import { Order, Business } from '@/types'

// Avanzar estado al siguiente en la cadena lógica
export const getNextStatus = (status: Order['status']): Order['status'] | null => {
    const flow: Order['status'][] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered']
    const idx = flow.indexOf(status)
    if (idx === -1) return null
    if (idx >= flow.length - 1) return null
    return flow[idx + 1]
}
// Helper para formatear la fecha programada
const formatScheduledDate = (timing: Order['timing']): string => {
    if (timing?.type !== 'scheduled') return '⚡ Inmediato';

    const time = timing.scheduledTime || '';

    // Si no hay fecha, mantener comportamiento anterior
    if (!timing.scheduledDate) {
        return `⏰ Programado para las ${time}`;
    }

    let date: Date;
    const rawDate = timing.scheduledDate as any;

    // Manejar diferentes formatos de fecha
    if (typeof rawDate.toDate === 'function') {
        // Firestore Timestamp instance
        date = rawDate.toDate();
    } else if (rawDate.seconds !== undefined) {
        // Firestore Timestamp plain object (serialized)
        date = new Date(rawDate.seconds * 1000);
    } else if (rawDate instanceof Date) {
        // Native Date object
        date = rawDate;
    } else {
        // Fallback (string o timestamp numérico)
        date = new Date(rawDate);
    }

    // Verificar si la fecha es válida
    if (isNaN(date.getTime())) {
        return `⏰ Programado para las ${time}`;
    }

    const now = new Date();
    // Normalizar a inicio del día para comparación
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (checkDate.getTime() === today.getTime()) {
        return `⏰ Programado para hoy a las ${time}`;
    } else if (checkDate.getTime() === tomorrow.getTime()) {
        return `⏰ Programado para mañana a las ${time}`;
    } else {
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return `⏰ Programado para:\n${date.getDate()} de ${months[date.getMonth()]} a las ${time}`;
    }
}
// Función unificada para enviar mensajes de WhatsApp al delivery o tienda
export const sendWhatsAppToDelivery = async (
    order: Order,
    availableDeliveries: any[],
    business: Business | null,
    onStatusUpdate?: (orderId: string, newStatus: Order['status']) => Promise<void>,
    updateLocalOrder?: (updatedOrder: Order) => void
) => {
    // Calcular el siguiente estado para usarlo si es necesario
    let nextStatus: Order['status'] | null = null;
    if (order.status !== 'ready' && onStatusUpdate && updateLocalOrder) {
        nextStatus = getNextStatus(order.status);
    }

    let phone = ''
    let title = ''

    if (order.delivery.type === 'delivery') {
        // Para delivery, enviar al delivery asignado
        const assignedDeliveryId = order.delivery?.assignedDelivery || (order.delivery as any)?.selectedDelivery
        if (!assignedDeliveryId) {
            alert('Este pedido no tiene un delivery asignado')
            return
        }

        const delivery = availableDeliveries.find(d => d.id === assignedDeliveryId)
        if (!delivery) {
            alert('No se encontró la información del delivery')
            return
        }

        phone = delivery.celular
        title = 'Enviar mensaje de WhatsApp al delivery'
    } else {
        // Para retiro, enviar al número de la tienda
        if (!business?.phone) {
            alert('No se encontró el número de teléfono de la tienda')
            return
        }

        phone = business.phone
        title = 'Enviar mensaje de WhatsApp a la tienda'
    }

    // Construir el mensaje de WhatsApp
    const customerName = order.customer?.name || 'Cliente sin nombre'
    const customerPhone = order.customer?.phone || 'Sin teléfono'
    const references = order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'

    // Crear enlace de Google Maps si hay coordenadas o Plus Code (solo para delivery)
    let locationLink = ''
    if (order.delivery.type === 'delivery') {
        if (order.delivery?.latlong) {
            const cleanCoords = order.delivery.latlong.replace(/\s+/g, '')
            // Verificar si es un Plus Code
            if (cleanCoords.startsWith('pluscode:')) {
                const plusCode = cleanCoords.replace('pluscode:', '')
                // Usar el formato de lugar para mejor compatibilidad con WhatsApp
                locationLink = `https://www.google.com/maps/place/${encodeURIComponent(plusCode)}`
            } else if (cleanCoords.includes(',')) {
                // Es una coordenada tradicional
                locationLink = `https://www.google.com/maps/place/${cleanCoords}`
            } else {
                // Si no es ninguno de los anteriores, intentar como búsqueda directa
                locationLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanCoords)}`
            }
        } else if (order.delivery?.mapLocation) {
            // Para compatibilidad con mapLocation existente
            locationLink = `https://www.google.com/maps/place/${order.delivery.mapLocation.lat},${order.delivery.mapLocation.lng}`
        }
    }

    // Construir lista de productos con cantidades entre paréntesis
    const productsList = order.items?.map((item: any) =>
        `(${item.quantity || 1}) ${item.variant || item.name || item.product?.name || 'Producto'}`
    ).join('\n') || 'Sin productos'

    // Calcular totales
    const deliveryCost = order.delivery.type === 'delivery' ? (order.delivery?.deliveryCost || 1) : 0
    const subtotal = order.total - deliveryCost
    const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' :
        order.payment?.method === 'transfer' ? 'Transferencia' :
            order.payment?.method === 'mixed' ? 'Pago Mixto' : 'Sin especificar'

    // Determinar el tipo de pedido (Inmediato o Programado)
    const orderType = formatScheduledDate(order.timing);

    // Construir mensaje
    let message = `*Pedido de ${business?.name || 'Tienda'}*${business?.phone ? ` - ${business.phone}` : ''}\n\n`

    message += `*Datos del cliente*\n`
    message += `Cliente: ${customerName}\n`
    message += `Celular: ${customerPhone}\n\n`

    if (order.delivery.type === 'delivery') {
        message += `*Detalles de la entrega*\n`
        message += `${orderType}\n`
        message += `Referencias: ${references}\n`
        if (locationLink) {
            message += `Ubicación: ${locationLink}\n\n`
        } else {
            message += `\n`
        }
    } else {
        message += `*Tipo de entrega*\n`
        message += `🏪 Retiro en tienda\n`
        message += `${orderType}\n\n`
    }

    message += `*Detalle del pedido*\n`
    message += `${productsList}\n\n`

    message += `*Detalles del pago*\n`
    message += `Valor del pedido: $${subtotal.toFixed(2)}\n`

    if (order.delivery.type === 'delivery') {
        message += `Envío: $${deliveryCost.toFixed(2)}\n\n`
    } else {
        message += `\n`
    }

    // Mostrar detalles de pago mixto si aplica
    if (order.payment?.method === 'mixed') {
        const payment = order.payment as any
        message += `🏦 Transferencia: $${(payment.transferAmount || 0).toFixed(2)}\n`
        message += `💵 *Cobrar:* $${(payment.cashAmount || 0).toFixed(2)}`
    } else if (order.payment?.method === 'cash') {
        // Solo mostrar "Total a cobrar" si es efectivo
        message += `💵 *Cobrar:* $${order.total.toFixed(2)}`
    } else if (order.payment?.method === 'transfer') {
        message += `🏦 Transferencia`
    }


    // Limpiar el número de teléfono (quitar espacios, guiones, etc.)
    const cleanPhone = phone.replace(/\D/g, '')

    // Crear enlace de WhatsApp
    const whatsappUrl = `https://api.whatsapp.com/send?phone=593${cleanPhone.startsWith('0') ? cleanPhone.slice(1) : cleanPhone}&text=${encodeURIComponent(message)}`

    // Abrir WhatsApp Web - PRIMERO abrir, luego hacer operaciones async
    window.open(whatsappUrl, '_blank')

    // Ahora sí realizar las actualizaciones de estado si corresponde
    if (nextStatus && onStatusUpdate && updateLocalOrder) {
        try {
            await onStatusUpdate(order.id, nextStatus);
            // Actualizar el estado local de la orden para reflejar el cambio
            const updatedOrder = { ...order, status: nextStatus };
            updateLocalOrder(updatedOrder);
        } catch (error) {
            console.error('Error al avanzar el estado del pedido:', error);
        }
    }
}

