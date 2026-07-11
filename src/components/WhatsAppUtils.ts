import { getWhatsAppTemplates } from '@/lib/database'
import { renderWhatsAppTemplate, WHATSAPP_TEMPLATE_DEFAULTS } from '@/lib/whatsappTemplates'
import { Order, Business } from '@/types'

const openExternalLink = (url: string) => {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.openLink) {
        (window as any).Telegram.WebApp.openLink(url)
    } else {
        window.open(url, '_blank')
    }
}

export const getNextStatus = (status: Order['status']): Order['status'] | null => {
    const flow: Order['status'][] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered']
    const idx = flow.indexOf(status)
    if (idx === -1) return null
    if (idx >= flow.length - 1) return null
    return flow[idx + 1]
}

const formatScheduledDate = (timing: Order['timing']): string => {
    if (timing?.type !== 'scheduled') return '⚡ Inmediato'

    const time = timing.scheduledTime || ''

    if (!timing.scheduledDate) {
        return `⏰ Programado para las ${time}`
    }

    let date: Date
    const rawDate = timing.scheduledDate as any

    if (typeof rawDate.toDate === 'function') {
        date = rawDate.toDate()
    } else if (rawDate.seconds !== undefined) {
        date = new Date(rawDate.seconds * 1000)
    } else if (rawDate instanceof Date) {
        date = rawDate
    } else {
        date = new Date(rawDate)
    }

    if (isNaN(date.getTime())) {
        return `⏰ Programado para las ${time}`
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (checkDate.getTime() === today.getTime()) {
        return `⏰ Programado para hoy a las ${time}`
    }

    if (checkDate.getTime() === tomorrow.getTime()) {
        return `⏰ Programado para mañana a las ${time}`
    }

    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    return `⏰ Programado para:\n${date.getDate()} de ${months[date.getMonth()]} a las ${time}`
}

const buildProductsList = (order: Order, includeStorePrice = false) => {
    const groupedProducts = new Map<string, { hasRealVariant: boolean; lines: string[] }>()

    order.items?.forEach((item: any) => {
        const productName = item.productName || item.product?.name || item.name || 'Producto'
        const variantName = item.variant || item.variantName || item.name || productName
        const hasRealVariant = Boolean(
            item.variant ||
            item.variantName ||
            (item.productName && variantName !== productName)
        )

        let suffix = ''
        if (includeStorePrice) {
            suffix = ` - $${(item.storeReceives || 0).toFixed(2)}`
        }

        const existingGroup = groupedProducts.get(productName) || { hasRealVariant: false, lines: [] }

        if (hasRealVariant) {
            existingGroup.hasRealVariant = true
            existingGroup.lines.push(`(${item.quantity || 1}) ${variantName}${suffix}`)
        } else {
            existingGroup.lines.push(`(${item.quantity || 1}) ${productName}${suffix}`)
        }

        groupedProducts.set(productName, existingGroup)
    })

    if (groupedProducts.size === 0) {
        return 'Sin productos'
    }

    return Array.from(groupedProducts.entries())
        .map(([productName, group]) => {
            if (!group.hasRealVariant) {
                return group.lines.join('\n')
            }

            return `${productName}\n${group.lines.join('\n')}`
        })
        .join('\n\n')
}

const buildLocationLink = (order: Order) => {
    let locationLink = ''

    if (order.delivery.type !== 'delivery') {
        return locationLink
    }

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

    return locationLink
}

const normalizePhoneForWhatsApp = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '')
    return `593${cleanPhone.startsWith('0') ? cleanPhone.slice(1) : cleanPhone}`
}

const getSavedTemplate = async (key: string) => {
    const savedTemplates = await getWhatsAppTemplates()
    return savedTemplates[key] || WHATSAPP_TEMPLATE_DEFAULTS[key]
}

