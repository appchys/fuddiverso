'use client'

import { useEffect, useState } from 'react'
import { getProductRatings, ProductRatingItem } from '@/lib/database'
import { Product } from '@/types'
import StarRating from '@/components/StarRating'

interface ProductRatingModalProps {
  isOpen: boolean
  onClose: () => void
  product: Product | null
  businessId: string | null
}

export default function ProductRatingModal({
  isOpen,
  onClose,
  product,
  businessId
}: ProductRatingModalProps) {
  const [loading, setLoading] = useState(true)
  const [ratings, setRatings] = useState<ProductRatingItem[]>([])
  const [averageRating, setAverageRating] = useState<number>(0)
  const [ratingCount, setRatingCount] = useState<number>(0)

  useEffect(() => {
    if (!isOpen || !product || !businessId) return

    let isMounted = true
    setLoading(true)

    getProductRatings(businessId, product.id)
      .then((res) => {
        if (isMounted) {
          setRatings(res.ratings)
          setAverageRating(res.averageRating)
          setRatingCount(res.ratingCount)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error('Error loading product ratings:', err)
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, product, businessId])

  if (!isOpen || !product) return null

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      <div className="flex items-end sm:items-center justify-center min-h-screen p-0 sm:p-4">
        <div className="relative w-full max-w-lg bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden transform transition-all animate-in slide-in-from-bottom sm:zoom-in duration-300 flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0 bg-white relative">
            <button
              onClick={onClose}
              className="absolute top-5 right-5 w-9 h-9 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-full flex items-center justify-center transition-all z-10"
              aria-label="Cerrar"
            >
              <i className="bi bi-x-lg text-sm"></i>
            </button>

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0 shadow-sm">
                {product.image ? (
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <i className="bi bi-image text-2xl"></i>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 pr-6">
                <span className="text-[10px] font-black uppercase tracking-widest text-red-600 bg-red-50 px-2 py-0.5 rounded-full inline-block mb-1">
                  Opiniones del producto
                </span>
                <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight truncate">
                  {product.name}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <StarRating rating={averageRating > 0 ? averageRating : 5} size="sm" showGrayStars={ratingCount === 0} />
                  <span className="text-xs font-black text-gray-900">
                    {averageRating > 0 ? averageRating.toFixed(1) : 'Sin calificar'}
                  </span>
                  {ratingCount > 0 && (
                    <span className="text-xs font-medium text-gray-400">
                      ({ratingCount} {ratingCount === 1 ? 'opinión' : 'opiniones'})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* List of Reviews */}
          <div className="p-6 overflow-y-auto flex-1 custom-scrollbar bg-gray-50 space-y-3">
            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-3">
                <i className="bi bi-arrow-repeat animate-spin text-2xl text-red-500"></i>
                <span className="text-xs font-medium">Cargando opiniones...</span>
              </div>
            ) : ratings.length > 0 ? (
              ratings.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 font-black text-xs flex items-center justify-center border border-red-100">
                        {item.clientName?.charAt(0)?.toUpperCase() || 'C'}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-900 leading-none">
                          {item.clientName || 'Cliente'}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Calificó en pedido
                        </p>
                      </div>
                    </div>
                    <StarRating rating={item.rating} size="sm" />
                  </div>

                  {item.comment ? (
                    <p className="text-xs text-gray-700 font-medium leading-relaxed bg-gray-50/80 p-3 rounded-xl border border-gray-100/80">
                      "{item.comment}"
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic">
                      Sin comentario escrito
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="py-12 text-center flex flex-col items-center justify-center">
                <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-2xl mb-3 border border-amber-100">
                  ⭐
                </div>
                <h4 className="text-sm font-black text-gray-900">
                  Aún no hay opiniones para este producto
                </h4>
                <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
                  Las calificaciones y comentarios se envían cuando los clientes califican los productos al recibir su pedido.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
