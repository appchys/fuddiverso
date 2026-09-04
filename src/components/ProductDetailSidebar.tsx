'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Product, Business } from '@/types'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { unredeemQRCodePrize, getProductsByBusiness, getProductRatings, ProductRatingItem, generateReferralLink, searchClientByPhone, createClient, updateClient, addProductRatingComment, addStoreRatingReply, toggleRatingLike, updateProductRatingComment, deleteProductRatingComment } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import dynamic from 'next/dynamic'
import { getProductPublicPrice, formatPrice, getPriceMetadata, ensureCartItemMetadata, getPackagingFee } from '@/lib/price-utils'
import { formatComboVariantSelection } from '@/lib/combo-utils'
import { Flame, Star, MessageSquare, Phone, ArrowRight, ArrowUp, Loader2, Copy, Check, Share2, Heart, Camera, X, Pencil, Trash2, ShoppingBag } from 'lucide-react'
import StarRating from '@/components/StarRating'
import { formatRelativeTime } from '@/lib/date-utils'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { optimizeImage } from '@/lib/image-utils'

const StoreRatingModal = dynamic(() => import('@/components/StoreRatingModal'), { ssr: false })

interface ProductDetailSidebarProps {
    isOpen: boolean
    onClose: () => void
    product: Product | null
    business: Business | null
    onProductSelect: (product: Product) => void
    onOpenCart?: () => void
    onGenerateReferral?: () => void
    hasRecommended?: boolean
    referralCount?: number
    onOpenRatingModal?: () => void
}