export const sendWhatsAppToDelivery = async (
    order: Order,
    availableDeliveries: any[],
    business: Business | null,
    onStatusUpdate?: (orderId: string, newStatus: Order['status']) => Promise<void>,
    updateLocalOrder?: (updatedOrder: Order) => void
) => {
    let nextStatus: Order['status'] | null = null
    if (order.status !== 'ready' && onStatusUpdate && updateLocalOrder) {
        nextStatus = getNextStatus(order.status)
    }

    let phone = ''

    if (order.delivery.type === 'delivery') {
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
    } else {
        if (!business?.phone) {
            alert('No se encontró el número de teléfono de la tienda')
            return
        }

        phone = business.phone
    }

    const customerName = order.customer?.name || 'Cliente sin nombre'
    const customerPhone = order.customer?.phone || 'Sin teléfono'
    const references = order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'
    const locationLink = buildLocationLink(order)
    const locationLine = locationLink ? `Ubicación: ${locationLink}\n\n` : ''
    const productsList = buildProductsList(order)
    const deliveryCost = order.delivery.type === 'delivery' ? (order.delivery?.deliveryCost || 1) : 0
    const subtotal = order.total - deliveryCost
    const orderType = formatScheduledDate(order.timing)

    let paymentDetailsBlock = ''
    if (order.payment?.method === 'mixed') {
        const payment = order.payment as any
        paymentDetailsBlock = `🏦 Transferencia: $${(payment.transferAmount || 0).toFixed(2)}\n💵 *Cobrar:* $${(payment.cashAmount || 0).toFixed(2)}`
    } else if (order.payment?.method === 'cash') {
        paymentDetailsBlock = `💵 *Cobrar:* $${order.total.toFixed(2)}`
    } else if (order.payment?.method === 'transfer') {
        paymentDetailsBlock = '🏦 Transferencia'
    }

    const deliverySection = order.delivery.type === 'delivery'
        ? `*Detalles de la entrega*\n${orderType}\nReferencias: ${references}\n${locationLink ? `Ubicación: ${locationLink}\n` : ''}`
        : ''

    const templateKey = order.delivery.type === 'delivery'
        ? 'delivery_assignment'
        : 'pickup_store_notification'

    const template = await getSavedTemplate(templateKey)
    const message = renderWhatsAppTemplate(template, {
        businessName: business?.name || 'Tienda',
        businessPhoneLine: business?.phone ? `+593${business.phone.replace(/\D/g, '').startsWith('0') ? business.phone.replace(/\D/g, '').slice(1) : business.phone.replace(/\D/g, '')}` : '',
        customerName,
        customerPhone: `+593${customerPhone.replace(/\D/g, '').startsWith('0') ? customerPhone.replace(/\D/g, '').slice(1) : customerPhone.replace(/\D/g, '')}`,
        deliverySection,
        pickupLine: '🏪 Retiro en tienda',
        orderType,
        references,
        locationLine,
        productsList,
        subtotal: subtotal.toFixed(2),
        deliveryCostLine: order.delivery.type === 'delivery' ? `Envío: $${deliveryCost.toFixed(2)}\n` : '',
        paymentDetailsBlock,
        total: (order.total || 0).toFixed(2)
    })

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${normalizePhoneForWhatsApp(phone)}&text=${encodeURIComponent(message)}`
    openExternalLink(whatsappUrl)

    if (nextStatus && onStatusUpdate && updateLocalOrder) {
        try {
            await onStatusUpdate(order.id, nextStatus)
            const updatedOrder = { ...order, status: nextStatus }
            updateLocalOrder(updatedOrder)
        } catch (error) {
            console.error('Error al avanzar el estado del pedido:', error)
        }
    }
}

export const sendWhatsAppToCustomer = async (order: Order) => {
    const customerPhoneRaw = order.customer?.phone || ''

    if (!customerPhoneRaw) {
        alert('No se encontró el número del cliente')
        return
    }

    const cleanPhone = customerPhoneRaw.replace(/\D/g, '')
    if (!cleanPhone) {
        alert('Número de cliente inválido')
        return
    }

    const productsList = buildProductsList(order)
    const deliveryInfo = order.delivery?.type === 'delivery'
        ? `${order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia'}`
        : 'Retiro en tienda'
    const paymentMethod = order.payment?.method === 'cash'
        ? 'Efectivo'
        : order.payment?.method === 'transfer'
            ? 'Transferencia'
            : order.payment?.method === 'mixed'
                ? 'Pago Mixto'
                : 'Sin especificar'
    const subtotal = order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0)
    const orderType = formatScheduledDate(order.timing)
    const initialMessage = order.timing?.type === 'scheduled'
        ? 'Tu pedido está agendado!'
        : 'Tu pedido está en preparación!'

    let orderLinkLine = ''
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        if (origin && order.id) {
            orderLinkLine = `\nVer tu orden: ${origin}/o/${encodeURIComponent(order.id)}`
        }
    } catch (e) {
        // ignore
    }

    const template = await getSavedTemplate('customer_status')
    const message = renderWhatsAppTemplate(template, {
        initialMessage,
        deliveryInfo,
        orderType,
        productsList,
        subtotal: subtotal.toFixed(2),
        deliveryCostLine: order.delivery?.type === 'delivery' ? `Envío: $${(order.delivery?.deliveryCost || 0).toFixed(2)}\n` : '',
        customerTotalBlock: (order.payment?.method === 'cash' || order.payment?.method === 'mixed')
            ? `*Total:* $${(order.total || 0).toFixed(2)}\n\n`
            : '',
        paymentMethod,
        orderLinkLine
    })

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${normalizePhoneForWhatsApp(customerPhoneRaw)}&text=${encodeURIComponent(message)}`
    openExternalLink(whatsappUrl)
}

export const sendOrderToStoreFromClient = async (order: Order, business: Business) => {
    const storePhone = business.phone || '0985985684'
    const customerName = order.customer?.name || 'Cliente'
    const productsList = buildProductsList(order)
    
    // Calculate total as fallback if order.total is not available
    const calculatedTotal = order.items?.reduce((sum: number, item: any) => {
        const price = item.price || item.product?.price || 0
        return sum + (price * (item.quantity || 1))
    }, 0) || 0
    
    const total = (order.total || calculatedTotal).toFixed(2)
    const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : order.payment?.method === 'transfer' ? 'Transferencia' : 'Otro'
    const locationLink = buildLocationLink(order)
    const orderType = formatScheduledDate(order.timing)
    const references = order.delivery.type === 'pickup'
        ? '🏪 Retira en tienda'
        : (order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia')
    
    const locationLine = locationLink ? `Ubicación: ${locationLink}\n\n` : ''

    let orderLinkLine = ''
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        if (origin && order.id) {
            orderLinkLine = `\n${origin}/o/${encodeURIComponent(order.id)}`
        }
    } catch (e) {
        // ignore
    }

    const template = await getSavedTemplate('client_to_store')
    const message = renderWhatsAppTemplate(template, {
        businessName: business.name,
        customerName,
        orderType,
        references,
        locationLine,
        productsList,
        total,
        paymentMethod,
        orderLinkLine
    })

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${normalizePhoneForWhatsApp(storePhone)}&text=${encodeURIComponent(message)}`
    openExternalLink(whatsappUrl)
}

