/**
 * Detecta si el usuario está usando el navegador integrado de Instagram o SFSafariViewController
 */
export const isRestrictedBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false
  
  const userAgent = navigator.userAgent || navigator.vendor || ''
  
  // Instagram incluye su nombre en el User Agent
  if (/Instagram/.test(userAgent)) return true
  
  // SFSafariViewController: detectar por la ausencia de ciertos indicadores de Safari real
  // Safari real incluye "Safari" después de "Version"
  // SFSafariViewController en apps nativas NO incluye "Safari" pero sí "Version"
  if (/iPhone|iPad|iPod/.test(userAgent) && !userAgent.includes('Safari')) {
    return true
  }
  
  // Otra forma de detectar: apps nativas que usan WKWebView/SFSafariViewController
  // no tendrán el header de Safari esperado
  if (/iPhone|iPad|iPod/.test(userAgent) && /Version\//.test(userAgent) && !/ Safari\//.test(userAgent)) {
    return true
  }
  
  return false
}

/**
 * Obtiene el tipo específico de navegador restringido
 */
export const getRestrictedBrowserType = (): 'instagram' | 'safari-view' | null => {
  if (typeof navigator === 'undefined') return null
  
  const userAgent = navigator.userAgent || navigator.vendor || ''
  
  if (/Instagram/.test(userAgent)) return 'instagram'
  
  if (/iPhone|iPad|iPod/.test(userAgent) && !userAgent.includes('Safari')) {
    return 'safari-view'
  }
  
  if (/iPhone|iPad|iPod/.test(userAgent) && /Version\//.test(userAgent) && !/ Safari\//.test(userAgent)) {
    return 'safari-view'
  }
  
  return null
}

/**
 * Detecta el tipo de dispositivo del usuario
 */
export const getDeviceType = (): 'android' | 'ios' | 'desktop' => {
  if (typeof navigator === 'undefined') return 'desktop'
  
  const userAgent = navigator.userAgent
  
  if (/android/i.test(userAgent)) {
    return 'android'
  }
  
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return 'ios'
  }
  
  return 'desktop'
}

/**
 * Intenta abrir la URL en el navegador externo
 */
export const openInExternalBrowser = (url: string = typeof window !== 'undefined' ? window.location.href : ''): void => {
  const deviceType = getDeviceType()
  
  if (deviceType === 'android') {
    // Usar intent:// para Android
    const intentUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;type=text/plain;action=android.intent.action.VIEW;end;`
    window.location.href = intentUrl
  } else if (deviceType === 'ios') {
    // En iOS, simplemente abrimos la URL normal y mostramos instrucciones
    // El usuario deberá seguir las instrucciones mostradas en el banner
    window.location.href = url
  }
}