// Enviar Whatsapp al cliente (número del cliente)
export const sendWhatsAppToCustomer = (order: Order) => {
    const customerPhoneRaw = order.customer?.phone || ''
    const customerName = order.customer?.name || 'Cliente'

    if (!customerPhoneRaw) {
        alert('No se encontró el número del cliente')
        return
    }

    // Normalizar y limpiar número
    const cleanPhone = customerPhoneRaw.replace(/\D/g, '')
    if (!cleanPhone) {
        alert('Número de cliente inválido')
        return
    }

    // Construir breve mensaje con detalles del pedido
    const productsList = order.items?.map((item: any) => `${item.quantity} x ${item.variant || item.name || item.product?.name || 'Producto'}`).join('\n') || 'Sin productos'
    const deliveryInfo = order.delivery?.type === 'delivery' ? `${order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}` : 'Retiro en tienda'
    const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : order.payment?.method === 'transfer' ? 'Transferencia' : order.payment?.method === 'mixed' ? 'Pago Mixto' : 'Sin especificar'

    // Calcular subtotal (total de productos sin envío)
    const subtotal = order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0)

    // Determinar el tipo de pedido (Inmediato o Programado)
    const orderType = formatScheduledDate(order.timing);

    // Construir mensaje en texto plano y luego aplicar encodeURIComponent al final
    const initialMessage = order.timing?.type === 'scheduled'
        ? 'Tu pedido está agendado!'
        : 'Tu pedido está en preparación!';
    let message = `${initialMessage}\n\n`;
    message += `*Dirección:*\n${deliveryInfo}\n\n`;
    message += `*Tipo de entrega:*\n${orderType}\n\n`;
    message += `Detalle del pedido:\n${productsList}\n\n`;
    message += `Subtotal: $${subtotal.toFixed(2)}\n`;
    if (order.delivery?.type === 'delivery') {
        message += `Envío: $${(order.delivery?.deliveryCost || 0).toFixed(2)}\n`;
    }

    message += '\n';

    // Solo mostrar total si es pago en efectivo
    if (order.payment?.method === 'cash' || order.payment?.method === 'mixed') {
        message += `*Total:* $${(order.total || 0).toFixed(2)}\n\n`;
    }

    message += `Forma de pago: ${paymentMethod}\n`;

    // Agregar enlace público a la orden
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        if (origin && order.id) {
            const orderUrl = `${origin}/o/${encodeURIComponent(order.id)}`;
            message += `\nVer tu orden: ${orderUrl}`;
        }
    } catch (e) {
        // ignore
    }

    // Armar URL y abrir (encodeURIComponent del mensaje)
    const waPhone = `593${cleanPhone.startsWith('0') ? cleanPhone.slice(1) : cleanPhone}`
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(message)}`
    window.open(whatsappUrl, '_blank')
}

// Enviar mensaje a la tienda solicitando comprobante
export const sendOrderToStore = (order: Order, business: Business) => {
    // Usar el teléfono del negocio
    const storePhone = business.phone || '0985985684' // Fallback al número viejo si no hay phone

    const customerName = order.customer?.name || 'Cliente'
    const productsList = order.items?.map((item: any) => `(${item.quantity}) ${item.variant || item.name || item.product?.name || 'Producto'}`).join('\n') || 'Sin productos'
    const total = order.total?.toFixed(2) || '0.00'
    const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : order.payment?.method === 'transfer' ? 'Transferencia' : 'Otro'

    // Lógica de ubicación (reutilizada de sendWhatsAppToDelivery)
    let locationLink = ''
    if (order.delivery.type === 'delivery') {
        if (order.delivery?.latlong) {
            const cleanCoords = order.delivery.latlong.replace(/\s+/g, '')
            if (cleanCoords.startsWith('pluscode:')) {
                const plusCode = cleanCoords.replace('pluscode:', '')
                locationLink = `https://www.google.com/maps/place/${encodeURIComponent(plusCode)}`
            } else if (cleanCoords.includes(',')) {
                locationLink = `https://www.google.com/maps/place/${cleanCoords}`
            } else {
                locationLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanCoords)}`
            }
        } else if (order.delivery?.mapLocation) {
            locationLink = `https://www.google.com/maps/place/${order.delivery.mapLocation.lat},${order.delivery.mapLocation.lng}`
        }
    }

    const orderType = formatScheduledDate(order.timing);

    const references = order.delivery.type === 'pickup'
        ? '🏪 Retira en tienda'
        : (order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia');

    // Construir mensaje con el formato solicitado
    let message = `*Hola ${business.name}, he realizado un pedido!*\n\n`
    message += `*Nombres:* ${customerName}\n\n`

    message += `*Detalles de la entrega*\n`
    message += `${orderType}\n`
    message += `Referencias: ${references}\n`
    if (locationLink) {
        message += `Ubicación: ${locationLink}\n\n`
    } else {
        message += `\n`
    }

    message += `*Detalle del pedido*\n`
    message += `${productsList}\n\n`

    message += `*Total* $${total}\n`
    message += `*Forma de pago:* ${paymentMethod}\n\n`

    // Agregar enlace a la orden
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        if (origin && order.id) {
            const orderUrl = `${origin}/o/${encodeURIComponent(order.id)}`;
            message += `${orderUrl}`;
        }
    } catch (e) {
        // ignore
    }

    const waPhone = `593${storePhone.startsWith('0') ? storePhone.slice(1) : storePhone}`
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(message)}`
    window.open(whatsappUrl, '_blank')
}
