'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { X, Search, ShoppingBag, Store } from 'lucide-react'
import { getAllProducts, getAllBusinesses } from '@/lib/database'
import { Product, Business } from '@/types'
import { formatPrice } from '@/lib/price-utils'

interface TagProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectProduct: (product: Product, business?: Business) => void
  selectedProductId?: string
}

export default function TagProductModal({
  isOpen,
  onClose,
  onSelectProduct,
  selectedProductId
}: TagProductModalProps) {
  const [productQuery, setProductQuery] = useState('')
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([])
  const [isCatalogLoaded, setIsCatalogLoaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return

    if (!isCatalogLoaded) {
      Promise.all([getAllProducts(), getAllBusinesses()])
        .then(([prods, bizs]) => {
          setAllProducts(prods || [])
          setAllBusinesses(bizs || [])
          setIsCatalogLoaded(true)
        })
        .catch((err) => {
          console.error('Error loading catalog for tagging modal:', err)
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

  // Filtrado de productos disponibles de tiendas públicas
  const searchResults = useMemo(() => {
    const activeProducts = allProducts.filter((p) => {
      if (p.isAvailable === false) return false
      return businessMap.has(p.businessId)
    })

    if (!productQuery.trim()) {
      // Mostrar sugerencias iniciales destacadas
      return activeProducts.slice(0, 10)
    }

    const q = productQuery.toLowerCase().trim()
    return activeProducts
      .filter((p) => {
        const nameMatch = p.name?.toLowerCase().includes(q)
        const descMatch = p.description?.toLowerCase().includes(q)
        const biz = businessMap.get(p.businessId)
        const bizMatch = biz?.name?.toLowerCase().includes(q)
        return nameMatch || descMatch || bizMatch
      })
      .slice(0, 15)
  }, [productQuery, allProducts, businessMap])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[290] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#aa1918]" />
            <h3 className="text-sm font-black text-gray-900 tracking-tight leading-none">
              Etiquetar plato o producto
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

        {/* Buscador */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
            <input
              ref={inputRef}
              type="text"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Buscar por plato o restaurante..."
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-10 pr-9 py-2.5 text-xs font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
            />
            {productQuery && (
              <button
                type="button"
                onClick={() => setProductQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Lista de Resultados */}
        <div className="flex-1 overflow-y-auto p-4 pt-1 divide-y divide-gray-50 space-y-1">
          {searchResults.length > 0 ? (
            searchResults.map((product) => {
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
                    <div className="w-11 h-11 rounded-xl bg-gray-100 border border-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center shadow-xs">
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

                  {product.price !== undefined && (
                    <span className="text-xs font-black text-gray-900 flex-shrink-0 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                      {formatPrice(product.price)}
                    </span>
                  )}
                </button>
              )
            })
          ) : (
            <div className="py-12 text-center text-xs text-gray-400 font-medium">
              No se encontraron platos disponibles
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
