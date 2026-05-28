'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth'
import { useAuth } from '@/contexts/AuthContext'
import { auth } from '@/lib/firebase'
import { Flame, User, Ticket, Headphones, Bell, Info, Store, Heart, Star, ChevronRight, ChevronUp, ChevronDown, X, ArrowLeft, MapPin, Wallet, Settings, Map, LogOut, Trash2, ShoppingCart, CircleDollarSign } from 'lucide-react'
import {
    searchClientByPhone, createClient, updateClient, getClientLocations,
    serverTimestamp, createClientLocation, deleteLocation,
    getUserReferrals, getAllUserCredits, getOrdersByClient, getBusiness,
    getClientNotifications, markClientNotificationAsRead, getClientStoreRatings, updateStoreRatingById,
    getUserBusinessAccess, getAllUserQRProgress, getQRCodesByBusiness
} from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import LocationSelectionModal from '@/components/LocationSelectionModal'
import OrderSidebar from '@/components/OrderSidebar'
import ReferralModal from '@/components/ReferralModal'
import { ClientLocation } from '@/lib/database'

interface UserSidebarProps {
    isOpen: boolean
    onClose: () => void
    onLogin?: () => void
}

const USER_SIDEBAR_PANEL_BASE_CLASS = 'absolute left-0 top-0 h-full w-full sm:w-[420px] bg-white transform transition-transform duration-500 cubic-bezier(0.4, 0, 0.2, 1)'
const getUserSidebarPanelStateClass = (isOpen: boolean) =>
    isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-[calc(100%+3rem)] shadow-none'

