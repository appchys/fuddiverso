'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { X, Search, ShoppingBag, Store, Loader2, Check } from 'lucide-react'
import { getAllProducts, getAllBusinesses } from '@/lib/database'
import { Product, Business } from '@/types'
import { formatPrice } from '@/lib/price-utils'

export type TagTabType = 'businesses' | 'products'

interface TagProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectProduct: (product: Product | null, business?: Business | null) => void
  onSelectBusiness?: (business: Business) => void
  selectedProductId?: string
  selectedBusinessId?: string
  initialTab?: TagTabType
}

export default function TagProductModal({
  isOpen,
  onClose,
  onSelectProduct,
  onSelectBusiness,
  selectedProductId,
  selectedBusinessId,
  initialTab = 'businesses'
}: TagProductModalProps) {
  // 'businesses' es la primera vista por defecto
  const [activeTab, setActiveTab] = useState<TagTabType>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([])
  const [isCatalogLoaded, setIsCatalogLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return

    setActiveTab('businesses') // Siempre abrir primero en Tiendas
    setSearchQuery('')

    if (!isCatalogLoaded) {
      setIsLoading(true)
      Promise.all([getAllProducts(), getAllBusinesses()])
        .then(([prods, bizs]) => {
          setAllProducts(prods || [])
          setAllBusinesses(bizs || [])
          setIsCatalogLoaded(true)
        })
        .catch((err) => {
          console.error('Error loading catalog for tagging modal:', err)
        })
        .finally(() => {
          setIsLoading(false)
        })
    }

    // Autoenfoque al abrir
    setTimeout(() => {
      inputRef.current?.focus()
    }, 150)
  }, [isOpen, isCatalogLoaded])

  // Mapa de negocios activos (no ocultos)
  const businessMap = useMemo(() => {
    const map = new Map<string, Business>()
    allBusinesses
      .filter((b) => !b.isHidden)
      .forEach((b) => map.set(b.id, b))
    return map
  }, [allBusinesses])

  // Lista de tiendas activas filtradas
  const filteredBusinesses = useMemo(() => {
    const activeBiz = allBusinesses.filter((b) => !b.isHidden)
    if (!searchQuery.trim()) {
      return activeBiz.slice(0, 25)
    }
    const q = searchQuery.toLowerCase().trim()
    return activeBiz
      .filter((b) => {
        const nameMatch = b.name?.toLowerCase().includes(q)
        const usernameMatch = b.username?.toLowerCase().includes(q)
        const categoryMatch = b.category?.toLowerCase().includes(q)
        const descMatch = b.description?.toLowerCase().includes(q)
        return nameMatch || usernameMatch || categoryMatch || descMatch
      })
      .slice(0, 30)
  }, [allBusinesses, searchQuery])

  // Lista de productos disponibles de tiendas públicas
  const filteredProducts = useMemo(() => {
    const activeProducts = allProducts.filter((p) => {
      if (p.isAvailable === false) return false
      return businessMap.has(p.businessId)
    })

    if (!searchQuery.trim()) {
      return activeProducts.slice(0, 25)
    }

    const q = searchQuery.toLowerCase().trim()
    return activeProducts
      .filter((p) => {
        const nameMatch = p.name?.toLowerCase().includes(q)
        const descMatch = p.description?.toLowerCase().includes(q)
        const biz = businessMap.get(p.businessId)
        const bizMatch = biz?.name?.toLowerCase().includes(q)
        return nameMatch || descMatch || bizMatch
      })
      .slice(0, 30)
  }, [searchQuery, allProducts, businessMap])

  if (!isOpen) return null

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-[290] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#aa1918]" />
            <h3 className="text-sm font-black text-gray-900 tracking-tight leading-none">
              Etiquetar en tu publicación
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Pestañas: Tiendas (primero) | Productos */}
        <div className="px-4 pt-3">
          <div className="flex p-1 bg-gray-100 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setActiveTab('businesses')
                setSearchQuery('')
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'businesses'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Store size={14} />
              <span>Tiendas</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('products')
                setSearchQuery('')
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'products'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <ShoppingBag size={14} />
              <span>Productos</span>
            </button>
          </div>
        </div>

        {/* Buscador */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'businesses'
                  ? 'Buscar tiendas o restaurantes...'
                  : 'Buscar por plato o comida...'
              }
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-10 pr-9 py-2.5 text-xs font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Contenido de la lista */}
        <div className="flex-1 overflow-y-auto p-4 pt-1 divide-y divide-gray-50 space-y-1">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400">
              <Loader2 size={20} className="animate-spin text-[#aa1918]" />
              <span className="text-xs font-medium">Cargando opciones...</span>
            </div>
          ) : activeTab === 'businesses' ? (
            /* PESTAÑA: TIENDAS */
            filteredBusinesses.length > 0 ? (
              filteredBusinesses.map((biz) => {
                const isSelected = selectedBusinessId === biz.id && !selectedProductId

                return (
                  <button
                    key={biz.id}
                    type="button"
                    onClick={() => {
                      if (onSelectBusiness) {
                        onSelectBusiness(biz)
                      } else {
                        onSelectProduct(null, biz)
                      }
                      onClose()
                    }}
                    className={`w-full p-2.5 rounded-2xl flex items-center justify-between gap-3 text-left transition-all ${
                      isSelected
                        ? 'bg-red-50 border border-red-200 shadow-sm'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-gray-100 border border-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center shadow-xs">
                        {biz.image ? (
                          <img
                            src={biz.image}
                            alt={biz.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Store size={18} className="text-[#aa1918]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-black text-gray-900 tracking-tight truncate">
                            {biz.name}
                          </p>
                          {(biz as any)?.isVerified && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" title="Verificado" />
                          )}
                        </div>
                        <p className="text-[10px] font-medium text-gray-500 truncate mt-0.5">
                          @{biz.username || biz.id}
                          {biz.category ? ` • ${biz.category}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isSelected && (
                        <span className="w-6 h-6 rounded-full bg-red-100 text-[#aa1918] flex items-center justify-center">
                          <Check size={13} />
                        </span>
                      )}
                      <span className="text-[10px] font-black text-gray-600 bg-gray-50 hover:bg-gray-200 px-2.5 py-1 rounded-xl border border-gray-100">
                        Seleccionar
                      </span>
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="py-12 text-center text-xs text-gray-400 font-medium">
                No se encontraron tiendas
              </div>
            )
          ) : (
            /* PESTAÑA: PRODUCTOS */
            filteredProducts.length > 0 ? (
              filteredProducts.map((product) => {
                const biz = businessMap.get(product.businessId)
                const isSelected = selectedProductId === product.id

                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => {
                      onSelectProduct(product, biz)
                      onClose()
                    }}
                    className={`w-full p-2.5 rounded-2xl flex items-center justify-between gap-3 text-left transition-all ${
                      isSelected
                        ? 'bg-red-50 border border-red-200 shadow-sm'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-gray-100 border border-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center shadow-xs">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ShoppingBag size={16} className="text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black text-gray-900 truncate">
                          {product.name}
                        </p>
                        <p className="text-[10px] font-medium text-gray-500 truncate flex items-center gap-1 mt-0.5">
                          <Store size={10} className="text-gray-400 flex-shrink-0" />
                          <span>{biz?.name || 'Tienda'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {product.price !== undefined && (
                        <span className="text-xs font-black text-gray-900 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                          {formatPrice(product.price)}
                        </span>
                      )}
                      {isSelected && (
                        <span className="w-6 h-6 rounded-full bg-red-100 text-[#aa1918] flex items-center justify-center">
                          <Check size={13} />
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="py-12 text-center text-xs text-gray-400 font-medium">
                No se encontraron platos o productos
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
