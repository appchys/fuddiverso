export const DEFAULT_MANUAL_LAT = -1.861971
export const DEFAULT_MANUAL_LNG = -79.978529
export const DEFAULT_MANUAL_LATLONG = `${DEFAULT_MANUAL_LAT}, ${DEFAULT_MANUAL_LNG}`
// Distancia mínima en metros que el cliente debe mover el pin desde el punto inicial por defecto
export const MIN_MANUAL_MOVE_DISTANCE_METERS = 5

export function parseLatLong(latlong?: string | null): { lat: number; lng: number } | null {
  if (!latlong || typeof latlong !== 'string' || latlong.startsWith('pluscode:')) return null
  const parts = latlong.split(',').map(coord => parseFloat(coord.trim()))
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null
  return { lat: parts[0], lng: parts[1] }
}

export function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function isNearDefaultManualLocation(lat: number, lng: number): boolean {
  return getDistanceMeters(lat, lng, DEFAULT_MANUAL_LAT, DEFAULT_MANUAL_LNG) < MIN_MANUAL_MOVE_DISTANCE_METERS
}

export function isDefaultManualLatLong(latlong?: string | null): boolean {
  const parsed = parseLatLong(latlong)
  if (!parsed) return false
  return isNearDefaultManualLocation(parsed.lat, parsed.lng)
}
