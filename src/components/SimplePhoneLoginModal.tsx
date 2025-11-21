'use client'

import { useState, useRef, useEffect } from 'react'
import { searchClientByPhone, createClient } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'

interface SimplePhoneLoginModalProps {
    isOpen: boolean
    onClose: () => void
    onLoginSuccess: (client: any) => void
}

export default function SimplePhoneLoginModal({
    isOpen,
    onClose,
    onLoginSuccess
}: SimplePhoneLoginModalProps) {
    const { login } = useAuth()
    const [phone, setPhone] = useState('')
    const [name, setName] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [step, setStep] = useState<'phone' | 'name'>('phone')
    const [foundClient, setFoundClient] = useState<any | null>(null)
    const modalRef = useRef<HTMLDivElement>(null)

    // Resetear estados al abrir el modal
    useEffect(() => {
        if (isOpen) {
            setPhone('')
            setName('')
            setError('')
            setLoading(false)
            setStep('phone')
            setFoundClient(null)
        }
    }, [isOpen])

    // Cerrar modal al hacer clic fuera
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                onClose()
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen, onClose])

    const handlePhoneSubmit = async () => {
        setError('')

        if (!phone.trim()) {
            setError('Por favor ingresa tu número de teléfono')
            return
        }

        const normalizedPhone = normalizeEcuadorianPhone(phone)
        if (!validateEcuadorianPhone(normalizedPhone)) {
            setError('Ingrese un número de celular ecuatoriano válido (10 dígitos)')
            return
        }

        setLoading(true)
        try {
            // Buscar cliente existente
            const client = await searchClientByPhone(normalizedPhone)

            if (client) {
                // Cliente existente - iniciar sesión directamente
                setFoundClient(client)

                // Guardar en localStorage
                localStorage.setItem('loginPhone', normalizedPhone)
                localStorage.setItem('clientData', JSON.stringify(client))

                // Actualizar contexto de autenticación
                login(client)

                onLoginSuccess(client)
                onClose()
            } else {
                // Cliente nuevo - pedir nombre
                setFoundClient(null)
                setStep('name')
            }
        } catch (error) {
            console.error('Error checking phone:', error)
            setError('Error al verificar el número. Intenta nuevamente.')
        } finally {
            setLoading(false)
        }
    }

    const handleNameSubmit = async () => {
        setError('')

        if (!name.trim()) {
            setError('Por favor ingresa tu nombre')
            return
        }

        setLoading(true)
        try {
            const normalizedPhone = normalizeEcuadorianPhone(phone)

            // Crear nuevo cliente sin PIN
            const clientData = await createClient({
                celular: normalizedPhone,
                nombres: name.trim()
            })

            // Guardar en localStorage
            localStorage.setItem('loginPhone', normalizedPhone)
            localStorage.setItem('clientData', JSON.stringify(clientData))

            // Actualizar contexto de autenticación
            login(clientData)

            onLoginSuccess(clientData)
            onClose()
        } catch (error) {
            console.error('Error creating client:', error)
            setError('Error al crear la cuenta. Intenta nuevamente.')
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                ref={modalRef}
                className="bg-[#ff6a8c] rounded-lg max-w-md w-full p-6 text-white relative"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Botón de cierre */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 w-8 h-8 text-white hover:bg-white/20 rounded-full flex items-center justify-center transition-colors focus:outline-none"
                    aria-label="Cerrar modal"
                >
                    <i className="bi bi-x-lg text-xl"></i>
                </button>

                {/* Título */}
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-white">
                        {step === 'phone' ? 'Ingresa tu celular' : 'Completa tu registro'}
                    </h2>
                    <p className="text-white/80 text-sm mt-1">
                        {step === 'phone'
                            ? 'Para continuar con el escaneo del código QR'
                            : 'Solo necesitamos tu nombre para crear tu cuenta'}
                    </p>
                </div>

                {step === 'phone' ? (
                    // Paso 1: Ingresar teléfono
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-white mb-2">
                                Número de celular
                            </label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="0998765432"
                                className="w-full px-4 py-3 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/50"
                                onKeyPress={(e) => e.key === 'Enter' && handlePhoneSubmit()}
                                autoFocus
                            />
                            {error && (
                                <p className="text-yellow-300 text-sm mt-2">{error}</p>
                            )}
                        </div>

                        <button
                            onClick={handlePhoneSubmit}
                            disabled={loading || !phone.trim()}
                            className="w-full px-4 py-3 bg-white text-[#ff6a8c] font-semibold rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center">
                                    <i className="bi bi-arrow-repeat animate-spin mr-2"></i>
                                    Verificando...
                                </span>
                            ) : (
                                'Continuar'
                            )}
                        </button>
                    </div>
                ) : (
                    // Paso 2: Ingresar nombre (solo para nuevos usuarios)
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-white mb-2">
                                Tu nombre completo
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Ej: Juan Pérez"
                                className="w-full px-4 py-3 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/50"
                                onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
                                autoFocus
                            />
                            {error && (
                                <p className="text-yellow-300 text-sm mt-2">{error}</p>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep('phone')}
                                className="flex-1 px-4 py-3 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors"
                            >
                                Atrás
                            </button>
                            <button
                                onClick={handleNameSubmit}
                                disabled={loading || !name.trim()}
                                className="flex-1 px-4 py-3 bg-white text-[#ff6a8c] font-semibold rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center">
                                        <i className="bi bi-arrow-repeat animate-spin mr-2"></i>
                                        Creando...
                                    </span>
                                ) : (
                                    'Crear cuenta'
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