export default function ProductDetailSidebar({ isOpen, onClose, product, business, onProductSelect, onOpenCart, onGenerateReferral, hasRecommended, referralCount, onOpenRatingModal }: ProductDetailSidebarProps) {
    const router = useRouter()
    const { user, login } = useAuth()
    const [isRatingModalOpen, setIsRatingModalOpen] = useState(false)
    const [productRatingAvg, setProductRatingAvg] = useState<number>(0)
    const [productRatingCount, setProductRatingCount] = useState<number>(0)
    const [productRatingsList, setProductRatingsList] = useState<ProductRatingItem[]>([])
    const [loadingRatings, setLoadingRatings] = useState(false)
    const [activeTab, setActiveTab] = useState<'options' | 'reviews' | 'referral'>('options')
    const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [comboSelection, setComboSelection] = useState<Record<string, number>>({})
    const [cart, setCart] = useState<any[]>([])
    const [selectedOptions, setSelectedOptions] = useState<Record<string, { name: string, price: number }[]>>({})
    const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
        show: false,
        message: '',
        type: 'success'
    })
    const [copySuccess, setCopySuccess] = useState(false)

    // Estados de recomendación/referidos internos
    const [referralLink, setReferralLink] = useState('')
    const [referralPhone, setReferralPhone] = useState('')
    const [referralPhoneError, setReferralPhoneError] = useState('')
    const [referralLoading, setReferralLoading] = useState(false)
    const [referralCopied, setReferralCopied] = useState(false)
    const [localHasRecommended, setLocalHasRecommended] = useState(hasRecommended || false)
    const [localReferralCount, setLocalReferralCount] = useState<number | undefined>(referralCount)

    // Estados para enviar nueva opinión/comentario
    const [newReviewComment, setNewReviewComment] = useState('')
    const [newReviewRating, setNewReviewRating] = useState(5)
    const [isSubmittingReview, setIsSubmittingReview] = useState(false)
    const [reviewImageFile, setReviewImageFile] = useState<File | null>(null)
    const [reviewImagePreview, setReviewImagePreview] = useState<string | null>(null)
    const reviewFileInputRef = useRef<HTMLInputElement>(null)

    // Estados para interacción con tarjetas de opinión (Me gusta y Comentar)
    const [activeCardId, setActiveCardId] = useState<string | null>(null)
    const [replyInputText, setReplyInputText] = useState<{ [ratingId: string]: string }>({})
    const [isSendingReply, setIsSendingReply] = useState<{ [ratingId: string]: boolean }>({})

    // Estados para edición de opiniones
    const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
    const [editRatingScore, setEditRatingScore] = useState(5)
    const [editCommentText, setEditCommentText] = useState('')
    const [editImageFile, setEditImageFile] = useState<File | null>(null)
    const [editImagePreview, setEditImagePreview] = useState<string | null>(null)
    const [editImageRemoved, setEditImageRemoved] = useState(false)
    const [isSavingEdit, setIsSavingEdit] = useState(false)
    const editFileInputRef = useRef<HTMLInputElement>(null)

    // Estados para visor modal de fotos de opiniones
    const [viewingPhotoModalUrl, setViewingPhotoModalUrl] = useState<string | null>(null)

    useEffect(() => {
        if (!viewingPhotoModalUrl) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setViewingPhotoModalUrl(null)
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [viewingPhotoModalUrl])

    // Estados para modal de autor de opinión (usuarios no autenticados)
    const [showGuestReviewModal, setShowGuestReviewModal] = useState(false)
    const [guestName, setGuestName] = useState('')
    const [guestPhone, setGuestPhone] = useState('')
    const [guestError, setGuestError] = useState('')
    const [guestLoading, setGuestLoading] = useState(false)
    const [otherProducts, setOtherProducts] = useState<Product[]>([])
    const sidebarContentRef = useRef<HTMLDivElement>(null)
    const [currentImgIndex, setCurrentImgIndex] = useState(0)

    const allImages = useMemo(() => {
        const imgs: string[] = []
        if (product?.image) imgs.push(product.image)
        product?.variants?.forEach((v: any) => {
            if (v.image && !imgs.includes(v.image)) imgs.push(v.image)
        })
        if (imgs.length === 0 && business?.image) imgs.push(business.image)
        return imgs
    }, [product, business])

    useEffect(() => {
        if (!isOpen || allImages.length <= 1) return
        const interval = setInterval(() => {
            setCurrentImgIndex((prev) => (prev + 1) % allImages.length)
        }, 2000)
        return () => clearInterval(interval)
    }, [allImages, isOpen])

    useEffect(() => {
        setCurrentImgIndex(0)
    }, [product?.id])

    useEffect(() => {
        if (!isOpen || !product?.id || !business?.id) {
            setProductRatingAvg(0)
            setProductRatingCount(0)
            setProductRatingsList([])
            setActiveTab('options')
            return
        }

        setActiveTab('options')
        let isMounted = true
        setLoadingRatings(true)
        getProductRatings(business.id, product.id)
            .then((res) => {
                if (isMounted) {
                    setProductRatingAvg(res.averageRating)
                    setProductRatingCount(res.ratingCount)
                    setProductRatingsList(res.ratings || [])
                    setLoadingRatings(false)
                }
            })
            .catch((err) => {
                console.error('Error fetching product ratings in sidebar:', err)
                if (isMounted) setLoadingRatings(false)
            })

        return () => {
            isMounted = false
        }
    }, [isOpen, product?.id, business?.id])

    // Sincronizar estados locales de recomendación
    useEffect(() => {
        setLocalHasRecommended(hasRecommended || false)
        setLocalReferralCount(referralCount)
    }, [hasRecommended, referralCount, product?.id])

    // Generar enlace de referido para un usuario
    const generateReferralForUser = async (targetUser: any) => {
        if (!product?.id || !business?.id) return
        try {
            setReferralLoading(true)
            const effectiveId = targetUser?.id || targetUser?.celular || ''
            const { code, isNew } = await generateReferralLink(
                product.id,
                business.id,
                effectiveId,
                product.name,
                product.image,
                business.name,
                business.username,
                product.slug
            )
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            const url = `${origin}/${business.username}/${product.slug || product.id}?ref=${code}`
            setReferralLink(url)
            setLocalHasRecommended(true)
            if (isNew) {
                setLocalReferralCount(prev => (prev || 0) + 1)
            }
        } catch (err) {
            console.error('Error generating referral in sidebar:', err)
        } finally {
            setReferralLoading(false)
        }
    }

    const handleReferralPhoneSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        const clean = referralPhone.trim()
        if (!clean) {
            setReferralPhoneError('Ingresa tu número de celular')
            return
        }
        const normalized = normalizeEcuadorianPhone(clean)
        if (!validateEcuadorianPhone(normalized)) {
            setReferralPhoneError('Ingresa un número válido de 10 dígitos (ej: 0991234567)')
            return
        }

        setReferralLoading(true)
        setReferralPhoneError('')
        try {
            let client = await searchClientByPhone(normalized)
            if (client) {
                login(client)
            } else {
                const newClient = await createClient({
                    celular: normalized,
                    nombres: 'Cliente',
                    fecha_de_registro: new Date().toISOString()
                })
                if (newClient) {
                    client = newClient
                    login(newClient)
                }
            }
            await generateReferralForUser(client || { id: normalized, celular: normalized })
        } catch (err) {
            console.error('Error submitting referral phone in sidebar:', err)
            setReferralPhoneError('Error al generar enlace. Intenta nuevamente.')
            setReferralLoading(false)
        }
    }

    const handleCopyReferral = async () => {
        if (!referralLink) return
        try {
            await navigator.clipboard.writeText(referralLink)
            setReferralCopied(true)
            setTimeout(() => setReferralCopied(false), 2000)
        } catch (err) {
            console.error('Error copying referral link:', err)
        }
    }

    const handleShareWhatsApp = () => {
        if (!referralLink) return
        const text = `¡Mira este producto en ${business?.name || 'la tienda'}! ${product?.name} - ${referralLink}`
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    }

    const handleShareFacebook = () => {
        if (!referralLink) return
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`, '_blank')
    }

    const handleReviewImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!file.type.startsWith('image/')) {
            showNotification('Selecciona una imagen válida', 'error')
            return
        }

        // Preview local
        setReviewImageFile(file)
        const previewUrl = URL.createObjectURL(file)
        setReviewImagePreview(previewUrl)
    }

    const publishReview = async (clientName: string, clientPhone: string, clientPhotoURL: string, text: string, rating: number) => {
        if (!product?.id || !business?.id) return
        setIsSubmittingReview(true)
        try {
            let uploadedImageUrl = ''
            if (reviewImageFile) {
                try {
                    const optimizedBlob = await optimizeImage(reviewImageFile, 1200, 0.8, 'image/jpeg')
                    const storagePath = `ratings/${business.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`
                    const storageRef = ref(storage, storagePath)
                    const snapshot = await uploadBytes(storageRef, optimizedBlob)
                    uploadedImageUrl = await getDownloadURL(snapshot.ref)
                } catch (uploadErr) {
                    console.error('Error uploading rating image:', uploadErr)
                }
            }

            await addProductRatingComment(
                business.id,
                product.id,
                rating,
                text,
                { name: clientName, phone: clientPhone, photoURL: clientPhotoURL },
                uploadedImageUrl,
                { name: product.name, image: product.image }
            )

            // Actualización optimista inmediata
            const newReviewItem: ProductRatingItem = {
                id: `local_${Date.now()}`,
                orderId: '',
                clientName: `${clientName} (Tú)`,
                clientPhone,
                clientPhotoURL,
                rating,
                comment: text,
                image: uploadedImageUrl || reviewImagePreview || '',
                createdAt: new Date()
            }

            setProductRatingsList(prev => [newReviewItem, ...prev])
            setProductRatingCount(prev => prev + 1)
            setProductRatingAvg(prev => {
                const newTotal = (prev * productRatingCount) + rating
                return Math.round((newTotal / (productRatingCount + 1)) * 10) / 10
            })

            setNewReviewComment('')
            setNewReviewRating(5)
            setReviewImageFile(null)
            setReviewImagePreview(null)
            if (reviewFileInputRef.current) reviewFileInputRef.current.value = ''
            showNotification('¡Opinión publicada con éxito!')
        } catch (err) {
            console.error('Error submitting product review:', err)
            showNotification('Error al publicar opinión', 'error')
        } finally {
            setIsSubmittingReview(false)
        }
    }

    const handleSendProductReview = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        const text = newReviewComment.trim()
        if (!text || !product?.id || !business?.id) return

        // Si el usuario no está autenticado, abrir modal minimalista para pedir nombre y celular
        if (!user?.celular && !user?.id) {
            setGuestError('')
            setShowGuestReviewModal(true)
            return
        }

        // Usuario autenticado: publicar directamente
        await publishReview(user?.nombres || 'Cliente', user?.celular || '', (user as any)?.photoURL || (user as any)?.foto || '', text, newReviewRating)
    }

    const handleGuestReviewSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        const trimmedName = guestName.trim()
        const trimmedPhone = guestPhone.trim()

        if (!trimmedName) {
            setGuestError('Ingresa tu nombre')
            return
        }
        if (!trimmedPhone) {
            setGuestError('Ingresa tu número de celular')
            return
        }
        const normalized = normalizeEcuadorianPhone(trimmedPhone)
        if (!validateEcuadorianPhone(normalized)) {
            setGuestError('Ingresa un celular válido de 10 dígitos (ej: 0991234567)')
            return
        }

        setGuestLoading(true)
        setGuestError('')
        try {
            let client = await searchClientByPhone(normalized)
            if (client) {
                // Si el cliente ya existe y el nombre ingresado es distinto, actualizarlo silenciosamente
                if (trimmedName && client.nombres !== trimmedName) {
                    try {
                        await updateClient(client.id, { nombres: trimmedName })
                        client.nombres = trimmedName
                    } catch (updateErr) {
                        console.error('Error silently updating client name:', updateErr)
                    }
                }
                login(client)
            } else {
                const newClient = await createClient({
                    celular: normalized,
                    nombres: trimmedName,
                    fecha_de_registro: new Date().toISOString()
                })
                if (newClient) {
                    client = newClient
                    login(newClient)
                }
            }

            setShowGuestReviewModal(false)
            await publishReview(trimmedName, normalized, client?.photoURL || '', newReviewComment.trim(), newReviewRating)
            setGuestName('')
            setGuestPhone('')
        } catch (err) {
            console.error('Error in guest review submission:', err)
            setGuestError('Error al publicar. Intenta nuevamente.')
        } finally {
            setGuestLoading(false)
        }
    }

    const handleToggleLike = async (item: ProductRatingItem, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        if (!business?.id) return
        const effectiveUserIdentifier = user?.celular || user?.id

        if (!effectiveUserIdentifier) {
            setGuestError('')
            setShowGuestReviewModal(true)
            return
        }

        const docId = item.ratingDocId || item.id.split('_')[0]
        const likes = item.likes || []
        const isCurrentlyLiked = likes.includes(effectiveUserIdentifier)
        const nextLikes = isCurrentlyLiked
            ? likes.filter(u => u !== effectiveUserIdentifier)
            : [...likes, effectiveUserIdentifier]

        // Actualización optimista inmediata
        setProductRatingsList(prev => prev.map(r => r.id === item.id ? { ...r, likes: nextLikes } : r))

        try {
            await toggleRatingLike(business.id, docId, effectiveUserIdentifier)
        } catch (err) {
            console.error('Error toggling like:', err)
            // Rollback en caso de error
            setProductRatingsList(prev => prev.map(r => r.id === item.id ? { ...r, likes } : r))
        }
    }

    const handleSendReply = async (item: ProductRatingItem, e?: React.FormEvent) => {
        if (e) e.preventDefault()
        const text = (replyInputText[item.id] || '').trim()
        if (!text || !business?.id) return
        const effectiveUserIdentifier = user?.celular || user?.id

        if (!effectiveUserIdentifier) {
            setGuestError('')
            setShowGuestReviewModal(true)
            return
        }

        const docId = item.ratingDocId || item.id.split('_')[0]
        const userName = user?.nombres || 'Cliente'
        const userPhone = user?.celular || ''
        const userPhoto = (user as any)?.photoURL || (user as any)?.foto || ''

        setIsSendingReply(prev => ({ ...prev, [item.id]: true }))

        const newReplyObj = {
            id: `reply_${Date.now()}`,
            userPhone,
            userName,
            userPhoto,
            comment: text,
            createdAt: new Date()
        }

        // Actualización optimista
        setProductRatingsList(prev => prev.map(r => {
            if (r.id === item.id) {
                return { ...r, replies: [...(r.replies || []), newReplyObj] }
            }
            return r
        }))
        setReplyInputText(prev => ({ ...prev, [item.id]: '' }))

        try {
            await addStoreRatingReply(business.id, docId, {
                userPhone,
                userName,
                userPhoto,
                comment: text
            })
            showNotification('Respuesta enviada')
        } catch (err) {
            console.error('Error sending reply:', err)
            showNotification('Error al enviar respuesta', 'error')
        } finally {
            setIsSendingReply(prev => ({ ...prev, [item.id]: false }))
        }
    }

    const normalizePhoneDigits = (phoneStr?: string | null) => (phoneStr || '').replace(/\D/g, '')
    const currentProductClientPhone = user?.celular || (typeof window !== 'undefined' ? localStorage.getItem('loginPhone') : '') || ''
    const currentProductClientDigits = normalizePhoneDigits(currentProductClientPhone)

    const startEditingReview = (item: ProductRatingItem, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone)
        const canManage = Boolean(
            currentProductClientDigits &&
            reviewPhoneDigits &&
            (currentProductClientDigits === reviewPhoneDigits || currentProductClientDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentProductClientDigits))
        ) || (item.id.startsWith('local_') && Boolean(currentProductClientDigits))

        if (!canManage) {
            showNotification('Solo el autor puede editar esta opinión', 'error')
            return
        }

        setEditingReviewId(item.id)
        setEditRatingScore(item.rating || 5)
        setEditCommentText(item.comment || '')
        setEditImagePreview(item.image || null)
        setEditImageFile(null)
        setEditImageRemoved(false)
    }

    const handleSaveEditReview = async (item: ProductRatingItem, e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!business?.id || !product?.id) return
        const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone)
        const canManage = Boolean(
            currentProductClientDigits &&
            reviewPhoneDigits &&
            (currentProductClientDigits === reviewPhoneDigits || currentProductClientDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentProductClientDigits))
        ) || (item.id.startsWith('local_') && Boolean(currentProductClientDigits))

        if (!canManage) {
            showNotification('Solo el autor puede editar esta opinión', 'error')
            return
        }

        const docId = item.ratingDocId || item.id.split('_')[0]
        setIsSavingEdit(true)

        try {
            let finalImageUrl = editImagePreview || item.image || ''
            if (editImageFile) {
                const optimizedBlob = await optimizeImage(editImageFile, 1200, 0.8, 'image/jpeg')
                const storagePath = `ratings/${business.id}/${Date.now()}_edit.jpg`
                const storageRef = ref(storage, storagePath)
                const snapshot = await uploadBytes(storageRef, optimizedBlob)
                finalImageUrl = await getDownloadURL(snapshot.ref)
            } else if (editImageRemoved) {
                finalImageUrl = ''
            }

            await updateProductRatingComment(
                business.id,
                docId,
                product.id,
                editRatingScore,
                editCommentText,
                finalImageUrl
            )

            // Actualización local
            setProductRatingsList(prev => prev.map(r => {
                if (r.id === item.id) {
                    return {
                        ...r,
                        rating: editRatingScore,
                        comment: editCommentText.trim(),
                        image: finalImageUrl
                    }
                }
                return r
            }))

            setProductRatingsList(currentList => {
                const totalRating = currentList.reduce((sum, r) => sum + r.rating, 0)
                setProductRatingAvg(currentList.length > 0 ? Math.round((totalRating / currentList.length) * 10) / 10 : 0)
                return currentList
            })

            setEditingReviewId(null)
            showNotification('Opinión actualizada')
        } catch (err) {
            console.error('Error updating review:', err)
            showNotification('Error al actualizar opinión', 'error')
        } finally {
            setIsSavingEdit(false)
        }
    }

    const handleDeleteReview = async (item: ProductRatingItem, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        if (!business?.id || !product?.id) return
        const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone)
        const canManage = Boolean(
            currentProductClientDigits &&
            reviewPhoneDigits &&
            (currentProductClientDigits === reviewPhoneDigits || currentProductClientDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentProductClientDigits))
        ) || (item.id.startsWith('local_') && Boolean(currentProductClientDigits))

        if (!canManage) {
            showNotification('Solo el autor puede eliminar esta opinión', 'error')
            return
        }

        if (!confirm('¿Deseas eliminar tu opinión?')) return

        const docId = item.ratingDocId || item.id.split('_')[0]

        // Eliminación optimista
        setProductRatingsList(prev => {
            const next = prev.filter(r => r.id !== item.id)
            const totalRating = next.reduce((sum, r) => sum + r.rating, 0)
            setProductRatingCount(next.length)
            setProductRatingAvg(next.length > 0 ? Math.round((totalRating / next.length) * 10) / 10 : 0)
            return next
        })
        showNotification('Opinión eliminada')

        try {
            await deleteProductRatingComment(business.id, docId, product.id)
        } catch (err) {
            console.error('Error deleting review:', err)
            showNotification('Error al eliminar opinión', 'error')
        }
    }

    const availableVariants = useMemo(() => {
        return product?.variants?.filter(v => v.isAvailable !== false) || []
    }, [product])

    const anyVariantHasImage = useMemo(() => {
        return availableVariants.some(v => !!v.image)
    }, [availableVariants])

    const comboPrice = useMemo(() => {
        if (!product || !product.isCombo) return 0;
        return Object.entries(comboSelection).reduce((total, [variantName, qty]) => {
            const variant = availableVariants.find(v => v.name === variantName);
            if (variant && qty > 0) {
                return total + (getProductPublicPrice(variant, business) * qty);
            }
            return total;
        }, 0);
    }, [product, comboSelection, availableVariants, business]);

    const activeVariantObj = useMemo(() => {
        if (!product || !product.variants || !selectedVariant) return null;
        return product.variants.find(v => v.name === selectedVariant) || null;
    }, [product, selectedVariant]);

    const optionsPrice = useMemo(() => {
        if (!product || !product.optionGroups) return 0;
        return Object.values(selectedOptions).reduce((sum, groupSelections) => {
            return sum + groupSelections.reduce((gSum, opt) => gSum + (opt.price || 0), 0);
        }, 0);
    }, [product, selectedOptions]);

    const isOptionsSelectionComplete = useMemo(() => {
        if (!product || !product.optionGroups) return true;
        return product.optionGroups.every(group => {
            const count = (selectedOptions[group.id] || []).length;
            return count >= group.minSelect;
        });
    }, [product, selectedOptions]);

    const baseProductPrice = useMemo(() => {
        if (!product) return 0;
        if (activeVariantObj) {
            return getProductPublicPrice(activeVariantObj, business);
        }
        if (product.variants && product.variants.length > 0) {
            const available = product.variants.filter(v => v.isAvailable !== false);
            if (available.length > 0) {
                return getProductPublicPrice(available[0], business);
            }
        }
        return getProductPublicPrice(product, business);
    }, [product, activeVariantObj, business]);


    // Reset state when product changes
    useEffect(() => {
        if (product) {
            if (product.variants && product.variants.length > 0) {
                setSelectedVariant(product.variants[0].name)
            } else {
                setSelectedVariant(null)
            }
            setQuantity(1)
            setComboSelection({})
            setSelectedOptions({})

            // Scroll to top
            if (sidebarContentRef.current) {
                sidebarContentRef.current.scrollTo({ top: 0, behavior: 'smooth' })
            }
        }
    }, [product])

    // Manage body scroll
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [isOpen])

    // Load cart for specific business
    useEffect(() => {
        if (business?.id && isOpen) {
            const loadCart = () => {
                const savedCarts = localStorage.getItem('carts')
                if (savedCarts) {
                    const allCarts = JSON.parse(savedCarts)
                    const businessCart = allCarts[business.id] || []
                    setCart(businessCart)
                } else {
                    setCart([])
                }
            }

            loadCart()
            // Listen for storage changes and custom cart updates
            const handleStorageChange = () => loadCart()
            window.addEventListener('storage', handleStorageChange)
            window.addEventListener('cart-updated', handleStorageChange)
            window.addEventListener('pageshow', handleStorageChange)
            return () => {
                window.removeEventListener('storage', handleStorageChange)
                window.removeEventListener('cart-updated', handleStorageChange)
                window.removeEventListener('pageshow', handleStorageChange)
            }
        }
    }, [business?.id, isOpen])

    // Load other products for the business
    useEffect(() => {
        if (business?.id && isOpen && product?.id) {
            const fetchOtherProducts = async () => {
                try {
                    const products = await getProductsByBusiness(business.id)
                    setOtherProducts(products.filter(p => p.id !== product.id && p.isAvailable).slice(0, 10))
                } catch (error) {
                    console.error("Error fetching other products:", error)
                }
            }
            fetchOtherProducts()
        }
    }, [business?.id, isOpen, product?.id])


    const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ show: true, message, type })
        setTimeout(() => {
            setNotification({ show: false, message: '', type: 'success' })
        }, 3000)
    }

    const updateQuantity = (productIdToUpdate: string, newQuantity: number, variantName?: string | null) => {
        if (!business?.id) return

        if (newQuantity <= 0) {
            removeFromCart(productIdToUpdate, variantName)
            return
        }

        const newCart = cart.map(item =>
            (item.id === productIdToUpdate && item.variantName === variantName)
                ? { ...item, quantity: newQuantity }
                : item
        )

        setCart(newCart)
        updateCartInStorage(business.id, newCart)
    }

    const removeFromCart = (productIdToRemove: string, variantName?: string | null) => {
        if (!business?.id) return

        const itemToRemove = cart.find(item => item.id === productIdToRemove && item.variantName === variantName)
        const isPremioQr = itemToRemove?.esPremio === true && (itemToRemove?.qrCodeId || String(itemToRemove?.id || '').startsWith('premio-qr-'))
        const qrCodeIdToUnredeem = itemToRemove?.qrCodeId || (typeof itemToRemove?.id === 'string' && itemToRemove.id.startsWith('premio-qr-')
            ? itemToRemove.id.replace('premio-qr-', '')
            : null)

        const newCart = cart.filter(item => !(item.id === productIdToRemove && item.variantName === variantName))
        setCart(newCart)
        updateCartInStorage(business.id, newCart)

        if (isPremioQr && qrCodeIdToUnredeem) {
            try {
                const rawPhone = localStorage.getItem('loginPhone') || ''
                const phone = normalizeEcuadorianPhone(rawPhone)
                if (phone) {
                    void unredeemQRCodePrize(phone, business.id, qrCodeIdToUnredeem)
                        .catch((e) => console.error('Error unredeeming QR prize after cart removal:', e))
                }
            } catch (e) {
                console.error('Error reading loginPhone for unredeem:', e)
            }
        }
    }

    const updateCartInStorage = (businessId: string, businessCart: any[]) => {
        const savedCarts = localStorage.getItem('carts')
        const allCarts = savedCarts ? JSON.parse(savedCarts) : {}

        if (businessCart.length === 0) {
            delete allCarts[businessId]
        } else {
            allCarts[businessId] = businessCart
        }

        localStorage.setItem('carts', JSON.stringify(allCarts))
        // Dispatch events for other components to update
        window.dispatchEvent(new Event('storage'))
        window.dispatchEvent(new Event('cart-updated'))
    }

    const handleAddOptionProductToCart = () => {
        if (!product || !business) return;

        if (!isOptionsSelectionComplete) {
            alert('Por favor selecciona las opciones obligatorias');
            return;
        }

        const basePriceMeta = activeVariantObj 
            ? getPriceMetadata(activeVariantObj) 
            : getPriceMetadata(product);

        // Format selectedOptions as a variant string
        const optionsList: string[] = [];
        Object.entries(selectedOptions).forEach(([groupId, selections]) => {
            const group = product.optionGroups?.find(g => g.id === groupId);
            if (selections.length > 0) {
                const groupSelections = selections.map(s => {
                    const priceStr = s.price > 0 ? ` (+$${s.price.toFixed(2)})` : '';
                    return `${s.name}${priceStr}`;
                }).join(', ');
                optionsList.push(`${group?.name || 'Opción'}: ${groupSelections}`);
            }
        });
        const optionsStr = optionsList.join(' | ');
        
        let finalVariantName = '';
        if (activeVariantObj) {
            finalVariantName = optionsStr ? `${activeVariantObj.name} (${optionsStr})` : activeVariantObj.name;
        } else {
            finalVariantName = optionsStr;
        }

        // Generate cartItemId using the combined variant name
        const cleanHash = finalVariantName.replace(/[^a-zA-Z0-9]/g, '');
        const cartItemId = cleanHash ? `${product.id}-${cleanHash}` : product.id;

        const itemToAdd = {
            id: cartItemId,
            productId: product.id, // ID original del producto para verificar disponibilidad en el carrito
            name: product.name,
            variantName: finalVariantName || null,
            productName: product.name,
            price: baseProductPrice + optionsPrice,
            ...basePriceMeta,
            isCartItem: true,
            feeAlreadyApplied: true,
            // Include options price in basePrice and storeReceives
            basePrice: (basePriceMeta.basePrice || baseProductPrice) + optionsPrice,
            storeReceives: (basePriceMeta.storeReceives || baseProductPrice) + optionsPrice,
            image: activeVariantObj?.image || product.image,
            description: activeVariantObj?.description || product.description,
            businessId: business.id,
            businessName: business.name,
            businessImage: business.image,
            category: product.category,
            imagePosition: product.imagePosition || 'center 50%',
            ...(product.isShared && {
                originalBusinessId: product.originalBusinessId,
                originalBusinessName: product.originalBusinessName,
                originalBusinessImage: product.originalBusinessImage
            })
        };

        const currentCart = [...cart];
        const existingItemIndex = currentCart.findIndex(item => item.id === cartItemId);
        
        if (existingItemIndex > -1) {
            currentCart[existingItemIndex].quantity += quantity;
        } else {
            currentCart.push({ ...itemToAdd, quantity });
        }
        
        setCart(currentCart);
        updateCartInStorage(business.id, currentCart);
        showNotification(`${product.name} agregado`);
        
        // Reset states
        setSelectedOptions({});
        setQuantity(1);
        onClose();
        onOpenCart?.();
    };

    const handleCopyProductLink = async () => {
        if (!product || !business) return
        const productUrl = `${window.location.origin}/${business.username || `restaurant/${business.id}`}/${product.slug || product.id}`
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(productUrl)
            } else {
                const textArea = document.createElement('textarea')
                textArea.value = productUrl
                textArea.style.position = 'fixed'
                textArea.style.opacity = '0'
                document.body.appendChild(textArea)
                textArea.focus()
                textArea.select()
                document.execCommand('copy')
                document.body.removeChild(textArea)
            }
            setCopySuccess(true)
            setTimeout(() => setCopySuccess(false), 2000)
        } catch (err) {
            console.error('Error al copiar enlace:', err)
        }
    }

    if (!isOpen || !product || !business) return null

    return (
        <div className="fixed inset-0 z-[120] overflow-hidden">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
            />

            <div
                className={`fixed right-0 top-0 h-full w-full sm:w-[500px] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-[130] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
                <div ref={sidebarContentRef} className="h-full overflow-y-auto scrollbar-hide bg-white">
                    <div className="min-h-full flex flex-col relative">

                        {/* Product Image & Overlaid Store Header Container (Edge to Edge, 0px margins) */}
                        <div className="w-full aspect-[16/9] sm:aspect-[16/10] bg-gray-900 overflow-hidden shadow-sm relative group flex-shrink-0">
                            {/* Gradient Overlay for Top Controls Visibility */}
                            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 via-black/20 to-transparent z-10 pointer-events-none" />

                            {/* Business Header without background */}
                            {business && (
                                <Link 
                                    href={business.username ? `/${business.username}` : `restaurant/${business.id}`}
                                    onClick={onClose}
                                    className="absolute top-4 left-4 z-20 flex items-center gap-3 text-white hover:opacity-85 transition-opacity group/header cursor-pointer max-w-[calc(100%-4.5rem)] drop-shadow-md"
                                >
                                    <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-white ring-2 ring-white/60 shadow-md">
                                        {business.image ? (
                                            <img src={business.image} alt={business.name || 'Tienda'} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-red-600 text-white font-bold text-xs">
                                                {(business.name || 'T').charAt(0)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="truncate text-left">
                                        <h3 className="text-sm font-black tracking-tight leading-tight text-white group-hover/header:text-red-300 transition-colors truncate">
                                            {business.name || 'Tienda'}
                                        </h3>
                                        {business.username && (
                                            <p className="text-xs text-gray-200 font-medium leading-none truncate mt-0.5">
                                                @{business.username}
                                            </p>
                                        )}
                                    </div>
                                </Link>
                            )}

                            {/* Close Button without background */}
                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-white hover:opacity-75 transition-opacity z-20 drop-shadow-md"
                                aria-label="Cerrar"
                            >
                                <i className="bi bi-x-lg text-lg"></i>
                            </button>

                            {/* Product Image */}
                            {allImages.length > 0 ? (
                                <img 
                                    src={allImages[currentImgIndex]} 
                                    alt={product.name} 
                                    className="w-full h-full object-cover transition-all duration-700" 
                                    style={{ 
                                        objectPosition: allImages[currentImgIndex] === product.image ? (product.imagePosition || 'center') : 'center',
                                        transformOrigin: allImages[currentImgIndex] === product.image ? (product.imagePosition || 'center') : 'center',
                                        transform: (allImages[currentImgIndex] === product.image && product.imageScale && product.imageScale > 1) ? `scale(${product.imageScale})` : undefined
                                    }} 
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <i className="bi bi-image text-5xl"></i>
                                </div>
                            )}
                        </div>

                        {/* Sidebar Content Padding Container */}
                        <div className="p-6 flex-1 flex flex-col">

                        {/* Product Info */}
                        <div className="mb-4">
                            <div className="flex items-center gap-2 mb-1">
                                {product.category && (
                                    <span className="px-2 py-0.5 text-gray-400 text-[10px] font-black uppercase tracking-widest rounded-full">
                                        {product.category}
                                    </span>
                                )}
                                {!product.isAvailable && (
                                    <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-rose-50 text-rose-600">
                                        No disponible
                                    </span>
                                )}
                            </div>

                            <div className="mb-1">
                                <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">{product.name}</h2>
                            </div>

                            {product.description && (
                                <p className="text-sm text-gray-500 font-medium leading-relaxed">{product.description}</p>
                            )}

                            {getPackagingFee(business) > 0 && (
                                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-xs font-semibold border border-amber-200/60 mt-1">
                                    <i className="bi bi-box-seam text-amber-600 text-xs"></i>
                                    <span>Incluye recargo por empaque</span>
                                </div>
                            )}

                            {/* Barra de 3 Pestañas: Comprar | Opiniones | Recomendar */}
                            <div className="grid grid-cols-3 gap-1.5 mt-3.5">
                                {/* Pestaña 1: Comprar */}
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('options')}
                                    className={`py-2 px-1 rounded-2xl text-[11px] sm:text-xs font-black transition-all flex flex-col items-center justify-center gap-1 active:scale-95 cursor-pointer ${
                                        activeTab === 'options'
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                                >
                                    <ShoppingBag
                                        size={17}
                                        className={activeTab === 'options' ? 'text-gray-900' : 'text-gray-400'}
                                    />
                                    <span>Comprar</span>
                                </button>

                                {/* Pestaña 2: Opiniones */}
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('reviews')}
                                    className={`py-2 px-1 rounded-2xl text-[11px] sm:text-xs font-black transition-all flex flex-col items-center justify-center gap-1 active:scale-95 cursor-pointer ${
                                        activeTab === 'reviews'
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="relative flex items-center justify-center">
                                        <Star
                                            size={17}
                                            className={activeTab === 'reviews' || productRatingAvg > 0 ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}
                                        />
                                        {productRatingAvg > 0 && (
                                             <span className="absolute -top-1.5 -right-3 text-[9px] text-amber-700 font-extrabold bg-amber-100 px-1 py-0.2 rounded-full leading-none">
                                                {productRatingAvg.toFixed(1)}
                                            </span>
                                        )}
                                    </div>
                                    <span>Opiniones</span>
                                </button>

                                {/* Pestaña 3: Recomendar */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveTab('referral')
                                        setReferralPhoneError('')
                                        setReferralCopied(false)
                                        if ((user?.id || user?.celular) && !referralLink) {
                                            generateReferralForUser(user)
                                        }
                                    }}
                                    className={`py-2 px-1 rounded-2xl text-[11px] sm:text-xs font-black transition-all flex flex-col items-center justify-center gap-1 active:scale-95 cursor-pointer ${
                                        activeTab === 'referral'
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-400 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                                >
                                    <Flame
                                        size={17}
                                        className={activeTab === 'referral' || localHasRecommended ? 'fill-orange-500 text-orange-500' : 'text-gray-400'}
                                    />
                                    <span>Recomendar</span>
                                </button>
                            </div>
                        </div>

                        {activeTab === 'options' ? (
                            <>
                                {/* Variants & Actions */}
                                <div className="space-y-4 animate-in fade-in duration-200">
                            {product.optionGroups && product.optionGroups.length > 0 ? (
                                <div className="space-y-6">
                                    {/* 1. Si hay opciones y también variantes, renderizarlas como un radio list */}
                                    {product.variants && product.variants.length > 0 && (
                                        <div>
                                            <div className="flex items-center justify-between pt-1 mb-3">
                                                <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                                                    Selecciona una opción
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                {availableVariants.map((variant) => {
                                                    const isSelected = selectedVariant === variant.name;
                                                    return (
                                                        <label
                                                            key={variant.name}
                                                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                                                isSelected 
                                                                    ? 'border-red-500 bg-red-50/50' 
                                                                    : 'border-gray-100 bg-white hover:border-gray-200'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <input
                                                                    type="radio"
                                                                    name="product-variant-radio"
                                                                    checked={isSelected}
                                                                    onChange={() => setSelectedVariant(variant.name)}
                                                                    className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300"
                                                                />
                                                                <span className="font-bold text-gray-900 text-sm">{variant.name}</span>
                                                            </div>
                                                            <span className="text-sm font-black text-red-600">
                                                                {formatPrice(getProductPublicPrice(variant, business))}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* 2. Renderizar los grupos de opciones/modificadores */}
                                    <div className="space-y-6">
                                        {product.optionGroups.map((group) => {
                                            const selections = selectedOptions[group.id] || []
                                            const isGroupAtMax = selections.length >= group.maxSelect

                                            return (
                                                <div key={group.id} className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <span className="block text-sm font-black text-gray-900 leading-tight">
                                                                {group.name}
                                                            </span>
                                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mt-0.5">
                                                                {group.minSelect > 0 
                                                                    ? `Obligatorio · Elige ${group.minSelect === group.maxSelect ? group.minSelect : `de ${group.minSelect} a ${group.maxSelect}`}` 
                                                                    : `Opcional · Elige hasta ${group.maxSelect}`}
                                                            </span>
                                                        </div>
                                                        {selections.length > 0 && (
                                                            <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-black">
                                                                {selections.length}/{group.maxSelect}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2">
                                                        {group.options.filter(opt => opt.isAvailable !== false).map((opt) => {
                                                            const isSelected = selections.some(s => s.name === opt.name)
                                                            const disabled = !isSelected && isGroupAtMax

                                                            return (
                                                                <label
                                                                    key={opt.name}
                                                                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                                                        isSelected 
                                                                            ? 'border-red-500 bg-red-50/50' 
                                                                            : disabled 
                                                                                ? 'border-gray-50 bg-gray-50/30 opacity-60 cursor-not-allowed' 
                                                                                : 'border-gray-100 bg-white hover:border-gray-200'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <input
                                                                            type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                                                                            name={group.id}
                                                                            checked={isSelected}
                                                                            disabled={disabled}
                                                                            onChange={() => {
                                                                                if (group.maxSelect === 1) {
                                                                                    setSelectedOptions(prev => ({
                                                                                        ...prev,
                                                                                        [group.id]: [{ name: opt.name, price: opt.price }]
                                                                                    }))
                                                                                } else {
                                                                                    setSelectedOptions(prev => {
                                                                                        const current = prev[group.id] || []
                                                                                        const exists = current.some(s => s.name === opt.name)
                                                                                        let updated
                                                                                        if (exists) {
                                                                                            updated = current.filter(s => s.name !== opt.name)
                                                                                        } else {
                                                                                            if (current.length >= group.maxSelect) return prev
                                                                                            updated = [...current, { name: opt.name, price: opt.price }]
                                                                                        }
                                                                                        return { ...prev, [group.id]: updated }
                                                                                    })
                                                                                }
                                                                            }}
                                                                            className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                                                                        />
                                                                        <span className="font-bold text-gray-900 text-sm">{opt.name}</span>
                                                                    </div>
                                                                    {opt.price > 0 && (
                                                                        <span className="text-xs font-black text-gray-500">
                                                                            +{formatPrice(opt.price)}
                                                                        </span>
                                                                    )}
                                                                </label>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {/* 3. Panel de control de cantidad y botón Agregar para modificadores */}
                                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                        <div>
                                            <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Precio</span>
                                            <span className="text-3xl font-black text-red-600 tracking-tight">{formatPrice(getProductPublicPrice(product, business))}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2 bg-white rounded-xl p-1 shadow-sm border border-gray-100">
                                                <button
                                                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                                                    className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-red-500 text-lg"
                                                >
                                                    <i className="bi bi-dash"></i>
                                                </button>
                                                <span className="text-lg font-black w-6 text-center">{quantity}</span>
                                                <button
                                                    onClick={() => setQuantity(q => q + 1)}
                                                    className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-green-600 text-lg"
                                                >
                                                    <i className="bi bi-plus"></i>
                                                </button>
                                            </div>
                                            <button
                                                onClick={handleAddOptionProductToCart}
                                                disabled={!isOptionsSelectionComplete || !product.isAvailable}
                                                className="px-6 py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                <i className="bi bi-bag-plus-fill"></i>
                                                Agregar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : product.variants && product.variants.length > 0 ? (
                                <div>
                                    <div className="flex items-center justify-between pt-1 mb-3">
                                        <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                                            Opciones
                                        </span>
                                    </div>
                                    <div className="space-y-3">
                                        {availableVariants.map((variant) => {
                                            const cartItem = cart.find(item => item.id === product.id && item.variantName === variant.name);
                                            const qty = product.isCombo ? (comboSelection[variant.name] || 0) : (cartItem ? cartItem.quantity : 0);

                                            return (
                                                <div key={variant.name} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${qty > 0 ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-white'}`}>
                                                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                                                        {anyVariantHasImage && (
                                                            <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-white border border-gray-100 flex items-center justify-center">
                                                                <img
                                                                    src={variant.image || product.image || business.image}
                                                                    alt={variant.name}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <span className="block font-bold text-gray-900 text-sm">{variant.name}</span>
                                                            {variant.description && (
                                                                <p className="text-[11px] text-gray-500 line-clamp-2 leading-tight mt-0.5 mb-1">
                                                                    {variant.description}
                                                                </p>
                                                            )}
                                                            <span className="text-sm font-black text-red-600">{formatPrice(getProductPublicPrice(variant, business))}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        {qty > 0 ? (
                                                            <div className="flex items-center gap-2 bg-white rounded-lg p-1 shadow-sm">
                                                                <button
                                                                    onClick={() => {
                                                                        if (product.isCombo) {
                                                                            setComboSelection(prev => ({ ...prev, [variant.name]: Math.max(0, qty - 1) }))
                                                                        } else {
                                                                            updateQuantity(product.id, qty - 1, variant.name)
                                                                        }
                                                                    }}
                                                                    className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-red-500"
                                                                >
                                                                    <i className="bi bi-dash"></i>
                                                                </button>
                                                                <span className="text-xs font-black w-4 text-center">{qty}</span>
                                                                <button
                                                                    onClick={() => {
                                                                        if (product.isCombo) {
                                                                            setComboSelection(prev => ({ ...prev, [variant.name]: qty + 1 }))
                                                                        } else {
                                                                            updateQuantity(product.id, qty + 1, variant.name)
                                                                        }
                                                                    }}
                                                                    className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-green-600"
                                                                >
                                                                    <i className="bi bi-plus"></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    if (product.isCombo) {
                                                                        setComboSelection(prev => ({ ...prev, [variant.name]: 1 }))
                                                                    } else {
                                                                        const itemToAdd = {
                                                                            id: product.id,
                                                                            name: product.name,            // Nombre base del producto
                                                                            variant: variant.name,        // Nombre de la variante
                                                                            variantName: variant.name,    // Nombre de la variante
                                                                            productName: product.name,    // Nombre base (redundante pero claro)
                                                                            price: getProductPublicPrice(variant, business),
                                                                            ...getPriceMetadata(variant, business),
                                                                            image: product.image,
                                                                            imagePosition: product.imagePosition || 'center 50%',
                                                                            description: variant.description || product.description,
                                                                            businessId: business.id,
                                                                            businessName: business.name,
                                                                            businessImage: business.image,
                                                                            category: product.category,
                                                                            ...(product.isShared && {
                                                                                originalBusinessId: product.originalBusinessId,
                                                                                originalBusinessName: product.originalBusinessName,
                                                                                originalBusinessImage: product.originalBusinessImage
                                                                            })
                                                                        };

                                                                        const enriched = ensureCartItemMetadata(itemToAdd)
                                                                        const currentCart = [...cart];
                                                                        currentCart.push({ ...enriched, quantity: 1 });
                                                                        setCart(currentCart);
                                                                        updateCartInStorage(business.id, currentCart);
                                                                        showNotification(`${product.name} - ${variant.name} agregado`);
                                                                    }
                                                                }}
                                                                disabled={!product.isAvailable}
                                                                className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center hover:bg-black transition-colors disabled:opacity-50"
                                                            >
                                                                <i className="bi bi-plus-lg"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div>
                                        <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Precio</span>
                                        <span className="text-3xl font-black text-red-600 tracking-tight">{formatPrice(getProductPublicPrice(product, business))}</span>
                                    </div>
                                    <div>
                                        {(() => {
                                            const cartItem = cart.find(item => item.id === product.id && item.variantName === null);
                                            const qty = cartItem ? cartItem.quantity : 0;

                                            if (qty > 0) {
                                                return (
                                                    <div className="flex items-center gap-3 bg-white rounded-xl p-2 shadow-sm border border-gray-100">
                                                        <button onClick={() => updateQuantity(product.id, qty - 1, null)} className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-red-500 text-lg"><i className="bi bi-dash"></i></button>
                                                        <span className="text-lg font-black w-6 text-center">{qty}</span>
                                                        <button onClick={() => updateQuantity(product.id, qty + 1, null)} className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-green-600 text-lg"><i className="bi bi-plus"></i></button>
                                                    </div>
                                                )
                                            } else {
                                                return (
                                                    <button
                                                        onClick={() => {
                                                            const itemToAdd = {
                                                                id: product.id,
                                                                name: product.name,
                                                                variantName: null,
                                                                productName: product.name,
                                                                price: getProductPublicPrice(product, business),
                                                                ...getPriceMetadata(product, business),
                                                                image: product.image,
                                                                imagePosition: product.imagePosition || 'center 50%',
                                                                description: product.description,
                                                                businessId: business.id,
                                                                businessName: business.name,
                                                                businessImage: business.image,
                                                                category: product.category
                                                            };

                                                            const currentCart = [...cart];
                                                            currentCart.push({ ...itemToAdd, quantity: 1 });
                                                            setCart(currentCart);
                                                            updateCartInStorage(business.id, currentCart);
                                                            showNotification(`${product.name} agregado`);
                                                        }}
                                                        disabled={!product.isAvailable}
                                                        className="px-6 py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                                    >
                                                        <i className="bi bi-bag-plus-fill"></i>
                                                        Agregar
                                                    </button>
                                                )
                                            }
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>

                                {/* Other Products Section */}
                                {otherProducts.length > 0 && (
                                    <div className="mt-8 border-t border-gray-100 pt-6">
                                        <h4 className="text-sm font-black text-gray-900 mb-4 uppercase tracking-tight">
                                            Otros productos de {business.name}
                                        </h4>
                                        <div className="relative">
                                            <div
                                                className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-4"
                                                style={{
                                                    scrollbarWidth: 'none',
                                                    msOverflowStyle: 'none',
                                                    WebkitOverflowScrolling: 'touch'
                                                }}
                                            >
                                                {otherProducts.map((otherProduct) => (
                                                    <div
                                                        key={otherProduct.id}
                                                        onClick={() => onProductSelect(otherProduct)}
                                                        className="group cursor-pointer bg-gray-50 rounded-xl p-2 border border-blue-50 hover:border-blue-200 transition-all hover:bg-white hover:shadow-sm flex-shrink-0 snap-start w-[140px]"
                                                    >
                                                        <div className="aspect-square rounded-lg overflow-hidden bg-white mb-2 relative">
                                                            {otherProduct.image ? (
                                                                <img
                                                                    src={otherProduct.image}
                                                                    alt={otherProduct.name}
                                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                                    style={{ objectPosition: otherProduct.imagePosition || 'center' }}
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-gray-200">
                                                                    <i className="bi bi-image text-2xl"></i>
                                                                </div>
                                                            )}
                                                            {otherProduct.price > 0 && (
                                                                <div className="absolute top-1 right-1 bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm">
                                                                    {formatPrice(getProductPublicPrice(otherProduct))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <h5 className="text-xs font-black text-gray-900 tracking-tight line-clamp-2 leading-tight group-hover:text-red-600 transition-colors h-[2.5em]">
                                                            {otherProduct.name}
                                                        </h5>
                                                    </div>
                                                ))}
                                            </div>
                                            {otherProducts.length > 2 && (
                                                <div className="absolute right-0 top-0 bottom-4 w-12 pointer-events-none bg-gradient-to-l from-white via-white/50 to-transparent flex items-center justify-end pr-1">
                                                    <div className="animate-pulse bg-white/80 p-1 rounded-full shadow-sm backdrop-blur-sm">
                                                        <i className="bi bi-chevron-right text-gray-400 text-xs"></i>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : activeTab === 'reviews' ? (
                            /* Opiniones y Comentarios Tab */
                            <div className="space-y-4 animate-in fade-in duration-200">
                                {/* Resumen de Calificación - Centrado horizontalmente y sin fondo */}
                                <div className="py-2 text-center flex flex-col items-center justify-center">
                                    <p className="text-4xl font-black text-gray-900 tracking-tight leading-none">
                                        {productRatingAvg > 0 ? productRatingAvg.toFixed(1) : '5.0'}
                                    </p>
                                    <div className="mt-2 flex justify-center">
                                        <StarRating
                                            rating={productRatingAvg > 0 ? productRatingAvg : 5}
                                            size="md"
                                            showGrayStars={productRatingCount === 0}
                                            showRatingText={false}
                                        />
                                    </div>
                                    <p className="text-xs font-bold text-gray-500 mt-1.5">
                                        {productRatingCount > 0
                                            ? `${productRatingCount} ${productRatingCount === 1 ? 'opinión' : 'opiniones'}`
                                            : 'Sin opiniones aún'}
                                    </p>
                                </div>

                                {/* Casillero incrustado para calificar y escribir opinión */}
                                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
                                    <form onSubmit={handleSendProductReview} className="space-y-2.5">
                                        {/* Selector de estrellas */}
                                        <div className="flex items-center justify-between px-1">
                                            <span className="text-xs font-bold text-gray-700">
                                                Tu calificación:
                                            </span>
                                            <div className="flex items-center gap-1">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <button
                                                        key={star}
                                                        type="button"
                                                        onClick={() => setNewReviewRating(star)}
                                                        className="p-0.5 transition-transform hover:scale-125 active:scale-95 text-amber-400"
                                                        title={`${star} estrellas`}
                                                    >
                                                        <i className={`bi ${newReviewRating >= star ? 'bi-star-fill' : 'bi-star text-gray-300'} text-lg`}></i>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Mini vista previa de la foto adjunta */}
                                        {reviewImagePreview && (
                                            <div className="relative inline-block px-1">
                                                <img
                                                    src={reviewImagePreview}
                                                    alt="Vista previa"
                                                    className="w-14 h-14 object-cover rounded-xl border border-gray-200 shadow-sm"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setReviewImageFile(null)
                                                        setReviewImagePreview(null)
                                                        if (reviewFileInputRef.current) reviewFileInputRef.current.value = ''
                                                    }}
                                                    className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow hover:bg-red-600 transition-colors"
                                                    title="Quitar foto"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        )}

                                        {/* Input con botón de cámara y botón de enviar */}
                                        <div className="flex items-center gap-2 sm:gap-2.5">
                                            <input
                                                type="file"
                                                ref={reviewFileInputRef}
                                                onChange={handleReviewImageChange}
                                                accept="image/*"
                                                className="hidden"
                                            />

                                            <input
                                                type="text"
                                                value={newReviewComment}
                                                onChange={(e) => setNewReviewComment(e.target.value)}
                                                placeholder="Escribe una opinión sobre el producto..."
                                                disabled={isSubmittingReview}
                                                className="flex-1 bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-2.5 text-xs text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent font-medium transition-all"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => reviewFileInputRef.current?.click()}
                                                disabled={isSubmittingReview}
                                                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl border flex items-center justify-center transition-all active:scale-95 flex-shrink-0 ${
                                                    reviewImagePreview
                                                        ? 'bg-amber-50 border-amber-300 text-amber-600'
                                                        : 'bg-gray-50 hover:bg-gray-100 border-gray-200/80 text-gray-500 hover:text-gray-900'
                                                }`}
                                                title="Adjuntar foto"
                                            >
                                                <Camera size={17} />
                                            </button>

                                            <button
                                                type="submit"
                                                disabled={(!newReviewComment.trim() && !reviewImageFile) || isSubmittingReview}
                                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gray-900 hover:bg-black text-white flex items-center justify-center transition-all shadow-md active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                                                title="Publicar opinión"
                                            >
                                                {isSubmittingReview ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <ArrowUp size={17} strokeWidth={2.5} />
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                </div>

                                {/* Cabecera sutil: Todas las opiniones */}
                                <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
                                    <span className="text-xs font-black uppercase tracking-wider text-gray-400">
                                        Todas las opiniones
                                    </span>
                                    {productRatingsList.length > 0 && (
                                        <span className="text-[11px] font-bold text-gray-400">
                                            {productRatingsList.length}
                                        </span>
                                    )}
                                </div>

                                {/* Listado de Opiniones */}
                                <div className="space-y-3">
                                    {loadingRatings ? (
                                        <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
                                            <i className="bi bi-arrow-repeat animate-spin text-xl text-amber-500"></i>
                                            <span className="text-xs font-medium">Cargando opiniones...</span>
                                        </div>
                                    ) : productRatingsList.length > 0 ? (
                                        productRatingsList.map((item) => {
                                            const isSelected = activeCardId === item.id
                                            const isEditing = editingReviewId === item.id
                                            const effectiveUserIdentifier = user?.celular || user?.id || ''
                                            const likes = item.likes || []
                                            const isLiked = effectiveUserIdentifier ? likes.includes(effectiveUserIdentifier) : false
                                            const likesCount = likes.length
                                            const repliesCount = item.replies?.length || 0
                                            const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone)
                                            const isOwnReview = Boolean(
                                                currentProductClientDigits &&
                                                reviewPhoneDigits &&
                                                (currentProductClientDigits === reviewPhoneDigits || currentProductClientDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentProductClientDigits))
                                            ) || (item.id.startsWith('local_') && Boolean(currentProductClientDigits))

                                            if (isEditing) {
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className="bg-white rounded-2xl p-4 border border-amber-300 ring-2 ring-amber-100 shadow-md space-y-3 animate-in fade-in duration-200"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                                                                Editar opinión
                                                            </span>
                                                            <div className="flex items-center gap-1">
                                                                {[1, 2, 3, 4, 5].map((star) => (
                                                                    <button
                                                                        key={star}
                                                                        type="button"
                                                                        onClick={() => setEditRatingScore(star)}
                                                                        className="p-0.5 text-amber-400 hover:scale-110 active:scale-95 transition-transform"
                                                                    >
                                                                        <i className={`bi ${editRatingScore >= star ? 'bi-star-fill' : 'bi-star text-gray-300'} text-sm`}></i>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <textarea
                                                            value={editCommentText}
                                                            onChange={(e) => setEditCommentText(e.target.value)}
                                                            placeholder="Escribe tu opinión..."
                                                            rows={2}
                                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs text-gray-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all resize-none"
                                                        />

                                                        {/* Foto preview o agregar foto en edición */}
                                                        {editImagePreview && !editImageRemoved && (
                                                            <div className="relative inline-block">
                                                                <img
                                                                    src={editImagePreview}
                                                                    alt="Foto"
                                                                    className="w-14 h-14 object-cover rounded-xl border border-gray-200 shadow-sm"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setEditImageFile(null)
                                                                        setEditImagePreview(null)
                                                                        setEditImageRemoved(true)
                                                                    }}
                                                                    className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow hover:bg-red-600 transition-colors"
                                                                    title="Eliminar foto"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        )}

                                                        <div className="flex items-center justify-between pt-1">
                                                            <input
                                                                type="file"
                                                                ref={editFileInputRef}
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0]
                                                                    if (file && file.type.startsWith('image/')) {
                                                                        setEditImageFile(file)
                                                                        setEditImagePreview(URL.createObjectURL(file))
                                                                        setEditImageRemoved(false)
                                                                    }
                                                                }}
                                                                accept="image/*"
                                                                className="hidden"
                                                            />

                                                            <button
                                                                type="button"
                                                                onClick={() => editFileInputRef.current?.click()}
                                                                className="px-2.5 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 hover:text-gray-900 text-xs font-bold flex items-center gap-1.5 transition-all"
                                                            >
                                                                <Camera size={14} />
                                                                <span>{editImagePreview ? 'Cambiar foto' : 'Foto'}</span>
                                                            </button>

                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditingReviewId(null)}
                                                                    className="px-3 py-1.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200 transition-all"
                                                                >
                                                                    Cancelar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={isSavingEdit}
                                                                    onClick={(e) => handleSaveEditReview(item, e)}
                                                                    className="px-3 py-1.5 rounded-xl bg-gray-900 text-white text-xs font-black hover:bg-black transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
                                                                >
                                                                    {isSavingEdit ? (
                                                                        <Loader2 size={12} className="animate-spin" />
                                                                    ) : (
                                                                        <Check size={13} />
                                                                    )}
                                                                    <span>Guardar</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            }

                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => setActiveCardId(isSelected ? null : item.id)}
                                                    className={`bg-white rounded-2xl p-4 border transition-all cursor-pointer space-y-2.5 ${
                                                        isSelected
                                                            ? 'border-amber-300 ring-2 ring-amber-100/70 shadow-md'
                                                            : 'border-gray-100 shadow-sm hover:border-gray-200'
                                                    }`}
                                                >
                                                    {/* Cabecera de la tarjeta */}
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="w-8 h-8 rounded-full bg-amber-100/80 text-amber-800 font-black text-xs flex items-center justify-center border border-amber-200/60 flex-shrink-0 overflow-hidden">
                                                                {item.clientPhotoURL ? (
                                                                    <img
                                                                        src={item.clientPhotoURL}
                                                                        alt={item.clientName || 'Cliente'}
                                                                        className="w-full h-full object-cover"
                                                                        onError={(e) => {
                                                                            (e.target as HTMLElement).style.display = 'none'
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <span>{item.clientName?.charAt(0)?.toUpperCase() || 'C'}</span>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-black text-gray-900 leading-none">
                                                                    {item.clientName || 'Cliente'}
                                                                </p>
                                                                <p className="text-[10px] text-gray-400 mt-0.5 font-medium">
                                                                    {item.createdAt ? formatRelativeTime(item.createdAt) : 'Calificó en pedido'}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            <StarRating rating={item.rating} size="sm" />
                                                            {isOwnReview && (
                                                                <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-gray-100">
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => startEditingReview(item, e)}
                                                                        className="p-1 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                                                        title="Editar opinión"
                                                                    >
                                                                        <Pencil size={13} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => handleDeleteReview(item, e)}
                                                                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                                        title="Eliminar opinión"
                                                                    >
                                                                        <Trash2 size={13} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Comentario principal (sin comillas) */}
                                                    {item.comment && item.comment.trim() ? (
                                                        <p className="text-xs text-gray-700 font-medium leading-relaxed px-0.5">
                                                            {item.comment}
                                                        </p>
                                                    ) : null}

                                                    {/* Foto adjunta de la opinión */}
                                                    {item.image && (
                                                        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 max-w-[200px]">
                                                            <img
                                                                src={item.image}
                                                                alt="Foto adjunta"
                                                                className="w-full h-28 object-cover hover:scale-105 transition-transform duration-300 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setViewingPhotoModalUrl(item.image!)
                                                                }}
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Barra de Opciones: Me gusta y Comentar (sin fondo ni bordes) */}
                                                    <div className="flex items-center gap-4 pt-0 -mt-0.5">
                                                        {/* Botón Me Gusta */}
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleToggleLike(item, e)}
                                                            className={`flex items-center gap-1.5 py-0.5 text-xs font-bold transition-all active:scale-95 ${
                                                                isLiked
                                                                    ? 'text-rose-600'
                                                                    : 'text-gray-500 hover:text-gray-800'
                                                            }`}
                                                        >
                                                            <Heart
                                                                size={14}
                                                                className={isLiked ? 'fill-rose-500 text-rose-500' : 'text-gray-400'}
                                                            />
                                                            <span>
                                                                {likesCount > 0 ? likesCount : ''} Me gusta
                                                            </span>
                                                        </button>

                                                        {/* Botón Comentar / Responder */}
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setActiveCardId(item.id)
                                                            }}
                                                            className={`flex items-center gap-1.5 py-1 text-xs font-bold transition-all active:scale-95 ${
                                                                isSelected
                                                                    ? 'text-amber-600'
                                                                    : 'text-gray-500 hover:text-gray-800'
                                                            }`}
                                                        >
                                                            <MessageSquare size={15} className={isSelected ? 'text-amber-600' : 'text-gray-400'} />
                                                            <span>
                                                                {repliesCount > 0 ? `${repliesCount} ${repliesCount === 1 ? 'respuesta' : 'respuestas'}` : 'Comentar'}
                                                            </span>
                                                        </button>
                                                    </div>

                                                    {/* Sección Expandida: Respuestas y Casillero para responder */}
                                                    {isSelected && (
                                                        <div
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="pt-2 border-t border-gray-100 space-y-2.5 animate-in fade-in duration-200"
                                                        >
                                                            {/* Lista de respuestas existentes */}
                                                            {item.replies && item.replies.length > 0 && (
                                                                <div className="space-y-2 pl-2 border-l-2 border-gray-200">
                                                                    {item.replies.map((reply: any, rIdx: number) => (
                                                                        <div
                                                                            key={reply.id || rIdx}
                                                                            className="bg-gray-50/80 border border-gray-100 p-2.5 rounded-xl text-xs space-y-1"
                                                                        >
                                                                            <div className="flex items-center justify-between">
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <div className="w-5 h-5 rounded-full bg-gray-200 text-gray-800 font-black text-[9px] flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                                                        {reply.userPhoto ? (
                                                                                            <img
                                                                                                src={reply.userPhoto}
                                                                                                alt={reply.userName || 'Cliente'}
                                                                                                className="w-full h-full object-cover"
                                                                                                onError={(e) => {
                                                                                                    (e.target as HTMLElement).style.display = 'none'
                                                                                                }}
                                                                                            />
                                                                                        ) : (
                                                                                            <span>{reply.userName?.charAt(0)?.toUpperCase() || 'C'}</span>
                                                                                        )}
                                                                                    </div>
                                                                                    <span className="font-black text-gray-800 text-[11px]">
                                                                                        {reply.userName || 'Cliente'}
                                                                                    </span>
                                                                                </div>
                                                                                <span className="text-[10px] text-gray-400">
                                                                                    {reply.createdAt ? formatRelativeTime(reply.createdAt) : ''}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-gray-600 font-medium leading-relaxed pl-6.5">
                                                                                {reply.comment}
                                                                            </p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {/* Input para responder */}
                                                            <form
                                                                onSubmit={(e) => handleSendReply(item, e)}
                                                                className="flex items-center gap-2 pt-1"
                                                            >
                                                                <input
                                                                    type="text"
                                                                    value={replyInputText[item.id] || ''}
                                                                    onChange={(e) =>
                                                                        setReplyInputText({
                                                                            ...replyInputText,
                                                                            [item.id]: e.target.value
                                                                        })
                                                                    }
                                                                    placeholder="Escribe una respuesta..."
                                                                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                                                                />
                                                                <button
                                                                    type="submit"
                                                                    disabled={
                                                                        !replyInputText[item.id]?.trim() ||
                                                                        isSendingReply[item.id]
                                                                    }
                                                                    className="w-8 h-8 bg-gray-900 hover:bg-black text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 active:scale-95 shadow-sm"
                                                                    title="Enviar respuesta"
                                                                >
                                                                    {isSendingReply[item.id] ? (
                                                                        <Loader2 size={12} className="animate-spin" />
                                                                    ) : (
                                                                        <ArrowUp size={14} strokeWidth={2.5} />
                                                                    )}
                                                                </button>
                                                            </form>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })
                                    ) : (
                                        <div className="py-10 text-center flex flex-col items-center justify-center bg-gray-50/60 rounded-2xl border border-dashed border-gray-200 p-6">
                                            <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-xl mb-2.5 border border-amber-100">
                                                ⭐
                                            </div>
                                            <h5 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                                                Aún no hay opiniones
                                            </h5>
                                            <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed font-medium">
                                                Las opiniones se registran cuando los clientes califican el producto al recibir su pedido.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* Recomendar Tab */
                            <div className="space-y-4 animate-in fade-in duration-200">
                                {/* Banner Recompensa */}
                                <div className="bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-2xl p-4 shadow-md shadow-amber-500/10 flex items-center justify-between">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-wider text-amber-100">
                                            Gana saldo en tu cuenta
                                        </p>
                                        <p className="text-2xl font-black tracking-tight leading-tight mt-0.5">
                                            $0.25 por venta
                                        </p>
                                    </div>
                                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-white backdrop-blur-sm">
                                        <Flame size={26} className="fill-white" />
                                    </div>
                                </div>

                                {/* Contenido según autenticación / enlace */}
                                {!user?.celular && !referralLink ? (
                                    /* Paso 1: Pedir Celular */
                                    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-3">
                                        <div>
                                            <h4 className="text-sm font-black text-gray-900 leading-tight">
                                                Asocia tu celular
                                            </h4>
                                            <p className="text-xs font-medium text-gray-500 mt-1">
                                                Ingresa tu número para acreditar tus recompensas automáticamente.
                                            </p>
                                        </div>

                                        <form onSubmit={handleReferralPhoneSubmit} className="space-y-3 pt-1">
                                            <div>
                                                <div className="relative">
                                                    <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                    <input
                                                        type="tel"
                                                        value={referralPhone}
                                                        onChange={(e) => {
                                                            setReferralPhone(e.target.value)
                                                            if (referralPhoneError) setReferralPhoneError('')
                                                        }}
                                                        placeholder="0999999999"
                                                        className={`w-full pl-10 pr-4 py-3 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all ${
                                                            referralPhoneError ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200'
                                                        }`}
                                                        disabled={referralLoading}
                                                        autoFocus
                                                    />
                                                </div>
                                                {referralPhoneError && (
                                                    <p className="text-xs text-red-600 font-medium mt-1.5">{referralPhoneError}</p>
                                                )}
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={referralLoading || !referralPhone.trim()}
                                                className="w-full py-3 bg-gray-900 hover:bg-black text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-900/10 active:scale-[0.98] disabled:opacity-50"
                                            >
                                                {referralLoading ? (
                                                    <>
                                                        <Loader2 size={16} className="animate-spin" />
                                                        <span>Generando enlace...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>Obtener enlace</span>
                                                        <ArrowRight size={16} />
                                                    </>
                                                )}
                                            </button>
                                        </form>
                                    </div>
                                ) : (
                                    /* Paso 2: Enlace listo y Compartir */
                                    <div className="space-y-3">
                                        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3.5">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                                                Tu enlace de referido
                                            </p>
                                            {referralLink ? (
                                                <p className="text-xs font-mono text-gray-800 break-all select-all leading-tight bg-white p-2.5 rounded-xl border border-gray-200/70">
                                                    {referralLink}
                                                </p>
                                            ) : (
                                                <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
                                                    <Loader2 size={14} className="animate-spin text-amber-500" />
                                                    <span>Generando tu enlace único...</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Botones de Acción */}
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                onClick={handleCopyReferral}
                                                disabled={!referralLink}
                                                className={`py-3 rounded-2xl font-black text-xs transition-all flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50 ${
                                                    referralCopied
                                                        ? 'bg-emerald-600 text-white'
                                                        : 'bg-gray-900 hover:bg-black text-white'
                                                }`}
                                            >
                                                {referralCopied ? <Check size={16} /> : <Copy size={16} />}
                                                <span>{referralCopied ? '¡Copiado!' : 'Copiar'}</span>
                                            </button>

                                            <button
                                                onClick={handleShareWhatsApp}
                                                disabled={!referralLink}
                                                className="py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl transition-all flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
                                            >
                                                <i className="bi bi-whatsapp text-base leading-none"></i>
                                                <span>WhatsApp</span>
                                            </button>

                                            <button
                                                onClick={handleShareFacebook}
                                                disabled={!referralLink}
                                                className="py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-2xl transition-all flex flex-col items-center justify-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
                                            >
                                                <i className="bi bi-facebook text-base leading-none"></i>
                                                <span>Facebook</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Spacer for fixed footer */}
                        <div className={activeTab === 'options' ? "h-32" : "h-6"}></div>
                    </div>
                </div>

                {/* Fixed Footer for Actions - Solo visible en opciones si hay selección de combo o hay carrito */}
                {activeTab === 'options' && ((product.isCombo && Object.values(comboSelection).reduce((a, b) => a + b, 0) > 0) || cart.reduce((sum, item) => sum + (item.esPremio ? 0 : item.quantity), 0) > 0) && (
                    <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 bg-white border-t border-gray-100 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-40 animate-in fade-in slide-in-from-bottom duration-200">
                        {(() => {
                        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
                        const cartItemsCount = cart.reduce((sum, item) => sum + (item.esPremio ? 0 : item.quantity), 0)
                        const totalComboSelected = product.isCombo ? Object.values(comboSelection).reduce((a, b) => a + b, 0) : 0;
                        const minComboItems = product.minComboItems || 1;
                        const isComboComplete = !product.isCombo || totalComboSelected >= minComboItems;
                        const comboProgressPercent = Math.min(100, Math.round((totalComboSelected / minComboItems) * 100));
                        const selectedVariantsStr = formatComboVariantSelection(
                            comboSelection,
                            availableVariants,
                            product.countComboUnits
                        );

                        const cartButton = cartItemsCount > 0 && (
                            <button
                                onClick={() => {
                                    if (onOpenCart) {
                                        onOpenCart()
                                    } else {
                                        router.push(`/${business.username || `restaurant/${business.id}`}`)
                                    }
                                }}
                                className="w-full bg-gray-900 text-white rounded-2xl shadow-lg hover:bg-black transition-all duration-300 transform active:scale-95 overflow-hidden"
                            >
                                <div className="flex items-center justify-center gap-3 px-5 py-3">
                                    <div className="relative">
                                        <i className="bi bi-cart3 text-xl"></i>
                                        <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-[9px] font-black flex items-center justify-center border-2 border-gray-900 shadow-lg">
                                            {cartItemsCount}
                                        </span>
                                    </div>
                                    <div className="text-left">
                                        <div className="text-[10px] font-black uppercase tracking-widest opacity-70 leading-none mb-0.5">Ver carrito</div>
                                        <div className="text-base font-black leading-none">{formatPrice(cartTotal)}</div>
                                    </div>
                                </div>
                            </button>
                        )

                        return (
                            <div className="space-y-2.5">
                                {product.isCombo && totalComboSelected > 0 && (
                                    <div className="flex items-center justify-between gap-3">
                                        {/* Izquierda: Combo que se está armando con espacio amplio y precio debajo */}
                                        <div className="flex-1 min-w-0 pr-1">
                                            <p className="text-xs font-bold text-gray-700 line-clamp-2 leading-snug uppercase">
                                                {selectedVariantsStr || product.name}
                                            </p>
                                            <span className="text-2xl font-black text-red-600 tracking-tight block leading-none mt-0.5">
                                                {formatPrice(comboPrice > 0 ? comboPrice : getProductPublicPrice(product, business))}
                                            </span>
                                        </div>

                                        {/* Derecha: Botón Agregar / Armar compacto */}
                                        <div className="flex-shrink-0">
                                            <button
                                                onClick={() => {
                                                    if (!isComboComplete) return;

                                                    const comboMeta = Object.entries(comboSelection).reduce((acc, [variantName, qty]) => {
                                                        const variant = availableVariants.find(v => v.name === variantName);
                                                        if (variant && qty > 0) {
                                                            const meta = getPriceMetadata(variant);
                                                            return {
                                                                basePrice: acc.basePrice + (meta.basePrice * qty),
                                                                commission: acc.commission + (meta.commission * qty),
                                                                publicPrice: acc.publicPrice + (meta.publicPrice * qty),
                                                                storeReceives: acc.storeReceives + (meta.storeReceives * qty),
                                                            };
                                                        }
                                                        return acc;
                                                    }, { basePrice: 0, commission: 0, publicPrice: 0, storeReceives: 0 });

                                                    const itemToAdd = {
                                                        id: `${product.id}-combo-${Date.now()}`,
                                                        name: product.name,
                                                        variantName: `Combo: ${selectedVariantsStr}`,
                                                        productName: product.name,
                                                        price: comboMeta.publicPrice,
                                                        basePrice: comboMeta.basePrice,
                                                        commission: comboMeta.commission,
                                                        storeReceives: comboMeta.storeReceives,
                                                        commissionType: product.commissionType || 'no_commission',
                                                        image: product.image,
                                                        imagePosition: product.imagePosition || 'center 50%',
                                                        description: product.description,
                                                        businessId: business.id,
                                                        businessName: business.name,
                                                        businessImage: business.image,
                                                        category: product.category,
                                                        isCombo: true,
                                                        comboSelection: comboSelection,
                                                        ...(product.isShared && {
                                                            originalBusinessId: product.originalBusinessId,
                                                            originalBusinessName: product.originalBusinessName,
                                                            originalBusinessImage: product.originalBusinessImage
                                                        })
                                                    };

                                                    const currentCart = [...cart];
                                                    currentCart.push({ ...itemToAdd, quantity: 1 });
                                                    setCart(currentCart);
                                                    updateCartInStorage(business.id, currentCart);
                                                    showNotification(`${product.name} (Combo) agregado`);
                                                    setComboSelection({});
                                                    onClose();
                                                    onOpenCart?.();
                                                }}
                                                disabled={!isComboComplete}
                                                className={`relative overflow-hidden px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all border shadow-sm active:scale-95 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${
                                                    isComboComplete
                                                        ? 'bg-red-600 border-red-600 text-white shadow-red-500/20 shadow-md hover:bg-red-700'
                                                        : 'bg-gray-100 border-gray-200 text-gray-700'
                                                }`}
                                            >
                                                {/* Barra de progreso animada de fondo */}
                                                <div 
                                                    className="absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out bg-gradient-to-r from-red-600 to-red-500"
                                                    style={{ width: `${comboProgressPercent}%` }}
                                                />

                                                {/* Contenido sobrepuesto con capas Z */}
                                                <div className="relative z-10 flex items-center gap-1.5">
                                                    <i className={`bi ${isComboComplete ? 'bi-bag-plus-fill text-sm text-white' : 'bi-stars text-sm text-gray-900'}`}></i>
                                                    <span className={`font-black text-xs uppercase tracking-wider whitespace-nowrap ${isComboComplete ? 'text-white' : 'text-gray-900'}`}>
                                                        {isComboComplete ? 'Agregar' : 'Armar'}
                                                    </span>
                                                    {!isComboComplete && (
                                                        <span className="text-[10px] font-black tracking-tight px-1.5 py-0.5 rounded-md border transition-all bg-white border-gray-200 text-gray-800 shadow-sm ml-0.5">
                                                            {totalComboSelected}/{minComboItems}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Botón Ver carrito ubicado debajo de todo */}
                                {cartButton}
                            </div>
                        )
                    })()}
                    </div>
                )}
                </div>
            </div>

            {notification.show && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[140] w-[calc(100%-2rem)] max-w-xs pointer-events-none animate-[slideDown_0.3s_ease-out]">
                    <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-[2rem] px-6 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                            <i className="bi bi-bag-check-fill text-emerald-400 text-lg"></i>
                        </div>
                        <div className="flex-1">
                            <p className="text-white font-black text-[10px] uppercase tracking-[0.2em] leading-tight">
                                {notification.message}
                            </p>
                        </div>
                    </div>
                    <style jsx>{`
            @keyframes slideDown {
              from { transform: translateY(-20px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
          `}</style>
                </div>
            )}
            {business && (
                <StoreRatingModal
                    isOpen={isRatingModalOpen}
                    onClose={() => setIsRatingModalOpen(false)}
                    business={business}
                    clientPhone={null}
                    clientUser={null}
                    businessUser={null}
                    businessOwnerId={business.ownerId || null}
                    onSuccess={() => {}}
                />
            )}

            {/* Modal Minimalista para Nombre y Celular en Opiniones */}
            {showGuestReviewModal && (
                <div className="fixed inset-0 z-[200] overflow-hidden flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !guestLoading && setShowGuestReviewModal(false)} />

                    <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 z-10 animate-in zoom-in-95 duration-200">
                        <button
                            onClick={() => setShowGuestReviewModal(false)}
                            disabled={guestLoading}
                            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                            aria-label="Cerrar"
                        >
                            <i className="bi bi-x-lg text-sm"></i>
                        </button>

                        {/* Cabecera */}
                        <div className="text-center mb-4">
                            <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-2.5">
                                <Star size={24} className="fill-amber-500" />
                            </div>
                            <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">
                                Publicar tu opinión
                            </h3>
                            <p className="text-xs font-medium text-gray-500 mt-1">
                                Ingresa tus datos para firmar tu reseña
                            </p>
                        </div>

                        {/* Mini preview del comentario */}
                        <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 mb-4 space-y-1.5">
                            <div className="flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((s) => (
                                    <i
                                        key={s}
                                        className={`bi ${newReviewRating >= s ? 'bi-star-fill text-amber-400' : 'bi-star text-gray-300'} text-xs`}
                                    ></i>
                                ))}
                                <span className="text-[11px] font-bold text-gray-600 ml-1.5">
                                    {newReviewRating}.0
                                </span>
                            </div>
                            {newReviewComment.trim() ? (
                                <p className="text-xs text-gray-700 font-medium line-clamp-2">
                                    {newReviewComment.trim()}
                                </p>
                            ) : null}
                            {reviewImagePreview && (
                                <div className="pt-1">
                                    <img
                                        src={reviewImagePreview}
                                        alt="Foto adjunta"
                                        className="w-12 h-12 object-cover rounded-xl border border-gray-200 shadow-sm"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Formulario */}
                        <form onSubmit={handleGuestReviewSubmit} className="space-y-3">
                            <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                                    Tu nombre
                                </label>
                                <input
                                    type="text"
                                    value={guestName}
                                    onChange={(e) => {
                                        setGuestName(e.target.value)
                                        if (guestError) setGuestError('')
                                    }}
                                    placeholder="Ej. Juan Pérez"
                                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                                    disabled={guestLoading}
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                                    Tu celular
                                </label>
                                <div className="relative">
                                    <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="tel"
                                        value={guestPhone}
                                        onChange={(e) => {
                                            setGuestPhone(e.target.value)
                                            if (guestError) setGuestError('')
                                        }}
                                        placeholder="0999999999"
                                        className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                                        disabled={guestLoading}
                                    />
                                </div>
                            </div>

                            {guestError && (
                                <p className="text-xs text-red-600 font-medium">{guestError}</p>
                            )}

                            <button
                                type="submit"
                                disabled={guestLoading || !guestName.trim() || !guestPhone.trim()}
                                className="w-full py-3 bg-gray-900 hover:bg-black text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2 shadow-md shadow-gray-900/10 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-1"
                            >
                                {guestLoading ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>Publicando...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Publicar opinión</span>
                                        <ArrowUp size={16} strokeWidth={2.5} />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Visor de Foto a pantalla completa */}
            {viewingPhotoModalUrl && (
                <div
                    className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200"
                    onClick={() => setViewingPhotoModalUrl(null)}
                >
                    {/* Botón flotante de cierre siempre visible por encima de todo */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            setViewingPhotoModalUrl(null)
                        }}
                        className="fixed top-4 right-4 sm:top-6 sm:right-6 z-[220] w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-xl border border-white/30 flex items-center justify-center transition-all shadow-2xl active:scale-95 cursor-pointer"
                        title="Cerrar imagen (Esc)"
                    >
                        <X size={22} strokeWidth={2.5} />
                    </button>

                    <div
                        className="relative z-[205] max-w-4xl max-h-[85vh] flex items-center justify-center animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={viewingPhotoModalUrl}
                            alt="Foto ampliada"
                            className="max-h-[85vh] max-w-[92vw] sm:max-w-[85vw] object-contain rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] border border-white/10"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
