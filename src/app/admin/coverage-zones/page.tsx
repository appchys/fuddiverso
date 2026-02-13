'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { GoogleMap, useJsApiLoader, Polygon, Marker } from '@react-google-maps/api'
import { getCoverageZones, createCoverageZone, updateCoverageZone, deleteCoverageZone, getAllDeliveries, getActiveOrdersWithLocations, getBusiness, updateOrder } from '@/lib/database'
import { CoverageZone, Delivery, Order, Business } from '@/types'

// Define libraries as a constant outside the component to prevent reloading
const GOOGLE_MAPS_LIBRARIES: ("drawing" | "geometry" | "places" | "visualization")[] = ["drawing", "geometry"]

const defaultCenter = {
  lat: -2.1709979,
  lng: -79.9224426 // Guayaquil, Ecuador
}

export default function CoverageZonesPage() {
  const [zones, setZones] = useState<CoverageZone[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedZone, setSelectedZone] = useState<CoverageZone | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    deliveryFee: 0,
    isActive: true,
    assignedDeliveryId: '', // Legacy - mantener para compatibilidad
    assignedDeliveryIds: [] as string[] // Nuevo: múltiples deliveries
  })
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [mapCenter, setMapCenter] = useState(defaultCenter)
  const [businesses, setBusinesses] = useState<Map<string, Business>>(new Map())
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'upcoming'>('today')
  const [currentPolygon, setCurrentPolygon] = useState<{ lat: number; lng: number }[]>([])
  const [markers, setMarkers] = useState<{ lat: number; lng: number }[]>([])
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })

  // New states for the restructured layout
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs',
    libraries: GOOGLE_MAPS_LIBRARIES
  })

  const [map, setMap] = useState<google.maps.Map | null>(null)

  useEffect(() => {
    loadZones()
    loadDeliveries()
    loadActiveOrders()

    // Recargar órdenes cada 30 segundos
    const interval = setInterval(() => {
      loadActiveOrders()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const loadZones = async () => {
    try {
      setLoading(true)
      const zonesData = await getCoverageZones()
      setZones(zonesData)
    } catch (error) {
      console.error('Error loading zones:', error)
      showNotification('Error al cargar las zonas', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadDeliveries = async () => {
    try {
      const deliveriesData = await getAllDeliveries()
      setDeliveries(deliveriesData.filter(d => d.estado === 'activo'))
    } catch (error) {
      console.error('Error loading deliveries:', error)
    }
  }

  const loadActiveOrders = async () => {
    try {
      const orders = await getActiveOrdersWithLocations()
      setActiveOrders(orders)

      // Cargar información de negocios para los pedidos
      const businessIds = Array.from(new Set(orders.map(o => o.businessId)))
      const businessMap = new Map<string, Business>()

      await Promise.all(
        businessIds.map(async (id) => {
          try {
            const business = await getBusiness(id)
            if (business) businessMap.set(id, business)
          } catch (e) {
            console.error(`Error loading business ${id}:`, e)
          }
        })
      )

      setBusinesses(businessMap)
      console.log(`[CoverageZones] Loaded ${orders.length} active orders and ${businessMap.size} businesses`)
    } catch (error) {
      console.error('Error loading active orders:', error)
    }
  }

  // Helper: Obtener emoji según estado del pedido
  const getStatusEmoji = (status: string): string => {
    const emojiMap: Record<string, string> = {
      'pending': '⏳',
      'confirmed': '✅',
      'preparing': '👨‍🍳',
      'ready': '📦',
      'on_way': '🛵',
      'delivered': '✔️'
    }
    return emojiMap[status] || '📍'
  }

  // Helper: Formatear hora de entrega
  const formatDeliveryTime = (order: Order): string => {
    if (order.timing.type === 'scheduled' && order.timing.scheduledTime) {
      return order.timing.scheduledTime
    }
    return 'Inmediato'
  }

  // Helper: Obtener nombre del delivery
  const getDeliveryName = (order: Order): string => {
    if (!order.delivery.assignedDelivery) return 'Sin asignar'
    const delivery = deliveries.find(d => d.id === order.delivery.assignedDelivery)
    return delivery?.nombres || 'Delivery'
  }

  // Helper: Obtener nombre del negocio
  const getBusinessName = (order: Order): string => {
    const business = businesses.get(order.businessId)
    return business?.name || 'Tienda'
  }

  // Manejar cambio de delivery
  const handleDeliveryChange = async (orderId: string, newDeliveryId: string) => {
    try {
      await updateOrder(orderId, {
        delivery: {
          ...activeOrders.find(o => o.id === orderId)?.delivery,
          assignedDelivery: newDeliveryId
        }
      } as any)

      // Actualizar el estado local
      setActiveOrders(prev => prev.map(order =>
        order.id === orderId
          ? { ...order, delivery: { ...order.delivery, assignedDelivery: newDeliveryId } }
          : order
      ))

      // Actualizar selectedOrder si es el que se modificó
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? {
          ...prev,
          delivery: { ...prev.delivery, assignedDelivery: newDeliveryId }
        } : null)
      }

      showNotification('Delivery asignado correctamente', 'success')
    } catch (error) {
      console.error('Error updating delivery:', error)
      showNotification('Error al asignar delivery', 'error')
    }
  }

  // Manejar cambio de estado
  const handleStatusChange = async (orderId: string, newStatus: 'delivered' | 'cancelled') => {
    try {
      await updateOrder(orderId, {
        status: newStatus,
        deliveredAt: newStatus === 'delivered' ? new Date() : undefined
      } as any)

      // Remover del estado local ya que no es más un pedido activo
      setActiveOrders(prev => prev.filter(order => order.id !== orderId))
      setSelectedOrder(null)

      showNotification(
        newStatus === 'delivered' ? 'Pedido marcado como entregado' : 'Pedido cancelado',
        'success'
      )
    } catch (error) {
      console.error('Error updating status:', error)
      showNotification('Error al actualizar estado', 'error')
    }
  }

  // Helper: Formatear fecha del pedido (prioriza timing)
  const formatOrderDate = (order: Order): string => {
    const timing = order.timing
    const scheduledDate = timing?.scheduledDate

    if (scheduledDate) {
      let scheduledDateStr = ''

      if (typeof scheduledDate === 'string') {
        scheduledDateStr = scheduledDate
      } else if (scheduledDate instanceof Date) {
        scheduledDateStr = scheduledDate.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
      } else if (scheduledDate && typeof scheduledDate === 'object') {
        if ('toDate' in (scheduledDate as any)) {
          scheduledDateStr = (scheduledDate as any).toDate().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
        } else if ('seconds' in (scheduledDate as any)) {
          const d = new Date((scheduledDate as any).seconds * 1000)
          scheduledDateStr = d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
        }
      }

      if (scheduledDateStr) {
        const todayStr = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
        const timeStr = timing.scheduledTime || ''

        if (scheduledDateStr === todayStr) {
          return `Hoy ${timeStr}`.trim()
        }
        return `${scheduledDateStr} ${timeStr}`.trim()
      }
    }

    // Si es inmediato, mostrar la fecha de creación
    const date = order.createdAt
    if (!date) return 'Sin fecha'

    const dateObj = date instanceof Date ? date : new Date(date)
    const today = new Date()
    const isToday = dateObj.toDateString() === today.toDateString()

    if (isToday) {
      return `Hoy ${dateObj.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}`
    }

    return dateObj.toLocaleDateString('es-EC', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Filtrar pedidos según la fecha seleccionada
  const filteredOrders = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return activeOrders.filter(order => {
      let orderDate: Date | null = null;
      const timing = order.timing;
      const scheduledDate = timing?.scheduledDate;

      if (scheduledDate) {
        if (scheduledDate instanceof Date) {
          orderDate = scheduledDate;
        } else if (scheduledDate && typeof scheduledDate === 'object') {
          if ('toDate' in (scheduledDate as any)) {
            orderDate = (scheduledDate as any).toDate();
          } else if ('seconds' in (scheduledDate as any)) {
            orderDate = new Date((scheduledDate as any).seconds * 1000);
          }
        } else if (typeof scheduledDate === 'string') {
          const dateStr = scheduledDate as string;
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            orderDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
          }
        }
      }

      if (!orderDate) {
        orderDate = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
      }

      if (!orderDate) return false;

      const d = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());

      if (dateFilter === 'today') {
        return d.getTime() === today.getTime();
      } else if (dateFilter === 'yesterday') {
        return d.getTime() === yesterday.getTime();
      } else if (dateFilter === 'upcoming') {
        return d.getTime() >= tomorrow.getTime();
      }
      return true;
    });
  }, [activeOrders, dateFilter]);

  // Auto-centrar mapa en pedidos filtrados
  useEffect(() => {
    if (!map || filteredOrders.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();
    let hasValidCoordinates = false;

    filteredOrders.forEach(order => {
      if (order.delivery.latlong && !order.delivery.latlong.startsWith('pluscode:')) {
        const [lat, lng] = order.delivery.latlong.split(',').map(Number);
        if (!isNaN(lat) && !isNaN(lng)) {
          bounds.extend({ lat, lng });
          hasValidCoordinates = true;
        }
      }
    });

    if (hasValidCoordinates) {
      map.fitBounds(bounds);

      // Ajustar zoom si solo hay un pedido
      if (filteredOrders.length === 1) {
        const listener = window.google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
          const currentZoom = map.getZoom();
          if (currentZoom && currentZoom > 15) {
            map.setZoom(15);
          }
        });
      }
    }
  }, [map, filteredOrders]);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type })
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' })
    }, 3000)
  }

  // Función para manejar clics en el mapa
  const handleMapClick = useCallback((event: google.maps.MapMouseEvent) => {
    if (!isDrawingMode || !event.latLng) return

    const lat = event.latLng.lat()
    const lng = event.latLng.lng()
    const newPoint = { lat, lng }

    setMarkers(prev => [...prev, newPoint])
    setCurrentPolygon(prev => [...prev, newPoint])
  }, [isDrawingMode])

  // Función para iniciar modo dibujo
  const startDrawing = () => {
    setIsDrawingMode(true)
    setMarkers([])
    setCurrentPolygon([])
  }

  // Función para terminar el dibujo
  const finishDrawing = () => {
    setIsDrawingMode(false)
    if (markers.length >= 3) {
      // Cerrar el polígono conectando el último punto con el primero
      setCurrentPolygon([...markers])
    } else {
      showNotification('Necesitas al menos 3 puntos para crear un polígono', 'error')
      setMarkers([])
      setCurrentPolygon([])
    }
  }

  // Función para limpiar el dibujo
  const clearDrawing = () => {
    setIsDrawingMode(false)
    setMarkers([])
    setCurrentPolygon([])
  }

  const handleSaveZone = async () => {
    if (!formData.name.trim()) {
      showNotification('El nombre de la zona es requerido', 'error')
      return
    }

    if (currentPolygon.length < 3) {
      showNotification('Se requieren al menos 3 puntos para formar un polígono válido', 'error')
      return
    }

    try {
      // Determinar estrategia basada en cantidad de deliveries
      const strategy = formData.assignedDeliveryIds.length > 1 ? 'round-robin' : 'single';

      if (selectedZone) {
        // Actualizar zona existente
        await updateCoverageZone(selectedZone.id, {
          name: formData.name,
          deliveryFee: formData.deliveryFee,
          isActive: formData.isActive,
          assignedDeliveryId: formData.assignedDeliveryIds[0] || undefined, // Legacy
          assignedDeliveryIds: formData.assignedDeliveryIds,
          deliveryAssignmentStrategy: strategy,
          lastAssignedIndex: 0, // Resetear al actualizar
          polygon: currentPolygon
        })
        showNotification('Zona actualizada correctamente', 'success')
      } else {
        // Crear nueva zona
        await createCoverageZone({
          name: formData.name,
          deliveryFee: formData.deliveryFee,
          isActive: formData.isActive,
          assignedDeliveryId: formData.assignedDeliveryIds[0] || undefined, // Legacy
          assignedDeliveryIds: formData.assignedDeliveryIds,
          deliveryAssignmentStrategy: strategy,
          lastAssignedIndex: 0,
          polygon: currentPolygon
        })
        showNotification('Zona creada correctamente', 'success')
      }

      loadZones()
      resetForm()
      setModalOpen(false)
    } catch (error) {
      console.error('Error saving zone:', error)
      showNotification('Error al guardar la zona', 'error')
    }
  }

  const handleDeleteZone = async (zoneId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta zona?')) {
      return
    }

    try {
      await deleteCoverageZone(zoneId)
      showNotification('Zona eliminada correctamente', 'success')
      loadZones()
      if (selectedZone?.id === zoneId) {
        resetForm()
        setModalOpen(false)
      }
    } catch (error) {
      console.error('Error deleting zone:', error)
      showNotification('Error al eliminar la zona', 'error')
    }
  }

  const resetForm = () => {
    setSelectedZone(null)
    setFormData({
      name: '',
      deliveryFee: 0,
      isActive: true,
      assignedDeliveryId: '',
      assignedDeliveryIds: []
    })
    setCurrentPolygon([])
    setMarkers([])
    setIsDrawingMode(false)
  }

  const startCreating = () => {
    resetForm()
    setModalOpen(true)
  }

  const editZone = (zone: CoverageZone) => {
    setSelectedZone(zone)
    setFormData({
      name: zone.name,
      deliveryFee: zone.deliveryFee,
      isActive: zone.isActive,
      assignedDeliveryId: zone.assignedDeliveryId || '',
      assignedDeliveryIds: zone.assignedDeliveryIds || (zone.assignedDeliveryId ? [zone.assignedDeliveryId] : [])
    })
    setCurrentPolygon(zone.polygon)
    setMarkers(zone.polygon)
    setIsDrawingMode(false)
    setModalOpen(true)

    // Center map on zone
    if (map && zone.polygon.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      zone.polygon.forEach(point => bounds.extend(point))
      map.fitBounds(bounds, 100)
    }
  }

  const removePoint = (index: number) => {
    const newPoints = [...markers]
    newPoints.splice(index, 1)
    setMarkers(newPoints)
    setCurrentPolygon(newPoints)
  }

  const handleMarkerDrag = useCallback((index: number, latLng: google.maps.LatLng) => {
    const lat = latLng.lat()
    const lng = latLng.lng()
    const newPoint = { lat, lng }

    setMarkers(prev => {
      const next = [...prev]
      next[index] = newPoint
      return next
    })
    setCurrentPolygon(prev => {
      const next = [...prev]
      next[index] = newPoint
      return next
    })
  }, [])

  const handlePolygonClick = useCallback((event: google.maps.MapMouseEvent) => {
    if (!modalOpen || isDrawingMode || !event.latLng || currentPolygon.length < 2) return

    const clickLatLng = event.latLng
    let bestIndex = -1
    let minExcess = Infinity

    // Encontrar el borde más cercano al clic
    for (let i = 0; i < currentPolygon.length; i++) {
      const p1 = currentPolygon[i]
      const p2 = currentPolygon[(i + 1) % currentPolygon.length]

      const pos1 = new google.maps.LatLng(p1.lat, p1.lng)
      const pos2 = new google.maps.LatLng(p2.lat, p2.lng)

      // Calcular la distancia total p1 -> clic -> p2
      const d12 = google.maps.geometry.spherical.computeDistanceBetween(pos1, pos2)
      const d1c = google.maps.geometry.spherical.computeDistanceBetween(pos1, clickLatLng)
      const dc2 = google.maps.geometry.spherical.computeDistanceBetween(clickLatLng, pos2)

      // El "exceso" nos dice qué tan cerca del segmento está el clic
      const excess = (d1c + dc2) - d12
      if (excess < minExcess) {
        minExcess = excess
        bestIndex = i + 1
      }
    }

    // Si el clic está razonablemente cerca de una línea (ej. menos de 50 metros de "exceso")
    // O si simplemente hacemos clic en el polígono, insertamos el punto
    if (bestIndex !== -1) {
      const newPoint = { lat: clickLatLng.lat(), lng: clickLatLng.lng() }
      const newPath = [...currentPolygon]
      newPath.splice(bestIndex, 0, newPoint)
      setMarkers(newPath)
      setCurrentPolygon(newPath)
    }
  }, [modalOpen, isDrawingMode, currentPolygon])

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map)
  }, [])

  const onUnmount = useCallback(() => {
    setMap(null)
  }, [])

  const closeModal = () => {
    setModalOpen(false)
    resetForm()
  }

  if (loading) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-300">Cargando zonas de cobertura...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900 overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-300"
            title={sidebarOpen ? 'Ocultar panel' : 'Mostrar panel'}
          >
            <i className={`bi ${sidebarOpen ? 'bi-layout-sidebar-inset' : 'bi-layout-sidebar'} text-xl`}></i>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-white">Zonas de Cobertura</h1>
            <p className="text-xs text-gray-400">{zones.length} zona{zones.length !== 1 ? 's' : ''} configurada{zones.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-700 p-1 rounded-lg mr-2">
            <button
              onClick={() => setDateFilter('yesterday')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${dateFilter === 'yesterday'
                ? 'bg-gray-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
            >
              Ayer
            </button>
            <button
              onClick={() => setDateFilter('today')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${dateFilter === 'today'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
            >
              Hoy
            </button>
            <button
              onClick={() => setDateFilter('upcoming')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${dateFilter === 'upcoming'
                ? 'bg-gray-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
                }`}
            >
              Próximos
            </button>
          </div>
          <button
            onClick={startCreating}
            className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 flex items-center gap-2 transition-colors"
          >
            <i className="bi bi-plus-circle"></i>
            Nueva Zona
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside
          className={`${sidebarOpen ? 'w-80' : 'w-0'} bg-gray-800 border-r border-gray-700 transition-all duration-300 overflow-hidden shrink-0 z-10`}
        >
          <div className="w-80 h-full flex flex-col">
            {/* Sidebar header */}
            <div className="p-4 border-b border-gray-700">
              <div className="relative">
                <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                <input
                  type="text"
                  placeholder="Buscar zona..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            {/* Zones list */}
            <div className="flex-1 overflow-y-auto">
              {zones.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-700 flex items-center justify-center">
                    <i className="bi bi-geo text-3xl text-gray-500"></i>
                  </div>
                  <p className="text-gray-400 font-medium">No hay zonas configuradas</p>
                  <p className="text-sm text-gray-500 mt-1">Crea tu primera zona para comenzar</p>
                  <button
                    onClick={startCreating}
                    className="mt-4 text-red-400 hover:text-red-300 text-sm font-medium"
                  >
                    + Crear zona
                  </button>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {zones.map((zone) => (
                    <div
                      key={zone.id}
                      className={`group p-3 rounded-lg cursor-pointer transition-all ${selectedZone?.id === zone.id
                        ? 'bg-red-500/20 border border-red-500/50'
                        : 'hover:bg-gray-700/50 border border-transparent'
                        }`}
                      onClick={() => editZone(zone)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${zone.isActive ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                            <h3 className="font-medium text-white truncate">{zone.name}</h3>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
                            <span>${zone.deliveryFee.toFixed(2)}</span>
                            <span>•</span>
                            <span>{zone.polygon.length} puntos</span>
                          </div>
                          {/* Deliveries asignados */}
                          {zone.assignedDeliveryIds && zone.assignedDeliveryIds.length > 0 ? (
                            <div className="mt-2 space-y-1">
                              {zone.assignedDeliveryIds.length > 1 && (
                                <span className="inline-flex items-center text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/50 mb-1">
                                  <i className="bi bi-arrow-repeat mr-1"></i>
                                  Round Robin
                                </span>
                              )}
                              <div className="flex items-center gap-1 flex-wrap">
                                {zone.assignedDeliveryIds.slice(0, 2).map((deliveryId) => {
                                  const delivery = deliveries.find(d => d.id === deliveryId);
                                  if (!delivery) return null;
                                  return (
                                    <div key={deliveryId} className="flex items-center gap-1 bg-gray-700/50 rounded px-1.5 py-0.5">
                                      {delivery.fotoUrl ? (
                                        <img
                                          src={delivery.fotoUrl}
                                          alt=""
                                          className="w-4 h-4 rounded-full object-cover"
                                        />
                                      ) : (
                                        <div className="w-4 h-4 rounded-full bg-gray-600 flex items-center justify-center">
                                          <i className="bi bi-person text-gray-400 text-xs"></i>
                                        </div>
                                      )}
                                      <span className="text-xs text-gray-400 truncate max-w-[80px]">
                                        {delivery.nombres.split(' ')[0]}
                                      </span>
                                    </div>
                                  );
                                })}
                                {zone.assignedDeliveryIds.length > 2 && (
                                  <span className="text-xs text-gray-500">
                                    +{zone.assignedDeliveryIds.length - 2}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : zone.assignedDeliveryId ? (
                            <div className="mt-2 flex items-center gap-2">
                              {deliveries.find(d => d.id === zone.assignedDeliveryId)?.fotoUrl ? (
                                <img
                                  src={deliveries.find(d => d.id === zone.assignedDeliveryId)?.fotoUrl}
                                  alt=""
                                  className="w-5 h-5 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center">
                                  <i className="bi bi-person text-gray-400 text-xs"></i>
                                </div>
                              )}
                              <span className="text-xs text-gray-400 truncate">
                                {deliveries.find(d => d.id === zone.assignedDeliveryId)?.nombres || 'Delivery'}
                              </span>
                            </div>
                          ) : (
                            <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                              <i className="bi bi-person-dash"></i>
                              <span>Sin delivery</span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteZone(zone.id)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition-all"
                          title="Eliminar zona"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar footer with help */}
            <div className="p-4 border-t border-gray-700 bg-gray-800/50">
              <div className="text-xs text-gray-500 space-y-1">
                <p><i className="bi bi-info-circle mr-1"></i> Haz clic en una zona para editarla</p>
                <p><i className="bi bi-hand-index mr-1"></i> Arrastra los puntos para ajustar</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Map container */}
        <div className="flex-1 relative">
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={mapCenter}
              zoom={12}
              onLoad={onLoad}
              onUnmount={onUnmount}
              onClick={handleMapClick}
              options={{
                streetViewControl: false,
                mapTypeControl: true,
                fullscreenControl: true,
                zoomControl: true,
                styles: [
                  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
                  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
                  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
                  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
                  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
                  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
                  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
                ]
              }}
            >
              {/* Mostrar todas las zonas existentes */}
              {zones.map((zone) => (
                <Polygon
                  key={zone.id}
                  paths={zone.polygon}
                  options={{
                    fillColor: selectedZone?.id === zone.id ? '#ef4444' : '#3b82f6',
                    fillOpacity: selectedZone?.id === zone.id ? 0.4 : 0.2,
                    strokeColor: selectedZone?.id === zone.id ? '#ef4444' : '#3b82f6',
                    strokeOpacity: 1,
                    strokeWeight: selectedZone?.id === zone.id ? 3 : 2
                  }}
                />
              ))}

              {/* Mostrar marcadores del polígono en edición */}
              {modalOpen && markers.map((marker, index) => (
                <Marker
                  key={`point-${index}`}
                  position={marker}
                  draggable={true}
                  onDrag={(e) => e.latLng && handleMarkerDrag(index, e.latLng)}
                  onDragEnd={(e) => e.latLng && handleMarkerDrag(index, e.latLng)}
                  icon={{
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="14" cy="14" r="12" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
                        <text x="14" y="18" text-anchor="middle" fill="white" font-family="Arial" font-size="11" font-weight="bold">${index + 1}</text>
                      </svg>
                    `),
                    scaledSize: new window.google.maps.Size(28, 28)
                  }}
                />
              ))}

              {/* Mostrar polígono actual en tiempo real */}
              {modalOpen && currentPolygon.length > 2 && (
                <Polygon
                  paths={currentPolygon}
                  onClick={handlePolygonClick}
                  options={{
                    fillColor: '#ef4444',
                    fillOpacity: 0.35,
                    strokeColor: '#ef4444',
                    strokeOpacity: 1,
                    strokeWeight: 3,
                    clickable: true
                  }}
                />
              )}

              {/* Marcadores de pedidos activos */}
              {filteredOrders.map((order) => {
                if (!order.delivery.latlong) return null;
                const [lat, lng] = order.delivery.latlong.split(',').map(Number);
                if (isNaN(lat) || isNaN(lng)) return null;

                const statusEmoji = getStatusEmoji(order.status);
                const isSelected = selectedOrder?.id === order.id;

                return (
                  <Marker
                    key={`order-${order.id}`}
                    position={{ lat, lng }}
                    onClick={() => setSelectedOrder(order)}
                    icon={{
                      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                      <svg width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 0 C9 0 0 9 0 20 C0 28 8 38 20 50 C32 38 40 28 40 20 C40 9 31 0 20 0 Z" 
                          fill="${isSelected ? '#ef4444' : '#3b82f6'}" stroke="#ffffff" stroke-width="2"/>
                        <text x="20" y="26" text-anchor="middle" font-size="20">${statusEmoji}</text>
                      </svg>
                    `),
                      scaledSize: new window.google.maps.Size(40, 50),
                      anchor: new window.google.maps.Point(20, 50)
                    }}
                  />
                );
              })}

              {/* InfoWindow para pedido seleccionado */}
              {selectedOrder && selectedOrder.delivery.latlong && (() => {
                const [lat, lng] = selectedOrder.delivery.latlong.split(',').map(Number);
                if (isNaN(lat) || isNaN(lng)) return null;

                return (
                  <div
                    style={{
                      position: 'absolute',
                      transform: `translate(-50%, -100%)`,
                      left: '50%',
                      top: '50%',
                      zIndex: 1000
                    }}
                  >
                    <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-700 p-4 min-w-[280px] max-w-sm">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{getStatusEmoji(selectedOrder.status)}</span>
                          <div>
                            <h3 className="font-semibold text-white text-sm">
                              {getBusinessName(selectedOrder)}
                            </h3>
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedOrder.status}
                                onChange={(e) => {
                                  const newStatus = e.target.value as 'delivered' | 'cancelled'
                                  if (newStatus === 'delivered' || newStatus === 'cancelled') {
                                    if (confirm(`¿Marcar pedido como ${newStatus === 'delivered' ? 'entregado' : 'cancelado'}?`)) {
                                      handleStatusChange(selectedOrder.id, newStatus)
                                    }
                                  }
                                }}
                                className="text-xs text-gray-300 bg-gray-700 rounded px-2 py-0.5 border border-gray-600 focus:border-blue-400 focus:outline-none capitalize"
                              >
                                <option value={selectedOrder.status} disabled>
                                  {selectedOrder.status.replace('_', ' ')}
                                </option>
                                <option value="delivered">✔️ Entregado</option>
                                <option value="cancelled">❌ Cancelado</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedOrder(null)}
                          className="text-gray-400 hover:text-white transition-colors"
                        >
                          <i className="bi bi-x-lg"></i>
                        </button>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-gray-300">
                          <i className="bi bi-calendar text-orange-400"></i>
                          <span className="font-medium">Fecha:</span>
                          <span>{formatOrderDate(selectedOrder)}</span>
                        </div>

                        <div className="flex items-center gap-2 text-gray-300">
                          <i className="bi bi-clock text-blue-400"></i>
                          <span className="font-medium">Hora:</span>
                          <span>{formatDeliveryTime(selectedOrder)}</span>
                        </div>

                        <div className="flex items-start gap-2 text-gray-300">
                          <i className="bi bi-scooter text-green-400 mt-1"></i>
                          <div className="flex-1">
                            <span className="font-medium block mb-1">Delivery:</span>
                            <select
                              value={selectedOrder.delivery.assignedDelivery || ''}
                              onChange={(e) => handleDeliveryChange(selectedOrder.id, e.target.value)}
                              className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-green-400 focus:outline-none"
                            >
                              <option value="">Sin asignar</option>
                              {deliveries.map(d => (
                                <option key={d.id} value={d.id}>
                                  {d.nombres}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-gray-300">
                          <i className="bi bi-person text-purple-400"></i>
                          <span className="font-medium">Cliente:</span>
                          <span className="truncate">{selectedOrder.customer.name}</span>
                        </div>

                        <div className="flex items-center gap-2 text-gray-300">
                          <i className="bi bi-cash text-yellow-400"></i>
                          <span className="font-medium">Total:</span>
                          <span className="font-semibold">${selectedOrder.total.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </GoogleMap>
          ) : loadError ? (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <div className="text-center max-w-md px-8">
                <i className="bi bi-exclamation-triangle text-5xl text-red-400 mb-4"></i>
                <h3 className="text-xl font-medium text-white mb-2">Error al cargar Google Maps</h3>
                <p className="text-gray-400 mb-4">No se pudo cargar la API de Google Maps.</p>
                <div className="bg-gray-700/50 rounded-lg p-4 text-left">
                  <p className="text-sm text-gray-300 mb-2 font-medium">Posibles soluciones:</p>
                  <ul className="text-xs text-gray-400 space-y-1">
                    <li>• Verifica que la API key esté configurada</li>
                    <li>• Asegúrate de tener permisos para Maps JavaScript API</li>
                    <li>• Verifica tu conexión a internet</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
                <p className="text-gray-400">Cargando mapa...</p>
              </div>
            </div>
          )}

          {/* Drawing mode instructions overlay */}
          {isDrawingMode && (
            <div className="absolute top-4 left-4 bg-gray-800/95 backdrop-blur-sm p-4 rounded-xl shadow-2xl border border-gray-700 max-w-sm animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                  <i className="bi bi-pencil-fill text-blue-400"></i>
                </div>
                <div>
                  <p className="font-semibold text-white">Modo Dibujo Activo</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Haz clic en el mapa para colocar puntos. Necesitas mínimo 3 puntos.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                      {markers.length} punto{markers.length !== 1 ? 's' : ''}
                    </span>
                    {markers.length >= 3 && (
                      <span className="text-xs text-green-400">
                        <i className="bi bi-check-circle mr-1"></i>Listo para guardar
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Editing mode instructions overlay */}
          {modalOpen && !isDrawingMode && markers.length > 0 && (
            <div className="absolute top-4 left-4 bg-gray-800/95 backdrop-blur-sm p-4 rounded-xl shadow-2xl border border-gray-700 max-w-sm animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <i className="bi bi-arrows-move text-green-400"></i>
                </div>
                <div>
                  <p className="font-semibold text-white">Modo Edición</p>
                  <ul className="text-sm text-gray-400 mt-1 space-y-1">
                    <li>• Arrastra los puntos para moverlos</li>
                    <li>• Clic en línea para añadir punto</li>
                  </ul>
                  <span className="inline-block mt-2 px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                    {markers.length} puntos
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Empty state overlay */}
          {!modalOpen && zones.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                  <i className="bi bi-geo text-4xl text-gray-500"></i>
                </div>
                <h3 className="text-xl font-medium text-white mb-2">Sin zonas configuradas</h3>
                <p className="text-gray-400 mb-4">Crea tu primera zona de cobertura</p>
                <button
                  onClick={startCreating}
                  className="bg-red-500 text-white px-6 py-3 rounded-lg hover:bg-red-600 transition-colors"
                >
                  <i className="bi bi-plus-circle mr-2"></i>
                  Crear zona
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal for creating/editing zones */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pointer-events-none">
          {/* Modal panel - positioned on the right */}
          <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-96 max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col pointer-events-auto animate-in slide-in-from-right-4 fade-in">
            {/* Modal header */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between shrink-0">
              <h3 className="text-lg font-semibold text-white">
                {selectedZone ? 'Editar Zona' : 'Nueva Zona'}
              </h3>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Zone name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Nombre de la zona *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Ej: Centro Norte, Samborondón..."
                />
              </div>

              {/* Delivery fee */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Tarifa de envío ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.deliveryFee}
                  onChange={(e) => setFormData({ ...formData, deliveryFee: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="0.00"
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-gray-300">Zona activa</span>
                <button
                  onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                  className={`relative w-12 h-6 rounded-full transition-colors ${formData.isActive ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${formData.isActive ? 'translate-x-6' : ''
                      }`}
                  ></span>
                </button>
              </div>

              {/* Delivery assignment - Multiple selection */}
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-300">
                    <i className="bi bi-scooter mr-2"></i>
                    Deliveries asignados
                  </label>
                  {formData.assignedDeliveryIds.length > 1 && (
                    <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/50">
                      <i className="bi bi-arrow-repeat mr-1"></i>
                      Round Robin
                    </span>
                  )}
                </div>

                {deliveries.length === 0 ? (
                  <div className="p-3 bg-gray-700/30 rounded-lg text-center text-sm text-gray-400">
                    No hay deliveries activos disponibles
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {deliveries.map((delivery) => {
                      const isSelected = formData.assignedDeliveryIds.includes(delivery.id);
                      return (
                        <label
                          key={delivery.id}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${isSelected
                            ? 'bg-red-500/20 border border-red-500/50'
                            : 'bg-gray-700/30 border border-gray-600 hover:bg-gray-700/50'
                            }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  assignedDeliveryIds: [...formData.assignedDeliveryIds, delivery.id]
                                });
                              } else {
                                setFormData({
                                  ...formData,
                                  assignedDeliveryIds: formData.assignedDeliveryIds.filter(id => id !== delivery.id)
                                });
                              }
                            }}
                            className="w-4 h-4 text-red-500 bg-gray-700 border-gray-600 rounded focus:ring-red-500 focus:ring-2"
                          />
                          {delivery.fotoUrl ? (
                            <img
                              src={delivery.fotoUrl}
                              alt={delivery.nombres}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
                              <i className="bi bi-person text-gray-400"></i>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{delivery.nombres}</p>
                            <p className="text-xs text-gray-400">{delivery.celular}</p>
                          </div>
                          {isSelected && (
                            <i className="bi bi-check-circle-fill text-red-400"></i>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                {formData.assignedDeliveryIds.length > 0 && (
                  <div className="mt-3 p-3 bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">
                        {formData.assignedDeliveryIds.length} delivery{formData.assignedDeliveryIds.length !== 1 ? 's' : ''} seleccionado{formData.assignedDeliveryIds.length !== 1 ? 's' : ''}
                      </span>
                      {formData.assignedDeliveryIds.length > 1 && (
                        <span className="text-blue-400 text-xs">
                          Los pedidos se asignarán por turnos
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Drawing controls */}
              <div className="border-t border-gray-700 pt-4">
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Área de cobertura
                </label>
                <div className="flex gap-2">
                  {!isDrawingMode ? (
                    <button
                      onClick={startDrawing}
                      className="flex-1 bg-blue-500/20 text-blue-400 border border-blue-500/50 px-3 py-2 text-sm rounded-lg hover:bg-blue-500/30 transition-colors"
                    >
                      <i className="bi bi-pencil mr-2"></i>
                      {currentPolygon.length > 0 ? 'Redibujar' : 'Dibujar'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={finishDrawing}
                        disabled={markers.length < 3}
                        className="flex-1 bg-green-500/20 text-green-400 border border-green-500/50 px-3 py-2 text-sm rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <i className="bi bi-check-circle mr-1"></i>
                        Terminar
                      </button>
                      <button
                        onClick={clearDrawing}
                        className="bg-red-500/20 text-red-400 border border-red-500/50 px-3 py-2 text-sm rounded-lg hover:bg-red-500/30 transition-colors"
                      >
                        <i className="bi bi-x-circle"></i>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Points list */}
              {currentPolygon.length > 0 && (
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">
                      <i className="bi bi-geo-alt mr-1"></i>
                      {currentPolygon.length} puntos
                    </span>
                    <span className="text-xs text-green-400">
                      <i className="bi bi-check-circle mr-1"></i>Polígono válido
                    </span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {currentPolygon.map((point, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between text-xs py-1 px-2 rounded bg-gray-700/50 group"
                      >
                        <span className="text-gray-400">
                          <span className="text-white font-medium">{index + 1}.</span>{' '}
                          {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                        </span>
                        <button
                          onClick={() => removePoint(index)}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentPolygon.length === 0 && !isDrawingMode && (
                <div className="bg-gray-700/30 rounded-lg p-4 text-center">
                  <i className="bi bi-geo text-2xl text-gray-500 mb-2"></i>
                  <p className="text-sm text-gray-400">
                    Usa el botón "Dibujar" para definir el área de cobertura en el mapa
                  </p>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="p-4 border-t border-gray-700 flex gap-3 shrink-0">
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-2 text-gray-300 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveZone}
                disabled={!formData.name.trim() || currentPolygon.length < 3}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                {selectedZone ? 'Actualizar' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {notification.show && (
        <div className={`fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          } text-white animate-in slide-in-from-bottom-4 fade-in`}>
          <div className="flex items-center gap-2">
            <i className={`bi ${notification.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'}`}></i>
            {notification.message}
          </div>
        </div>
      )}
    </div>
  )
}
