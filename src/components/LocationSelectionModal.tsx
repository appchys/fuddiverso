import { useState, useMemo, useCallback, useEffect } from 'react'
import { GoogleMap } from './GoogleMap'
import LocationMap from './LocationMap'
import { ClientLocation, createClientLocation, getDeliveryFeeForLocation, deleteLocation, updateLocation } from '@/lib/database'
import { isInstagramBrowser, getDeviceType, openInExternalBrowser } from '@/lib/instagram-detect'

interface NewLocationData {
    latlong: string
    referencia: string
    tarifa: string
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
    onLocationUpdated
}: LocationSelectionModalProps) {
    // Estado local para controlar si estamos seleccionando o agregando
    const [isAddingNewLocation, setIsAddingNewLocation] = useState(initialAddingState)
    const [isInInstagram, setIsInInstagram] = useState(false)
    const [deviceType, setDeviceType] = useState<'android' | 'ios' | 'desktop'>('desktop')
    const [openMenuId, setOpenMenuId] = useState<string | null>(null)
    const [newLocationData, setNewLocationData] = useState<NewLocationData>({ latlong: '', referencia: '', tarifa: '1' })
    const [isRequestingLocation, setIsRequestingLocation] = useState(false)
    const [locationPermissionError, setLocationPermissionError] = useState<string | null>(null)
    const [gpsAttempts, setGpsAttempts] = useState(0)
    const [isManualMode, setIsManualMode] = useState(false)

    useEffect(() => {
        setIsInInstagram(isInstagramBrowser())
        setDeviceType(getDeviceType())
    }, [])

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
            setIsManualMode(false)
            setGpsAttempts(0)
            setLocationPermissionError(null)
            setNewLocationData({ latlong: '', referencia: '', tarifa: '1' })
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [isOpen])

    useEffect(() => {
        if (!isAddingNewLocation) {
            setIsManualMode(false)
            setGpsAttempts(0)
            setLocationPermissionError(null)
            setNewLocationData({ latlong: '', referencia: '', tarifa: '1' })
        }
    }, [isAddingNewLocation])

    // Si entramos con initialAddingState true, nos aseguramos de que el estado lo refleje
    // Pero solo si el modal se acaba de abrir (esto podría requerir un useEffect si el prop cambia)

    // Helper para calcular tarifa
    const calculateDeliveryFee = async ({ lat, lng }: { lat: number; lng: number }) => {
        try {
            if (!businessId) return 0
            const fee = await getDeliveryFeeForLocation({ lat, lng }, businessId)
            return fee
        } catch (error) {
            console.error('Error calculating delivery fee:', error)
            return 0
        }
    }

    // Función para obtener ubicación actual
    const getCurrentLocation = () => {
        setLocationPermissionError(null)
        if (navigator.geolocation) {
            setIsRequestingLocation(true)
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    const latlong = `${latitude}, ${longitude}`

                    let tarifa = '1'
                    // Calcular tarifa inicial
                    if (businessId) {
                        const fee = await calculateDeliveryFee({ lat: latitude, lng: longitude })
                        const normalizedFee = fee === 0 ? 1.5 : fee
                        tarifa = normalizedFee.toFixed(2)
                    }

                    setNewLocationData(prev => ({
                        ...prev,
                        latlong,
                        tarifa
                    }));
                    setIsRequestingLocation(false)
                },
                (error) => {
                    console.error('Error getting location:', error);
                    setIsRequestingLocation(false)
                    setGpsAttempts(prev => prev + 1)
                    if (error.code === error.PERMISSION_DENIED) {
                        setLocationPermissionError('Permiso de ubicación denegado.')
                    } else if (error.code === error.POSITION_UNAVAILABLE) {
                        setLocationPermissionError('Ubicación no disponible.')
                    } else if (error.code === error.TIMEOUT) {
                        setLocationPermissionError('Tiempo de espera agotado.')
                    } else {
                        setLocationPermissionError('Error al obtener ubicación.')
                    }
                }
            );
        } else {
            // Coordenadas por defecto si no hay geolocalización
            setIsManualMode(true)
            setNewLocationData(prev => ({
                ...prev,
                latlong: '-1.861971, -79.978529'
            }));
            setLocationPermissionError('Geolocalización no soportada por el navegador.')
        }
    }

    const handleManualLocation = () => {
        setIsManualMode(true)
        setNewLocationData(prev => ({
            ...prev,
            latlong: '-1.861971, -79.978529'
        }))
        setLocationPermissionError(null)
    }

    // Función para manejar cambio de ubicación en el mapa
    const handleLocationChange = useCallback(async (lat: number, lng: number) => {
        let tarifa = '1'
        if (businessId) {
            const fee = await calculateDeliveryFee({ lat, lng })
            const normalizedFee = fee === 0 ? 1.5 : fee
            tarifa = normalizedFee.toFixed(2)
        }

        setNewLocationData(prev => ({
            ...prev,
            latlong: `${lat}, ${lng}`,
            tarifa
        }));
    }, [businessId]);

    // Memorizar las coordenadas del mapa
    const mapCoordinates = useMemo(() => {
        if (!newLocationData.latlong) return null;
        try {
            const [lat, lng] = newLocationData.latlong.split(',').map(coord => parseFloat(coord.trim()));
            if (isNaN(lat) || isNaN(lng)) return null;
            return { lat, lng };
        } catch {
            return null;
        }
    }, [newLocationData.latlong]);

    const handleReferenciaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setNewLocationData(prev => ({ ...prev, referencia: e.target.value }));
    }

    const handleSaveNewLocation = async () => {
        if (!clientId || !newLocationData.latlong || !newLocationData.referencia) {
            alert('Por favor completa todos los campos requeridos');
            return;
        }

        try {
            const locationId = await createClientLocation({
                id_cliente: clientId,
                latlong: newLocationData.latlong,
                referencia: newLocationData.referencia,
                tarifa: newLocationData.tarifa,
                sector: 'Sin especificar',
                createdBy: 'client'
            });

            const newLocation: ClientLocation = {
                id: locationId,
                id_cliente: clientId,
                latlong: newLocationData.latlong,
                referencia: newLocationData.referencia,
                sector: 'Sin especificar',
                tarifa: newLocationData.tarifa
            };

            onLocationCreated(newLocation);
            setNewLocationData({ latlong: '', referencia: '', tarifa: '1' }); // Reset
            setIsAddingNewLocation(false); // Volver a la lista o cerrar? El padre cierra el modal al seleccionar
        } catch (error) {
            console.error('❌ Error saving location:', error);
            alert('Error al guardar la ubicación. Por favor intenta de nuevo.');
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
        return [...clientLocations].sort((a, b) => {
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
                            onClick={() => isAddingNewLocation ? setIsAddingNewLocation(false) : onClose()}
                            className="p-2 -ml-2 text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            {isAddingNewLocation ? (
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
                            {isAddingNewLocation ? 'Nueva Ubicación' : 'Seleccionar Ubicación'}
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
                                    {sortedLocations.map((location) => (
                                        <div
                                            key={location.id}
                                            onClick={() => onSelect(location)}
                                            className={`group relative p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex gap-4 ${selectedLocationId === location.id
                                                ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900 shadow-sm'
                                                : 'border-gray-100 bg-white hover:border-gray-300 hover:shadow-md'
                                                }`}
                                        >
                                            <div className="flex-shrink-0 pt-1">
                                                <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${selectedLocationId === location.id
                                                    ? 'border-gray-900 bg-gray-900 text-white'
                                                    : 'border-gray-300 bg-white group-hover:border-gray-400'
                                                    }`}>
                                                    {selectedLocationId === location.id && <div className="w-2 h-2 bg-white rounded-full" />}
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
                                                    <span className="px-2 py-0.5 bg-gray-100 rounded-md border border-gray-200">
                                                        ${location.tarifa} Envío
                                                    </span>
                                                    {(location.tarifa == null || Number(location.tarifa) <= 0) && (
                                                        <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                                                            Fuera de zona
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex-shrink-0 self-center w-16 h-16 rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                                                <LocationMap latlong={location.latlong} height="100%" />
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
                                    ))}
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
                                <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-200 bg-gray-50 h-[220px] relative">
                                    {/* Advertencia para Instagram - Diseño Premium */}
                                    {isInInstagram && !mapCoordinates && (
                                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-white/95 backdrop-blur-sm">
                                            <div className="w-20 h-20 bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] rounded-3xl flex items-center justify-center mb-6 text-white shadow-xl rotate-3 animate-pulse">
                                                <i className="bi bi-instagram text-4xl"></i>
                                            </div>
                                            <h4 className="text-xl font-black text-gray-900 mb-3 tracking-tight">¡Espera un momento! 🛑</h4>
                                            <p className="text-sm text-gray-600 mb-6 px-4 leading-relaxed font-medium text-balance">
                                                GPS bloqueado por <b>Instagram</b>.
                                            </p>

                                            {deviceType === 'android' ? (
                                                <button
                                                    onClick={() => openInExternalBrowser()}
                                                    className="w-full bg-gray-900 text-white font-bold py-4 px-8 rounded-2xl shadow-lg hover:bg-black transition-all flex items-center justify-center gap-3 transform active:scale-95"
                                                >
                                                    <i className="bi bi-box-arrow-up-right text-lg"></i>
                                                    Abrir en navegador
                                                </button>
                                            ) : deviceType === 'ios' ? (
                                                <div className="w-full bg-blue-50 border border-blue-100 p-4 rounded-2xl shadow-sm">
                                                    <p className="text-sm text-blue-700 leading-snug">
                                                        Toca los <i className="bi bi-three-dots text-lg align-middle mx-1"></i> en la esquina superior y selecciona <b>"Abrir en navegador externo"</b>.
                                                    </p>
                                                </div>
                                            ) : null}

                                            <button
                                                onClick={() => setIsInInstagram(false)} // Permitir continuar bajo su propio riesgo
                                                className="mt-6 text-sm text-gray-400 hover:text-gray-900 font-bold uppercase tracking-wider transition-colors"
                                            >
                                                Continuar aquí de todos modos
                                            </button>
                                        </div>
                                    )}

                                    {mapCoordinates ? (
                                        <GoogleMap
                                            latitude={mapCoordinates.lat}
                                            longitude={mapCoordinates.lng}
                                            height="100%"
                                            width="100%"
                                            zoom={16}
                                            marker={!isManualMode}
                                            draggable={!isManualMode}
                                            fixedCenterMarker={isManualMode}
                                            onLocationChange={handleLocationChange}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                getCurrentLocation()
                                            }}
                                            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-6 text-center hover:bg-gray-100 transition-colors"
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
                                            {gpsAttempts >= 2 && !isRequestingLocation && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        handleManualLocation()
                                                    }}
                                                    className="mt-6 font-bold text-sm bg-gray-900 text-white py-3 px-6 rounded-xl shadow hover:bg-black transition-all shadow-black/20 transform active:scale-95"
                                                >
                                                    <i className="bi bi-map mr-2"></i>
                                                    Buscar manualmente
                                                </button>
                                            )}
                                        </button>
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
                            {newLocationData.latlong && (
                                <div className={`p-4 rounded-xl border ${Number(newLocationData.tarifa) === 1.5 || Number(newLocationData.tarifa) <= 0
                                    ? 'bg-amber-50 border-amber-100'
                                    : 'bg-green-50 border-green-100'
                                    }`}>
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`text-sm font-bold ${Number(newLocationData.tarifa) === 1.5 || Number(newLocationData.tarifa) <= 0
                                            ? 'text-amber-800'
                                            : 'text-green-800'
                                            }`}>
                                            Tarifa de envío: ${newLocationData.tarifa}
                                        </span>
                                    </div>
                                    <p className={`text-xs ${Number(newLocationData.tarifa) === 1.5 || Number(newLocationData.tarifa) <= 0
                                        ? 'text-amber-700'
                                        : 'text-green-700'
                                        }`}>
                                        {Number(newLocationData.tarifa) === 1.5 || Number(newLocationData.tarifa) <= 0
                                            ? 'Tu ubicación parece estar fuera de nuestra zona principal. Revisaremos la tarifa al confirmar.'
                                            : '¡Genial! Estás dentro de nuestra zona de cobertura.'}
                                    </p>
                                </div>
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
                                onClick={() => setIsAddingNewLocation(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                className={`flex-[2] py-3.5 rounded-xl transition-all font-bold text-sm shadow-lg flex items-center justify-center transform active:scale-[0.98] ${mapCoordinates
                                    ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-gray-200'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                    }`}
                                onClick={mapCoordinates ? handleSaveNewLocation : (e) => e.preventDefault()}
                                disabled={!mapCoordinates}
                            >
                                Confirmar Ubicación
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
