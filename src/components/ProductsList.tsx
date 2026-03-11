'use client'

import React, { useState, useEffect } from 'react'
import { Product, Business, ProductVariant, CommissionType } from '@/types'
import { getAllProducts, getAllBusinesses, updateProduct } from '@/lib/database'

const COMMISSION_RATE = 0.05 // 5% de comisión base

// Redondear al 0.05 más cercano (para evitar centavos raros en el precio al cliente)
const roundToNearest005 = (value: number): number => {
  return Math.round(value * 20) / 20
}

interface ProductWithBusiness extends Product {
  businessName?: string
}

interface PriceState {
  storePrice: number
  commission: number
  publicPrice: number
  commissionType: CommissionType
  storeReceives: number
}

interface VariantPriceKey {
  productId: string
  variantId?: string
}

// Función para crear una clave única para identificar un producto/variante
const getPriceKey = (productId: string, variantId?: string): string => {
  return variantId ? `${productId}-${variantId}` : productId
}

export default function ProductsList() {
  const [products, setProducts] = useState<ProductWithBusiness[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [filteredProducts, setFilteredProducts] = useState<ProductWithBusiness[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBusiness, setFilterBusiness] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [priceStates, setPriceStates] = useState<Record<string, PriceState>>({})
  const [updatingPrices, setUpdatingPrices] = useState<Set<string>>(new Set())
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [lastSavedKey, setLastSavedKey] = useState<string | null>(null)
  const [isEditingPrices, setIsEditingPrices] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [products, businesses, filterBusiness, searchTerm])

  const loadData = async () => {
    try {
      setLoading(true)
      const [allProducts, allBusinesses] = await Promise.all([
        getAllProducts(),
        getAllBusinesses()
      ])

      // Mapear información de tienda a cada producto
      const productsWithBusiness = allProducts.map(product => {
        const business = allBusinesses.find(b => b.id === product.businessId)
        return {
          ...product,
          businessName: business?.name || 'Tienda desconocida'
        }
      })

      setProducts(productsWithBusiness)
      setBusinesses(allBusinesses)

      // Inicializar estados de precios
      const initialPriceStates: Record<string, PriceState> = {}
      productsWithBusiness.forEach(product => {
        const commissionType = product.commissionType || 'no_commission'
        const basePrice = product.basePrice !== undefined ? product.basePrice : product.price
        const commission = commissionType === 'no_commission' ? 0 : (product.commission !== undefined ? product.commission : 0)

        // Si es no_commission, el precio público es igual al precio de tienda (basePrice)
        const publicPrice = commissionType === 'no_commission' ? basePrice : product.price

        // Calcular "Tienda Recibe" basado en el tipo guardado
        let storeReceives = basePrice
        if (commissionType === 'fuddi_assumed_by_store') {
          storeReceives = product.price - (product.commission || 0)
        }

        // Estado para el producto principal
        initialPriceStates[getPriceKey(product.id)] = {
          storePrice: basePrice,
          commission: commission,
          publicPrice: publicPrice,
          commissionType: commissionType,
          storeReceives: storeReceives
        }

        // Estado para cada variante
        if (product.variants && product.variants.length > 0) {
          product.variants.forEach(variant => {
            const vCommissionType = variant.commissionType || 'no_commission'
            const vBasePrice = variant.basePrice !== undefined ? variant.basePrice : variant.price
            const vCommission = vCommissionType === 'no_commission' ? 0 : (variant.commission !== undefined ? variant.commission : 0)
            const vPublicPrice = vCommissionType === 'no_commission' ? vBasePrice : variant.price

            let vStoreReceives = vBasePrice
            if (vCommissionType === 'fuddi_assumed_by_store') {
              vStoreReceives = variant.price - (variant.commission || 0)
            }

            initialPriceStates[getPriceKey(product.id, variant.id)] = {
              storePrice: vBasePrice,
              commission: vCommission,
              publicPrice: vPublicPrice,
              commissionType: vCommissionType,
              storeReceives: vStoreReceives
            }
          })
        }
      })

      setPriceStates(initialPriceStates)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    let filtered = products

    // Filtrar por tienda
    if (filterBusiness !== 'all') {
      filtered = filtered.filter(p => p.businessId === filterBusiness)
    }

    // Filtrar por término de búsqueda
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.businessName?.toLowerCase().includes(term)
      )
    }

    setFilteredProducts(filtered)
  }

  const handleCommissionTypeChange = async (productId: string, variantId: string | undefined, type: CommissionType) => {
    const key = getPriceKey(productId, variantId)
    const currentState = priceStates[key]
    if (!currentState) return

    let newCommission = 0
    let newPublicPrice = currentState.storePrice
    let newStoreReceives = currentState.storePrice

    const rawCommission = currentState.storePrice * COMMISSION_RATE

    if (type === 'fuddi_assumed_by_customer') {
      // Cliente asume: comisión redondeada al 0.05 más cercano
      newCommission = roundToNearest005(rawCommission)
      newPublicPrice = roundToNearest005(currentState.storePrice + newCommission)
      newStoreReceives = currentState.storePrice
    } else if (type === 'fuddi_assumed_by_store') {
      // Tienda asume: comisión exacta (sin redondeo) y tienda recibe precio tienda menos comisión exacta
      newCommission = rawCommission
      newPublicPrice = currentState.storePrice
      newStoreReceives = currentState.storePrice - newCommission
    } else {
      // no_commission
      newCommission = 0
      newPublicPrice = currentState.storePrice
      newStoreReceives = currentState.storePrice
    }

    const newState = {
      ...currentState,
      commissionType: type,
      commission: newCommission,
      publicPrice: newPublicPrice,
      storeReceives: newStoreReceives
    }

    setPriceStates(prev => ({
      ...prev,
      [key]: newState
    }))

    // Auto-save logic
    await handleOfficalizePrice(productId, variantId, newState)
  }

  const handleStorePriceChange = async (productId: string, variantId: string | undefined, newStorePrice: number) => {
    const key = getPriceKey(productId, variantId)
    const currentState = priceStates[key]
    if (!currentState) return

    let newCommission = 0
    let newPublicPrice = newStorePrice
    let newStoreReceives = newStorePrice

    const rawCommission = newStorePrice * COMMISSION_RATE

    if (currentState.commissionType === 'fuddi_assumed_by_customer') {
      // Cliente asume: comisión redondeada al 0.05 más cercano
      newCommission = roundToNearest005(rawCommission)
      newPublicPrice = roundToNearest005(newStorePrice + newCommission)
      newStoreReceives = newStorePrice
    } else if (currentState.commissionType === 'fuddi_assumed_by_store') {
      // Tienda asume: comisión exacta (sin redondeo) y tienda recibe precio tienda menos comisión exacta
      newCommission = rawCommission
      newPublicPrice = newStorePrice
      newStoreReceives = newStorePrice - newCommission
    } else {
      // no_commission
      newCommission = 0
      newPublicPrice = newStorePrice
      newStoreReceives = newStorePrice
    }

    const newState = {
      ...currentState,
      storePrice: newStorePrice,
      commission: newCommission,
      publicPrice: newPublicPrice,
      storeReceives: newStoreReceives
    }

    setPriceStates(prev => ({
      ...prev,
      [key]: newState
    }))

    // Auto-save logic
    await handleOfficalizePrice(productId, variantId, newState)
  }

  const handleOfficalizePrice = async (productId: string, variantId?: string, overrideState?: PriceState) => {
    const key = getPriceKey(productId, variantId)
    const currentState = overrideState || priceStates[key]
    if (!currentState) return

    setUpdatingPrices(prev => new Set(prev).add(key))

    try {
      const product = products.find(p => p.id === productId)
      if (!product) return

      const updateData = {
        price: currentState.publicPrice,
        basePrice: currentState.storePrice,
        commission: currentState.commission,
        commissionType: currentState.commissionType,
        updatedAt: new Date()
      }

      if (variantId) {
        // Actualizar variante
        const updatedVariants = product.variants?.map(v =>
          v.id === variantId
            ? {
              ...v,
              price: currentState.publicPrice,
              basePrice: currentState.storePrice,
              commission: currentState.commission,
              commissionType: currentState.commissionType
            }
            : v
        ) || []

        await updateProduct(productId, {
          variants: updatedVariants,
          updatedAt: new Date()
        } as Partial<Product>)

        // Actualizar estado local de productos
        setProducts(prev => prev.map(p =>
          p.id === productId
            ? { ...p, variants: updatedVariants }
            : p
        ))
      } else {
        // Actualizar producto principal
        await updateProduct(productId, updateData)

        // Actualizar estado local
        setProducts(prev => prev.map(p =>
          p.id === productId
            ? {
              ...p,
              ...updateData
            }
            : p
        ))
      }

      // Feedback sutil
      setLastSavedKey(key)
      setTimeout(() => setLastSavedKey(null), 2000)
    } catch (error) {
      console.error('Error auto-saving:', error)
    } finally {
      setUpdatingPrices(prev => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const toggleProductExpanded = (productId: string) => {
    setExpandedProducts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(productId)) {
        newSet.delete(productId)
      } else {
        newSet.add(productId)
      }
      return newSet
    })
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Productos y Variantes</h1>
          <p className="text-sm text-gray-500 mt-1">Gestión de precios y comisiones por producto y variante</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsEditingPrices(!isEditingPrices)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isEditingPrices 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <i className={`bi bi-${isEditingPrices ? 'check-lg' : 'pencil'}`}></i>
            {isEditingPrices ? 'Guardando...' : 'Editar Precios Tienda'}
          </button>
          <div className="text-right">
            <p className="text-lg font-semibold text-gray-900">{filteredProducts.length}</p>
            <p className="text-xs text-gray-500">Productos mostrados</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Filtro por Tienda */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tienda</label>
            <select
              value={filterBusiness}
              onChange={(e) => setFilterBusiness(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">Todas las tiendas ({businesses.length})</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </div>

          {/* Búsqueda por Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Buscar Producto</label>
            <input
              type="text"
              placeholder="Nombre del producto o tienda..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Lista de Productos Table Mode */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Producto</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Tienda</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">P. Tienda</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Trato Comisión</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Comisión</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">P. Público</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Recibe</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    No hay productos que coincidan con los filtros
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const isExpanded = expandedProducts.has(product.id)
                  const hasVariants = product.variants && product.variants.length > 0
                  const mainKey = getPriceKey(product.id)
                  const mainPriceState = priceStates[mainKey] || {
                    storePrice: product.basePrice !== undefined ? product.basePrice : product.price,
                    commission: 0,
                    publicPrice: product.basePrice !== undefined ? product.basePrice : product.price,
                    commissionType: 'no_commission',
                    storeReceives: product.basePrice !== undefined ? product.basePrice : product.price
                  }
                  const isMainUpdating = updatingPrices.has(mainKey)
                  const isMainSaved = lastSavedKey === mainKey

                  return (
                    <React.Fragment key={product.id}>
                      <tr className={`${isExpanded ? 'bg-blue-50/30' : 'hover:bg-gray-50'} transition-colors group`}>
                        {/* Producto */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {product.image ? (
                              <img src={product.image} alt={product.name} className="w-10 h-10 rounded object-cover border border-gray-100" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400">
                                <i className="bi bi-box"></i>
                              </div>
                            )}
                            <div>
                              <p className="font-semibold text-gray-900 text-sm">{product.name}</p>
                              {hasVariants && (
                                <button
                                  onClick={() => toggleProductExpanded(product.id)}
                                  className="text-[10px] text-blue-600 font-bold uppercase hover:underline flex items-center gap-1 mt-0.5"
                                >
                                  {product.variants!.length} Variantes
                                  <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Tienda */}
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {product.businessName}
                        </td>

                        {/* P. Tienda */}
                        <td className="px-6 py-4">
                          {isEditingPrices ? (
                            <input
                              type="number"
                              value={mainPriceState.storePrice}
                              onChange={(e) => {
                                const value = parseFloat(e.target.value)
                                if (!isNaN(value) && value >= 0) {
                                  handleStorePriceChange(product.id, undefined, value)
                                }
                              }}
                              disabled={isMainUpdating}
                              className="w-20 px-2 py-1 text-sm font-medium text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              step="0.01"
                              min="0"
                            />
                          ) : (
                            <span className="font-medium text-gray-900 text-sm">
                              ${mainPriceState.storePrice.toFixed(2)}
                            </span>
                          )}
                        </td>

                        {/* Trato */}
                        <td className="px-6 py-4">
                          <select
                            value={mainPriceState.commissionType}
                            onChange={(e) => handleCommissionTypeChange(product.id, undefined, e.target.value as CommissionType)}
                            disabled={isMainUpdating}
                            className="text-xs border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 bg-transparent py-1"
                          >
                            <option value="no_commission">Pendiente</option>
                            <option value="fuddi_assumed_by_customer">Cliente asume</option>
                            <option value="fuddi_assumed_by_store">Tienda asume</option>
                          </select>
                        </td>

                        {/* Comisión */}
                        <td className="px-6 py-4 text-sm">
                          <span className={`${mainPriceState.commission > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                            ${mainPriceState.commission.toFixed(2)}
                          </span>
                        </td>

                        {/* P. Público */}
                        <td className="px-6 py-4 font-bold text-gray-900 text-sm">
                          ${mainPriceState.publicPrice.toFixed(2)}
                        </td>

                        {/* Recibe */}
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-green-50 text-green-700">
                            ${mainPriceState.storeReceives.toFixed(2)}
                          </span>
                        </td>

                        {/* Status / Auto-save feedback */}
                        <td className="px-6 py-4 text-right">
                          {isMainUpdating ? (
                            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                          ) : isMainSaved ? (
                            <i className="bi bi-check-circle-fill text-green-500 text-lg animate-pulse"></i>
                          ) : null}
                        </td>
                      </tr>

                      {/* Variantes en la tabla */}
                      {isExpanded && product.variants?.map((variant) => {
                        const variantKey = getPriceKey(product.id, variant.id)
                        const variantPriceState = priceStates[variantKey] || {
                          storePrice: variant.basePrice !== undefined ? variant.basePrice : variant.price,
                          commission: 0,
                          publicPrice: variant.basePrice !== undefined ? variant.basePrice : variant.price,
                          commissionType: 'no_commission',
                          storeReceives: variant.basePrice !== undefined ? variant.basePrice : variant.price
                        }
                        const isVariantUpdating = updatingPrices.has(variantKey)
                        const isVariantSaved = lastSavedKey === variantKey

                        return (
                          <tr key={variant.id} className="bg-gray-50/50 border-l-4 border-blue-200">
                            <td className="px-6 py-3 pl-14">
                              <p className="text-gray-700 text-xs font-medium">{variant.name}</p>
                            </td>
                            <td className="px-6 py-3 text-xs text-gray-400 italic">Variante</td>
                            <td className="px-6 py-3">
                              {isEditingPrices ? (
                                <input
                                  type="number"
                                  value={variantPriceState.storePrice}
                                  onChange={(e) => {
                                    const value = parseFloat(e.target.value)
                                    if (!isNaN(value) && value >= 0) {
                                      handleStorePriceChange(product.id, variant.id, value)
                                    }
                                  }}
                                  disabled={isVariantUpdating}
                                  className="w-16 px-1 py-0.5 text-xs text-gray-700 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                                  step="0.01"
                                  min="0"
                                />
                              ) : (
                                <span className="text-xs text-gray-700">
                                  ${variantPriceState.storePrice.toFixed(2)}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-3">
                              <select
                                value={variantPriceState.commissionType}
                                onChange={(e) => handleCommissionTypeChange(product.id, variant.id, e.target.value as CommissionType)}
                                disabled={isVariantUpdating}
                                className="text-[10px] border-gray-200 rounded py-0.5 bg-transparent"
                              >
                                <option value="no_commission">Pendiente</option>
                                <option value="fuddi_assumed_by_customer">Cliente asume</option>
                                <option value="fuddi_assumed_by_store">Tienda asume</option>
                              </select>
                            </td>
                            <td className="px-6 py-3 text-xs text-gray-500">${variantPriceState.commission.toFixed(2)}</td>
                            <td className="px-6 py-3 text-xs font-bold text-gray-800">${variantPriceState.publicPrice.toFixed(2)}</td>
                            <td className="px-6 py-3">
                              <span className="text-[10px] font-bold text-green-600">${variantPriceState.storeReceives.toFixed(2)}</span>
                            </td>
                            <td className="px-6 py-3 text-right">
                              {isVariantUpdating ? (
                                <div className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                              ) : isVariantSaved ? (
                                <i className="bi bi-check-circle-fill text-green-500 text-sm"></i>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Información de Comisión */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <i className="bi bi-info-circle text-2xl text-blue-600"></i>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-blue-900 mb-2">¿Cómo funciona?</h3>
            <p className="text-sm text-blue-800 mb-3">
              El sistema trabaja con tres valores para cada producto/variante:
            </p>
            <ul className="text-sm text-blue-800 space-y-2">
              <li>
                <strong>Precio Tienda:</strong> Es el precio base que registraste. Inicialmente, este es el precio público.
              </li>
              <li>
                <strong>Comisión:</strong> Se calcula al 5% del precio tienda cuando presionas "Oficializar". Inicialmente es $0.00.
              </li>
              <li>
                <strong>Precio Público:</strong> Es lo que pagarán los clientes (Precio Tienda + Comisión). Puedes revisar y oficializar cada producto/variante manualmente.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
