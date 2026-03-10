const admin = require('firebase-admin');

/**
 * Función auxiliar para procesar la acción de la orden (reutilizada por Email y Telegram)
 */
async function processOrderAction(token, action) {
    const result = {};
    try {
        // Decodificar token
        let orderId, actionType;
        try {
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            [orderId, actionType] = decoded.split('|');
            result.orderId = orderId;
        } catch (e) {
            return { error: 'Token inválido' };
        }

        // Validar que el action sea válido
        const validActions = ['confirm', 'discard', 'on_way', 'delivered', 'biz_confirm', 'biz_discard', 'preparing', 'store_preparing'];
        if (!validActions.includes(action) || actionType !== action) {
            return { error: 'Acción inválida' };
        }

        // Obtener la orden
        const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return { error: 'Orden no encontrada' };
        }

        const order = orderDoc.data();

        // No permitir cambios si ya está entregada o cancelada
        if (order.status === 'delivered' || order.status === 'cancelled') {
            return { orderId };
        }

        // Actualizar estado según la acción
        const updateData = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (action === 'confirm' || action === 'biz_confirm') {
            if (action === 'biz_confirm') {
                updateData.status = 'confirmed';
            } else if (action === 'confirm') {
                // Solo confirmar la aceptación del delivery, no cambiar el estado del pedido
                updateData['delivery.acceptanceStatus'] = 'accepted';
            }


            // Auto-asignación de delivery si es por negocio y es tipo delivery
            if (action === 'biz_confirm' && order.delivery?.type === 'delivery') {
                if (!order.delivery?.assignedDelivery) {
                    const assignedDelivery = await autoAssignDelivery(order);
                    if (assignedDelivery) {
                        updateData['delivery.assignedDelivery'] = assignedDelivery.id;
                        updateData['delivery.assignedAt'] = admin.firestore.FieldValue.serverTimestamp();
                        result.assignedDeliveryName = assignedDelivery.nombres;
                        console.log(`🚚 [processOrderAction] Auto-asignado delivery ${assignedDelivery.nombres} a orden ${orderId}`);
                    }
                } else {
                    // Ya tiene repartidor asignado, obtener su nombre para el resultado
                    const deliveryDoc = await admin.firestore().collection('deliveries').doc(order.delivery.assignedDelivery).get();
                    if (deliveryDoc.exists) {
                        result.assignedDeliveryName = deliveryDoc.data().nombres;
                    }
                }
            }

            console.log(`✅ Orden ${orderId} confirmada por ${action === 'confirm' ? 'delivery' : 'negocio'}`);
        } else if (action === 'on_way') {
            updateData.status = 'on_way';
            updateData['statusHistory.on_wayAt'] = admin.firestore.FieldValue.serverTimestamp();
            console.log(`🛵 Orden ${orderId} en camino`);
        } else if (action === 'delivered') {
            updateData.status = 'delivered';
            updateData.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
            updateData['statusHistory.deliveredAt'] = admin.firestore.FieldValue.serverTimestamp();
            console.log(`✅ Orden ${orderId} marcada como entregada`);
        } else if (action === 'discard') {
            const currentDeliveryId = order.delivery?.assignedDelivery;
            updateData['delivery.assignedDelivery'] = null;
            if (currentDeliveryId) {
                updateData['delivery.rejectedBy'] = admin.firestore.FieldValue.arrayUnion(currentDeliveryId);
            }
            console.log(`❌ Orden ${orderId} descartada por delivery ${currentDeliveryId || 'desconocido'}. Pedido liberado.`);
        } else if (action === 'biz_discard') {
            updateData.status = 'cancelled';
            updateData['statusHistory.cancelledAt'] = admin.firestore.FieldValue.serverTimestamp();
            console.log(`❌ Orden ${orderId} cancelada por negocio`);
        } else if (action === 'preparing' || action === 'store_preparing') {
            updateData.status = 'preparing';
            updateData['statusHistory.preparingAt'] = admin.firestore.FieldValue.serverTimestamp();
            console.log(`👨‍🍳 Orden ${orderId} marcada como preparando`);
        }

        // Actualizar la orden
        await orderDoc.ref.update(updateData);

        return result;
    } catch (error) {
        console.error('Error en processOrderAction:', error);
        return { error: 'Error interno' };
    }
}

/**
 * HTTP Function: Manejar acciones de confirmación/descarte de orden por parte del delivery
 * Accesible desde los links en el email
 */
async function handleDeliveryOrderAction(request, response) {
    // Configurar CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
    }

    try {
        const { action, token } = request.query;

        if (!action || !token) {
            return response.status(400).json({ error: 'Parámetros faltantes' });
        }

        // Decodificar token
        const result = await processOrderAction(token, action);

        if (result.error) {
            return response.status(400).json({ error: result.error });
        }

        // Redirección directa al dashboard con parámetros para mostrar notificación
        const redirectUrl = `https://fuddi.shop/delivery/dashboard?action=${action}&orderId=${result.orderId.substring(0, 8).toUpperCase()}`;
        response.redirect(redirectUrl);

    } catch (error) {
        console.error('❌ Error en handleDeliveryOrderAction:', error);
        response.status(500).json({ error: 'Error procesando la acción' });
    }
}

module.exports = {
    processOrderAction,
    handleDeliveryOrderAction
};

/**
 * Verifica si un punto está dentro de un polígono (Ray Casting Algorithm)
 */
function isPointInPolygon(point, polygon) {
    const x = point.lat, y = point.lng;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Lógica para asignar repartidor automáticamente
 */
async function autoAssignDelivery(order) {
    try {
        const db = admin.firestore();
        // 1. Obtener deliveries activos
        const deliveriesSnap = await db.collection('deliveries').where('estado', '==', 'activo').get();
        if (deliveriesSnap.empty) return null;
        const deliveries = deliveriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        let assignedDelivery = null;

        // 2. Intentar por zona de cobertura
        const latlong = order.delivery?.latlong;
        if (latlong && !latlong.startsWith('pluscode:')) {
            const [lat, lng] = latlong.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) {
                const zonesSnap = await db.collection('coverageZones').where('isActive', '==', true).get();
                if (!zonesSnap.empty) {
                    const zones = zonesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    const matchingZone = zones.find(zone =>
                        zone.assignedDeliveryId &&
                        isPointInPolygon({ lat, lng }, zone.polygon)
                    );

                    if (matchingZone) {
                        const zoneDelivery = deliveries.find(d => d.id === matchingZone.assignedDeliveryId);
                        if (zoneDelivery) {
                            assignedDelivery = zoneDelivery;
                            console.log(`✅ [Backend] Asignado por zona: ${matchingZone.name}`);
                        }
                    }
                }
            }
        }

        // 3. Fallbacks
        if (!assignedDelivery) {
            // Pedro Sánchez
            assignedDelivery = deliveries.find(d => d.celular === '0990815097');
            if (!assignedDelivery) {
                // Sergio Alvarado
                assignedDelivery = deliveries.find(d => d.celular === '0978697867');
            }
            if (assignedDelivery) console.log(`✅ [Backend] Asignado por fallback: ${assignedDelivery.nombres}`);
        }

        return assignedDelivery;
    } catch (error) {
        console.error('Error en autoAssignDelivery:', error);
        return null;
    }
}
