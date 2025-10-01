'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase'
import { getDeliveryByEmail, linkDeliveryWithAuth } from '@/lib/database'
import { useDeliveryAuth } from '@/contexts/DeliveryAuthContext'

export default function DeliveryLogin() {
  const router = useRouter()
  const { login, isAuthenticated, authLoading } = useDeliveryAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Redirigir si ya está autenticado
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace('/delivery/dashboard')
    }
  }, [authLoading, isAuthenticated, router])

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError('')

    try {
      // Iniciar sesión con Google
      const result = await signInWithPopup(auth, googleProvider)
      const user = result.user

      if (!user.email) {
        setError('No se pudo obtener el email de tu cuenta de Google')
        setLoading(false)
        return
      }

      // Buscar el delivery por email
      const delivery = await getDeliveryByEmail(user.email)

      if (!delivery) {
        setError('No tienes una cuenta de delivery registrada con este email. Contacta al administrador.')
        await auth.signOut()
        setLoading(false)
        return
      }

      if (delivery.estado !== 'activo') {
        setError('Tu cuenta de delivery está inactiva. Contacta al administrador.')
        await auth.signOut()
        setLoading(false)
        return
      }

      // Vincular el UID de Firebase con el delivery si no está vinculado
      if (!delivery.uid) {
        await linkDeliveryWithAuth(delivery.id!, user.uid)
      }

      // Guardar en el contexto
      login(
        {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL
        },
        delivery.id!
      )

      // Redirigir al dashboard
      router.push('/delivery/dashboard')
    } catch (error: any) {
      console.error('Error en login:', error)
      setError('Error al iniciar sesión. Por favor intenta de nuevo.')
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <div className="max-w-md w-full">
        {/* Card principal */}
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
          {/* Logo/Icono */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-blue-100 rounded-full mb-4">
              <svg 
                className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M13 10V3L4 14h7v7l9-11h-7z" 
                />
              </svg>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
              Delivery Portal
            </h1>
            <p className="text-sm sm:text-base text-gray-600">
              Accede para gestionar tus entregas
            </p>
          </div>

          {/* Mensaje de error */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start">
                <svg 
                  className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" 
                  fill="currentColor" 
                  viewBox="0 0 20 20"
                >
                  <path 
                    fillRule="evenodd" 
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" 
                    clipRule="evenodd" 
                  />
                </svg>
                <p className="ml-3 text-sm text-red-800">{error}</p>
              </div>
            </div>
          )}

          {/* Botón de Google */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-300 rounded-lg px-4 py-3 sm:py-4 text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-700"></div>
                <span className="text-sm sm:text-base">Iniciando sesión...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="text-sm sm:text-base">Continuar con Google</span>
              </>
            )}
          </button>

          {/* Información adicional */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs sm:text-sm text-gray-500 text-center">
              Solo personal autorizado puede acceder a este portal.
              <br />
              Si tienes problemas, contacta al administrador.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs sm:text-sm text-gray-600">
            © 2025 Fuddiverso. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </div>
  )
}
