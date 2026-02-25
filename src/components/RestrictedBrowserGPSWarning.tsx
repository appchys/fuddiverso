'use client'

import { useEffect, useState } from 'react'
import { isRestrictedBrowser, getRestrictedBrowserType, getDeviceType } from '@/lib/instagram-detect'

export default function RestrictedBrowserGPSWarning() {
  const [showWarning, setShowWarning] = useState(false)
  const [browserType, setBrowserType] = useState<'instagram' | 'safari-view' | null>(null)
  const [deviceType, setDeviceType] = useState<'android' | 'ios' | 'desktop'>('desktop')

  useEffect(() => {
    const isRestricted = isRestrictedBrowser()
    const browserTypeDetected = getRestrictedBrowserType()
    const device = getDeviceType()
    
    setDeviceType(device)
    setBrowserType(browserTypeDetected)
    setShowWarning(isRestricted && device !== 'desktop')
  }, [])

  if (!showWarning || !browserType) return null

  const isInstagram = browserType === 'instagram'
  const isSafariView = browserType === 'safari-view'
  const isIos = deviceType === 'ios'

  return (
    <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-grow">
          <h4 className="text-sm font-semibold text-yellow-800 mb-1">
            {isInstagram && 'Limitaciones del navegador de Instagram'}
            {isSafariView && 'GPS limitado en este navegador'}
          </h4>
          <p className="text-sm text-yellow-700 mb-2">
            {isInstagram && 'El navegador de Instagram tiene limitaciones con el GPS. Para seleccionar tu ubicación correctamente:'}
            {isSafariView && 'Este navegador tiene restricciones de GPS. Para funcionalidad completa:'}
          </p>
          <ul className="text-xs text-yellow-700 space-y-1 ml-4">
            {isInstagram && (
              <>
                <li>• Abre Fuddi en tu navegador principal (Safari o Chrome)</li>
                <li>• Luego podrás usar el GPS para seleccionar tu ubicación</li>
              </>
            )}
            {isSafariView && isIos && (
              <>
                <li>• Abre Safari directamente</li>
                <li>• El GPS funcionará correctamente en Safari</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
