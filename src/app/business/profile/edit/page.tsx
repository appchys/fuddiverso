'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Business } from '@/types'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { getBusiness, updateBusiness } from '@/lib/database'
import BusinessProfileEditor from '@/components/BusinessProfileEditor'
import Link from 'next/link'

export default function EditBusinessProfilePage() {
    const router = useRouter()
    const { user, businessId, isAuthenticated, authLoading } = useBusinessAuth()

    const [business, setBusiness] = useState<Business | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Protección de ruta
    useEffect(() => {
        if (authLoading) return
        if (!isAuthenticated) {
            router.replace('/business/login')
        }
    }, [authLoading, isAuthenticated, router])

    // Cargar datos del negocio
    useEffect(() => {
        if (!businessId) return

        const loadBusiness = async () => {
            try {
                const businessData = await getBusiness(businessId)
                if (businessData) {
                    setBusiness(businessData)
                } else {
                    router.push('/business/dashboard')
                }
            } catch (error) {
                console.error('Error loading business:', error)
                router.push('/business/dashboard')
            } finally {
                setLoading(false)
            }
        }

        loadBusiness()
    }, [businessId, router])

    const handleSave = async (updatedData: Partial<Business>) => {
        if (!business) return

        setSaving(true)
        try {
            await updateBusiness(business.id, {
                ...updatedData,
                updatedAt: new Date()
            })

            // Actualizar caché local
            const CACHE_KEY = `businessAccess:${user?.uid}`
            try {
                localStorage.removeItem(CACHE_KEY)
            } catch { }

            // Redirigir al dashboard con mensaje de éxito
            router.push('/business/dashboard?tab=profile&saved=true')
        } catch (error) {
            console.error('Error saving business:', error)
            alert('Error al guardar los cambios. Inténtalo de nuevo.')
        } finally {
            setSaving(false)
        }
    }

    const handleCancel = () => {
        router.push('/business/dashboard?tab=profile')
    }

    if (authLoading || loading) {
        return (
            <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-red-200 border-t-red-600 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500 font-medium">Cargando...</p>
                </div>
            </div>
        )
    }

    if (!business) {
        return (
            <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
                <div className="text-center bg-white p-8 rounded-3xl shadow-xl max-w-md">
                    <i className="bi bi-exclamation-triangle text-5xl text-orange-500 mb-4"></i>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Negocio no encontrado</h2>
                    <p className="text-gray-500 mb-6">No se pudo encontrar la información del negocio.</p>
                    <Link
                        href="/business/dashboard"
                        className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-2xl transition-colors"
                    >
                        <i className="bi bi-arrow-left"></i>
                        Volver al Dashboard
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-[#F8F9FA]">
            {/* Header con botón de regreso */}
            <div className="bg-white border-b border-gray-100 sticky top-0 z-50">
                <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
                    <button
                        onClick={handleCancel}
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        <i className="bi bi-arrow-left text-xl text-gray-600"></i>
                    </button>
                    <div>
                        <h1 className="font-bold text-gray-900">Editar Perfil</h1>
                        <p className="text-xs text-gray-500">{business.name}</p>
                    </div>
                </div>
            </div>

            {/* Editor Component */}
            <BusinessProfileEditor
                business={business}
                onSave={handleSave}
                onCancel={handleCancel}
                saving={saving}
            />
        </div>
    )
}
