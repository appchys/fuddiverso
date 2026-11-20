import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { GoogleMap } from './GoogleMap'
import LocationMap from './LocationMap'
import { ClientLocation, createClientLocation, getDeliveryDetailsForLocation, deleteLocation, updateLocation, uploadImage } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import {
    DEFAULT_MANUAL_LAT,
    DEFAULT_MANUAL_LNG,
    parseLatLong,
    isNearDefaultManualLocation,
    isDefaultManualLatLong
} from '@/lib/location-utils'
import type { Business } from '@/types'

interface NewLocationData {
    latlong: string
    referencia: string
    tarifa: string
    sector?: string
}

interface LocationSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    clientLocations: ClientLocation[]
    onSelect: (location: ClientLocation) => void
    onLocationCreated: (location: ClientLocation) => void
    clientId: string
    businessId?: string
    initialAddingState?: boolean
    selectedLocationId?: string
    onLocationDeleted?: (locationId: string) => void
    onLocationUpdated?: (location: ClientLocation) => void
    /** Negocio precargado: evita volver a descargarlo en cada cálculo de tarifa */
    business?: Business | null
}

// Tiempos máximos para no dejar al cliente esperando indefinidamente
const GPS_TIMEOUT_MS = 15000
const FEE_TIMEOUT_MS = 8000
const PHOTO_UPLOAD_TIMEOUT_MS = 25000

class TimeoutError extends Error {
    constructor(label: string) {
        super(`Timeout: ${label}`)
        this.name = 'TimeoutError'
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer)
    })
}

/** Optimiza y sube la foto de referencia. Lanza error si falla (el llamador decide si continuar sin foto). */
async function uploadLocationPhoto(file: File, clientId: string): Promise<string> {
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
    const fileName = `locations/${clientId}_${timestamp}_${safeName}.jpg`

    let blob: Blob = file
    try {
        // Max 1000px, 0.8 calidad, JPEG para compatibilidad
        blob = await optimizeImage(file, 1000, 0.8, 'image/jpeg')
    } catch (error) {
        // p. ej. HEIC en navegadores que no lo decodifican: subir el original
        console.warn('No se pudo optimizar la foto de ubicación, se sube el original:', error)
    }

    // Se pasa el Blob (no File) para que uploadImage no vuelva a comprimir la imagen
    return withTimeout(uploadImage(blob, fileName), PHOTO_UPLOAD_TIMEOUT_MS, 'photo-upload')
}