export const sendOrderToStore = async (order: Order, business: Business) => {
    const storePhone = business.phone || '0985985684'
    const customerName = order.customer?.name || 'Cliente'
    const customerPhone = order.customer?.phone || ''
    const productsList = buildProductsList(order, true)
    
    // Calcular lo que recibe la tienda
    const storeReceives = order.items?.reduce((sum: number, item: any) => {
        const itemStoreReceives = item.storeReceives || 0
        return sum + (itemStoreReceives * (item.quantity || 1))
    }, 0) || order.total || 0
    
    // Calcular la comisión sumando las comisiones de cada item
    const commissionAmount = order.items?.reduce((sum: number, item: any) => {
        const itemCommission = item.commission || 0
        return sum + (itemCommission * (item.quantity || 1))
    }, 0) || 0
    
    // Calcular línea de envío
    const deliveryCostLine = order.delivery?.type === 'delivery' ? `Envío: $${(order.delivery?.deliveryCost || 0).toFixed(2)}\n` : ''
    
    // Calcular línea de ubicación
    const locationLink = buildLocationLink(order)
    const locationLine = locationLink ? `Ubicación: ${locationLink}\n\n` : ''
    
    // Calcular detalles de pago
    let paymentDetailsBlock = ''
    if (order.payment?.method === 'mixed') {
        const payment = order.payment as any
        paymentDetailsBlock = `🏦 Transferencia: $${(payment.transferAmount || 0).toFixed(2)}\n💵 *Cobrar:* $${(payment.cashAmount || 0).toFixed(2)}`
    } else if (order.payment?.method === 'cash') {
        paymentDetailsBlock = `💵 *Cobrar:* $${order.total.toFixed(2)}`
    } else if (order.payment?.method === 'transfer') {
        paymentDetailsBlock = '🏦 Transferencia'
    }
    
    const total = storeReceives.toFixed(2)
    const storeSubtotal = storeReceives.toFixed(2)
    const commissionAmountStr = commissionAmount.toFixed(2)
    const orderType = formatScheduledDate(order.timing)
    const references = order.delivery.type === 'pickup'
        ? '🏪 Retira en tienda'
        : (order.delivery?.references || (order.delivery as any)?.reference || 'Sin referencia')

    let message = ''
    const isConfirmedOrLater = order.status !== 'pending' && order.status !== 'borrador'

    if (isConfirmedOrLater) {
        const subtotalVal = order.subtotal || (order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0))
        const paymentMethod = order.payment?.method || 'No especificado'
        let paymentMethodText = 'No especificado'
        if (paymentMethod === 'cash') paymentMethodText = '💵 Efectivo'
        else if (paymentMethod === 'transfer') paymentMethodText = '🏦 Transferencia'
        else if (paymentMethod === 'mixed') paymentMethodText = '💳 Mixto'

        const statusLabel = ({
            pending: 'Pendiente',
            confirmed: 'Confirmado',
            preparing: 'Preparando',
            ready: 'Listo',
            on_way: 'En camino',
            delivered: 'Entregado',
            cancelled: 'Cancelado',
            borrador: 'Borrador'
        })[order.status || 'pending'] || (order.status || 'Confirmado')

        const deliveryCost = order.delivery?.deliveryCost || 0

        message = `Tienda: ${business.name || 'Tienda'}\n` +
                  `Cliente: ${customerName}\n\n` +
                  `*Detalles del pago*\n` +
                  `Pedido: $${subtotalVal.toFixed(2)}\n` +
                  `Comisión: $${commissionAmount.toFixed(2)}\n` +
                  `Delivery: $${deliveryCost.toFixed(2)}\n\n` +
                  `${paymentMethodText}\n\n` +
                  `${statusLabel}`
    } else {
        const template = await getSavedTemplate('admin_to_store')
        message = renderWhatsAppTemplate(template, {
            businessName: business.name,
            customerName,
            customerPhone: customerPhone ? `+593${customerPhone.replace(/\D/g, '').startsWith('0') ? customerPhone.replace(/\D/g, '').slice(1) : customerPhone.replace(/\D/g, '')}` : '',
            orderType,
            references,
            productsList,
            total,
            storeSubtotal,
            commissionAmount: commissionAmountStr,
            paymentDetailsBlock,
            deliveryCostLine,
            locationLine
        })
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${normalizePhoneForWhatsApp(storePhone)}&text=${encodeURIComponent(message)}`
    openExternalLink(whatsappUrl)
}
