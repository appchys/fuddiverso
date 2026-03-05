'use client'

import React, { useState, useEffect } from 'react'
import { Product, Business, ProductVariant } from '@/types'
import { getAllProducts, getAllBusinesses, updateProduct } from '@/lib/database'

const COMMISSION_RATE = 0.05 // 5% de comisión

// Redondear al 0.05 más cercano (para evitar centavos raros)
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
        // Estado para el producto principal
        initialPriceStates[getPriceKey(product.id)] = {
          storePrice: product.price,
          commission: 0,
          publicPrice: product.price
        }

        // Estado para cada variante
        if (product.variants && product.variants.length > 0) {
          product.variants.forEach(variant => {
            initialPriceStates[getPriceKey(product.id, variant.id)] = {
              storePrice: variant.price,
              commission: 0,
              publicPrice: variant.price
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

  const calculateCommission = (storePrice: number): number => {
    return roundToNearest005(storePrice * COMMISSION_RATE)
  }

  const handleOfficalizePrice = async (productId: string, variantId?: string) => {
    const key = getPriceKey(productId, variantId)
    const currentState = priceStates[key]
    if (!currentState) return

    // Calcular nueva comisión al 5%
    const newCommission = calculateCommission(currentState.storePrice)
    const newPublicPrice = roundToNearest005(currentState.storePrice + newCommission)

    setUpdatingPrices(prev => new Set(prev).add(key))

    try {
      const product = products.find(p => p.id === productId)
      if (!product) return

      if (variantId) {
        // Actualizar variante
        const updatedVariants = product.variants?.map(v =>
          v.id === variantId
            ? { ...v, price: newPublicPrice }
            : v
        ) || []

        await updateProduct(productId, {
          variants: updatedVariants
        } as Partial<Product>)

        // Actualizar estado local de productos
        setProducts(prev => prev.map(p =>
          p.id === productId
            ? { ...p, variants: updatedVariants }
            : p
        ))
      } else {
        // Actualizar producto principal
        await updateProduct(productId, {
          price: newPublicPrice
        })

        // Actualizar estado local
        setProducts(prev => prev.map(p =>
          p.id === productId
            ? { ...p, price: newPublicPrice }
            : p
        ))
      }

      // Actualizar estado de precios
      setPriceStates(prev => ({
        ...prev,
        [key]: {
          storePrice: currentState.storePrice,
          commission: newCommission,
          publicPrice: newPublicPrice
        }
      }))

      alert('Precio oficializado correctamente')
    } catch (error) {
      console.error('Error updating price:', error)
      alert('Error al oficializar el precio')
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
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{filteredProducts.length}</p>
          <p className="text-xs text-gray-500">Productos mostrados</p>
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

      {/* Lista de Productos */}
      <div className="space-y-4">
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
            <div className="flex flex-col items-center">
              <i className="bi bi-inbox text-4xl text-gray-300 mb-3"></i>
              <p className="text-gray-500 font-medium">No hay productos que coincidan con los filtros</p>
            </div>
          </div>
        ) : (
          filteredProducts.map((product) => {
            const isExpanded = expandedProducts.has(product.id)
            const hasVariants = product.variants && product.variants.length > 0
            const mainKey = getPriceKey(product.id)
            const mainPriceState = priceStates[mainKey] || {
              storePrice: product.price,
              commission: 0,
              publicPrice: product.price
            }
            const isMainUpdating = updatingPrices.has(mainKey)

            return (
              <div key={product.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Producto Principal */}
                <div className="p-6 border-b border-gray-200 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      {product.image && (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-16 h-16 rounded object-cover"
                        />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-gray-900">{product.name}</h3>
                          {hasVariants && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              Con variantes
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{product.businessName}</p>
                        <p className="text-xs text-gray-500">{product.category}</p>
                      </div>
                    </div>

                    {/* Estado disponibilidad */}
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          product.isAvailable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {product.isAvailable ? 'Disponible' : 'No disponible'}
                      </span>
                    </div>
                  </div>

                  {/* Precios producto principal */}
                  <div className="mt-6 grid grid-cols-3 md:grid-cols-4 gap-3">
                    <div className="bg-blue-50 rounded p-3 border border-blue-200">
                      <p className="text-xs font-medium text-blue-700 mb-1">Precio Tienda</p>
                      <p className="text-lg font-bold text-blue-900">${mainPriceState.storePrice.toFixed(2)}</p>
                    </div>
                    <div className="bg-orange-50 rounded p-3 border border-orange-200">
                      <p className="text-xs font-medium text-orange-700 mb-1">Comisión</p>
                      <p className="text-lg font-bold text-orange-900">${mainPriceState.commission.toFixed(2)}</p>
                      <p className="text-xs text-orange-600 mt-1">({(COMMISSION_RATE * 100).toFixed(0)}%)</p>
                    </div>
                    <div className="bg-green-50 rounded p-3 border border-green-200">
                      <p className="text-xs font-medium text-green-700 mb-1">Precio Público</p>
                      <p className="text-lg font-bold text-green-900">${mainPriceState.publicPrice.toFixed(2)}</p>
                    </div>
                    <div className="col-span-3 md:col-span-1">
                      <button
                        onClick={() => handleOfficalizePrice(product.id)}
                        disabled={isMainUpdating}
                        className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isMainUpdating ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Guardando...
                          </>
                        ) : (
                          <>
                            <i className="bi bi-check-circle"></i>
                            Oficializar
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Variantes */}
                {hasVariants && (
                  <>
                    {/* Botón expandir/contraer */}
                    <button
                      onClick={() => toggleProductExpanded(product.id)}
                      className="w-full px-6 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-200 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-500`}></i>
                        <span>{isExpanded ? 'Ocultar' : 'Mostrar'} variantes ({product.variants!.length})</span>
                      </div>
                    </button>

                    {/* Lista de variantes */}
                    {isExpanded && (
                      <div className="bg-gray-50 divide-y divide-gray-200">
                        {product.variants!.map((variant) => {
                          const variantKey = getPriceKey(product.id, variant.id)
                          const variantPriceState = priceStates[variantKey] || {
                            storePrice: variant.price,
                            commission: 0,
                            publicPrice: variant.price
                          }
                          const isVariantUpdating = updatingPrices.has(variantKey)

                          return (
                            <div key={variant.id} className="p-6 hover:bg-gray-100 transition-colors">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <h4 className="font-medium text-gray-900 mb-1">{variant.name}</h4>
                                  {variant.description && (
                                    <p className="text-sm text-gray-600 mb-2">{variant.description}</p>
                                  )}
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      variant.isAvailable
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-gray-100 text-gray-800'
                                    }`}
                                  >
                                    {variant.isAvailable ? 'Disponible' : 'No disponible'}
                                  </span>
                                </div>

                                {/* Precios variante */}
                                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 flex-1 ml-4">
                                  <div className="bg-blue-50 rounded p-3 border border-blue-200">
                                    <p className="text-xs font-medium text-blue-700 mb-1">Precio Tienda</p>
                                    <p className="text-lg font-bold text-blue-900">${variantPriceState.storePrice.toFixed(2)}</p>
                                  </div>
                                  <div className="bg-orange-50 rounded p-3 border border-orange-200">
                                    <p className="text-xs font-medium text-orange-700 mb-1">Comisión</p>
                                    <p className="text-lg font-bold text-orange-900">${variantPriceState.commission.toFixed(2)}</p>
                                    <p className="text-xs text-orange-600 mt-1">({(COMMISSION_RATE * 100).toFixed(0)}%)</p>
                                  </div>
                                  <div className="bg-green-50 rounded p-3 border border-green-200">
                                    <p className="text-xs font-medium text-green-700 mb-1">Precio Público</p>
                                    <p className="text-lg font-bold text-green-900">${variantPriceState.publicPrice.toFixed(2)}</p>
                                  </div>
                                  <div>
                                    <button
                                      onClick={() => handleOfficalizePrice(product.id, variant.id)}
                                      disabled={isVariantUpdating}
                                      className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                      {isVariantUpdating ? (
                                        <>
                                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        </>
                                      ) : (
                                        <i className="bi bi-check-circle"></i>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })
        )}
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
