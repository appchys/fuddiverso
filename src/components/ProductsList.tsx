'use client'

import React, { useState, useEffect } from 'react'
import { Product, Business } from '@/types'
import { getAllProducts, getAllBusinesses, updateProduct } from '@/lib/database'

const COMMISSION_RATE = 0.05 // 5% de comisión

// Redondear al 0.05 más cercano (para evitar centavos raros)
const roundToNearest005 = (value: number): number => {
  return Math.round(value * 20) / 20
}

interface ProductWithBusiness extends Product {
  businessName?: string
}

interface EditingProduct {
  productId: string
  currentPrice: number
  currentStoreEarnings: number
  newPrice: string
  mode: 'maintain-earnings' | 'maintain-price'
}

interface InlineEditing {
  productId: string
  newPrice: string
  mode: 'maintain-earnings' | 'maintain-price'
}

export default function ProductsList() {
  const [products, setProducts] = useState<ProductWithBusiness[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [filteredProducts, setFilteredProducts] = useState<ProductWithBusiness[]>([])
  const [loading, setLoading] = useState(true)
  const [filterBusiness, setFilterBusiness] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [editingProduct, setEditingProduct] = useState<EditingProduct | null>(null)
  const [inlineEditing, setInlineEditing] = useState<InlineEditing | null>(null)
  const [updatingPrices, setUpdatingPrices] = useState<Set<string>>(new Set())

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

  const calculateCommission = (price: number) => {
    return roundToNearest005(price * COMMISSION_RATE)
  }

  const calculateStoreEarnings = (price: number) => {
    return roundToNearest005(price * (1 - COMMISSION_RATE))
  }

  const openEditModal = (product: ProductWithBusiness) => {
    const earnings = calculateStoreEarnings(product.price)
    setEditingProduct({
      productId: product.id,
      currentPrice: product.price,
      currentStoreEarnings: earnings,
      newPrice: product.price.toString(),
      mode: 'maintain-earnings'
    })
  }

  const calculateNewPrice = (value: number, mode: 'maintain-earnings' | 'maintain-price'): number => {
    if (mode === 'maintain-price') {
      // El precio se mantiene igual, tienda recibe menos
      return value
    } else {
      // Modo: maintain-earnings
      // Si queremos que la tienda reciba X después de comisión
      // Precio público debe ser: X / (1 - 0.05) = X / 0.95
      return value / (1 - COMMISSION_RATE)
    }
  }

  const handleModeChange = (mode: 'maintain-earnings' | 'maintain-price') => {
    if (!editingProduct) return

    if (mode === 'maintain-price') {
      // La tienda quiere mantener el precio público
      setEditingProduct(prev => 
        prev ? {
          ...prev,
          mode: 'maintain-price',
          newPrice: prev.currentPrice.toFixed(2)
        } : null
      )
    } else {
      // La tienda quiere mantener sus ganancias
      setEditingProduct(prev => 
        prev ? {
          ...prev,
          mode: 'maintain-earnings',
          newPrice: prev.currentStoreEarnings.toFixed(2)
        } : null
      )
    }
  }

  const getPreviewPrices = () => {
    if (!editingProduct) return null

    const inputValue = parseFloat(editingProduct.newPrice) || 0

    if (editingProduct.mode === 'maintain-earnings') {
      // Input es lo que la tienda quiere recibir
      const newPublicPrice = roundToNearest005(calculateNewPrice(inputValue, 'maintain-earnings'))
      const newCommission = calculateCommission(newPublicPrice)
      return {
        publicPrice: newPublicPrice,
        commission: newCommission,
        storeEarnings: roundToNearest005(inputValue)
      }
    } else {
      // Input es el nuevo precio público
      const roundedInputValue = roundToNearest005(inputValue)
      const newCommission = calculateCommission(roundedInputValue)
      const newStoreEarnings = calculateStoreEarnings(roundedInputValue)
      return {
        publicPrice: roundedInputValue,
        commission: newCommission,
        storeEarnings: newStoreEarnings
      }
    }
  }

  const handleSavePrice = async () => {
    if (!editingProduct) return

    const preview = getPreviewPrices()
    if (!preview) return

    setUpdatingPrices(prev => new Set(prev).add(editingProduct.productId))

    try {
      await updateProduct(editingProduct.productId, {
        price: preview.publicPrice
      })

      // Actualizar el estado local
      setProducts(prev => prev.map(p =>
        p.id === editingProduct.productId
          ? { ...p, price: preview.publicPrice }
          : p
      ))

      setEditingProduct(null)
      alert('Precio actualizado exitosamente')
    } catch (error) {
      console.error('Error updating price:', error)
      alert('Error al actualizar el precio')
    } finally {
      setUpdatingPrices(prev => {
        const newSet = new Set(prev)
        newSet.delete(editingProduct.productId)
        return newSet
      })
    }
  }

  const handleSavePriceInline = async () => {
    if (!inlineEditing) return

    const inputValue = parseFloat(inlineEditing.newPrice) || 0
    let newPublicPrice: number

    if (inlineEditing.mode === 'maintain-earnings') {
      newPublicPrice = roundToNearest005(inputValue / (1 - COMMISSION_RATE))
    } else {
      newPublicPrice = roundToNearest005(inputValue)
    }

    setUpdatingPrices(prev => new Set(prev).add(inlineEditing.productId))

    try {
      await updateProduct(inlineEditing.productId, {
        price: newPublicPrice
      })

      // Actualizar el estado local
      setProducts(prev => prev.map(p =>
        p.id === inlineEditing.productId
          ? { ...p, price: newPublicPrice }
          : p
      ))

      setInlineEditing(null)
    } catch (error) {
      console.error('Error updating price:', error)
      alert('Error al actualizar el precio')
    } finally {
      setUpdatingPrices(prev => {
        const newSet = new Set(prev)
        newSet.delete(inlineEditing.productId)
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

  const preview = getPreviewPrices()

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Productos</h1>
          <p className="text-sm text-gray-500 mt-1">Gestión de precios y comisiones</p>
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

      {/* Tabla de Productos */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tienda</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Precio Público
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-red-500 uppercase tracking-wider">
                  Comisión (5%)
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-green-500 uppercase tracking-wider">
                  Tienda Recibe
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acción
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center">
                    <div className="flex flex-col items-center">
                      <i className="bi bi-inbox text-4xl text-gray-300 mb-3"></i>
                      <p className="text-gray-500 font-medium">No hay productos que coincidan con los filtros</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const commission = calculateCommission(product.price)
                  const storeEarnings = calculateStoreEarnings(product.price)
                  const isUpdating = updatingPrices.has(product.id)
                  const isBeingEdited = inlineEditing?.productId === product.id

                  return (
                    <React.Fragment key={product.id}>
                      <tr className={`hover:bg-gray-50 transition-colors ${isBeingEdited ? 'bg-blue-50' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            {product.image && (
                              <img
                                src={product.image}
                                alt={product.name}
                                className="w-10 h-10 rounded object-cover"
                              />
                            )}
                            <div>
                              <p className="font-medium text-gray-900">{product.name}</p>
                              <p className="text-xs text-gray-500">{product.category}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {product.businessName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-gray-900">
                            ${product.price.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className="text-sm font-medium text-red-600">
                            -${commission.toFixed(2)}
                          </span>
                          <p className="text-xs text-red-500">({(COMMISSION_RATE * 100).toFixed(0)}%)</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-green-600">
                            ${storeEarnings.toFixed(2)}
                          </span>
                          <p className="text-xs text-green-500">({((1 - COMMISSION_RATE) * 100).toFixed(0)}%)</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              product.isAvailable
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {product.isAvailable ? 'Disponible' : 'No disponible'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          {isBeingEdited ? (
                            <div className="flex items-center gap-2 justify-center">
                              <button
                                onClick={() => handleSavePriceInline()}
                                disabled={isUpdating}
                                className="px-2 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                {isUpdating ? 'Guardando...' : 'Guardar'}
                              </button>
                              <button
                                onClick={() => setInlineEditing(null)}
                                disabled={isUpdating}
                                className="px-2 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setInlineEditing({
                                productId: product.id,
                                newPrice: product.price.toString(),
                                mode: 'maintain-earnings'
                              })}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <i className="bi bi-pencil"></i>
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                      {/* Fila de edición inline */}
                      {isBeingEdited && (
                        <tr className="bg-blue-50 border-b-2 border-blue-200">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="space-y-4">
                              <div className="bg-blue-100 rounded px-4 py-3">
                                <p className="text-sm font-semibold text-blue-900 mb-3">Editar precio para {product.name}</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {/* Selector de modo */}
                                  <div>
                                    <label className="block text-xs font-semibold text-blue-800 mb-2">Tipo de ajuste</label>
                                    <select
                                      value={inlineEditing.mode}
                                      onChange={(e) => setInlineEditing(prev => ({
                                        ...prev!,
                                        mode: e.target.value as 'maintain-earnings' | 'maintain-price',
                                        newPrice: e.target.value === 'maintain-earnings' 
                                          ? storeEarnings.toString() 
                                          : product.price.toString()
                                      }))}
                                      className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    >
                                      <option value="maintain-earnings">Mantener mis ganancias (ingresa lo que deseas recibir)</option>
                                      <option value="maintain-price">Asumo comisión (ingresa precio público)</option>
                                    </select>
                                  </div>

                                  {/* Input de valor */}
                                  <div>
                                    <label className="block text-xs font-semibold text-blue-800 mb-2">
                                      {inlineEditing.mode === 'maintain-earnings' ? 'Monto a recibir:' : 'Precio público:'}
                                    </label>
                                    <div className="relative flex items-center gap-2">
                                      <div className="relative flex-1">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-gray-600">$</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={inlineEditing.newPrice}
                                          onChange={(e) => setInlineEditing(prev => ({
                                            ...prev!,
                                            newPrice: e.target.value
                                          }))}
                                          className="w-full pl-8 pr-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                          placeholder="0.00"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Preview */}
                                {inlineEditing && (
                                  <div className="mt-4 grid grid-cols-3 gap-3">
                                    {(() => {
                                      const inputValue = parseFloat(inlineEditing.newPrice) || 0
                                      let newPublicPrice: number
                                      if (inlineEditing.mode === 'maintain-earnings') {
                                        newPublicPrice = roundToNearest005(inputValue / (1 - COMMISSION_RATE))
                                      } else {
                                        newPublicPrice = roundToNearest005(inputValue)
                                      }
                                      const newCommission = calculateCommission(newPublicPrice)
                                      const newStoreEarnings = calculateStoreEarnings(newPublicPrice)
                                      
                                      return (
                                        <>
                                          <div className="bg-white rounded p-3 border border-blue-200">
                                            <p className="text-xs font-medium text-gray-600">Precio Público</p>
                                            <p className="text-lg font-bold text-gray-900 mt-1">${newPublicPrice.toFixed(2)}</p>
                                            <p className={`text-xs mt-1 font-semibold ${newPublicPrice > product.price ? 'text-green-600' : newPublicPrice < product.price ? 'text-red-600' : 'text-gray-600'}`}>
                                              {newPublicPrice > product.price ? '↑ +' : newPublicPrice < product.price ? '↓ -' : '='} ${Math.abs(newPublicPrice - product.price).toFixed(2)}
                                            </p>
                                          </div>
                                          <div className="bg-white rounded p-3 border border-blue-200">
                                            <p className="text-xs font-medium text-gray-600">Comisión (5%)</p>
                                            <p className="text-lg font-bold text-red-600 mt-1">-${newCommission.toFixed(2)}</p>
                                          </div>
                                          <div className="bg-white rounded p-3 border border-blue-200">
                                            <p className="text-xs font-medium text-gray-600">Tienda Recibe</p>
                                            <p className="text-lg font-bold text-green-600 mt-1">${newStoreEarnings.toFixed(2)}</p>
                                            <p className={`text-xs mt-1 font-semibold ${newStoreEarnings > storeEarnings ? 'text-green-600' : newStoreEarnings < storeEarnings ? 'text-red-600' : 'text-gray-600'}`}>
                                              {newStoreEarnings > storeEarnings ? '↑ +' : newStoreEarnings < storeEarnings ? '↓ -' : '='} ${Math.abs(newStoreEarnings - storeEarnings).toFixed(2)}
                                            </p>
                                          </div>
                                        </>
                                      )
                                    })()}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Edición */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* Encabezado - sin scroll */}
            <div className="p-6 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-2xl font-bold text-gray-900">Editar Precio</h3>
              <button
                onClick={() => setEditingProduct(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <i className="bi bi-x text-2xl text-gray-500"></i>
              </button>
            </div>

            {/* Contenido - scrolleable */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Producto actual */}
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-600 mb-1">Producto</p>
                <div className="flex items-center gap-3">
                  {filteredProducts.find(p => p.id === editingProduct.productId)?.image && (
                    <img
                      src={filteredProducts.find(p => p.id === editingProduct.productId)?.image}
                      alt="Producto"
                      className="w-12 h-12 rounded object-cover"
                    />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">
                      {filteredProducts.find(p => p.id === editingProduct.productId)?.name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {filteredProducts.find(p => p.id === editingProduct.productId)?.businessName}
                    </p>
                  </div>
                </div>
              </div>

              {/* Precio actual */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                  <p className="text-xs font-semibold text-blue-700 uppercase">Precio Actual</p>
                  <p className="text-2xl font-bold text-blue-900 mt-2">${editingProduct.currentPrice.toFixed(2)}</p>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-4 border border-red-200">
                  <p className="text-xs font-semibold text-red-700 uppercase">Comisión</p>
                  <p className="text-2xl font-bold text-red-900 mt-2">-${calculateCommission(editingProduct.currentPrice).toFixed(2)}</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                  <p className="text-xs font-semibold text-green-700 uppercase">Tienda Recibe</p>
                  <p className="text-2xl font-bold text-green-900 mt-2">${editingProduct.currentStoreEarnings.toFixed(2)}</p>
                </div>
              </div>

              {/* Opciones de cálculo */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-900">¿Qué quieres ajustar?</p>
                <div className="space-y-3">
                  {/* Opción 1: Mantener ganancias */}
                  <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    editingProduct.mode === 'maintain-earnings'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="mode"
                      value="maintain-earnings"
                      checked={editingProduct.mode === 'maintain-earnings'}
                      onChange={() => handleModeChange('maintain-earnings')}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">Mantener mis ganancias</p>
                      <p className="text-sm text-gray-600">Queremos recibir ${editingProduct.currentStoreEarnings.toFixed(2)} aunque aumente el precio público</p>
                      <p className="text-xs text-gray-500 mt-1">El precio público subirá para compensar la comisión</p>
                    </div>
                  </label>

                  {/* Opción 2: Mantener precio público */}
                  <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    editingProduct.mode === 'maintain-price'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="mode"
                      value="maintain-price"
                      checked={editingProduct.mode === 'maintain-price'}
                      onChange={() => handleModeChange('maintain-price')}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">Asumento yo la comisión</p>
                      <p className="text-sm text-gray-600">El precio público se mantiene igual, pero yo pago la comisión</p>
                      <p className="text-xs text-gray-500 mt-1">El precio público NO cambia, gano menos</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Input según la opción seleccionada */}
              <div className="space-y-3">
                <label className="block">
                  <p className="text-sm font-semibold text-gray-900 mb-2">
                    {editingProduct.mode === 'maintain-earnings'
                      ? 'Monto que deseas recibir'
                      : 'Nuevo precio público'}
                  </p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-gray-600">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingProduct.newPrice}
                      onChange={(e) => setEditingProduct(prev => ({
                        ...prev!,
                        newPrice: e.target.value
                      }))}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>
                </label>

                {editingProduct.mode === 'maintain-earnings' && (
                  <p className="text-xs text-gray-500 bg-blue-50 p-3 rounded-lg">
                    💡 Ingresa el monto que quieres recibir. El precio público se ajustará automáticamente para que después de la comisión, recibas este monto.
                  </p>
                )}
                {editingProduct.mode === 'maintain-price' && (
                  <p className="text-xs text-gray-500 bg-orange-50 p-3 rounded-lg">
                    💡 Ingresa el nuevo precio público. Este es el precio que verán los clientes y tú asumirás la comisión del 5%.
                  </p>
                )}
              </div>

              {/* Vista previa */}
              {preview && (
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-semibold text-purple-900">Resultado si aplicas este cambio:</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white rounded p-3">
                      <p className="text-xs font-medium text-gray-600">Precio Público</p>
                      <p className="text-lg font-bold text-gray-900 mt-1">${preview.publicPrice.toFixed(2)}</p>
                      {preview.publicPrice !== editingProduct.currentPrice && (
                        <p className={`text-xs mt-1 font-semibold ${
                          preview.publicPrice > editingProduct.currentPrice ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {preview.publicPrice > editingProduct.currentPrice ? '↑' : '↓'} ${Math.abs(preview.publicPrice - editingProduct.currentPrice).toFixed(2)}
                        </p>
                      )}
                    </div>
                    <div className="bg-white rounded p-3">
                      <p className="text-xs font-medium text-gray-600">Comisión</p>
                      <p className="text-lg font-bold text-red-600 mt-1">-${preview.commission.toFixed(2)}</p>
                    </div>
                    <div className="bg-white rounded p-3">
                      <p className="text-xs font-medium text-gray-600">Tienda Recibe</p>
                      <p className="text-lg font-bold text-green-600 mt-1">${preview.storeEarnings.toFixed(2)}</p>
                      {preview.storeEarnings !== editingProduct.currentStoreEarnings && (
                        <p className={`text-xs mt-1 font-semibold ${
                          preview.storeEarnings > editingProduct.currentStoreEarnings ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {preview.storeEarnings > editingProduct.currentStoreEarnings ? '↑' : '↓'} ${Math.abs(preview.storeEarnings - editingProduct.currentStoreEarnings).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Botones de acción - sin scroll */}
            <div className="p-6 border-t border-gray-200 flex gap-3 justify-end flex-shrink-0">
              <button
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSavePrice}
                disabled={!preview || updatingPrices.has(editingProduct.productId)}
                className="px-4 py-2 text-white bg-blue-600 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <i className="bi bi-check-circle"></i>
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Información de Comisión */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <i className="bi bi-info-circle text-2xl text-blue-600"></i>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-blue-900 mb-2">Cálculo de Comisiones</h3>
            <p className="text-sm text-blue-800 mb-2">
              Se aplica una comisión del 5% sobre el precio público de cada producto:
            </p>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• <strong>Precio Público:</strong> Es el precio que paga el cliente</li>
              <li>• <strong>Comisión (5%):</strong> Cantidad cobrada por Fuddi del precio público</li>
              <li>• <strong>Tienda Recibe:</strong> Dinero que recibe la tienda después de comisión</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