function CartMenuOption({ onClose }: { onClose: () => void }) {
    const [activeCarts, setActiveCarts] = useState<{ [key: string]: any[] }>({})
    const [showCarts, setShowCarts] = useState(false)

    useEffect(() => {
        const loadCarts = () => {
            const cartsData = localStorage.getItem('carts')
            if (cartsData) {
                try {
                    const allCarts = JSON.parse(cartsData)
                    const filteredCarts: { [key: string]: any[] } = {}
                    Object.entries(allCarts).forEach(([businessId, cart]: [string, any]) => {
                        if (Array.isArray(cart) && cart.length > 0) {
                            filteredCarts[businessId] = cart
                        }
                    })
                    setActiveCarts(filteredCarts)
                } catch (e) {
                    console.error('Error parsing carts:', e)
                }
            }
        }

        loadCarts()
        const handleStorageChange = () => loadCarts()
        window.addEventListener('storage', handleStorageChange)
        const interval = setInterval(loadCarts, 1000)

        return () => {
            window.removeEventListener('storage', handleStorageChange)
            clearInterval(interval)
        }
    }, [])

    const activeCartsCount = Object.keys(activeCarts).length
    const totalItems = Object.values(activeCarts).reduce((total, cart) =>
        total + cart.reduce((sum, item) => sum + item.quantity, 0), 0
    )

    const handleDeleteCart = (businessId: string) => {
        try {
            const cartsData = localStorage.getItem('carts')
            if (!cartsData) return
            const allCarts = JSON.parse(cartsData)
            if (allCarts[businessId]) {
                delete allCarts[businessId]
                localStorage.setItem('carts', JSON.stringify(allCarts))
                setActiveCarts(prev => {
                    const copy = { ...prev }
                    delete copy[businessId]
                    return copy
                })
                window.dispatchEvent(new Event('storage'))
            }
        } catch (e) {
            console.error('Error deleting cart:', e)
        }
    }

    return (
        <div className="space-y-3">
            <button
                onClick={() => setShowCarts(!showCarts)}
                className="w-full flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 group transition-all"
            >
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-gray-900 group-hover:text-white transition-all">
                        <ShoppingCart size={20} />
                    </div>
                    <span className="font-black text-gray-900">Mis Carritos</span>
                </div>
                <div className="flex items-center gap-3">
                    {totalItems > 0 && (
                        <span className="bg-orange-500 text-white text-[10px] rounded-full px-2 py-0.5 font-black">
                            {totalItems}
                        </span>
                    )}
                    {showCarts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
            </button>

            {showCarts && activeCartsCount > 0 && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    {Object.entries(activeCarts).map(([businessId, cart]) => {
                        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
                        const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)
                        const businessName = cart[0]?.businessName || 'Tienda'
                        const logo = cart[0]?.businessImage || '/default-restaurant-og.svg'

                        return (
                            <div key={businessId} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 ml-4 border-l-4 border-l-gray-900">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center min-w-0">
                                        <img src={logo} alt={businessName} className="w-10 h-10 rounded-xl object-cover mr-3 border border-gray-50" />
                                        <div className="min-w-0">
                                            <h4 className="font-black text-gray-900 text-sm truncate leading-tight">{businessName}</h4>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{cartItemsCount} productos</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-black text-orange-500">${cartTotal.toFixed(2)}</span>
                                        <button
                                            onClick={() => handleDeleteCart(businessId)}
                                            className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                                <Link
                                    href={`/checkout?businessId=${businessId}`}
                                    className="block w-full text-center text-[10px] font-black uppercase tracking-[0.2em] bg-gray-900 text-white py-3 rounded-xl hover:bg-gray-800 transition-all active:scale-[0.98]"
                                    onClick={onClose}
                                >
                                    Finalizar Pedido
                                </Link>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function ClientNotificationsSidebar({
    isOpen,
    onClose,
    notifications,
    loading,
    unreadCount,
    onNotificationClick,
    formatDate
}: {
    isOpen: boolean
    onClose: () => void
    notifications: any[]
    loading: boolean
    unreadCount: number
    onNotificationClick: (notification: any) => void
    formatDate: (value: any) => string
}) {
    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Notificaciones</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            {unreadCount > 0 ? `${unreadCount} nuevas` : 'Todo al dia'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 px-6 py-6 space-y-4 overflow-y-auto">
                        {loading ? (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs font-bold text-gray-400">
                                Cargando...
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-4">
                                    <Bell size={20} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aun no tienes notificaciones</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                {notifications.map((notification) => (
                                    <button
                                        key={notification.id}
                                        onClick={() => onNotificationClick(notification)}
                                        className={`w-full p-4 text-left border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-all ${notification.read ? 'bg-white' : 'bg-red-50/60'}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${notification.type === 'referral_credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                                                {notification.type === 'referral_credit' ? <CircleDollarSign size={16} /> : <Bell size={16} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="text-sm font-black text-gray-900 leading-tight">{notification.title}</p>
                                                    <span className="text-[9px] font-bold text-gray-300 uppercase whitespace-nowrap">
                                                        {formatDate(notification.createdAt)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 leading-snug mt-1">{notification.message}</p>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ClientReviewsSidebar({
    isOpen,
    onClose,
    reviews,
    loading,
    savingReviewId,
    onSaveReview,
    formatDate
}: {
    isOpen: boolean
    onClose: () => void
    reviews: any[]
    loading: boolean
    savingReviewId: string | null
    onSaveReview: (review: any, rating: number, comment: string) => Promise<void>
    formatDate: (value: any) => string
}) {
    const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
    const [draftRating, setDraftRating] = useState(0)
    const [draftComment, setDraftComment] = useState('')

    const startEditing = (review: any) => {
        setEditingReviewId(review.id)
        setDraftRating(review.rating || 0)
        setDraftComment(review.comment || '')
    }

    const cancelEditing = () => {
        setEditingReviewId(null)
        setDraftRating(0)
        setDraftComment('')
    }

    const handleSave = async (review: any) => {
        if (!draftRating || savingReviewId) return
        await onSaveReview(review, draftRating, draftComment)
        cancelEditing()
    }

    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Reseñas</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            {reviews.length > 0 ? `${reviews.length} publicadas` : 'Sin reseñas'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 px-6 py-6 space-y-4 overflow-y-auto">
                        {loading ? (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs font-bold text-gray-400">
                                Cargando...
                            </div>
                        ) : reviews.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-4">
                                    <Star size={20} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aun no has escrito reseñas</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {reviews.map((review) => (
                                    <div key={`${review.businessId}-${review.id}`} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-900 transition-all">
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0">
                                                {review.businessImage ? (
                                                    <img src={review.businessImage} alt={review.businessName || 'Tienda'} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                        <Store size={16} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-black text-gray-900 truncate leading-tight">{review.businessName || 'Tienda'}</p>
                                                        {editingReviewId === review.id ? (
                                                            <div className="flex items-center gap-1 mt-2 text-amber-400">
                                                                {[1, 2, 3, 4, 5].map((star) => (
                                                                    <button
                                                                        key={star}
                                                                        type="button"
                                                                        onClick={() => setDraftRating(star)}
                                                                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 transition-all"
                                                                        title={`${star} estrellas`}
                                                                    >
                                                                        <Star size={16} fill={star <= draftRating ? 'currentColor' : 'none'} />
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-0.5 mt-1 text-amber-400">
                                                                {[1, 2, 3, 4, 5].map((star) => (
                                                                    <Star key={star} size={12} fill={star <= review.rating ? 'currentColor' : 'none'} />
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className="text-[9px] font-bold text-gray-300 uppercase whitespace-nowrap">
                                                        {formatDate(review.createdAt)}
                                                    </span>
                                                </div>

                                                {editingReviewId === review.id ? (
                                                    <textarea
                                                        value={draftComment}
                                                        onChange={(e) => setDraftComment(e.target.value)}
                                                        rows={3}
                                                        className="mt-3 w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 outline-none focus:bg-white focus:border-gray-900 transition-all resize-none"
                                                        placeholder="Actualiza tu comentario..."
                                                    />
                                                ) : (
                                                    review.comment ? (
                                                        <p className="text-xs text-gray-500 leading-snug mt-3 border-l-2 border-red-100 pl-3">
                                                            {review.comment}
                                                        </p>
                                                    ) : (
                                                        <p className="text-xs text-gray-400 leading-snug mt-3">Sin comentario escrito.</p>
                                                    )
                                                )}

                                                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                        {review.likes?.length || 0} likes
                                                    </span>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                                        {review.replies?.length || 0} comentarios
                                                    </span>
                                                </div>

                                                {editingReviewId === review.id ? (
                                                    <div className="flex items-center justify-end gap-2 mt-3">
                                                        <button
                                                            type="button"
                                                            onClick={cancelEditing}
                                                            disabled={savingReviewId === review.id}
                                                            className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all disabled:opacity-50"
                                                        >
                                                            Cancelar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSave(review)}
                                                            disabled={!draftRating || savingReviewId === review.id}
                                                            className="px-4 py-2 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50 flex items-center gap-2"
                                                        >
                                                            {savingReviewId === review.id ? 'Guardando...' : 'Guardar'}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditing(review)}
                                                        className="mt-3 w-full py-2.5 rounded-xl bg-gray-50 text-gray-700 text-[10px] font-black uppercase tracking-widest hover:bg-gray-900 hover:text-white transition-all"
                                                    >
                                                        Editar reseña
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ClientRecommendationsSidebar({
    isOpen,
    onClose,
    referrals,
    referralStats,
    walletBalance,
    loading,
    formatDate,
    onReferralClick
}: {
    isOpen: boolean
    onClose: () => void
    referrals: any[]
    referralStats: { totalClicks: number; totalSales: number; totalCredits: number }
    walletBalance: { referralCredits: number; manualBalance: number }
    loading: boolean
    formatDate: (value: any) => string
    onReferralClick: (referral: any) => void
}) {
    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Recomendaciones</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            {referrals.length > 0 ? `${referrals.length} productos` : 'Sin recomendaciones'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 px-6 py-6 space-y-4 overflow-y-auto">
                        <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl p-4 text-white">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                        <Wallet size={20} />
                                    </div>
                                    <div>
                                        <p className="text-purple-200 text-[10px] font-black uppercase tracking-widest leading-none mb-1">Disponible</p>
                                        <p className="text-white font-black text-2xl leading-tight">
                                            ${(walletBalance.referralCredits + walletBalance.manualBalance).toFixed(2)}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Ventas</p>
                                    <p className="text-xl font-black">{referralStats.totalSales}</p>
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                <div className="bg-white/10 rounded-xl px-3 py-2">
                                    <p className="text-[10px] font-bold text-purple-100 uppercase tracking-widest">Recomendaciones</p>
                                    <p className="text-sm font-black">${walletBalance.referralCredits.toFixed(2)}</p>
                                </div>
                                <div className="bg-white/10 rounded-xl px-3 py-2">
                                    <p className="text-[10px] font-bold text-purple-100 uppercase tracking-widest">Clics</p>
                                    <p className="text-sm font-black">{referralStats.totalClicks}</p>
                                </div>
                            </div>
                        </div>

                        {loading ? (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs font-bold text-gray-400">
                                Cargando...
                            </div>
                        ) : referrals.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-4">
                                    <Flame size={20} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aun no has recomendado productos</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Productos recomendados</p>
                                {referrals.map((referral) => (
                                    <button
                                        key={referral.id}
                                        type="button"
                                        onClick={() => onReferralClick(referral)}
                                        className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-900 hover:shadow-sm transition-all"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0">
                                                {referral.productImage ? (
                                                    <img src={referral.productImage} alt={referral.productName || 'Producto'} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-orange-500 bg-orange-50">
                                                        <Flame size={18} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-black text-gray-900 truncate">{referral.productName || 'Producto recomendado'}</p>
                                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                                    {formatDate(referral.createdAt)}
                                                </p>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <p className="text-sm font-black text-gray-900">{referral.conversions || 0}</p>
                                                <p className="text-[9px] font-bold text-gray-300 uppercase">ventas</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Clics</p>
                                                <p className="text-sm font-black text-gray-900">{referral.clicks || 0}</p>
                                            </div>
                                            <div className="bg-emerald-50 rounded-xl px-3 py-2">
                                                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Ganado</p>
                                                <p className="text-sm font-black text-emerald-700">${((referral.conversions || 0) * 0.25).toFixed(2)}</p>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ClientFavoritesSidebar({
    isOpen,
    onClose,
    favorites,
    loading,
    onOpenBusiness,
    onRemoveFavorite
}: {
    isOpen: boolean
    onClose: () => void
    favorites: any[]
    loading: boolean
    onOpenBusiness: (business: any) => void
    onRemoveFavorite: (businessId: string) => void
}) {
    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Favoritos</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            {favorites.length > 0 ? `${favorites.length} guardados` : 'Sin favoritos'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3">
                        {loading ? (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs font-bold text-gray-400">
                                Cargando...
                            </div>
                        ) : favorites.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-4">
                                    <Heart size={20} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aun no tienes favoritos</p>
                            </div>
                        ) : (
                            favorites.map((business) => (
                                <div
                                    key={business.id}
                                    className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-900 hover:shadow-sm transition-all group"
                                >
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => onOpenBusiness(business)}
                                            className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                        >
                                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0">
                                                {business.image ? (
                                                    <img src={business.image} alt={business.name || 'Negocio'} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                        <Store size={18} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-black text-gray-900 truncate">{business.name || 'Negocio favorito'}</p>
                                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1 truncate">
                                                    {business.categories?.[0] || business.type || 'Favorito'}
                                                </p>
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveFavorite(business.id)}
                                            className="w-9 h-9 rounded-lg bg-red-50 text-[#aa1918] flex items-center justify-center hover:bg-[#aa1918] hover:text-white transition-all flex-shrink-0"
                                            title="Quitar favorito"
                                        >
                                            <Heart size={16} fill="currentColor" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ClientPersonalInfoSidebar({
    isOpen,
    onClose,
    user,
    saving,
    message,
    onSave
}: {
    isOpen: boolean
    onClose: () => void
    user: any
    saving: boolean
    message: { type: 'success' | 'error'; text: string } | null
    onSave: (data: { nombres: string; celular: string; email: string }) => Promise<void>
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [formData, setFormData] = useState({ nombres: '', celular: '', email: '' })

    useEffect(() => {
        if (!user) return
        setFormData({
            nombres: user.nombres || '',
            celular: user.celular || '',
            email: user.email || ''
        })
        setIsEditing(false)
    }, [user, isOpen])

    const handleSave = async () => {
        await onSave(formData)
        setIsEditing(false)
    }

    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Información personal</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            Datos de tu cuenta
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                        <div className="bg-white rounded-xl border border-gray-200 p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center overflow-hidden">
                                    {user?.photoURL ? (
                                        <img src={user.photoURL} alt={user.nombres || 'Usuario'} className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={20} />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-black text-gray-900 truncate">{user?.nombres || 'Cliente'}</p>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1 truncate">
                                        {user?.celular || 'Sin celular'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {message && (
                            <div className={`rounded-xl px-4 py-3 text-xs font-bold ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                {message.text}
                            </div>
                        )}

                        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Nombre completo</label>
                                {isEditing ? (
                                    <input
                                        type="text"
                                        value={formData.nombres}
                                        onChange={(e) => setFormData(prev => ({ ...prev, nombres: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-gray-900 transition-all outline-none"
                                    />
                                ) : (
                                    <p className="text-sm font-bold text-gray-900 py-2 border-b border-gray-100">{user?.nombres || 'No registrado'}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Celular</label>
                                {isEditing ? (
                                    <input
                                        type="tel"
                                        value={formData.celular}
                                        onChange={(e) => setFormData(prev => ({ ...prev, celular: e.target.value }))}
                                        maxLength={10}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-gray-900 transition-all outline-none"
                                    />
                                ) : (
                                    <p className="text-sm font-bold text-gray-900 py-2 border-b border-gray-100">{user?.celular || 'No registrado'}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Correo electrónico</label>
                                {isEditing ? (
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                                        placeholder="Opcional"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-gray-900 transition-all outline-none"
                                    />
                                ) : (
                                    <p className="text-sm font-bold text-gray-900 py-2 border-b border-gray-100">{user?.email || 'No registrado'}</p>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            {isEditing ? (
                                <>
                                    <button
                                        onClick={() => {
                                            setIsEditing(false)
                                            setFormData({
                                                nombres: user?.nombres || '',
                                                celular: user?.celular || '',
                                                email: user?.email || ''
                                            })
                                        }}
                                        className="flex-1 py-3 bg-gray-50 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="flex-1 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-all disabled:opacity-60"
                                    >
                                        {saving ? 'Guardando...' : 'Guardar'}
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-all"
                                >
                                    Editar información
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function ClientCouponsSidebar({
    isOpen,
    onClose,
    cards,
    loading,
    formatDate
}: {
    isOpen: boolean
    onClose: () => void
    cards: any[]
    loading: boolean
    formatDate: (value: any) => string
}) {
    const totalScanned = cards.reduce((sum, card) => sum + (card.scannedCount || 0), 0)
    const availableCount = cards.reduce((sum, card) => sum + card.scannedQRs.filter((qr: any) => qr.status === 'available').length, 0)
    const inCartCount = cards.reduce((sum, card) => sum + card.scannedQRs.filter((qr: any) => qr.status === 'in_cart').length, 0)
    const redeemedCount = cards.reduce((sum, card) => sum + card.scannedQRs.filter((qr: any) => qr.status === 'redeemed').length, 0)

    const statusLabel = (status: string) => {
        if (status === 'in_cart') return 'En canje'
        if (status === 'redeemed') return 'Canjeado'
        return 'Disponible'
    }

    const statusClass = (status: string) => {
        if (status === 'in_cart') return 'bg-orange-50 text-orange-600'
        if (status === 'redeemed') return 'bg-gray-100 text-gray-400'
        return 'bg-emerald-50 text-emerald-700'
    }

    return (
        <div className={`fixed inset-0 z-[130] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    <div className="sticky top-0 bg-white z-50 border-b border-gray-100">
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 min-w-0">
                                    <button
                                        onClick={onClose}
                                        className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
                                        title="Volver"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-semibold text-gray-900 leading-tight">Cupones</h2>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">
                                            {cards.length > 0 ? `${cards.length} negocios` : 'Sin cupones'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                        {loading ? (
                            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs font-bold text-gray-400">
                                Cargando...
                            </div>
                        ) : cards.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-4">
                                    <Ticket size={20} />
                                </div>
                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Aun no tienes cupones escaneados</p>
                            </div>
                        ) : (
                            <>
                                <div className="bg-gray-900 rounded-2xl p-4 text-white">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Tarjetas escaneadas</p>
                                            <p className="text-3xl font-black leading-tight mt-1">{totalScanned}</p>
                                        </div>
                                        <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
                                            <Ticket size={20} />
                                        </div>
                                    </div>
                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        <div className="bg-white/10 rounded-xl px-3 py-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Disponibles</p>
                                            <p className="text-sm font-black">{availableCount}</p>
                                        </div>
                                        <div className="bg-white/10 rounded-xl px-3 py-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-white/50">En canje</p>
                                            <p className="text-sm font-black">{inCartCount}</p>
                                        </div>
                                        <div className="bg-white/10 rounded-xl px-3 py-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-white/50">Canjeados</p>
                                            <p className="text-sm font-black">{redeemedCount}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {cards.map((card) => (
                                        <div key={card.businessId} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-900 transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-100 overflow-hidden flex-shrink-0">
                                                    <img
                                                        src={card.businessImage || '/placeholder.png'}
                                                        alt={card.businessName}
                                                        className="w-full h-full object-cover"
                                                        onError={(e: any) => { e.currentTarget.src = 'https://via.placeholder.com/150' }}
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-black text-gray-900 text-sm truncate">{card.businessName}</h3>
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                                        {card.scannedCount}/{card.totalCards || card.scannedCount} tarjetas
                                                    </p>
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Visita</p>
                                                    <p className="text-xs font-bold text-gray-900">{formatDate(card.lastScanned) || 'Nunca'}</p>
                                                </div>
                                            </div>

                                            {card.totalCards > 0 && (
                                                <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-[#aa1918] rounded-full"
                                                        style={{ width: `${Math.min(100, (card.scannedCount / card.totalCards) * 100)}%` }}
                                                    />
                                                </div>
                                            )}

                                            {card.scannedQRs.length > 0 && (
                                                <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                                                    {card.scannedQRs.map((qr: any) => (
                                                        <div key={qr.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-2">
                                                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white flex-shrink-0">
                                                                <img
                                                                    src={qr.image || card.businessImage || '/placeholder.png'}
                                                                    alt={qr.name}
                                                                    className="w-full h-full object-cover"
                                                                    onError={(e: any) => { e.currentTarget.src = 'https://via.placeholder.com/150' }}
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs font-black text-gray-900 truncate">{qr.name}</p>
                                                                <p className="text-[10px] text-emerald-600 font-bold truncate">{qr.prize || 'Sin premio especificado'}</p>
                                                            </div>
                                                            <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex-shrink-0 ${statusClass(qr.status)}`}>
                                                                {statusLabel(qr.status)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function UserSidebar({ isOpen, onClose, onLogin }: UserSidebarProps) {
    const { user, logout, login } = useAuth()
    const router = useRouter()

    // Authentication states
    const [customerData, setCustomerData] = useState({ name: '', phone: '' })
    const [clientFound, setClientFound] = useState<any>(null)
    const [clientSearching, setClientSearching] = useState(false)
    const [showNameField, setShowNameField] = useState(false)
    const [phoneConfirmation, setPhoneConfirmation] = useState('')
    const [loginPinLoading, setLoginPinLoading] = useState(false)
    const [phoneError, setPhoneError] = useState('')
    const [nameError, setNameError] = useState('')
    const [registerLoading, setRegisterLoading] = useState(false)
    const [showAuthForm, setShowAuthForm] = useState(false)
    const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)
    const [savedLocation, setSavedLocation] = useState<{ referencia: string; lat: number; lng: number } | null>(null)

    const [userLocations, setUserLocations] = useState<any[]>([])
    const [activeOrders, setActiveOrders] = useState<any[]>([])
    const [loadingOrders, setLoadingOrders] = useState(false)

    const [orderSidebarOpen, setOrderSidebarOpen] = useState(false)
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
    const [walletBalance, setWalletBalance] = useState({ referralCredits: 0, manualBalance: 0 })
    const [showHowToEarn, setShowHowToEarn] = useState(false)
    const [showRecommendations, setShowRecommendations] = useState(false)
    const [clientReferrals, setClientReferrals] = useState<any[]>([])
    const [referralStats, setReferralStats] = useState({ totalClicks: 0, totalSales: 0, totalCredits: 0 })
    const [loadingRecommendations, setLoadingRecommendations] = useState(false)
    const [referralModalOpen, setReferralModalOpen] = useState(false)
    const [selectedReferralProduct, setSelectedReferralProduct] = useState<any>(null)
    const [selectedReferralLink, setSelectedReferralLink] = useState('')
    const [selectedReferralBusinessName, setSelectedReferralBusinessName] = useState('')
    const [showFavorites, setShowFavorites] = useState(false)
    const [favoriteBusinesses, setFavoriteBusinesses] = useState<any[]>([])
    const [loadingFavorites, setLoadingFavorites] = useState(false)
    const [showCoupons, setShowCoupons] = useState(false)
    const [couponCards, setCouponCards] = useState<any[]>([])
    const [loadingCoupons, setLoadingCoupons] = useState(false)
    const [showPersonalInfo, setShowPersonalInfo] = useState(false)
    const [savingPersonalInfo, setSavingPersonalInfo] = useState(false)
    const [personalInfoMessage, setPersonalInfoMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const [hasOwnedBusiness, setHasOwnedBusiness] = useState(false)
    const [hasGoogleBusinessSession, setHasGoogleBusinessSession] = useState(false)
    const [businessLogoStack, setBusinessLogoStack] = useState<any[]>([])
    const [ownedBusinessCount, setOwnedBusinessCount] = useState(0)
    const [showNotifications, setShowNotifications] = useState(false)
    const [clientNotifications, setClientNotifications] = useState<any[]>([])
    const [loadingNotifications, setLoadingNotifications] = useState(false)
    const [showReviews, setShowReviews] = useState(false)
    const [clientReviews, setClientReviews] = useState<any[]>([])
    const [loadingReviews, setLoadingReviews] = useState(false)
    const [savingReviewId, setSavingReviewId] = useState<string | null>(null)

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

    // Modal states
    const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)
    const [isAddingNewLocation, setIsAddingNewLocation] = useState(false)


    // Capturar y guardar coordenadas en localStorage al montar (oculto para el usuario)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            // Intentar cargar coordenadas existentes
            const storedCoords = localStorage.getItem('userCoordinates')
            if (storedCoords) {
                try {
                    const coords = JSON.parse(storedCoords)
                    setCurrentLocation(coords)
                } catch (e) {
                    console.error('Error loading coordinates:', e)
                }
            }

            // Obtener ubicación actual
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const coords = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        }
                        setCurrentLocation(coords)
                        // Guardar en localStorage para filtrar tiendas cercanas
                        localStorage.setItem('userCoordinates', JSON.stringify(coords))
                    },
                    (error) => {
                        console.warn('Ubicación no detectada, usando ubicación por defecto:', error)
                        // Si falla y no hay guardada, usar coordenadas por defecto (Quito, Ecuador)
                        // Esto permite que el mapa funcione y el usuario pueda seleccionar manualmente
                        if (!storedCoords) {
                            const defaultCoords = {
                                lat: -0.180653,
                                lng: -78.467834
                            }
                            setCurrentLocation(defaultCoords)
                        }
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 5000,
                        maximumAge: 0
                    }
                )
            } else if (!storedCoords) {
                // Navegador no soporta geo y no hay guardada
                const defaultCoords = {
                    lat: -0.180653,
                    lng: -78.467834
                }
                setCurrentLocation(defaultCoords)
            }
        }
    }, [])

    // Cuando el usuario inicia sesión, cargar sus ubicaciones guardadas
    useEffect(() => {
        if (user?.id) {
            getClientLocations(user.id).then(locs => {
                setUserLocations(locs)

                // Persistence Logic: Try to restore last selected location
                let foundMatch = false
                const storedCoordsStr = localStorage.getItem('userCoordinates')

                if (storedCoordsStr && locs && locs.length > 0) {
                    try {
                        const stored = JSON.parse(storedCoordsStr)
                        // Find match with strict tolerance
                        const match = locs.find(l => {
                            const [lat, lng] = l.latlong.split(',').map((n: string) => parseFloat(n.trim()))
                            return Math.abs(lat - stored.lat) < 0.0001 && Math.abs(lng - stored.lng) < 0.0001
                        })

                        if (match) {
                            handleSelectLocation(match)
                            foundMatch = true
                        }
                    } catch (e) {
                        console.error("Error restoring location persistency", e)
                    }
                }

                if (!foundMatch && locs && locs.length > 0) {
                    handleSelectLocation(locs[0])
                }
            }).catch(console.error)

            // Cargar Créditos
            const loadCredits = async () => {
                try {
                    const [creditsById, creditsByPhone] = await Promise.all([
                        getAllUserCredits(user.id),
                        user.celular ? getAllUserCredits(user.celular) : Promise.resolve([])
                    ])

                    const combinedCredits = [...creditsById]
                    creditsByPhone.forEach(credit => {
                        if (combinedCredits.some(c => c.id === credit.id)) return
                        const index = combinedCredits.findIndex(c => c.businessId === credit.businessId)
                        if (index === -1) {
                            combinedCredits.push(credit)
                        } else {
                            combinedCredits[index].availableCredits = (combinedCredits[index].availableCredits || 0) + (credit.availableCredits || 0)
                            combinedCredits[index].balance = (combinedCredits[index].balance || 0) + (credit.balance || 0)
                        }
                    })

                    const referralCredits = combinedCredits.reduce((sum, c) => sum + (c.availableCredits || 0), 0)
                    const manualBalance = combinedCredits.reduce((sum, c) => sum + (c.balance || 0), 0)
                    setWalletBalance({ referralCredits, manualBalance })
                } catch (e) {
                    console.error('Error loading credits in sidebar:', e)
                }
            }
            loadCredits()

            const loadNotifications = async () => {
                setLoadingNotifications(true)
                try {
                    const ids = [user.id, user.celular].filter(Boolean) as string[]
                    const notifications = await getClientNotifications(ids)
                    setClientNotifications(notifications)
                } catch (e) {
                    console.error('Error loading client notifications:', e)
                } finally {
                    setLoadingNotifications(false)
                }
            }
            loadNotifications()

            const loadRecommendations = async () => {
                setLoadingRecommendations(true)
                try {
                    const [referralsById, referralsByPhone, creditsById, creditsByPhone] = await Promise.all([
                        getUserReferrals(user.id),
                        user.celular ? getUserReferrals(user.celular) : Promise.resolve([]),
                        getAllUserCredits(user.id),
                        user.celular ? getAllUserCredits(user.celular) : Promise.resolve([])
                    ])

                    const combinedReferrals = [...referralsById]
                    referralsByPhone.forEach(ref => {
                        if (!combinedReferrals.some(r => r.id === ref.id)) {
                            combinedReferrals.push(ref)
                        }
                    })

                    const combinedCredits = [...creditsById]
                    creditsByPhone.forEach(credit => {
                        if (combinedCredits.some(c => c.id === credit.id)) return
                        const index = combinedCredits.findIndex(c => c.businessId === credit.businessId)
                        if (index === -1) {
                            combinedCredits.push(credit)
                        } else {
                            combinedCredits[index].availableCredits = (combinedCredits[index].availableCredits || 0) + (credit.availableCredits || 0)
                            combinedCredits[index].balance = (combinedCredits[index].balance || 0) + (credit.balance || 0)
                        }
                    })

                    combinedReferrals.sort((a, b) => {
                        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt ? new Date(a.createdAt) : new Date(0)
                        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt ? new Date(b.createdAt) : new Date(0)
                        return dateB.getTime() - dateA.getTime()
                    })

                    const referralCredits = combinedCredits.reduce((sum, c) => sum + (c.availableCredits || 0), 0)
                    const manualBalance = combinedCredits.reduce((sum, c) => sum + (c.balance || 0), 0)

                    setClientReferrals(combinedReferrals)
                    setWalletBalance({ referralCredits, manualBalance })
                    setReferralStats({
                        totalClicks: combinedReferrals.reduce((sum, r) => sum + (r.clicks || 0), 0),
                        totalSales: combinedReferrals.reduce((sum, r) => sum + (r.conversions || 0), 0),
                        totalCredits: referralCredits + manualBalance
                    })
                } catch (e) {
                    console.error('Error loading recommendations in sidebar:', e)
                } finally {
                    setLoadingRecommendations(false)
                }
            }
            loadRecommendations()

            const loadFavorites = async () => {
                setLoadingFavorites(true)
                try {
                    const saved = typeof window !== 'undefined' ? localStorage.getItem(`followedBusinesses_${user.id}`) : null
                    const favoriteIds = saved ? JSON.parse(saved) : []
                    if (!Array.isArray(favoriteIds) || favoriteIds.length === 0) {
                        setFavoriteBusinesses([])
                        return
                    }

                    const businesses = await Promise.all(
                        favoriteIds.map(async (id: string) => {
                            try {
                                return await getBusiness(id)
                            } catch (error) {
                                console.error('Error loading favorite business:', error)
                                return null
                            }
                        })
                    )
                    setFavoriteBusinesses(businesses.filter(Boolean))
                } catch (e) {
                    console.error('Error loading favorite businesses in sidebar:', e)
                    setFavoriteBusinesses([])
                } finally {
                    setLoadingFavorites(false)
                }
            }
            loadFavorites()

            const loadCoupons = async () => {
                setLoadingCoupons(true)
                try {
                    const couponUserIds = Array.from(new Set([
                        user.celular ? normalizeEcuadorianPhone(user.celular) : '',
                        user.celular || '',
                        user.id || ''
                    ].filter(Boolean)))

                    const progressResults = await Promise.all(couponUserIds.map(id => getAllUserQRProgress(id)))
                    const progressByBusiness = new globalThis.Map<string, any>()
                    progressResults.flat().forEach((progress: any) => {
                        const existing = progressByBusiness.get(progress.businessId)
                        if (!existing) {
                            progressByBusiness.set(progress.businessId, progress)
                            return
                        }

                        progressByBusiness.set(progress.businessId, {
                            ...existing,
                            scannedCodes: Array.from(new Set([...(existing.scannedCodes || []), ...(progress.scannedCodes || [])])),
                            redeemedPrizeCodes: Array.from(new Set([...(existing.redeemedPrizeCodes || []), ...(progress.redeemedPrizeCodes || [])])),
                            completedRedemptions: Array.from(new Set([...(existing.completedRedemptions || []), ...(progress.completedRedemptions || [])])),
                            lastScanned: (() => {
                                const existingDate = existing.lastScanned ? new Date(existing.lastScanned) : new Date(0)
                                const nextDate = progress.lastScanned ? new Date(progress.lastScanned) : new Date(0)
                                return nextDate.getTime() > existingDate.getTime() ? progress.lastScanned : existing.lastScanned
                            })()
                        })
                    })

                    const progressList = Array.from(progressByBusiness.values())
                    const enriched = await Promise.all(progressList.map(async (progress: any) => {
                        try {
                            const business = await getBusiness(progress.businessId)
                            const allCodes = await getQRCodesByBusiness(progress.businessId, true)
                            const savedCarts = typeof window !== 'undefined' ? localStorage.getItem('carts') : null
                            const allCarts = savedCarts ? JSON.parse(savedCarts) : {}
                            const businessCart = allCarts[progress.businessId] || []

                            const scannedQRs = allCodes
                                .filter(code => (progress.scannedCodes || []).includes(code.id))
                                .map(code => {
                                    const isCompleted = (progress.completedRedemptions || []).includes(code.id)
                                    const isRedeemed = (progress.redeemedPrizeCodes || []).includes(code.id)
                                    const isInCart = businessCart.some((item: any) => item.qrCodeId === code.id || item.id === `premio-qr-${code.id}`)
                                    let status: 'available' | 'in_cart' | 'redeemed' = 'available'
                                    if (isInCart || isRedeemed) status = 'in_cart'
                                    if (isCompleted) status = 'redeemed'

                                    return {
                                        id: code.id,
                                        name: code.name,
                                        prize: code.prize,
                                        image: code.image,
                                        status
                                    }
                                })

                            return {
                                businessId: progress.businessId,
                                businessName: business?.name || 'Negocio desconocido',
                                businessImage: business?.image,
                                scannedCount: (progress.scannedCodes || []).length,
                                totalCards: allCodes.length,
                                lastScanned: progress.lastScanned,
                                scannedQRs
                            }
                        } catch (error) {
                            console.error('Error enriching coupon card:', error)
                            return null
                        }
                    }))

                    const validCards = enriched.filter(Boolean) as any[]
                    validCards.sort((a, b) => {
                        const dateA = a.lastScanned?.toDate ? a.lastScanned.toDate() : a.lastScanned ? new Date(a.lastScanned) : new Date(0)
                        const dateB = b.lastScanned?.toDate ? b.lastScanned.toDate() : b.lastScanned ? new Date(b.lastScanned) : new Date(0)
                        return dateB.getTime() - dateA.getTime()
                    })
                    setCouponCards(validCards)
                } catch (e) {
                    console.error('Error loading coupons in sidebar:', e)
                    setCouponCards([])
                } finally {
                    setLoadingCoupons(false)
                }
            }
            loadCoupons()

            const loadBusinessAccess = async () => {
                try {
                    const firebaseUser = auth.currentUser || await new Promise<FirebaseUser | null>((resolve) => {
                        const unsubscribe = onAuthStateChanged(
                            auth,
                            (currentUser) => {
                                unsubscribe()
                                resolve(currentUser)
                            },
                            () => {
                                unsubscribe()
                                resolve(null)
                            }
                        )
                    })

                    const emailToSearch = firebaseUser?.email || user.googleEmail || user.email || ''
                    const uidToSearch = firebaseUser?.uid || user.googleUid || user.id
                    setHasGoogleBusinessSession(!!firebaseUser || !!user.googleEmail || !!user.googleUid)

                    const access = await getUserBusinessAccess(emailToSearch, uidToSearch)
                    const ownedBusinesses = access.ownedBusinesses.filter((business: any) => !business.isHidden)
                    setHasOwnedBusiness(ownedBusinesses.length > 0)
                    setOwnedBusinessCount(ownedBusinesses.length)
                    setBusinessLogoStack(ownedBusinesses.slice(0, 4))
                } catch (e) {
                    console.error('Error loading business access in sidebar:', e)
                    setHasGoogleBusinessSession(false)
                    setHasOwnedBusiness(false)
                    setOwnedBusinessCount(0)
                    setBusinessLogoStack([])
                }
            }
            loadBusinessAccess()

            const loadReviews = async () => {
                setLoadingReviews(true)
                try {
                    const ids = [user.id, user.celular].filter(Boolean) as string[]
                    const reviews = await getClientStoreRatings(ids)
                    setClientReviews(reviews)
                } catch (e) {
                    console.error('Error loading client reviews:', e)
                } finally {
                    setLoadingReviews(false)
                }
            }
            loadReviews()

            // Cargar órdenes activas
            if (user.celular) {
                setLoadingOrders(true)
                getOrdersByClient(user.celular)
                    .then(async (orders) => {
                        const active = orders.filter((o: any) =>
                            !['delivered', 'cancelled'].includes(o.status)
                        )

                        // Enriquecer con datos básicos del negocio para el logo/nombre
                        const enriched = await Promise.all(active.map(async (o: any) => {
                            const biz = await getBusiness(o.businessId)
                            return { ...o, businessName: biz?.name, businessImage: biz?.image }
                        }))

                        setActiveOrders(enriched)
                    })
                    .catch(console.error)
                    .finally(() => setLoadingOrders(false))
            }
        } else {
            // Si cierra sesión, limpiar datos
            setUserLocations([])
            setSavedLocation(null)
            setActiveOrders([])
            setWalletBalance({ referralCredits: 0, manualBalance: 0 })
            setClientReferrals([])
            setReferralStats({ totalClicks: 0, totalSales: 0, totalCredits: 0 })
            setShowRecommendations(false)
            setLoadingRecommendations(false)
            setReferralModalOpen(false)
            setSelectedReferralProduct(null)
            setSelectedReferralLink('')
            setSelectedReferralBusinessName('')
            setShowFavorites(false)
            setFavoriteBusinesses([])
            setLoadingFavorites(false)
            setShowCoupons(false)
            setCouponCards([])
            setLoadingCoupons(false)
            setShowPersonalInfo(false)
            setSavingPersonalInfo(false)
            setPersonalInfoMessage(null)
            setHasGoogleBusinessSession(false)
            setHasOwnedBusiness(false)
            setOwnedBusinessCount(0)
            setBusinessLogoStack([])
            setClientNotifications([])
            setShowNotifications(false)
            setClientReviews([])
            setShowReviews(false)
        }
    }, [user])

    const handleLocationCreated = (newLocation: ClientLocation) => {
        setUserLocations(prev => [...prev, newLocation])
        handleSelectLocation(newLocation)
        setIsLocationModalOpen(false)
        setIsAddingNewLocation(false)
    }

    const handleSelectLocation = (loc: any) => {
        try {
            const [lat, lng] = loc.latlong.split(',').map((n: string) => parseFloat(n.trim()))
            const newLocation = {
                referencia: loc.referencia,
                lat,
                lng
            }
            setCurrentLocation({ lat, lng })
            setSavedLocation(newLocation)
            // Guardar en localStorage para persistencia
            localStorage.setItem('userCoordinates', JSON.stringify({ lat, lng }))

            // Notificar a HomePage del cambio de ubicación
            window.dispatchEvent(new Event('location-changed'))

            // Close modal if open
            setIsLocationModalOpen(false)
        } catch (e) {
            console.error('Error parsing location:', e)
        }
    }



    // Phone search function
    async function handlePhoneSearch(phone: string) {
        if (!phone.trim()) {
            setClientFound(null)
            setShowNameField(false)
            setPhoneError('')
            setPhoneConfirmation('')
            return
        }

        const normalizedPhone = normalizeEcuadorianPhone(phone);

        if (!validateEcuadorianPhone(normalizedPhone)) {
            setClientFound(null);
            setShowNameField(false);
            setPhoneError('')
            setPhoneConfirmation('')
            return;
        }

        setClientSearching(true);
        setPhoneError('')
        try {
            const client = await searchClientByPhone(normalizedPhone);
            if (client) {
                setClientFound(client);
                setCustomerData(prev => ({
                    ...prev,
                    name: client.nombres || '',
                    phone: normalizedPhone
                }));
                setShowNameField(false);
                
                // Auto-login if found
                login(client as any)
                if (client.id) {
                    await updateClient(client.id, {
                        lastLoginAt: serverTimestamp(),
                        loginSource: 'sidebar'
                    })
                }
                setShowAuthForm(false)
            } else {
                setClientFound(null);
                setShowNameField(true);
                setCustomerData(prev => ({
                    ...prev,
                    name: '',
                    phone: normalizedPhone
                }));
            }
        } catch (error) {
            console.error('Error searching client:', error);
            setPhoneError('Error al buscar el cliente');
            setClientFound(null);
            setShowNameField(false);
        } finally {
            setClientSearching(false);
        }
    }

    // Register function like in CheckoutContent
    const handleRegister = async () => {
        if (!customerData.phone || !customerData.name) {
            setNameError('El nombre es requerido')
            return
        }

        if (phoneConfirmation !== customerData.phone) {
            setPhoneError('Los números no coinciden')
            return
        }

        setRegisterLoading(true)
        setNameError('')
        setPhoneError('')

        try {
            const normalizedPhone = normalizeEcuadorianPhone(customerData.phone)
            
            if (clientFound && clientFound.id) {
                await updateClient(clientFound.id, {
                    nombres: customerData.name.trim(),
                    lastLoginAt: serverTimestamp(),
                    loginSource: 'sidebar'
                })
                const updatedClient = { ...clientFound, nombres: customerData.name.trim() }
                login(updatedClient as any)
            } else {
                const newClient = await createClient({
                    celular: normalizedPhone,
                    nombres: customerData.name.trim(),
                    fecha_de_registro: new Date().toISOString()
                })

                if (newClient && newClient.id) {
                    await updateClient(newClient.id, {
                        lastRegistrationAt: serverTimestamp(),
                        lastLoginAt: serverTimestamp(),
                        loginSource: 'sidebar'
                    })
                }

                login(newClient as any)
            }

            setShowAuthForm(false)
            setPhoneConfirmation('')
        } catch (error) {
            console.error('Error in registration:', error)
            setNameError('Error al procesar registro')
        } finally {
            setRegisterLoading(false)
        }
    }

    const handleLogout = () => {
        logout()
        localStorage.removeItem('loginPhone')
        localStorage.removeItem('clientData')
        onClose()
        router.push('/')
    }

    const getInitials = (name: string) => {
        if (!name) return 'U'
        return name
            .split(' ')
            .filter(Boolean)
            .map(word => word.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2)
    }

    const unreadNotifications = clientNotifications.filter(n => !n.read).length

    const formatNotificationDate = (value: any) => {
        const date = value?.toDate ? value.toDate() : value ? new Date(value) : null
        if (!date) return ''
        return date.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })
    }

    const handleNotificationClick = async (notification: any) => {
        if (!notification.id || notification.read) return
        await markClientNotificationAsRead(notification.id)
        setClientNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n))
    }

    const handleReferralClick = (referral: any) => {
        if (!referral?.code || !referral?.businessUsername || !referral?.productSlug) return

        setSelectedReferralProduct({
            id: referral.productId,
            name: referral.productName,
            image: referral.productImage,
            price: referral.productPrice
        })
        setSelectedReferralBusinessName(referral.businessName || '')
        setSelectedReferralLink(`${window.location.origin}/${referral.businessUsername}/${referral.productSlug}?ref=${referral.code}`)
        setReferralModalOpen(true)
    }

    const handleOpenFavoriteBusiness = (business: any) => {
        if (!business?.username) return
        setShowFavorites(false)
        onClose()
        router.push(`/${business.username}`)
    }

    const handleRemoveFavoriteBusiness = (businessId: string) => {
        if (!user?.id) return
        const nextFavorites = favoriteBusinesses.filter(business => business.id !== businessId)
        setFavoriteBusinesses(nextFavorites)
        localStorage.setItem(`followedBusinesses_${user.id}`, JSON.stringify(nextFavorites.map(business => business.id)))
    }

    const handleSavePersonalInfo = async (data: { nombres: string; celular: string; email: string }) => {
        if (!user?.id) return
        const nextName = data.nombres.trim()
        const nextPhone = data.celular.trim()
        const nextEmail = data.email.trim()

        if (!nextName) {
            setPersonalInfoMessage({ type: 'error', text: 'El nombre es requerido' })
            return
        }

        if (!validateEcuadorianPhone(nextPhone)) {
            setPersonalInfoMessage({ type: 'error', text: 'El celular debe tener el formato 09XXXXXXXX' })
            return
        }

        if (nextPhone !== user.celular) {
            const existingClient = await searchClientByPhone(nextPhone)
            if (existingClient && existingClient.id !== user.id) {
                setPersonalInfoMessage({ type: 'error', text: 'Este número ya está registrado' })
                return
            }
        }

        setSavingPersonalInfo(true)
        try {
            await updateClient(user.id, {
                nombres: nextName,
                celular: nextPhone,
                email: nextEmail
            })

            login({
                ...user,
                nombres: nextName,
                celular: nextPhone,
                email: nextEmail
            })
            setPersonalInfoMessage({ type: 'success', text: 'Perfil actualizado' })
        } catch (error) {
            console.error('Error saving personal info from sidebar:', error)
            setPersonalInfoMessage({ type: 'error', text: 'Error al actualizar.' })
        } finally {
            setSavingPersonalInfo(false)
        }
    }

    const handleSaveReview = async (review: any, nextRating: number, nextComment: string) => {
        if (!review.businessId || !review.id) return

        setSavingReviewId(review.id)
        try {
            await updateStoreRatingById(review.businessId, review.id, nextRating, nextComment)

            setClientReviews(prev => prev.map(item => {
                if (item.id !== review.id || item.businessId !== review.businessId) return item
                return {
                    ...item,
                    rating: nextRating,
                    comment: nextComment,
                    updatedAt: new Date()
                }
            }))
        } catch (error) {
            console.error('Error saving review from sidebar:', error)
        } finally {
            setSavingReviewId(null)
        }
    }

    return (
        <div className={`fixed inset-0 z-[110] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            {/* Overlay */}
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Sidebar Content */}
            <div
                className={`${USER_SIDEBAR_PANEL_BASE_CLASS} ${getUserSidebarPanelStateClass(isOpen)}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide bg-white">
                    {/* Header with User Info and Plus Banner */}
                    <div className="sticky top-0 bg-white z-50">
                        {/* User Greeting */}
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                                        {user?.photoURL ? (
                                            <img src={user.photoURL} alt={user.nombres} className="w-full h-full rounded-full object-cover" />
                                        ) : (
                                            <User size={48} />
                                        )}
                                    </div>
                                    <h2 className="text-xl font-semibold text-gray-900">
                                        ¡Hola, {user?.nombres?.split(' ')[0] || 'Pedro'}!
                                    </h2>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Credits / How to Earn Banner */}
                        <div className="px-6 pb-4 space-y-3">
                            {user ? (
                                <button
                                    type="button"
                                    onClick={() => setShowRecommendations(true)}
                                    className="w-full text-left bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:shadow-lg transition-all group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                            <Wallet size={20} />
                                        </div>
                                        <div>
                                            <p className="text-purple-200 text-[10px] font-black uppercase tracking-widest leading-none mb-1">Mis Créditos</p>
                                            <p className="text-white font-black text-xl leading-tight">
                                                ${(walletBalance.referralCredits + walletBalance.manualBalance).toFixed(2)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Ver más</span>
                                        <ChevronRight size={16} className="text-white/50 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </button>
                            ) : (
                                <div
                                    onClick={() => setShowAuthForm(true)}
                                    className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:shadow-lg transition-all group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                            <Flame size={20} />
                                        </div>
                                        <div>
                                            <p className="text-purple-200 text-[10px] font-black uppercase tracking-widest leading-none mb-1">Gana dinero con Fuddi</p>
                                            <p className="text-white font-black text-sm leading-tight">Recomienda platos y gana saldo</p>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-white/50 group-hover:translate-x-1 transition-transform" />
                                </div>
                            )}

                            {/* How to earn option */}
                            <button
                                onClick={() => setShowHowToEarn(!showHowToEarn)}
                                className="w-full flex items-center justify-between px-1 text-[11px] font-bold text-gray-400 hover:text-gray-900 transition-colors group"
                            >
                                <span className="flex items-center gap-2">
                                    <div className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                                        <CircleDollarSign size={12} />
                                    </div>
                                    ¿Cómo ganar créditos?
                                </span>
                                <ChevronDown size={14} className={`transition-transform duration-300 ${showHowToEarn ? 'rotate-180 text-gray-900' : ''}`} />
                            </button>

                            {showHowToEarn && (
                                <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="space-y-4">
                                        <div className="flex gap-3">
                                            <div className="w-6 h-6 rounded-lg bg-white shadow-sm flex items-center justify-center text-emerald-600 font-black text-[10px] flex-shrink-0">1</div>
                                            <p className="text-xs text-gray-600 leading-snug">Busca tu plato favorito en cualquier tienda de Fuddi.</p>
                                        </div>
                                        <div className="flex gap-3">
                                            <div className="w-6 h-6 rounded-lg bg-white shadow-sm flex items-center justify-center text-emerald-600 font-black text-[10px] flex-shrink-0">2</div>
                                            <p className="text-xs text-gray-600 leading-snug">Haz clic en el ícono <span className="text-orange-500 font-bold inline-flex items-center gap-1"><Flame size={14} /> Recomendar</span> del producto.</p>
                                        </div>
                                        <div className="flex gap-3">
                                            <div className="w-6 h-6 rounded-lg bg-white shadow-sm flex items-center justify-center text-emerald-600 font-black text-[10px] flex-shrink-0">3</div>
                                            <p className="text-xs text-gray-600 leading-snug">Comparte el enlace con tus amigos. Si compran, tú ganas.</p>
                                        </div>
                                        <div className="pt-3 border-t border-emerald-100 flex items-center justify-between">
                                            <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Recompensa:</span>
                                            <span className="text-sm font-black text-emerald-600">$0.25 por venta</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 px-6 py-6 space-y-6 overflow-y-auto">
                        {/* Login Section */}
                        {!user ? (
                            <div className="space-y-4">
                                {!showAuthForm ? (
                                    <div className="text-center py-8 space-y-4">
                                        <div className="w-24 h-24 bg-gradient-to-br from-gray-100 to-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300 shadow-sm">
                                            <Info size={48} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-gray-900 mb-2">¿Eres nuevo por aquí?</h3>
                                            <p className="text-sm text-gray-500 leading-relaxed">Inicia sesión para acceder a tus pedidos, ubicaciones guardadas y más beneficios.</p>
                                        </div>
                                        <button
                                            onClick={() => setShowAuthForm(true)}
                                            className="w-full py-3.5 bg-gradient-to-r from-gray-900 to-gray-800 text-white font-black rounded-2xl hover:from-gray-800 hover:to-gray-700 transition-all active:scale-[0.98] shadow-lg"
                                        >
                                            Iniciar Sesión
                                        </button>
                                    </div>
                                ) : (
                                    <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
                                        <div className="flex items-center gap-3 mb-6">
                                            <button
                                                onClick={() => setShowAuthForm(false)}
                                                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors"
                                            >
                                                <ArrowLeft size={18} />
                                            </button>
                                            <h4 className="text-lg font-black text-gray-900">Ingresa tu número</h4>
                                        </div>

                                        <div className="space-y-6">
                                            <div>
                                                <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">
                                                    Número de WhatsApp
                                                </label>
                                                <div className="relative">
                                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                                        <span className="text-sm font-bold text-gray-400">+593</span>
                                                    </div>
                                                    <input
                                                        type="tel"
                                                        value={customerData.phone}
                                                        onChange={(e) => {
                                                            const phone = e.target.value;
                                                            setCustomerData({ ...customerData, phone });
                                                            handlePhoneSearch(phone);
                                                        }}
                                                        placeholder="09XXXXXXXX"
                                                        className="w-full pl-14 pr-4 py-3 bg-white border-2 border-gray-200 rounded-xl text-sm font-bold focus:border-gray-900 focus:bg-white transition-all outline-none"
                                                    />
                                                </div>
                                                {phoneError && <p className="text-red-500 text-xs font-bold mt-2 uppercase">{phoneError}</p>}
                                            </div>

                                            {clientSearching && (
                                                <div className="flex items-center justify-center gap-3 py-4 bg-white rounded-xl border border-gray-200">
                                                    <div className="animate-spin h-4 w-4 border-2 border-gray-900 border-t-transparent rounded-full"></div>
                                                    <span className="text-xs font-black text-gray-400 uppercase">Buscando...</span>
                                                </div>
                                            )}

                                            {!clientSearching && !clientFound && showNameField && customerData.phone.length >= 7 && (
                                                <div className="space-y-6 animate-in fade-in duration-300">
                                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                                                        <p className="text-xs font-bold text-blue-700">
                                                            📝 Completa tu perfil en segundos para comenzar
                                                        </p>
                                                    </div>

                                                    <div>
                                                        <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">
                                                            Tu Nombre
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={customerData.name}
                                                            onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                                                            placeholder="Ej. Juan Pérez"
                                                            className="w-full px-4 py-3 bg-white border-2 border-gray-200 rounded-xl text-sm font-bold focus:border-gray-900 transition-all outline-none"
                                                        />
                                                        {nameError && <p className="text-red-500 text-xs font-bold mt-2 uppercase">{nameError}</p>}
                                                    </div>

                                                    <button
                                                        onClick={handleRegister}
                                                        disabled={registerLoading || !customerData.name}
                                                        className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-all disabled:opacity-50 active:scale-[0.98]"
                                                    >
                                                        {registerLoading ? 'Creando cuenta...' : 'Crear cuenta'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                {/* Icon Navigation Grid */}
                                <div className="grid grid-cols-4 gap-3">
                                    <button
                                        onClick={() => {
                                            setPersonalInfoMessage(null)
                                            setShowPersonalInfo(true)
                                        }}
                                        className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-gray-200 hover:border-gray-900 transition-all group"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all mb-2">
                                            <User size={16} />
                                        </div>
                                        <span className="text-xs font-medium text-gray-900 text-center">Información personal</span>
                                    </button>

                                    <button
                                        onClick={() => setShowCoupons(true)}
                                        className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-gray-200 hover:border-gray-900 transition-all group"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all mb-2">
                                            <Ticket size={16} />
                                        </div>
                                        <span className="text-xs font-medium text-gray-900 text-center">Cupones</span>
                                    </button>

                                    <button className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-gray-200 hover:border-gray-900 transition-all group">
                                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all mb-2">
                                            <Headphones size={16} />
                                        </div>
                                        <span className="text-xs font-medium text-gray-900 text-center">Ayuda</span>
                                    </button>

                                    <button
                                        onClick={() => setShowNotifications(!showNotifications)}
                                        className="relative flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-gray-200 hover:border-gray-900 transition-all group"
                                    >
                                        {unreadNotifications > 0 && (
                                            <span className="absolute top-2 right-3 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                                                {unreadNotifications}
                                            </span>
                                        )}
                                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all mb-2">
                                            <Bell size={16} />
                                        </div>
                                        <span className="text-xs font-medium text-gray-900 text-center">Notificaciones</span>
                                    </button>
                                </div>

                                {/* Pedidos en Curso */}
                                {activeOrders.length > 0 && (
                                    <div className="space-y-3 border-t border-gray-100 pt-6">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">PEDIDOS EN CURSO</p>
                                            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                        </div>
                                        <div className="space-y-2">
                                            {activeOrders.map((order) => (
                                                <button
                                                    key={order.id}
                                                    onClick={() => {
                                                        setSelectedOrderId(order.id)
                                                        setOrderSidebarOpen(true)
                                                    }}
                                                    className="w-full bg-gradient-to-r from-emerald-50 to-emerald-100 p-3 rounded-xl border border-emerald-200 flex items-center gap-3 hover:border-emerald-400 transition-all group"
                                                >
                                                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex-shrink-0">
                                                        <img src={order.businessImage || '/default-restaurant-og.svg'} className="w-full h-full object-cover" />
                                                    </div>
                                                    <div className="flex-1 text-left min-w-0">
                                                        <p className="text-xs font-medium text-gray-900 truncate">{order.businessName || 'Tienda'}</p>
                                                        <p className="text-[10px] text-gray-600 font-medium">${(order.total || 0).toFixed(2)}</p>
                                                    </div>
                                                    <div className="flex-shrink-0 text-center">
                                                        <p className="text-[9px] font-medium px-2 py-1 rounded-full bg-emerald-200 text-emerald-700 uppercase">{order.status}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Ubicación */}
                                {(savedLocation || userLocations.length > 0) && (
                                    <div className="space-y-3 border-t border-gray-100 pt-6">
                                        <p className="text-xs font-black uppercase tracking-wider text-gray-400">UBICACIÓN DE ENTREGA</p>
                                        <button
                                            onClick={() => {
                                                setIsAddingNewLocation(false)
                                                setIsLocationModalOpen(true)
                                            }}
                                            className="w-full bg-gradient-to-r from-gray-50 to-gray-100 p-3.5 rounded-xl border border-gray-200 flex items-center gap-3 hover:border-gray-900 transition-all group"
                                        >
                                            <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center text-white flex-shrink-0 group-hover:shadow-lg transition-all">
                                                <MapPin size={16} />
                                            </div>
                                            <div className="flex-1 text-left min-w-0">
                                                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">Entrega en</p>
                                                <h4 className="text-xs font-medium text-gray-900 truncate">
                                                    {savedLocation?.referencia || 'Seleccionar ubicación'}
                                                </h4>
                                            </div>
                                            <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-900 flex-shrink-0" />
                                        </button>
                                    </div>
                                )}

                                
                                {/* Profile Section */}
                                <div className="space-y-3">
                                    <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Mi actividad</p>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                        <button onClick={() => setShowFavorites(true)} className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 border-b border-gray-100 transition-all group text-left">
                                            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all">
                                                <Heart size={16} />
                                            </div>
                                            <span className="font-medium text-gray-900 text-sm flex-1">Favoritos</span>
                                            <ChevronRight size={16} className="text-gray-300" />
                                        </button>
                                        <button onClick={() => setShowReviews(true)} className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 border-b border-gray-100 transition-all group text-left">
                                            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all">
                                                <Star size={16} />
                                            </div>
                                            <span className="font-medium text-gray-900 text-sm flex-1">Reseñas</span>
                                            <ChevronRight size={16} className="text-gray-300" />
                                        </button>
                                        <button onClick={() => setShowRecommendations(true)} className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-all group text-left">
                                            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all">
                                                <Flame size={16} strokeWidth={1.5} />
                                            </div>
                                            <span className="font-medium text-gray-900 text-sm flex-1">Recomendaciones</span>
                                            <ChevronRight size={16} className="text-gray-300" />
                                        </button>
                                    </div>
                                </div>

                                {/* Configuration Section */}
                                <div className="space-y-3">
                                    <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Configuración</p>
                                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                        <Link href="/business/dashboard" onClick={onClose} className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-all group">
                                            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-600 group-hover:bg-gray-900 group-hover:text-white transition-all">
                                                <Store size={16} />
                                            </div>
                                            <span className="font-medium text-gray-900 text-sm flex-1">
                                                {hasGoogleBusinessSession && hasOwnedBusiness ? 'Administrar mi negocio' : 'Registrar mi negocio'}
                                            </span>
                                            {hasGoogleBusinessSession && hasOwnedBusiness && businessLogoStack.length > 0 && (
                                                <div className="flex items-center -space-x-2 flex-shrink-0">
                                                    {businessLogoStack.map((business, index) => (
                                                        <div
                                                            key={business.id || index}
                                                            className="w-8 h-8 rounded-full bg-white border-2 border-white shadow-sm overflow-hidden flex items-center justify-center text-gray-400"
                                                            title={business.name || 'Negocio'}
                                                        >
                                                            {business.image ? (
                                                                <img src={business.image} alt={business.name || 'Negocio'} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <Store size={13} />
                                                            )}
                                                        </div>
                                                    ))}
                                                    {ownedBusinessCount > businessLogoStack.length && (
                                                        <div className="w-8 h-8 rounded-full bg-gray-900 border-2 border-white shadow-sm text-white text-[10px] font-black flex items-center justify-center">
                                                            +{ownedBusinessCount - businessLogoStack.length}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            <ChevronRight size={16} className="text-gray-300" />
                                        </Link>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Logout Footer */}
                    {user && (
                        <div className="px-6 py-4 bg-white border-t border-gray-100 mt-auto">
                            <button
                                onClick={handleLogout}
                                className="w-full py-3 flex items-center justify-center gap-2 bg-red-50 text-red-600 font-black rounded-xl hover:bg-red-100 transition-all active:scale-95"
                            >
                                <LogOut size={20} />
                                Cerrar Sesión
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <LocationSelectionModal
                isOpen={isLocationModalOpen}
                onClose={() => setIsLocationModalOpen(false)}
                clientLocations={userLocations}
                onSelect={(loc) => handleSelectLocation(loc)}
                onLocationCreated={handleLocationCreated}
                clientId={user?.id || ''}
                initialAddingState={isAddingNewLocation}
                onLocationDeleted={(id) => {
                    setUserLocations(prev => {
                        const deleting = prev.find(l => l.id === id);
                        if (deleting && savedLocation?.referencia === deleting.referencia) {
                            setSavedLocation(null);
                        }
                        return prev.filter(l => l.id !== id);
                    });
                }}
                onLocationUpdated={(updatedLoc) => {
                    setUserLocations(prev => prev.map(l => l.id === updatedLoc.id ? updatedLoc : l));
                }}
            />

            <OrderSidebar
                isOpen={orderSidebarOpen}
                onClose={() => setOrderSidebarOpen(false)}
                orderId={selectedOrderId}
            />

            <ClientNotificationsSidebar
                isOpen={showNotifications}
                onClose={() => setShowNotifications(false)}
                notifications={clientNotifications}
                loading={loadingNotifications}
                unreadCount={unreadNotifications}
                onNotificationClick={handleNotificationClick}
                formatDate={formatNotificationDate}
            />

            <ClientReviewsSidebar
                isOpen={showReviews}
                onClose={() => setShowReviews(false)}
                reviews={clientReviews}
                loading={loadingReviews}
                savingReviewId={savingReviewId}
                onSaveReview={handleSaveReview}
                formatDate={formatNotificationDate}
            />

            <ClientRecommendationsSidebar
                isOpen={showRecommendations}
                onClose={() => setShowRecommendations(false)}
                referrals={clientReferrals}
                referralStats={referralStats}
                walletBalance={walletBalance}
                loading={loadingRecommendations}
                formatDate={formatNotificationDate}
                onReferralClick={handleReferralClick}
            />

            <ReferralModal
                isOpen={referralModalOpen}
                onClose={() => setReferralModalOpen(false)}
                product={selectedReferralProduct}
                referralLink={selectedReferralLink}
                businessName={selectedReferralBusinessName}
            />

            <ClientFavoritesSidebar
                isOpen={showFavorites}
                onClose={() => setShowFavorites(false)}
                favorites={favoriteBusinesses}
                loading={loadingFavorites}
                onOpenBusiness={handleOpenFavoriteBusiness}
                onRemoveFavorite={handleRemoveFavoriteBusiness}
            />

            <ClientCouponsSidebar
                isOpen={showCoupons}
                onClose={() => setShowCoupons(false)}
                cards={couponCards}
                loading={loadingCoupons}
                formatDate={formatNotificationDate}
            />

            <ClientPersonalInfoSidebar
                isOpen={showPersonalInfo}
                onClose={() => setShowPersonalInfo(false)}
                user={user}
                saving={savingPersonalInfo}
                message={personalInfoMessage}
                onSave={handleSavePersonalInfo}
            />
        </div>
    )
}
