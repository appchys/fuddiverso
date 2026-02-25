/**
 * Detecta si el usuario está usando el navegador integrado de Instagram
 */
export const isInstagramBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false
  
  const userAgent = navigator.userAgent || navigator.vendor || ''
  
  // Instagram incluye su nombre en el User Agent
  return /Instagram/.test(userAgent)
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