export default function LocationSelectionModal({
    isOpen,
    onClose,
    clientLocations,
    onSelect,
    onLocationCreated,
    clientId,
    businessId,
    initialAddingState = false,
    selectedLocationId,
    onLocationDeleted,
    onLocationUpdated,
    business
}: LocationSelectionModalProps) {
    // Estado local para controlar si estamos seleccionando o agregando
    const [isAddingNewLocation, setIsAddingNewLocation] = useState(initialAddingState)
    const [editingLocation, setEditingLocation] = useState<ClientLocation | null>(null)
    const [openMenuId, setOpenMenuId] = useState<string | null>(null)
    const [newLocationData, setNewLocationData] = useState<NewLocationData>({ latlong: '', referencia: '', tarifa: '1.25', sector: '' })
    const [isRequestingLocation, setIsRequestingLocation] = useState(false)
    const [locationPermissionError, setLocationPermissionError] = useState<string | null>(null)
    const [gpsAttempts, setGpsAttempts] = useState(0)
    const [isManualMode, setIsManualMode] = useState(false)
    const [pinMovementMode, setPinMovementMode] = useState<'map' | 'pin'>('map')
    const [hasMovedPin, setHasMovedPin] = useState(false)
    const [locationImageFile, setLocationImageFile] = useState<File | null>(null)
    const [locationImagePreview, setLocationImagePreview] = useState<string>('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isResolvingDeliveryFee, setIsResolvingDeliveryFee] = useState(false)
    const [feeResolutionFailed, setFeeResolutionFailed] = useState(false)
    const [calculatedDistance, setCalculatedDistance] = useState<number | null>(null)
    const [isInsideCoverage, setIsInsideCoverage] = useState<boolean>(false)
    const [selectingLocationId, setSelectingLocationId] = useState<string | null>(null)

    // Identificadores de petición: descartan respuestas tardías (GPS / tarifa) que ya no aplican
    const feeRequestIdRef = useRef(0)
    const geoRequestIdRef = useRef(0)
    // Evita doble envío por doble toque antes de que React re-renderice el botón deshabilitado
    const submittingRef = useRef(false)

    useEffect(() => {
        if (typeof window !== 'undefined' && window.innerWidth >= 768) {
            setPinMovementMode('pin')
        }
    }, [])

    const resetLocationForm = useCallback(() => {
        // Invalidar cualquier GPS / cálculo de tarifa en curso
        feeRequestIdRef.current++
        geoRequestIdRef.current++
        setIsRequestingLocation(false)
        setIsManualMode(false)
        setHasMovedPin(false)
        setGpsAttempts(0)
        setLocationPermissionError(null)
        setNewLocationData({ latlong: '', referencia: '', tarifa: '1.25', sector: '' })
        setLocationImageFile(null)
        setLocationImagePreview('')
        setIsSubmitting(false)
        submittingRef.current = false
        setIsResolvingDeliveryFee(false)
        setFeeResolutionFailed(false)
        setCalculatedDistance(null)
        setIsInsideCoverage(false)
    }, [])

    const exitLocationForm = useCallback(() => {
        setIsAddingNewLocation(false)
        setEditingLocation(null)
        resetLocationForm()
    }, [resetLocationForm])

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
            setSelectingLocationId(null)
            // Si el cliente no tiene direcciones guardadas, ir directo al formulario (un toque menos)
            setIsAddingNewLocation(initialAddingState || clientLocations.length === 0)
        } else {
            document.body.style.overflow = ''
            setEditingLocation(null)
            setSelectingLocationId(null)
            setOpenMenuId(null)
            setIsAddingNewLocation(false)
            resetLocationForm()
        }
        return () => {
            document.body.style.overflow = ''
        }
        // Solo reaccionar a la apertura/cierre del modal
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, resetLocationForm])

    useEffect(() => {
        if (!isAddingNewLocation) {
            setEditingLocation(null)
            resetLocationForm()
        }
    }, [isAddingNewLocation, resetLocationForm])

    // Helper puro para calcular tarifa (con tiempo límite para no bloquear el guardado)
    const calculateDeliveryFee = useCallback(async ({ lat, lng }: { lat: number; lng: number }) => {
        if (!businessId) {
            return { fee: 0, zoneName: 'Sin especificar', isOutOfCoverage: false, distance: undefined as number | undefined, failed: false }
        }
        try {
            const details = await withTimeout(
                getDeliveryDetailsForLocation({ lat, lng }, businessId, business ?? undefined),
                FEE_TIMEOUT_MS,
                'delivery-fee'
            )
            const { fee, distance, zoneName, isOutOfCoverage } = details
            return {
                fee: typeof fee === 'number' ? fee : 0,
                zoneName: zoneName || (isOutOfCoverage ? 'Sin cobertura' : 'Zona de cobertura'),
                isOutOfCoverage: !!isOutOfCoverage,
                distance,
                failed: false
            }
        } catch (error) {
            console.error('Error calculating delivery fee:', error)
            return { fee: 0, zoneName: '', isOutOfCoverage: true, distance: undefined as number | undefined, failed: true }
        }
    }, [businessId, business])

    const resolveDeliveryFeeValue = useCallback(async (lat: number, lng: number) => {
        const requestId = ++feeRequestIdRef.current
        setIsResolvingDeliveryFee(true)
        try {
            let tarifa = '1.25'
            let sector = 'Sin especificar'
            let insideCoverage = true
            let distance: number | undefined
            let failed = false
            if (businessId) {
                const result = await calculateDeliveryFee({ lat, lng })
                tarifa = result.fee.toFixed(2)
                sector = result.zoneName
                insideCoverage = !result.isOutOfCoverage
                distance = result.distance
                failed = result.failed
            }

            // Respuesta tardía de una posición anterior: descartar
            if (requestId !== feeRequestIdRef.current) return null

            setIsInsideCoverage(insideCoverage)
            setCalculatedDistance(distance !== undefined ? distance : null)
            setFeeResolutionFailed(failed)
            return { tarifa, sector }
        } finally {
            if (requestId === feeRequestIdRef.current) {
                setIsResolvingDeliveryFee(false)
            }
        }
    }, [businessId, calculateDeliveryFee])

    // Función para manejar cambio de ubicación en el mapa / GPS
    const handleLocationChange = useCallback(async (lat: number, lng: number, options?: { fromGps?: boolean }) => {
        const manualActive = options?.fromGps ? false : isManualMode

        if (isNearDefaultManualLocation(lat, lng) && (manualActive || !options?.fromGps)) {
            // Nunca almacenar el punto inicial por defecto en newLocationData.latlong
            feeRequestIdRef.current++
            setIsResolvingDeliveryFee(false)
            setFeeResolutionFailed(false)
            setIsInsideCoverage(false)
            setHasMovedPin(false)
            setNewLocationData(prev => ({ ...prev, latlong: '', tarifa: '0.00', sector: '' }))
            return
        }

        const latlong = `${lat}, ${lng}`
        setHasMovedPin(true)

        // Actualizar las coordenadas de inmediato (no esperar a la tarifa) para que el
        // mapa no "salte" a la posición anterior mientras se calcula
        setNewLocationData(prev => ({ ...prev, latlong }))

        const result = await resolveDeliveryFeeValue(lat, lng)
        if (!result) return

        setNewLocationData(prev => prev.latlong === latlong
            ? { ...prev, tarifa: result.tarifa, sector: result.sector }
            : prev
        )
    }, [isManualMode, resolveDeliveryFeeValue])

    // Función para obtener ubicación actual
    const getCurrentLocation = () => {
        setLocationPermissionError(null)
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            // Abrir mapa en modo manual SIN pre-guardar el punto inicial en latlong
            setIsManualMode(true)
            setHasMovedPin(false)
            setNewLocationData(prev => ({
                ...prev,
                latlong: '',
                tarifa: '0.00',
                sector: ''
            }));
            setLocationPermissionError('Geolocalización no soportada por el navegador.')
            return
        }

        if (isRequestingLocation) return

        const geoId = ++geoRequestIdRef.current
        setIsRequestingLocation(true)
        navigator.geolocation.getCurrentPosition(
            (position) => {
                // El modal se cerró o el cliente eligió modo manual mientras esperábamos
                if (geoId !== geoRequestIdRef.current) return
                setIsRequestingLocation(false)
                setIsManualMode(false)
                const { latitude, longitude } = position.coords
                setHasMovedPin(true)
                void handleLocationChange(latitude, longitude, { fromGps: true })
            },
            (error) => {
                if (geoId !== geoRequestIdRef.current) return
                console.error('Error getting location:', error);
                setIsRequestingLocation(false)
                setGpsAttempts(prev => prev + 1)
                if (error.code === error.PERMISSION_DENIED) {
                    setLocationPermissionError('Permiso de ubicación denegado.')
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    setLocationPermissionError('Ubicación no disponible. Verifica que el GPS esté activado.')
                } else if (error.code === error.TIMEOUT) {
                    setLocationPermissionError('Tiempo de espera agotado al obtener tu ubicación.')
                } else {
                    setLocationPermissionError('Error al obtener ubicación.')
                }
            },
            {
                // Sin timeout, algunos navegadores (WebViews de Instagram/Facebook, iOS) se quedan
                // esperando para siempre y el cliente nunca veía la opción manual
                enableHighAccuracy: true,
                timeout: GPS_TIMEOUT_MS,
                maximumAge: 30000
            }
        );
    }

    const handleManualLocation = () => {
        // Ignorar una respuesta de GPS que llegue después de elegir modo manual
        geoRequestIdRef.current++
        feeRequestIdRef.current++
        setIsRequestingLocation(false)
        setIsResolvingDeliveryFee(false)
        setFeeResolutionFailed(false)
        setIsManualMode(true)
        setHasMovedPin(false)
        // Mantener latlong vacío hasta que el cliente mueva el pin a una ubicación real
        setNewLocationData(prev => ({
            ...prev,
            latlong: '',
            tarifa: '0.00',
            sector: ''
        }))
        setLocationPermissionError(null)
    }

    // Memorizar las coordenadas reales seleccionadas por el cliente
    const mapCoordinates = useMemo(() => parseLatLong(newLocationData.latlong), [newLocationData.latlong]);

    const isAtDefaultManualPoint = Boolean(
        mapCoordinates && isNearDefaultManualLocation(mapCoordinates.lat, mapCoordinates.lng)
    )
    const isManualPinPending = (isManualMode && (!hasMovedPin || !mapCoordinates || isAtDefaultManualPoint)) || isAtDefaultManualPoint

    const handleReferenciaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setNewLocationData(prev => ({ ...prev, referencia: e.target.value }));
    }

    const handleEditLocation = async (e: React.MouseEvent, location: ClientLocation) => {
        e.stopPropagation();
        const isExistingAtDefault = isDefaultManualLatLong(location.latlong);
        setEditingLocation(location);
        setOpenMenuId(null);
        setIsAddingNewLocation(true);
        setIsManualMode(isExistingAtDefault);
        setHasMovedPin(!isExistingAtDefault);
        setGpsAttempts(0);
        setLocationPermissionError(null);
        setIsSubmitting(false);
        setNewLocationData({
            latlong: isExistingAtDefault ? '' : (location.latlong || ''),
            referencia: location.referencia || '',
            tarifa: isExistingAtDefault ? '0.00' : (location.tarifa || ''),
            sector: isExistingAtDefault ? '' : (location.sector || '')
        });
        setLocationImageFile(null);
        setLocationImagePreview(location.photo || '');

        if (location.latlong && !isExistingAtDefault) {
            try {
                const [lat, lng] = location.latlong.split(',').map(coord => parseFloat(coord.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                    const result = await resolveDeliveryFeeValue(lat, lng);
                    if (!result) return;
                    setNewLocationData(prev => prev.latlong === location.latlong
                        ? { ...prev, tarifa: result.tarifa, sector: result.sector }
                        : prev
                    );
                }
            } catch (error) {
                console.error('Error loading location details for edit:', error);
            }
        }
    }

    const handleSaveNewLocation = async () => {
        if (submittingRef.current) return;

        const parsedCoords = parseLatLong(newLocationData.latlong);
        if (
            !parsedCoords ||
            isNearDefaultManualLocation(parsedCoords.lat, parsedCoords.lng) ||
            (isManualMode && !hasMovedPin)
        ) {
            alert('Por favor mueve el pin en el mapa hasta tu dirección real. No puedes guardar la ubicación inicial por defecto.');
            return;
        }

        if (!clientId) {
            alert('No pudimos identificar tu cuenta. Completa tus datos (nombre y teléfono) y vuelve a intentarlo.');
            return;
        }

        const referencia = newLocationData.referencia.trim();
        if (!newLocationData.latlong || !referencia) {
            alert('Por favor ubica tu dirección en el mapa y escribe una referencia.');
            return;
        }

        submittingRef.current = true;
        setIsSubmitting(true);
        try {
            // La foto es opcional: si falla o tarda demasiado, guardar la ubicación sin foto
            let photoUrl = '';
            let photoFailed = false;
            if (locationImageFile) {
                try {
                    photoUrl = await uploadLocationPhoto(locationImageFile, clientId);
                } catch (photoError) {
                    console.warn('No se pudo subir la foto de referencia, se guarda sin foto:', photoError);
                    photoFailed = true;
                }
            }

            const sectorToSave = newLocationData.sector || 'Sin especificar';

            const locationId = await createClientLocation({
                id_cliente: clientId,
                latlong: newLocationData.latlong,
                referencia,
                tarifa: newLocationData.tarifa,
                sector: sectorToSave,
                createdBy: 'client',
                ...(photoUrl && { photo: photoUrl })
            });

            const newLocation: ClientLocation = {
                id: locationId,
                id_cliente: clientId,
                latlong: newLocationData.latlong,
                referencia,
                sector: sectorToSave,
                tarifa: newLocationData.tarifa,
                ...(photoUrl && { photo: photoUrl })
            };

            onLocationCreated(newLocation);
            setIsAddingNewLocation(false);

            if (photoFailed) {
                alert('Tu ubicación se guardó, pero no pudimos subir la foto por la conexión. Puedes agregarla luego editando la dirección.');
            }
        } catch (error) {
            console.error('❌ Error saving location:', error);
            alert('Error al guardar la ubicación. Revisa tu conexión e intenta de nuevo.');
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    }

    const handleUpdateExistingLocation = async () => {
        if (submittingRef.current) return;

        const parsedCoords = parseLatLong(newLocationData.latlong);
        if (!parsedCoords || isNearDefaultManualLocation(parsedCoords.lat, parsedCoords.lng) || (isManualMode && !hasMovedPin)) {
            alert('Por favor mueve el pin en el mapa hasta tu dirección real. No puedes guardar la ubicación inicial por defecto.');
            return;
        }

        const referencia = newLocationData.referencia.trim();
        if (!editingLocation || !newLocationData.latlong || !referencia) {
            alert('Por favor ubica tu dirección en el mapa y escribe una referencia.');
            return;
        }

        submittingRef.current = true;
        setIsSubmitting(true);
        // Si el usuario quitó la vista previa, se elimina la foto; si no, se conserva la anterior
        let photoUrl = locationImagePreview ? (editingLocation.photo || '') : '';
        let photoFailed = false;

        try {
            if (locationImageFile) {
                try {
                    photoUrl = await uploadLocationPhoto(locationImageFile, clientId);
                } catch (photoError) {
                    console.warn('No se pudo subir la nueva foto, se conserva la anterior:', photoError);
                    photoFailed = true;
                    // Nunca guardar la vista previa base64 en Firestore
                    photoUrl = editingLocation.photo || '';
                }
            }

            const sectorToSave = newLocationData.sector || editingLocation.sector || 'Sin especificar';

            await updateLocation(editingLocation.id, {
                latlong: newLocationData.latlong,
                referencia,
                tarifa: newLocationData.tarifa,
                sector: sectorToSave,
                photo: photoUrl
            });

            const updatedLocation: ClientLocation = {
                ...editingLocation,
                latlong: newLocationData.latlong,
                referencia,
                tarifa: newLocationData.tarifa,
                sector: sectorToSave,
                ...(photoUrl ? { photo: photoUrl } : {})
            };

            if (!photoUrl && 'photo' in updatedLocation) {
                delete updatedLocation.photo;
            }

            if (onLocationUpdated) {
                onLocationUpdated(updatedLocation);
            }

            exitLocationForm();

            if (photoFailed) {
                alert('Los cambios se guardaron, pero no pudimos subir la nueva foto por la conexión.');
            }
        } catch (error) {
            console.error('Error updating location:', error);
            alert('Error al actualizar la ubicación. Revisa tu conexión e intenta de nuevo.');
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    }

    const handleDeleteLocation = async (e: React.MouseEvent, locationId: string) => {
        e.stopPropagation();
        if (confirm('¿Estás seguro de eliminar esta ubicación?')) {
            try {
                await deleteLocation(locationId);
                if (onLocationDeleted) {
                    onLocationDeleted(locationId);
                }
                setOpenMenuId(null);
            } catch (error) {
                console.error('Error deleting location:', error);
                alert('Hubo un error al eliminar la ubicación');
            }
        }
    }

    const handleToggleFavorite = async (e: React.MouseEvent, location: ClientLocation) => {
        e.stopPropagation();
        try {
            const isFavorite = !location.isFavorite;

            // If we are setting a new favorite, remove favorite from any existing favorite
            if (isFavorite) {
                const currentFavorite = clientLocations.find(l => l.isFavorite && l.id !== location.id);
                if (currentFavorite) {
                    await updateLocation(currentFavorite.id, { isFavorite: false });
                    if (onLocationUpdated) {
                        onLocationUpdated({ ...currentFavorite, isFavorite: false });
                    }
                }
            }

            await updateLocation(location.id, { isFavorite });
            if (onLocationUpdated) {
                onLocationUpdated({ ...location, isFavorite });
            }
            setOpenMenuId(null);
        } catch (error) {
            console.error('Error toggling favorite:', error);
            alert('Hubo un error al actualizar la ubicación');
        }
    }

    const sortedLocations = useMemo(() => {
        return [...clientLocations]
            .filter(location => {
                // Filter out locations without valid coordinates
                if (!location.latlong) return false;
                
                try {
                    const [lat, lng] = location.latlong.split(',').map(coord => parseFloat(coord.trim()));
                    return !isNaN(lat) && !isNaN(lng);
                } catch {
                    return false;
                }
            })
            .sort((a, b) => {
                if (a.isFavorite && !b.isFavorite) return -1;
                if (!a.isFavorite && b.isFavorite) return 1;
                return 0;
            });
    }, [clientLocations]);

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

            <div className="relative bg-white w-full max-w-[450px] h-auto max-h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden transform transition-all">
                {/* Header */}
                <div className="px-6 pt-6 pb-4 bg-white border-b border-gray-100 shrink-0 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => (isAddingNewLocation && sortedLocations.length > 0) ? exitLocationForm() : onClose()}
                            className="p-2 -ml-2 text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            {isAddingNewLocation && sortedLocations.length > 0 ? (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                </svg>
                            ) : (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                        </button>
                        <h2 className="text-xl font-bold text-gray-900 leading-none">
                            {isAddingNewLocation ? (editingLocation ? 'Editar Ubicación' : 'Nueva Ubicación') : 'Seleccionar Ubicación'}
                        </h2>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-white p-6 scrollbar-hide">
                    {!isAddingNewLocation ? (
                        <div className="space-y-4">
                            {clientLocations.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-6 text-gray-300">
                                        <i className="bi bi-geo-alt text-4xl"></i>
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-2">Sin ubicaciones</h3>
                                    <p className="text-gray-500 max-w-[200px] text-sm leading-relaxed">
                                        Aún no tienes direcciones guardadas. ¡Agrega una para recibir tus pedidos!
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {sortedLocations.map((location) => {
                                        const isSelected = selectedLocationId === location.id || selectingLocationId === location.id;
                                        return (
                                        <div
                                            key={location.id}
                                            onClick={() => {
                                                setSelectingLocationId(location.id)
                                                onSelect(location)
                                            }}
                                            className={`group relative p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex gap-4 ${isSelected
                                                ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900 shadow-sm'
                                                : 'border-gray-100 bg-white hover:border-gray-300 hover:shadow-md'
                                                }`}
                                        >
                                            <div className="flex-shrink-0 pt-1">
                                                <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected
                                                    ? 'border-gray-900 bg-gray-900 text-white'
                                                    : 'border-gray-300 bg-white group-hover:border-gray-400'
                                                    }`}>
                                                    {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                                                </div>
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-gray-900 mb-1 leading-snug flex items-center gap-2">
                                                    {location.referencia}
                                                    {location.isFavorite && (
                                                        <i className="bi bi-star-fill text-yellow-400 text-sm"></i>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                                                    {(location.tarifa == null || Number(location.tarifa) <= 0) && (
                                                        <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                                                            Fuera de zona
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex-shrink-0 self-center flex items-center gap-2">
                                                {location.photo && (
                                                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-100 shadow-sm bg-gray-100">
                                                        <img
                                                            src={location.photo}
                                                            alt={`Foto de referencia de ${location.referencia}`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                )}
                                                <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                                                    <LocationMap latlong={location.latlong} height="100%" />
                                                </div>
                                            </div>

                                            <div className="absolute top-2 right-2 flex flex-col items-end">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuId(openMenuId === location.id ? null : location.id);
                                                    }}
                                                    className="p-1 text-gray-400 hover:text-gray-900 bg-white rounded-full hover:bg-gray-100 transition-colors shadow-sm"
                                                >
                                                    <i className="bi bi-three-dots-vertical"></i>
                                                </button>

                                                {openMenuId === location.id && (
                                                    <div className="absolute top-8 right-0 bg-white rounded-xl shadow-lg border border-gray-100 py-2 w-36 z-20">
                                                        <button
                                                            onClick={(e) => handleEditLocation(e, location)}
                                                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 flex items-center gap-2 transition-colors"
                                                        >
                                                            <i className="bi bi-pencil-square"></i>
                                                            Editar
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleToggleFavorite(e, location)}
                                                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 flex items-center gap-2 transition-colors"
                                                        >
                                                            <i className={`bi ${location.isFavorite ? 'bi-star-fill text-yellow-400' : 'bi-star'}`}></i>
                                                            {location.isFavorite ? 'Quitar Fav.' : 'Favorito'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDeleteLocation(e, location.id)}
                                                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                                                        >
                                                            <i className="bi bi-trash"></i>
                                                            Eliminar
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Map View */}
                            <div>
                                <label className="block text-sm font-bold text-gray-900 mb-2">
                                    Ubicación en el mapa
                                </label>
                                <div className={`rounded-2xl overflow-hidden shadow-sm border bg-gray-50 h-[220px] relative transition-all ${
                                    isManualPinPending
                                        ? 'border-amber-400 ring-2 ring-amber-200/70'
                                        : (isManualMode && !editingLocation && !isManualPinPending)
                                            ? 'border-emerald-400'
                                            : 'border-gray-200'
                                }`}>

                                    {(mapCoordinates || isManualMode) ? (
                                        <>
                                            <GoogleMap
                                                latitude={mapCoordinates ? mapCoordinates.lat : DEFAULT_MANUAL_LAT}
                                                longitude={mapCoordinates ? mapCoordinates.lng : DEFAULT_MANUAL_LNG}
                                                height="100%"
                                                width="100%"
                                                zoom={16}
                                                marker={isManualMode ? (pinMovementMode === 'pin') : true}
                                                draggable={isManualMode ? (pinMovementMode === 'pin') : false}
                                                fixedCenterMarker={isManualMode && pinMovementMode === 'map'}
                                                pinNeedsMove={isManualPinPending}
                                                onLocationChange={handleLocationChange}
                                            />
                                            {/* Selector de modo para mover el pin / mover el mapa */}
                                            {isManualMode && (
                                                <button
                                                    type="button"
                                                    onClick={() => setPinMovementMode(prev => prev === 'map' ? 'pin' : 'map')}
                                                    title={pinMovementMode === 'pin' ? 'Cambiar a modo: mover mapa' : 'Cambiar a modo: mover pin'}
                                                    className="absolute top-2.5 left-2.5 z-20 bg-white/95 hover:bg-white text-gray-800 backdrop-blur-md px-2.5 py-1.5 rounded-xl shadow-md border border-gray-200/90 text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer select-none"
                                                >
                                                    {pinMovementMode === 'pin' ? (
                                                        <>
                                                            <i className="bi bi-geo-alt-fill text-red-500 text-sm"></i>
                                                            <span className="hidden xs:inline">Mover pin</span>
                                                            <i className="bi bi-arrow-left-right text-[10px] text-gray-400"></i>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <i className="bi bi-arrows-move text-indigo-600 text-sm"></i>
                                                            <span className="hidden xs:inline">Mover mapa</span>
                                                            <i className="bi bi-arrow-left-right text-[10px] text-gray-400"></i>
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                            {isManualPinPending && (
                                                <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none max-w-[62%]">
                                                    <div className="bg-amber-600/95 backdrop-blur-sm text-white text-[11px] font-bold py-1.5 px-2.5 rounded-xl shadow-lg flex items-center gap-1.5 border border-white/20 animate-pulse">
                                                        <i className={`bi ${pinMovementMode === 'pin' ? 'bi-hand-index-thumb' : 'bi-arrows-move'} text-xs shrink-0`}></i>
                                                        <span className="truncate">
                                                            {pinMovementMode === 'pin' ? 'Mueve el pin a tu dirección' : 'Mueve el mapa a tu dirección'}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {isManualMode && !editingLocation && !isManualPinPending && (
                                                <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none">
                                                    <div className="bg-emerald-600/90 backdrop-blur-sm text-white text-[11px] font-semibold py-1 px-2.5 rounded-lg shadow flex items-center gap-1.5 border border-white/20">
                                                        <i className="bi bi-check-circle-fill"></i>
                                                        <span>Ubicación fijada</span>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => {
                                                e.preventDefault()
                                                getCurrentLocation()
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    getCurrentLocation()
                                                }
                                            }}
                                            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-6 text-center hover:bg-gray-100 transition-colors cursor-pointer"
                                        >
                                            <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-3 text-gray-400">
                                                <i className="bi bi-crosshair text-xl"></i>
                                            </div>
                                            <span className="font-bold text-gray-900 mb-1">Activar ubicación</span>
                                            <span className="text-xs text-gray-500 px-4">
                                                Toca aquí para localizarte automáticamente en el mapa
                                            </span>
                                            {isRequestingLocation && (
                                                <span className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-full">
                                                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                                    Obteniendo ubicación...
                                                </span>
                                            )}
                                            {/* Siempre disponible: si el GPS no responde (permiso ignorado, WebView sin GPS) el cliente no queda atrapado */}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleManualLocation()
                                                }}
                                                className={`mt-4 font-bold text-sm py-2.5 px-5 rounded-xl transition-all transform active:scale-95 ${(gpsAttempts >= 1 || locationPermissionError)
                                                    ? 'bg-gray-900 text-white shadow shadow-black/20 hover:bg-black'
                                                    : 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50'
                                                    }`}
                                            >
                                                <i className="bi bi-map mr-2"></i>
                                                Buscar manualmente
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {locationPermissionError && !isManualMode && (
                                    <p className="mt-4 text-xs text-red-500 font-medium px-2 py-3 bg-red-50 rounded-lg flex items-start gap-2 border border-red-100">
                                        <i className="bi bi-exclamation-circle-fill text-red-500 mt-0.5"></i>
                                        <span>
                                            {locationPermissionError}
                                            <span className="block mt-1 text-gray-700">Asegúrate de conceder permisos de GPS en tu navegador o intenta buscar manualmente.</span>
                                        </span>
                                    </p>
                                )}
                            </div>

                            {/* Delivery Fee Status */}
                            {(newLocationData.latlong || isManualMode) && (
                                isManualPinPending ? (
                                    <div className="p-3.5 rounded-xl border bg-amber-50 border-amber-200">
                                        <div className="flex items-center gap-2">
                                            <i className="bi bi-geo-alt-fill text-amber-600 text-sm"></i>
                                            <span className="text-sm font-bold text-amber-900">
                                                Mueve el pin a tu dirección real
                                            </span>
                                        </div>
                                        <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                            {pinMovementMode === 'pin'
                                                ? 'El mapa inicia en un punto de referencia y no se puede guardar ahí. Arrastra el pin o toca el mapa en tu dirección exacta.'
                                                : 'El mapa inicia en un punto de referencia y no se puede guardar ahí. Arrastra el mapa hasta ubicar el pin en tu dirección exacta.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className={`p-3.5 rounded-xl border ${!isInsideCoverage
                                        ? 'bg-amber-50 border-amber-100'
                                        : 'bg-green-50 border-green-100'
                                        }`}>
                                        <div className="flex justify-between items-center">
                                            {isResolvingDeliveryFee ? (
                                                <span className="inline-flex items-center gap-2 text-sm font-bold text-gray-700">
                                                    <span className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin"></span>
                                                    Calculando tarifa de envío...
                                                </span>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-sm font-bold ${!isInsideCoverage
                                                        ? 'text-amber-800'
                                                        : 'text-green-800'
                                                        }`}>
                                                        Tarifa de envío: ${newLocationData.tarifa}
                                                    </span>
                                                    {isInsideCoverage ? (
                                                        <i className="bi bi-check-circle-fill text-green-600 text-sm"></i>
                                                    ) : (
                                                        <i className="bi bi-exclamation-triangle-fill text-amber-600 text-sm"></i>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {!isInsideCoverage && !isResolvingDeliveryFee && (
                                            <p className="text-xs text-amber-700 mt-1">
                                                {feeResolutionFailed
                                                    ? 'No pudimos calcular la tarifa por la conexión. Puedes guardar la dirección; la tarifa se recalculará al confirmar.'
                                                    : 'Tu ubicación parece estar fuera de nuestra zona principal. Revisaremos la tarifa al confirmar.'}
                                            </p>
                                        )}
                                    </div>
                                )
                            )}

                            {/* Reference Textarea */}
                            <div>
                                <label className="block text-sm font-bold text-gray-900 mb-2">
                                    Referencia / Descripción del lugar *
                                </label>
                                <textarea
                                    value={newLocationData.referencia}
                                    onChange={handleReferenciaChange}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all font-medium text-gray-900 placeholder:text-gray-400"
                                    placeholder="Ej: Casa blanca de dos pisos, frente al parque..."
                                    rows={3}
                                    required
                                />
                            </div>

                            {/* Photo Upload */}
                            <div>
                                <label className="block text-sm font-bold text-gray-900 mb-2">
                                    Foto de referencia (opcional)
                                </label>
                                <div className="relative">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                setLocationImageFile(file);
                                                const reader = new FileReader();
                                                reader.onloadend = () => {
                                                    setLocationImagePreview(reader.result as string);
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        }}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all font-medium text-gray-900 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-900 file:text-white hover:file:bg-gray-800"
                                    />
                                </div>
                                {locationImagePreview && (
                                    <div className="mt-3 relative w-32 h-32 rounded-xl overflow-hidden shadow-sm border border-gray-200">
                                        <img src={locationImagePreview} alt="Preview" className="w-full h-full object-cover" />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setLocationImageFile(null);
                                                setLocationImagePreview('');
                                            }}
                                            className="absolute top-2 right-2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 backdrop-blur-sm transition-colors shadow"
                                        >
                                            <i className="bi bi-x text-lg leading-none"></i>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-gray-100 bg-white">
                    {!isAddingNewLocation ? (
                        <div className="flex gap-3">
                            <button
                                className="flex-1 bg-white border border-gray-200 text-gray-700 py-3.5 rounded-xl hover:bg-gray-50 transition-all font-bold text-sm shadow-sm"
                                onClick={onClose}
                            >
                                Cancelar
                            </button>
                            <button
                                className="flex-1 bg-gray-900 text-white py-3.5 rounded-xl hover:bg-gray-800 transition-all font-bold text-sm shadow-lg shadow-gray-200 flex items-center justify-center gap-2 transform active:scale-[0.98]"
                                onClick={() => {
                                    setEditingLocation(null);
                                    setIsAddingNewLocation(true);
                                    getCurrentLocation();
                                }}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                                </svg>
                                Nueva Dirección
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <button
                                className="flex-1 bg-white border border-gray-200 text-gray-700 py-3.5 rounded-xl hover:bg-gray-50 transition-all font-bold text-sm shadow-sm"
                                onClick={() => sortedLocations.length > 0 ? exitLocationForm() : onClose()}
                            >
                                Cancelar
                            </button>
                            {(() => {
                                const canSave = Boolean(
                                    mapCoordinates &&
                                    !isSubmitting &&
                                    !isResolvingDeliveryFee &&
                                    !isManualPinPending &&
                                    newLocationData.referencia.trim().length > 0
                                );

                                return (
                                    <button
                                        className={`flex-[2] py-3.5 rounded-xl transition-all font-bold text-sm shadow-lg flex items-center justify-center transform active:scale-[0.98] ${canSave
                                            ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-gray-200'
                                            : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                            }`}
                                        onClick={canSave ? (editingLocation ? handleUpdateExistingLocation : handleSaveNewLocation) : (e) => e.preventDefault()}
                                        disabled={!canSave}
                                    >
                                        {isSubmitting ? (
                                            <div className="flex items-center gap-2">
                                                <span className="w-5 h-5 rounded-full border-2 border-gray-400 border-t-gray-600 animate-spin"></span>
                                                <span>Guardando...</span>
                                            </div>
                                        ) : isManualPinPending ? (
                                            <span className="flex items-center gap-1.5 text-xs sm:text-sm">
                                                <i className={`bi ${pinMovementMode === 'pin' ? 'bi-geo-alt' : 'bi-arrows-move'}`}></i>
                                                {pinMovementMode === 'pin' ? 'Mueve el pin en el mapa' : 'Mueve el mapa'}
                                            </span>
                                        ) : (
                                            <span>{editingLocation ? 'Guardar Cambios' : 'Guardar y Seleccionar'}</span>
                                        )}
                                    </button>
                                );
                            })()}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
