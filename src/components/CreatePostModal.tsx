'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  X,
  Camera,
  Star,
  Loader2,
  Tag,
  ShoppingBag
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  getAllProducts,
  getAllBusinesses,
  createCommunityPost,
  uploadImage,
  GlobalProductReviewItem,
  searchClientByPhone,
  createClient
} from '@/lib/database'
import { Product, Business } from '@/types'
import { formatPrice } from '@/lib/price-utils'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'

interface CreatePostModalProps {
  isOpen: boolean
  onClose: () => void
  onPostCreated: (newReview: GlobalProductReviewItem) => void
}

export default function CreatePostModal({
  isOpen,
  onClose,
  onPostCreated
}: CreatePostModalProps) {
  const { user, login } = useAuth()

  // Estados del post
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState(5)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Producto etiquetado
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)

  // Buscador de productos
  const [productQuery, setProductQuery] = useState('')
  const [isSearchingProduct, setIsSearchingProduct] = useState(false)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([])
  const [isCatalogLoaded, setIsCatalogLoaded] = useState(false)

  // Datos de usuario no autenticado
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Cargar productos y negocios cuando se abre el modal
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
          console.error('Error loading catalog for tagging:', err)
        })
    }
  }, [isOpen, isCatalogLoaded])

  // Click outside para cerrar el dropdown de búsqueda
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchingProduct(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Mapa de negocios activos (no ocultos) para búsqueda
  const businessMap = useMemo(() => {
    const map = new Map<string, Business>()
    allBusinesses
      .filter((b) => !b.isHidden)
      .forEach((b) => map.set(b.id, b))
    return map
  }, [allBusinesses])

  // Filtrado de productos activos para etiquetar
  const searchResults = useMemo(() => {
    if (!productQuery.trim()) return []
    const q = productQuery.toLowerCase().trim()
    return allProducts
      .filter((p) => {
        // Excluir productos no disponibles o pausados
        if (p.isAvailable === false) return false

        // Excluir productos de tiendas ocultas o inactivas
        const biz = businessMap.get(p.businessId)
        if (!biz) return false

        const nameMatch = p.name?.toLowerCase().includes(q)
        const descMatch = p.description?.toLowerCase().includes(q)
        const bizMatch = biz.name?.toLowerCase().includes(q)
        return nameMatch || descMatch || bizMatch
      })
      .slice(0, 6)
  }, [productQuery, allProducts, businessMap])

  // Manejador de selección de imagen
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setSelectedFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Seleccionar producto etiquetado
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product)
    const biz = businessMap.get(product.businessId) || null
    setSelectedBusiness(biz)
    setProductQuery('')
    setIsSearchingProduct(false)
  }

  const handleRemoveProduct = () => {
    setSelectedProduct(null)
    setSelectedBusiness(null)
  }

  // Reset del formulario
  const handleReset = () => {
    setComment('')
    setRating(5)
    setHoverRating(null)
    setSelectedFile(null)
    setImagePreview(null)
    setSelectedProduct(null)
    setSelectedBusiness(null)
    setProductQuery('')
    setIsSearchingProduct(false)
    setErrorMsg('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    handleReset()
    onClose()
  }

  // Enviar publicación
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    if (!comment.trim() && !selectedFile && !selectedProduct) {
      setErrorMsg('Escribe un comentario, añade una foto o etiqueta un producto')
      return
    }

    let authorName = user?.nombres?.trim() || guestName.trim()
    let authorPhone = user?.celular?.trim() || guestPhone.trim()

    if (!user) {
      if (!authorName) {
        setErrorMsg('Ingresa tu nombre')
        return
      }
      if (!authorPhone) {
        setErrorMsg('Ingresa tu celular')
        return
      }
      const normalizedPhone = normalizeEcuadorianPhone(authorPhone)
      if (!validateEcuadorianPhone(normalizedPhone)) {
        setErrorMsg('Ingresa un celular válido de 10 dígitos')
        return
      }
      authorPhone = normalizedPhone
    }

    let targetBusinessId = selectedProduct?.businessId || selectedBusiness?.id || ''
    if (!targetBusinessId && allBusinesses.length > 0) {
      targetBusinessId = allBusinesses[0].id
    }

    if (!targetBusinessId) {
      setErrorMsg('Selecciona o etiqueta un producto')
      return
    }

    setIsSubmitting(true)
    try {
      // Si no estaba autenticado, registrarlo/loguearlo de forma fluida
      if (!user && authorPhone) {
        try {
          let client = await searchClientByPhone(authorPhone)
          if (client) {
            login(client)
          } else {
            const newClient = await createClient({
              celular: authorPhone,
              nombres: authorName,
              fecha_de_registro: new Date().toISOString()
            })
            if (newClient) login(newClient)
          }
        } catch (authErr) {
          console.error('Error authenticating guest client:', authErr)
        }
      }

      // Subir imagen si existe
      let uploadedImageUrl = ''
      if (selectedFile) {
        const filePath = `ratings/${targetBusinessId}_${Date.now()}`
        uploadedImageUrl = await uploadImage(selectedFile, filePath)
      }

      // Crear publicación en Firestore
      const newReview = await createCommunityPost({
        businessId: targetBusinessId,
        rating,
        comment: comment.trim(),
        image: uploadedImageUrl,
        clientName: authorName,
        clientPhone: authorPhone,
        clientPhotoURL: (user as any)?.photoURL || (user as any)?.clientPhotoUrl || '',
        product: selectedProduct
          ? {
              id: selectedProduct.id,
              name: selectedProduct.name,
              image: selectedProduct.image || '',
              price: selectedProduct.price || 0,
              slug: selectedProduct.slug || selectedProduct.id
            }
          : undefined
      })

      onPostCreated(newReview)
      handleClose()
    } catch (err: any) {
      console.error('Error creating post:', err)
      setErrorMsg('No se pudo publicar. Intenta nuevamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[280] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Cabecera Minimalista */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#aa1918]" />
            <h2 className="text-base font-black text-gray-900 tracking-tight leading-none">
              Crear publicación
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Contenido / Formulario */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {/* Calificación por Estrellas */}
          <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 rounded-2xl border border-gray-100">
            <span className="text-xs font-black text-gray-800">Calificación</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(null)}
                  className="p-1 transition-transform active:scale-90"
                >
                  <Star
                    size={20}
                    className={`transition-colors ${
                      (hoverRating !== null ? star <= hoverRating : star <= rating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-gray-200'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Textarea de la Reseña */}
          <div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="¿Qué probaste? Comparte tu opinión..."
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3.5 text-xs sm:text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all resize-none"
            />
          </div>

          {/* Etiquetado de Producto */}
          <div className="space-y-2" ref={searchContainerRef}>
            {selectedProduct ? (
              /* Tarjeta de Producto Etiquetado */
              <div className="flex items-center justify-between gap-3 bg-red-50/60 border border-red-100 p-2.5 rounded-2xl">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white border border-red-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {selectedProduct.image ? (
                      <img
                        src={selectedProduct.image}
                        alt={selectedProduct.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ShoppingBag size={16} className="text-red-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-gray-900 truncate">
                      {selectedProduct.name}
                    </p>
                    <p className="text-[10px] font-medium text-gray-500 truncate">
                      {selectedBusiness?.name || 'Tienda'}
                      {selectedProduct.price ? ` • ${formatPrice(selectedProduct.price)}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveProduct}
                  className="w-7 h-7 rounded-full bg-white hover:bg-red-100 text-red-500 flex items-center justify-center border border-red-100 transition-colors flex-shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              /* Input Buscador para Etiquetar Producto */
              <div className="relative">
                <div className="relative flex items-center">
                  <Tag
                    size={14}
                    className="absolute left-3.5 text-gray-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={productQuery}
                    onChange={(e) => {
                      setProductQuery(e.target.value)
                      setIsSearchingProduct(true)
                    }}
                    onFocus={() => setIsSearchingProduct(true)}
                    placeholder="Etiquetar un plato o producto..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-9 pr-8 py-2.5 text-xs font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                  />
                  {productQuery && (
                    <button
                      type="button"
                      onClick={() => setProductQuery('')}
                      className="absolute right-3 text-gray-400 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Dropdown de Resultados de Búsqueda */}
                {isSearchingProduct && productQuery.trim() && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-2xl shadow-xl z-20 max-h-56 overflow-y-auto divide-y divide-gray-50">
                    {searchResults.length > 0 ? (
                      searchResults.map((product) => {
                        const biz = businessMap.get(product.businessId)
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => handleSelectProduct(product)}
                            className="w-full p-2.5 flex items-center justify-between gap-2.5 hover:bg-gray-50 text-left transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-gray-100 border border-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                {product.image ? (
                                  <img
                                    src={product.image}
                                    alt={product.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <ShoppingBag size={14} className="text-gray-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-black text-gray-900 truncate">
                                  {product.name}
                                </p>
                                <p className="text-[10px] font-medium text-gray-500 truncate">
                                  {biz?.name || 'Tienda'}
                                </p>
                              </div>
                            </div>
                            {product.price !== undefined && (
                              <span className="text-xs font-bold text-gray-700 flex-shrink-0">
                                {formatPrice(product.price)}
                              </span>
                            )}
                          </button>
                        )
                      })
                    ) : (
                      <div className="p-4 text-center text-xs text-gray-400 font-medium">
                        Sin resultados para &ldquo;{productQuery}&rdquo;
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Previsualización de Imagen Adjunta */}
          {imagePreview && (
            <div className="relative rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 max-h-48 flex items-center justify-center">
              <img
                src={imagePreview}
                alt="Vista previa"
                className="w-full h-48 object-cover"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute top-2 right-2 w-7 h-7 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center transition-colors shadow-md"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Botón de Adjuntar Foto */}
          {!imagePreview && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                id="post-photo-upload"
              />
              <label
                htmlFor="post-photo-upload"
                className="flex items-center gap-2 w-full justify-center py-2.5 border border-dashed border-gray-200 hover:border-gray-900 hover:bg-gray-50 text-gray-600 rounded-2xl cursor-pointer text-xs font-bold transition-all"
              >
                <Camera size={15} />
                <span>Adjuntar foto</span>
              </label>
            </div>
          )}

          {/* Identificación de Usuario si no está logueado */}
          {!user && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
              <div>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Tu nombre"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="Celular (ej: 0991234567)"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <p className="text-[11px] font-bold text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-100">
              {errorMsg}
            </p>
          )}

          {/* Botón Publicar */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-2xl bg-gray-900 hover:bg-black text-white text-xs font-black tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-[0.99]"
          >
            {isSubmitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <span>Publicar</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
