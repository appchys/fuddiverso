'use client'

import React, { useState, useEffect } from 'react'
import { Product, Business, ProductVariant, CommissionType } from '@/types'
import { getAllProducts, getAllBusinesses, updateBusiness, updateProduct } from '@/lib/database'
import {
  calculateCommissionPricing,
  getBusinessCommissionSettings,
  normalizeCommissionRate
} from '@/lib/price-utils'

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

// Clave única para producto o variante
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
  const [businessSettingsDrafts, setBusinessSettingsDrafts] = useState<Record<string, {
    defaultCommissionType: CommissionType
    commissionRate: number
  }>>({})
  const [savingBusinessSettings, setSavingBusinessSettings] = useState<Set<string>>(new Set())

  // Pestañas y guías
  const [activeTab, setActiveTab] = useState<'products' | 'stores'>('products')
  const [showInfoGuide, setShowInfoGuide] = useState(false)

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

      const productsWithBusiness = allProducts.map(product => {
        const business = allBusinesses.find(b => b.id === product.businessId)
        return {
          ...product,
          businessName: business?.name || 'Tienda desconocida'
        }
      })

      setProducts(productsWithBusiness)
      setBusinesses(allBusinesses)
      setBusinessSettingsDrafts(
        Object.fromEntries(
          allBusinesses.map(business => {
            const settings = getBusinessCommissionSettings(business)
            return [business.id, settings]
          })
        )
      )

      // Inicializar estados de precios
      const initialPriceStates: Record<string, PriceState> = {}
      productsWithBusiness.forEach(product => {
        const commissionType = product.commissionType || 'no_commission'
        const basePrice = product.basePrice !== undefined ? product.basePrice : product.price
        const commission = commissionType === 'no_commission' ? 0 : (product.commission !== undefined ? product.commission : 0)
        let publicPrice = basePrice
        if (commissionType === 'fixed_commission') {
          publicPrice = product.price !== undefined ? product.price : basePrice + commission
        } else if (commissionType !== 'no_commission') {
          publicPrice = product.price
        }
        const storeReceives = commissionType === 'fuddi_assumed_by_store'
          ? product.price - (product.commission || 0)
          : basePrice

        initialPriceStates[getPriceKey(product.id)] = {
          storePrice: basePrice,
          commission: commission,
          publicPrice: publicPrice,
          commissionType: commissionType,
          storeReceives: storeReceives
        }

        if (product.variants && product.variants.length > 0) {
          product.variants.forEach(variant => {
            const vCommissionType = variant.commissionType || 'no_commission'
            const vBasePrice = variant.basePrice !== undefined ? variant.basePrice : variant.price
            const vCommission = vCommissionType === 'no_commission' ? 0 : (variant.commission !== undefined ? variant.commission : 0)
            let vPublicPrice = vBasePrice
            if (vCommissionType === 'fixed_commission') {
              vPublicPrice = variant.price !== undefined ? variant.price : vBasePrice + vCommission
            } else if (vCommissionType !== 'no_commission') {
              vPublicPrice = variant.price
            }
            const vStoreReceives = vCommissionType === 'fuddi_assumed_by_store'
              ? variant.price - (variant.commission || 0)
              : vBasePrice

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

    if (filterBusiness !== 'all') {
      filtered = filtered.filter(p => p.businessId === filterBusiness)
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.businessName?.toLowerCase().includes(term)
      )
    }

    setFilteredProducts(filtered)
  }

  const getBusinessForProduct = (productId: string) => {
    const product = products.find(p => p.id === productId)
    return businesses.find(b => b.id === product?.businessId)
  }

  const getCommissionRateForProduct = (productId: string) => {
    const business = getBusinessForProduct(productId)
    return getBusinessCommissionSettings(business).commissionRate
  }

  const handleSaveBusinessCommissionSettings = async (businessId: string) => {
    const businessDraft = businessSettingsDrafts[businessId]
    if (!businessDraft) return
    const normalizedRate = normalizeCommissionRate(businessDraft.commissionRate)
    const updates = {
      defaultCommissionType: businessDraft.defaultCommissionType,
      commissionRate: normalizedRate
    }

    setSavingBusinessSettings(prev => new Set(prev).add(businessId))
    try {
      await updateBusiness(businessId, {
        ...updates,
        updatedAt: new Date()
      })

      setBusinesses(prev => prev.map(business =>
        business.id === businessId
          ? { ...business, ...updates, updatedAt: new Date() }
          : business
      ))

      setBusinessSettingsDrafts(prev => ({
        ...prev,
        [businessId]: updates
      }))
    } catch (error) {
      console.error('Error saving business commission settings:', error)
      alert('No se pudo guardar la configuración de comisión de la tienda.')
    } finally {
      setSavingBusinessSettings(prev => {
        const next = new Set(prev)
        next.delete(businessId)
        return next
      })
    }
  }

  const handleCommissionTypeChange = async (productId: string, variantId: string | undefined, type: CommissionType) => {
    const key = getPriceKey(productId, variantId)
    const currentState = priceStates[key]
    if (!currentState) return

    const newState = {
      ...currentState,
      ...calculateCommissionPricing(
        currentState.storePrice,
        type,
        getCommissionRateForProduct(productId),
        currentState.commission
      )
    }

    setPriceStates(prev => ({
      ...prev,
      [key]: newState
    }))

    await handleOfficalizePrice(productId, variantId, newState)
  }

  const handleCommissionValueChange = (productId: string, variantId: string | undefined, newCommission: number) => {
    const key = getPriceKey(productId, variantId)
    const currentState = priceStates[key]
    if (!currentState) return

    const newState = {
      ...currentState,
      ...calculateCommissionPricing(
        currentState.storePrice,
        'fixed_commission',
        getCommissionRateForProduct(productId),
        newCommission
      )
    }

    setPriceStates(prev => ({
      ...prev,
      [key]: newState
    }))
  }

  const handleStorePriceChange = (productId: string, variantId: string | undefined, newStorePrice: number) => {
    const key = getPriceKey(productId, variantId)
    const currentState = priceStates[key]
    if (!currentState) return

    const newState = {
      ...currentState,
      ...calculateCommissionPricing(
        newStorePrice,
        currentState.commissionType,
        getCommissionRateForProduct(productId),
        currentState.commission
      )
    }

    setPriceStates(prev => ({
      ...prev,
      [key]: newState
    }))
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

        setProducts(prev => prev.map(p =>
          p.id === productId
            ? { ...p, variants: updatedVariants }
            : p
        ))
      } else {
        await updateProduct(productId, updateData)

        setProducts(prev => prev.map(p =>
          p.id === productId
            ? {
              ...p,
              ...updateData
            }
            : p
        ))
      }

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

  const getCommissionBadgeClass = (type: CommissionType) => {
    switch (type) {
      case 'fuddi_assumed_by_customer':
        return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'fuddi_assumed_by_store':
        return 'bg-purple-50 text-purple-700 border-purple-200'
      case 'fixed_commission':
        return 'bg-amber-50 text-amber-800 border-amber-300 font-semibold'
      default:
        return 'bg-gray-50 text-gray-500 border-gray-200'
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[350px] gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-3 border-blue-600 border-t-transparent"></div>
        <p className="text-sm font-medium text-slate-500">Cargando catálogo de tiendas...</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-10">
      {/* Header & Main Navigation */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
              <i className="bi bi-box-seam"></i>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Catálogo y Precios de Tiendas</h1>
              <p className="text-xs text-slate-500 font-medium">Gestión rápida de precios, variantes y comisiones</p>
            </div>
          </div>
        </div>

        {/* Tab Switcher & Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-slate-100/80 p-1 rounded-xl flex items-center gap-1 border border-slate-200/50">
            <button
              onClick={() => setActiveTab('products')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'products'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <i className="bi bi-tag"></i>
              Productos
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200/60 text-slate-700">
                {filteredProducts.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('stores')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'stores'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <i className="bi bi-shop"></i>
              Tiendas
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200/60 text-slate-700">
                {businesses.length}
              </span>
            </button>
          </div>

          <button
            onClick={() => setIsEditingPrices(!isEditingPrices)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm ${
              isEditingPrices
                ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <i className={`bi bi-${isEditingPrices ? 'check2-circle' : 'pencil-square'}`}></i>
            {isEditingPrices ? 'Edición Activa' : 'Editar Precios'}
          </button>

          <button
            onClick={() => setShowInfoGuide(!showInfoGuide)}
            className={`p-2 rounded-xl text-xs transition-colors border ${
              showInfoGuide
                ? 'bg-blue-50 text-blue-600 border-blue-200'
                : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50'
            }`}
            title="¿Cómo funcionan los tratos de comisión?"
          >
            <i className="bi bi-info-circle text-sm"></i>
          </button>
        </div>
      </div>

      {/* Collapsible Info Guide */}
      {showInfoGuide && (
        <div className="bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-blue-50/90 border border-blue-200/70 rounded-2xl p-5 text-sm text-blue-900 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <i className="bi bi-lightbulb text-xl text-blue-600 mt-0.5"></i>
              <div>
                <h3 className="font-bold text-slate-900 text-sm mb-1">Guía Rápida de Comisiones Fuddi</h3>
                <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                  Cada producto o variante maneja su trato independientemente. Los valores clave son:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-blue-100">
                    <span className="font-bold text-slate-800 block mb-0.5">Pendiente</span>
                    <span className="text-slate-500 text-[11px]">Sin comisión aplicada ($0.00). P. Público = P. Tienda.</span>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-blue-100">
                    <span className="font-bold text-blue-700 block mb-0.5">Cliente asume</span>
                    <span className="text-slate-500 text-[11px]">Se suma el % configurado al precio cliente. La tienda recibe el 100%.</span>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-blue-100">
                    <span className="font-bold text-purple-700 block mb-0.5">Tienda asume</span>
                    <span className="text-slate-500 text-[11px]">El precio cliente no cambia. Fuddi descuenta el % de la ganancia tienda.</span>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-amber-200/70">
                    <span className="font-bold text-amber-700 block mb-0.5">Fija ($)</span>
                    <span className="text-slate-500 text-[11px]">Valor manual en dinero ($) por producto, independiente del %.</span>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowInfoGuide(false)}
              className="text-slate-400 hover:text-slate-600 text-base"
            >
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        </div>
      )}

      {/* PRODUCTS TAB */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          {/* Controls & Filter Bar */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 w-full md:w-auto flex-1">
              {/* Search input */}
              <div className="relative flex-1 md:max-w-md">
                <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  placeholder="Buscar por nombre o tienda..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    <i className="bi bi-x-circle-fill"></i>
                  </button>
                )}
              </div>

              {/* Store Filter Dropdown */}
              <div className="relative min-w-[170px]">
                <select
                  value={filterBusiness}
                  onChange={(e) => setFilterBusiness(e.target.value)}
                  className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="all">Todas las tiendas ({businesses.length})</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <i className="bi bi-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none"></i>
              </div>
            </div>

            {/* Quick Filter Reset if active */}
            {(filterBusiness !== 'all' || searchTerm !== '') && (
              <button
                onClick={() => {
                  setFilterBusiness('all')
                  setSearchTerm('')
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 self-end md:self-auto px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <i className="bi bi-arrow-counterclockwise"></i>
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Products Table Container */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3.5 px-5">Producto</th>
                    <th className="py-3.5 px-4">Tienda</th>
                    <th className="py-3.5 px-4">P. Tienda</th>
                    <th className="py-3.5 px-4">Trato Comisión</th>
                    <th className="py-3.5 px-4">Comisión</th>
                    <th className="py-3.5 px-4">P. Público</th>
                    <th className="py-3.5 px-4">Recibe</th>
                    <th className="py-3.5 px-4 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <i className="bi bi-box-seam text-3xl text-slate-300"></i>
                          <p className="font-medium text-slate-500 text-sm">No se encontraron productos</p>
                          <p className="text-xs text-slate-400">Intenta cambiar los filtros o el término de búsqueda</p>
                        </div>
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
                          <tr className={`transition-colors ${isExpanded ? 'bg-blue-50/20' : 'hover:bg-slate-50/60'}`}>
                            {/* Producto */}
                            <td className="py-3 px-5">
                              <div className="flex items-center gap-3">
                                {product.image ? (
                                  <img src={product.image} alt={product.name} className="w-9 h-9 rounded-lg object-cover border border-slate-100 shadow-2xs" />
                                ) : (
                                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                                    <i className="bi bi-box"></i>
                                  </div>
                                )}
                                <div>
                                  <p className="font-semibold text-slate-900 text-xs leading-snug">{product.name}</p>
                                  {hasVariants && (
                                    <button
                                      onClick={() => toggleProductExpanded(product.id)}
                                      className="text-[10px] text-blue-600 font-bold uppercase tracking-wider hover:text-blue-700 flex items-center gap-1 mt-0.5 group"
                                    >
                                      <span>{product.variants!.length} Variantes</span>
                                      <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-[9px] transition-transform`}></i>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Tienda */}
                            <td className="py-3 px-4 text-slate-500 font-medium">
                              {product.businessName}
                            </td>

                            {/* P. Tienda */}
                            <td className="py-3 px-4">
                              {isEditingPrices ? (
                                <div className="relative w-20">
                                  <span className="absolute inset-y-0 left-2 flex items-center text-xs text-slate-400">$</span>
                                  <input
                                    type="number"
                                    value={mainPriceState.storePrice}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value)
                                      if (!isNaN(value) && value >= 0) {
                                        handleStorePriceChange(product.id, undefined, value)
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleOfficalizePrice(product.id, undefined)
                                        ;(e.target as HTMLInputElement).blur()
                                      }
                                    }}
                                    onBlur={() => {
                                      handleOfficalizePrice(product.id, undefined)
                                    }}
                                    disabled={isMainUpdating}
                                    className="w-full pl-5 pr-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    step="0.01"
                                    min="0"
                                  />
                                </div>
                              ) : (
                                <span className="font-semibold text-slate-800">
                                  ${mainPriceState.storePrice.toFixed(2)}
                                </span>
                              )}
                            </td>

                            {/* Trato Comisión */}
                            <td className="py-3 px-4">
                              <select
                                value={mainPriceState.commissionType}
                                onChange={(e) => handleCommissionTypeChange(product.id, undefined, e.target.value as CommissionType)}
                                disabled={isMainUpdating}
                                className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-all ${getCommissionBadgeClass(mainPriceState.commissionType)}`}
                              >
                                <option value="no_commission">Pendiente</option>
                                <option value="fuddi_assumed_by_customer">Cliente asume</option>
                                <option value="fuddi_assumed_by_store">Tienda asume</option>
                                <option value="fixed_commission">Fija ($)</option>
                              </select>
                            </td>

                            {/* Comisión */}
                            <td className="py-3 px-4">
                              {mainPriceState.commissionType === 'fixed_commission' ? (
                                <div className="relative w-22">
                                  <span className="absolute inset-y-0 left-2 flex items-center text-xs text-amber-600 font-bold">$</span>
                                  <input
                                    type="number"
                                    value={mainPriceState.commission}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value)
                                      if (!isNaN(value) && value >= 0) {
                                        handleCommissionValueChange(product.id, undefined, value)
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleOfficalizePrice(product.id, undefined)
                                        ;(e.target as HTMLInputElement).blur()
                                      }
                                    }}
                                    onBlur={() => {
                                      handleOfficalizePrice(product.id, undefined)
                                    }}
                                    disabled={isMainUpdating}
                                    className="w-full pl-5 pr-1.5 py-1 bg-amber-50/80 border border-amber-300 rounded-lg text-xs font-bold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                                    step="0.05"
                                    min="0"
                                  />
                                </div>
                              ) : (
                                <span className={mainPriceState.commission > 0 ? 'text-amber-700 font-semibold' : 'text-slate-400'}>
                                  ${mainPriceState.commission.toFixed(2)}
                                </span>
                              )}
                            </td>

                            {/* P. Público */}
                            <td className="py-3 px-4 font-bold text-slate-900">
                              ${mainPriceState.publicPrice.toFixed(2)}
                            </td>

                            {/* Recibe */}
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                ${mainPriceState.storeReceives.toFixed(2)}
                              </span>
                            </td>

                            {/* Status */}
                            <td className="py-3 px-4 text-center">
                              {isMainUpdating ? (
                                <div className="w-3.5 h-3.5 mx-auto border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                              ) : isMainSaved ? (
                                <i className="bi bi-check-circle-fill text-emerald-500 text-base animate-pulse"></i>
                              ) : null}
                            </td>
                          </tr>

                          {/* Variantes sub-filas */}
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
                              <tr key={variant.id} className="bg-slate-50/70 border-l-3 border-blue-400">
                                <td className="py-2.5 px-5 pl-12">
                                  <div className="flex items-center gap-1.5">
                                    <i className="bi bi-arrow-return-right text-slate-300 text-xs"></i>
                                    <p className="text-slate-700 font-medium text-[11px]">{variant.name}</p>
                                  </div>
                                </td>
                                <td className="py-2.5 px-4 text-[10px] text-slate-400 italic">Variante</td>
                                <td className="py-2.5 px-4">
                                  {isEditingPrices ? (
                                    <div className="relative w-18">
                                      <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] text-slate-400">$</span>
                                      <input
                                        type="number"
                                        value={variantPriceState.storePrice}
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value)
                                          if (!isNaN(value) && value >= 0) {
                                            handleStorePriceChange(product.id, variant.id, value)
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            handleOfficalizePrice(product.id, variant.id)
                                            ;(e.target as HTMLInputElement).blur()
                                          }
                                        }}
                                        onBlur={() => {
                                          handleOfficalizePrice(product.id, variant.id)
                                        }}
                                        disabled={isVariantUpdating}
                                        className="w-full pl-4 pr-1 py-0.5 bg-white border border-slate-200 rounded text-[11px] font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        step="0.01"
                                        min="0"
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-700 font-medium">
                                      ${variantPriceState.storePrice.toFixed(2)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4">
                                  <select
                                    value={variantPriceState.commissionType}
                                    onChange={(e) => handleCommissionTypeChange(product.id, variant.id, e.target.value as CommissionType)}
                                    disabled={isVariantUpdating}
                                    className={`text-[10px] px-2 py-0.5 rounded border font-semibold focus:outline-none cursor-pointer ${getCommissionBadgeClass(variantPriceState.commissionType)}`}
                                  >
                                    <option value="no_commission">Pendiente</option>
                                    <option value="fuddi_assumed_by_customer">Cliente asume</option>
                                    <option value="fuddi_assumed_by_store">Tienda asume</option>
                                    <option value="fixed_commission">Fija ($)</option>
                                  </select>
                                </td>
                                <td className="py-2.5 px-4">
                                  {variantPriceState.commissionType === 'fixed_commission' ? (
                                    <div className="relative w-18">
                                      <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] text-amber-600 font-bold">$</span>
                                      <input
                                        type="number"
                                        value={variantPriceState.commission}
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value)
                                          if (!isNaN(value) && value >= 0) {
                                            handleCommissionValueChange(product.id, variant.id, value)
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            handleOfficalizePrice(product.id, variant.id)
                                            ;(e.target as HTMLInputElement).blur()
                                          }
                                        }}
                                        onBlur={() => {
                                          handleOfficalizePrice(product.id, variant.id)
                                        }}
                                        disabled={isVariantUpdating}
                                        className="w-full pl-4 pr-1 py-0.5 bg-amber-50/80 border border-amber-300 rounded text-[11px] font-bold text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                        step="0.05"
                                        min="0"
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-500 font-medium">
                                      ${variantPriceState.commission.toFixed(2)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-[11px] font-bold text-slate-800">
                                  ${variantPriceState.publicPrice.toFixed(2)}
                                </td>
                                <td className="py-2.5 px-4">
                                  <span className="text-[10px] font-bold text-emerald-600">
                                    ${variantPriceState.storeReceives.toFixed(2)}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 text-center">
                                  {isVariantUpdating ? (
                                    <div className="w-3 h-3 mx-auto border border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                  ) : isVariantSaved ? (
                                    <i className="bi bi-check-circle-fill text-emerald-500 text-xs"></i>
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
        </div>
      )}

      {/* STORES TAB */}
      {activeTab === 'stores' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Configuración Global por Tienda</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Define el trato de comisión por defecto y el porcentaje (%) asignado a cada tienda.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Tienda</th>
                  <th className="py-3.5 px-4">Username</th>
                  <th className="py-3.5 px-4">Trato por Defecto</th>
                  <th className="py-3.5 px-4">% Comisión</th>
                  <th className="py-3.5 px-4">Productos</th>
                  <th className="py-3.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {businesses.map((business) => {
                  const settings = businessSettingsDrafts[business.id] || getBusinessCommissionSettings(business)
                  const businessProductsCount = products.filter(p => p.businessId === business.id).length
                  const isSavingBusiness = savingBusinessSettings.has(business.id)

                  return (
                    <tr key={business.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {business.image ? (
                            <img src={business.image} alt={business.name} className="w-9 h-9 rounded-full object-cover border border-slate-200" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                              <i className="bi bi-shop"></i>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-slate-900 text-xs">{business.name}</p>
                            <p className="text-[11px] text-slate-400">{business.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-medium">@{business.username}</td>
                      <td className="py-3 px-4">
                        <select
                          value={settings.defaultCommissionType}
                          onChange={(e) => setBusinessSettingsDrafts(prev => ({
                            ...prev,
                            [business.id]: {
                              ...settings,
                              defaultCommissionType: e.target.value as CommissionType
                            }
                          }))}
                          disabled={isSavingBusiness}
                          className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="no_commission">Pendiente</option>
                          <option value="fuddi_assumed_by_customer">Cliente asume</option>
                          <option value="fuddi_assumed_by_store">Tienda asume</option>
                          <option value="fixed_commission">Fija ($)</option>
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <div className="relative w-24">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={settings.commissionRate}
                            onChange={(e) => setBusinessSettingsDrafts(prev => ({
                              ...prev,
                              [business.id]: {
                                ...settings,
                                commissionRate: Number(e.target.value)
                              }
                            }))}
                            disabled={isSavingBusiness}
                            className="w-full pl-3 pr-7 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                          <span className="absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-400">%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => {
                            setFilterBusiness(business.id)
                            setActiveTab('products')
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold text-xs hover:bg-slate-200 transition-colors"
                        >
                          <i className="bi bi-box-seam text-slate-400"></i>
                          {businessProductsCount} productos
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleSaveBusinessCommissionSettings(business.id)}
                          disabled={isSavingBusiness}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-2xs"
                        >
                          <i className={`bi bi-${isSavingBusiness ? 'arrow-repeat animate-spin' : 'check-lg'}`}></i>
                          {isSavingBusiness ? 'Guardando...' : 'Guardar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
