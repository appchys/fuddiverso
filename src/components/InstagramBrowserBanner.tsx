'use client'

import { useEffect, useState } from 'react'
import { isRestrictedBrowser, getRestrictedBrowserType, getDeviceType, openInExternalBrowser } from '@/lib/instagram-detect'

export default function InstagramBrowserBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const [deviceType, setDeviceType] = useState<'android' | 'ios' | 'desktop'>('desktop')
  const [browserType, setBrowserType] = useState<'instagram' | 'safari-view' | null>(null)

  useEffect(() => {
    const isRestricted = isRestrictedBrowser()
    const browserTypeDetected = getRestrictedBrowserType()
    const device = getDeviceType()
    
    setDeviceType(device)
    setBrowserType(browserTypeDetected)
    setShowBanner(isRestricted && device !== 'desktop')
  }, [])

  if (!showBanner || !browserType) return null

  const isAndroid = deviceType === 'android'
  const isIos = deviceType === 'ios'
  const isInstagram = browserType === 'instagram'
  const isSafariView = browserType === 'safari-view'

  const getTitle = () => {
    if (isInstagram) return 'Abre Fuddi en tu navegador'
    if (isSafariView) return 'Mejora tu experiencia en Fuddi'
    return 'Abre Fuddi en tu navegador'
  }

  const getDescription = () => {
    if (isInstagram) {
      return 'El navegador de Instagram tiene limitaciones. Para una mejor experiencia, abre Fuddi en tu navegador externo.'
    }
    if (isSafariView) {
      return 'Este navegador tiene limitaciones con el acceso a GPS. Para una mejor experiencia, abre Fuddi en Safari.'
    }
    return ''
  }

  return (
    <div className="sticky top-0 z-50 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-3 shadow-lg">
      <div className="max-w-6xl mx-auto flex items-start gap-4">
        {/* Icono */}
        <div className="flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zm-11-1a1 1 0 11-2 0 1 1 0 012 0zM8 7a1 1 0 11-2 0 1 1 0 012 0zm4-1a1 1 0 11-2 0 1 1 0 012 0z" clipRule="evenodd" />
          </svg>
        </div>

        {/* Contenido */}
        <div className="flex-grow">
          <h3 className="font-bold mb-1">{getTitle()}</h3>
          
          {isAndroid && isInstagram && (
            <p className="text-sm opacity-95">
              {getDescription()}
            </p>
          )}
          
          {isIos && isInstagram && (
            <div className="text-sm opacity-95 space-y-1">
              <p>{getDescription()}</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>Toca los <strong>3 puntos</strong> en la esquina superior derecha</li>
                <li>Selecciona <strong>"Abrir en navegador externo"</strong> o Safari</li>
              </ol>
            </div>
          )}

          {isSafariView && isIos && (
            <div className="text-sm opacity-95 space-y-1">
              <p>{getDescription()}</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>Abre <strong>Safari</strong> directamente</li>
                <li>Ingresa <strong>fuddi.shop</strong> en la barra de direcciones</li>
              </ol>
            </div>
          )}
        </div>

        {/* Botones */}
        <div className="flex-shrink-0 flex gap-2">
          {isAndroid && isInstagram && (
            <button
              onClick={() => openInExternalBrowser()}
              className="bg-white text-blue-600 hover:bg-gray-100 font-semibold py-1.5 px-3 rounded-lg text-sm transition-colors"
            >
              Abrir
            </button>
          )}
          
          <button
            onClick={() => setShowBanner(false)}
            className="text-white hover:bg-white/20 font-semibold py-1.5 px-3 rounded-lg text-sm transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
