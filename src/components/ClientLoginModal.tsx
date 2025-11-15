'use client'

import { useState, useRef, useEffect } from 'react'
import { searchClientByPhone, createClient, setClientPin, updateClient, clearClientPin, registerClientForgotPin } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'

interface ClientLoginModalProps {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (client: any) => void
  initialPhone?: string
}

export default function ClientLoginModal({ 
  isOpen, 
  onClose, 
  onLoginSuccess,
  initialPhone = ''
}: ClientLoginModalProps) {
  const { login } = useAuth()
  const [loginPhone, setLoginPhone] = useState(initialPhone)
  const [loginError, setLoginError] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [registerPin, setRegisterPin] = useState('')
  const [registerPinConfirm, setRegisterPinConfirm] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)
  const [foundClient, setFoundClient] = useState<any | null>(null)
  const [phoneCheckTimeout, setPhoneCheckTimeout] = useState<any>(null)
  const [loginPin, setLoginPin] = useState('')
  const [loginPinError, setLoginPinError] = useState('')
  const [loginPinLoading, setLoginPinLoading] = useState(false)
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [showEditFields, setShowEditFields] = useState(false)
  const [phoneValidated, setPhoneValidated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Cerrar el modal al hacer clic fuera
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

  // Resetear todos los estados al abrir el modal (evita prellenado persistente)
  useEffect(() => {
    if (isOpen) {
      // Resetear campos y errores
      setLoginPhone(initialPhone || '')
      setLoginError('')
      setRegisterName('')
      setRegisterPin('')
      setRegisterPinConfirm('')
      setRegisterError('')
      setLoginPin('')
      setLoginPinError('')
      setRegisterLoading(false)
      setLoginPinLoading(false)
      setFoundClient(null)
      setPhoneValidated(false)
      setShowEditFields(false)
      setProfileImage(null)
      // Limpiar timeout si existe
      if (phoneCheckTimeout) {
        clearTimeout(phoneCheckTimeout)
        setPhoneCheckTimeout(null)
      }
      // Si hay initialPhone, cargarlo y chequear
      if (initialPhone) {
        setLoginPhone(initialPhone)
        checkPhone(initialPhone)
      }
    }
  }, [isOpen, initialPhone])

  useEffect(() => {
    if (initialPhone && isOpen) {
      checkPhone(initialPhone)
    }
  }, [initialPhone, isOpen])

  // Función para hashear el PIN de manera consistente
  async function hashPin(pin: string): Promise<string> {
    // Usamos una implementación de hash simple pero consistente
    // que funcione igual en todos los entornos
    const simpleHash = (str: string): string => {
      let hash = 0
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash // Convierte a 32bit entero
      }
      return Math.abs(hash).toString(16).padStart(8, '0')
    }
    
    // Para compatibilidad con hashes existentes, intentamos primero con el método simple
    // Si el hash resultante tiene 64 caracteres, asumimos que fue generado con SHA-256
    // y usamos ese método si está disponible
    try {
      if (typeof window !== 'undefined' && window.crypto?.subtle?.digest) {
        // Si el hash existente es de 64 caracteres, usamos SHA-256
        if (foundClient?.pinHash?.length === 64) {
          const encoder = new TextEncoder()
          const data = encoder.encode(pin)
          const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        }
      }
    } catch (e) {
      console.warn('Error usando Web Crypto API, usando hash simple', e)
    }
    
    // Por defecto, usar el hash simple
    return simpleHash(pin)
  }

  const handleRegisterSubmit = async () => {
    setRegisterError('')
    if (!registerName.trim()) {
      setRegisterError('Ingresa tu nombre')
      return
    }
    if (!/^[0-9]{4,6}$/.test(registerPin)) {
      setRegisterError('El PIN debe contener entre 4 y 6 dígitos')
      return
    }
    if (registerPin !== registerPinConfirm) {
      setRegisterError('Los PIN no coinciden')
      return
    }

    setRegisterLoading(true)
    try {
      const pinHash = await hashPin(registerPin)
      const normalizedPhone = normalizeEcuadorianPhone(loginPhone)

      let clientData: any

      if (foundClient && foundClient.id) {
        if (registerName && registerName.trim()) {
          try {
            await updateClient(foundClient.id, { nombres: registerName.trim() })
          } catch (e) {
            console.warn('Could not update client name, continuing to set PIN', e)
          }
        }
        await setClientPin(foundClient.id, pinHash)
        const updated = await searchClientByPhone(normalizedPhone)
        clientData = updated
      } else {
        clientData = await createClient({ celular: normalizedPhone, nombres: registerName, pinHash })
      }

      // Guardar en localStorage
      localStorage.setItem('loginPhone', normalizedPhone)
      localStorage.setItem('clientData', JSON.stringify(clientData))

      // Actualizar contexto de autenticación
      login(clientData)

      onLoginSuccess(clientData)
      onClose()
    } catch (error) {
      console.error('Error creating client:', error)
      setRegisterError('Error al crear la cuenta. Intenta nuevamente.')
    } finally {
      setRegisterLoading(false)
    }
  }

  const checkPhone = async (phoneRaw?: string) => {
    const phoneToCheck = phoneRaw || loginPhone
    if (!phoneToCheck) return
    const normalized = normalizeEcuadorianPhone(phoneToCheck)
    if (!validateEcuadorianPhone(normalized)) {
      setPhoneValidated(false)
      setFoundClient(null)
      return
    }

    try {
      const client = await searchClientByPhone(normalized)
      setFoundClient(client)
      if (client && client.nombres) {
        setRegisterName(client.nombres)
      } else {
        setRegisterName('')
      }
      setPhoneValidated(true)
    } catch (error) {
      console.error('Error checking phone:', error)
      setPhoneValidated(false)
      setFoundClient(null)
      setRegisterName('')
    }
  }

  const handleLoginWithPin = async () => {
    setLoginPinError('')
    if (!foundClient) return
    if (!/^[0-9]{4,6}$/.test(loginPin)) {
      setLoginPinError('PIN inválido')
      return
    }
    setLoginPinLoading(true)
    try {
      const pinHash = await hashPin(loginPin)
      if (pinHash === foundClient.pinHash) {
        // Guardar en localStorage
        const normalizedPhone = normalizeEcuadorianPhone(loginPhone)
        localStorage.setItem('loginPhone', normalizedPhone)
        localStorage.setItem('clientData', JSON.stringify(foundClient))
        
        // Actualizar contexto de autenticación
        login(foundClient)
        
        onLoginSuccess(foundClient)
        onClose()
      } else {
        setLoginPinError('PIN incorrecto')
      }
    } catch (error) {
      console.error('Error validating PIN:', error)
      setLoginPinError('Error al verificar PIN')
    } finally {
      setLoginPinLoading(false)
    }
  }

  const handleLogin = async () => {
    if (!loginPhone.trim()) {
      setLoginError('Por favor ingresa tu número de teléfono')
      return
    }

    const normalizedPhone = normalizeEcuadorianPhone(loginPhone)
    if (!validateEcuadorianPhone(normalizedPhone)) {
      setLoginError('Ingrese un número de celular ecuatoriano válido')
      return
    }

    setLoginError('')
    await checkPhone(normalizedPhone)
  }

  if (!isOpen) return null

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        ref={modalRef}
        className="bg-[#ff6a8c] rounded-lg max-w-md w-full p-6 text-white relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botón de cierre mejorado */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 text-white hover:bg-white/20 rounded-full flex items-center justify-center transition-colors focus:outline-none"
          aria-label="Cerrar modal"
        >
          <i className="bi bi-x-lg text-xl"></i>
        </button>
        {phoneValidated ? (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="relative group">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                  {profileImage ? (
                    <img 
                      src={profileImage} 
                      alt="Foto de perfil" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <i className="bi bi-person text-2xl text-white/70"></i>
                  )}
                </div>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-0 right-0 translate-y-1/2 w-5 h-5 flex items-center justify-center text-white text-xs transition-all duration-200"
                  title="Cambiar foto"
                >
                  <i className="bi bi-pencil"></i>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        setProfileImage(event.target?.result as string);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  {/* AJUSTE FINAL: Título condicional basado en foundClient */}
                  {!foundClient ? (
                    'Crear cuenta'
                  ) : registerName ? (
                    <>
                      Hola, {registerName}
                      <i 
                        className="bi bi-pencil text-white/70 hover:text-white transition-colors cursor-pointer"
                        onClick={() => setShowEditFields(!showEditFields)}
                      ></i>
                    </>
                  ) : (
                    'Iniciar Sesión'
                  )}
                </h3>
                <p className="text-sm text-white/80 mt-1">
                  {loginPhone}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-8"></div> // Espacio para mantener el mismo espaciado
        )}

        {!phoneValidated ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-1">
                Celular
              </label>
              <input
                type="tel"
                value={loginPhone}
                onChange={(e) => {
                  const v = e.target.value
                  setLoginPhone(v)
                  if (phoneCheckTimeout) clearTimeout(phoneCheckTimeout)
                  const t = setTimeout(() => checkPhone(v), 500)
                  setPhoneCheckTimeout(t)
                }}
                onBlur={() => checkPhone()}
                placeholder="0998765432"
                className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70"
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              />
              {loginError && (
                <p className="text-yellow-300 text-sm mt-1">{loginError}</p>
              )}
            </div>
            <button 
              onClick={handleLogin} 
              disabled={!loginPhone.trim() || !!loginError}
              className="w-full px-4 py-2 bg-white text-[#ff6a8c] font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              Continuar
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {foundClient && foundClient.pinHash ? (
              // Caso: Cliente existente con PIN - solo PIN de login
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-white mb-1">Ingresa tu PIN</label>
                  <input 
                    type="password" 
                    value={loginPin} 
                    onChange={(e) => setLoginPin(e.target.value)} 
                    maxLength={6} 
                    className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70" 
                    onKeyPress={(e) => e.key === 'Enter' && handleLoginWithPin()}
                  />
                  <div className="text-right mt-1">
                    <button 
                      type="button" 
                      onClick={async () => {
                        if (!foundClient?.id) return;
                        try {
                          setLoginPinLoading(true)
                          await registerClientForgotPin(foundClient.id)
                          await clearClientPin(foundClient.id)
                          // Refrescar UI para mostrar flujo de crear PIN
                          setFoundClient((prev: any | null) => (prev ? { ...prev, pinHash: null } : prev))
                          setLoginPin('')
                          setLoginPinError('')
                          // Mantener el teléfono validado para seguir en el modal, pero cambiar de rama
                          // Al no tener pinHash, se mostrará la sección de crear PIN
                        } catch (e) {
                          console.error('Error al limpiar PIN:', e)
                          setLoginPinError('No se pudo restablecer el PIN. Intenta nuevamente.')
                        } finally {
                          setLoginPinLoading(false)
                        }
                      }}
                      className="text-xs text-white/70 hover:text-white transition-colors"
                    >
                      ¿Olvidaste tu PIN?
                    </button>
                  </div>
                  {loginPinError && <p className="text-yellow-300 text-sm mt-1">{loginPinError}</p>}
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={onClose} 
                    className="flex-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleLoginWithPin} 
                    disabled={loginPinLoading} 
                    className="flex-1 px-4 py-2 bg-white text-[#ff6a8c] font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-70"
                  >
                    {loginPinLoading ? 'Verificando...' : 'Iniciar sesión'}
                  </button>
                </div>
              </div>
            ) : (
              // Caso: Nuevo o existente sin PIN - mostrar nombre + PINs
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-white mb-1">
                    {foundClient ? 'Nombres' : 'Tu nombre completo'}
                  </label>
                  <input
                    type="text"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    placeholder="Tu nombre completo"
                    className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1">Crea un PIN (4-6 dígitos)</label>
                  <input 
                    type="password" 
                    value={registerPin} 
                    onChange={(e) => setRegisterPin(e.target.value)} 
                    maxLength={6} 
                    className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-1">Confirmar PIN</label>
                  <input 
                    type="password" 
                    value={registerPinConfirm} 
                    onChange={(e) => setRegisterPinConfirm(e.target.value)} 
                    maxLength={6} 
                    className="w-full px-3 py-2 border border-white/30 bg-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent placeholder-white/70" 
                  />
                </div>
                {registerError && <p className="text-yellow-300 text-sm">{registerError}</p>}
                <div className="flex gap-3">
                  <button 
                    onClick={onClose} 
                    className="flex-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleRegisterSubmit} 
                    disabled={registerLoading} 
                    className="flex-1 px-4 py-2 bg-white text-[#ff6a8c] font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-70"
                  >
                    {registerLoading ? 'Procesando...' : (foundClient ? 'Crear PIN' : 'Registrarse')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}