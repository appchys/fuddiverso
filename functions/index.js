/**
 * Cloud Functions para Fuddiverso
 * - Enviar email cuando se crea una nueva orden
 * - Notificaciones de cambios de estado
 * - Notificaciones a repartidores (Email y Telegram)
 */

const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require('firebase-admin');

// Inicializar la app antes que cualquier otro módulo
admin.initializeApp();

const emailServices = require('./email');
const telegramServices = require('./telegram');
const deliveryServices = require('./delivery');
const { getBusinessAdminEmails } = require('./utils');

/**
 * Cloud Function: Enviar email cuando se crea una nueva orden
 */
async function sendOrderEmailLogic(order, orderId) {
  return emailServices.sendOrderCreatedEmail(order, orderId);
}

/**
 * Cloud Function: Notificar cambio de estado de orden (opcional)
 */
async function onOrderStatusChangeLogic(beforeData, afterData, orderId) {
  // Solo procesar si cambió el estado
  if (beforeData.status === afterData.status) {
    return;
  }
  console.log(`📌 Orden ${orderId}: Estado cambió de "${beforeData.status}" a "${afterData.status}"`);
}

/**
 * Cloud Function: Crear notificación en el panel cuando llega una nueva orden
 */
async function createOrderNotificationLogic(order, orderId) {
  // Ignorar órdenes creadas por administradores
  if (order.createdByAdmin) {
    console.log(`ℹ️ Orden ${orderId} creada por admin, omitiendo notificación.`);
    return;
  }

  if (!order.businessId) {
    console.warn(`⚠️ Orden ${orderId} no tiene businessId, no se puede crear notificación.`);
    return;
  }

  try {
    console.log(`🔔 Creando notificación para orden: ${orderId} en negocio: ${order.businessId}`);
    const customerName = order.customer?.name || 'Cliente';

    const notificationData = {
      orderId: orderId,
      type: 'new_order',
      title: `${customerName} ha realizado un pedido`,
      message: `Orden #${orderId.slice(0, 6)} - Total: $${order.total?.toFixed(2) || '0.00'}`,
      read: false,
      orderData: {
        id: orderId,
        customer: order.customer,
        items: order.items,
        total: order.total,
        status: order.status
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await admin.firestore()
      .collection('businesses')
      .doc(order.businessId)
      .collection('notifications')
      .add(notificationData);

    console.log(`✅ Notificación creada exitosamente para orden ${orderId}`);
  } catch (error) {
    console.error(`❌ Error creando notificación para orden ${orderId}:`, error);
  }
}

/**
 * Cloud Function: Notificar cuando un cliente empieza el checkout
 */
exports.onCheckoutProgressUpdate = onDocumentCreated("checkoutProgress/{docId}", async (event) => {
  const afterData = event.data.data();
  if (!afterData) return;

  const docId = event.params.docId;
  const clientId = afterData.clientId;
  const businessId = afterData.businessId;

  if (!clientId || !businessId) {
    console.warn(`⚠️ Documento ${docId} no tiene clientId o businessId`);
    return;
  }

  try {
    console.log(`🛒 Cliente ${clientId} empezó checkout en negocio ${businessId}`);

    // Obtener datos del negocio
    let businessData = {};
    const businessDoc = await admin.firestore().collection('businesses').doc(businessId).get();
    if (businessDoc.exists) {
      businessData = businessDoc.data();
    } else {
      console.warn(`⚠️ No se encontró el negocio ${businessId}`);
      return;
    }

    // Obtener datos del cliente (opcional, si solo necesitamos nombre)
    let clientData = {};
    try {
      const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();
      if (clientDoc.exists) clientData = clientDoc.data();
    } catch (e) {
      console.warn(`⚠️ No se pudo obtener datos del cliente ${clientId}:`, e.message);
    }

    await emailServices.sendCheckoutProgressEmail(clientData, businessData, clientId, businessId);

  } catch (error) {
    console.error(`❌ Error en onCheckoutProgressUpdate para ${docId}:`, error);
  }
});

/**
 * Función común para notificar al delivery (Email + Telegram)
 */
async function notifyDeliveryCommon(orderData, orderId, deliveryId, businessId) {
  try {
    // Obtener datos del delivery
    const deliveryDoc = await admin.firestore().collection('deliveries').doc(deliveryId).get();
    if (!deliveryDoc.exists) {
      console.warn(`⚠️ Delivery ${deliveryId} no encontrado`);
      return;
    }
    const deliveryData = deliveryDoc.data();
    const deliveryEmail = deliveryData.email;

    // Obtener datos del negocio
    let businessData = {};
    let businessName = 'Negocio';
    if (businessId) {
      const businessDoc = await admin.firestore().collection('businesses').doc(businessId).get();
      if (businessDoc.exists) {
        businessData = businessDoc.data();
        businessName = businessData.name || businessName;
      }
    }

    // Obtener datos del cliente
    let customerName = orderData.customer?.name || 'Cliente no especificado';
    let customerPhone = orderData.customer?.phone || 'No registrado';
    if (orderData.customer?.id) {
      const clientDoc = await admin.firestore().collection('clients').doc(orderData.customer.id).get();
      if (clientDoc.exists) {
        const clientData = clientDoc.data();
        customerName = clientData.nombres || customerName;
        customerPhone = clientData.celular || customerPhone;
      }
    }

    // Enviar Email
    if (deliveryEmail) {
      await emailServices.sendDeliveryAssignmentEmail(orderData, orderId, deliveryEmail, customerName, customerPhone, businessData);
    } else {
      console.warn(`⚠️ Delivery ${deliveryId} no tiene email`);
    }

    // Enviar Telegram
    await telegramServices.sendDeliveryTelegramNotification(deliveryData, orderData, orderId, businessName);

  } catch (error) {
    console.error(`❌ Error en notificaciones de delivery para orden ${orderId}:`, error);
  }
}

async function notifyDeliveryOnOrderCreationLogic(orderData, orderId) {
  const assignedDeliveryId = orderData.delivery?.assignedDelivery;
  if (!assignedDeliveryId) return;

  console.log(`📦 Nueva orden ${orderId} creada con delivery: ${assignedDeliveryId}`);
  await notifyDeliveryCommon(orderData, orderId, assignedDeliveryId, orderData.businessId);
}

/**
 * Notificar a la tienda por Telegram cuando se crea una orden desde checkout
 */
async function notifyBusinessTelegramOnOrderCreation(orderData, orderId) {
  if (!orderData.businessId) {
    console.warn(`⚠️ Orden ${orderId} no tiene businessId, no se puede notificar a la tienda.`);
    return;
  }

  try {
    // Obtener datos del negocio
    const businessDoc = await admin.firestore().collection('businesses').doc(orderData.businessId).get();
    if (!businessDoc.exists) {
      console.warn(`⚠️ Negocio ${orderData.businessId} no encontrado`);
      return;
    }

    const businessData = businessDoc.data();

    // Solo notificar si la orden NO fue creada por un admin (es decir, fue creada por un cliente)
    // O si fue creada por admin pero la tienda tiene habilitada la configuración de notificaciones para pedidos manuales por Telegram
    const notifyManual = businessData.notificationSettings?.telegramOrderManual === true;

    if (orderData.createdByAdmin && !notifyManual) {
      console.log(`ℹ️ Orden ${orderId} creada por admin y notificación manual desactivada, omitiendo.`);
      return;
    }

    // Enviar notificación de Telegram a la tienda
    await telegramServices.sendBusinessTelegramNotification(businessData, orderData, orderId);
  } catch (error) {
    console.error(`❌ Error enviando notificación de Telegram a la tienda para orden ${orderId}:`, error);
  }
}


async function notifyDeliveryAssignmentLogic(beforeData, afterData, orderId) {
  const beforeDeliveryId = beforeData.delivery?.assignedDelivery;
  const afterDeliveryId = afterData.delivery?.assignedDelivery;

  if (!afterDeliveryId) return;
  if (beforeDeliveryId === afterDeliveryId) return;

  console.log(`📦 Orden ${orderId} asignada al delivery: ${afterDeliveryId}`);
  await notifyDeliveryCommon(afterData, orderId, afterDeliveryId, afterData.businessId);
}

/**
 * Cloud Function: Único disparador para CREACIÓN de órdenes
 */
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const order = snap.data();
  const orderId = event.params.orderId;

  console.log(`🚀 [CONSOLIDADO] Procesando CREACIÓN de orden: ${orderId}`);

  await Promise.allSettled([
    sendOrderEmailLogic(order, orderId),
    createOrderNotificationLogic(order, orderId),
    notifyDeliveryOnOrderCreationLogic(order, orderId),
    notifyBusinessTelegramOnOrderCreation(order, orderId)
  ]);
});

async function notifyStoreOnDeliveryAcceptanceLogic(beforeData, afterData, orderId) {
  const beforeStatus = beforeData.delivery?.acceptanceStatus;
  const afterStatus = afterData.delivery?.acceptanceStatus;

  // Si pasa de no aceptado a aceptado, actualizar mensaje
  if (beforeStatus !== 'accepted' && afterStatus === 'accepted') {
    console.log(`✅ Delivery aceptó orden ${orderId}. Actualizando mensaje de tienda.`);
    await telegramServices.updateBusinessTelegramMessage(afterData, orderId);
  }
}

/**
 * Cloud Function: Único disparador para ACTUALIZACIÓN de órdenes
 */
exports.onOrderUpdated = onDocumentUpdated("orders/{orderId}", async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  const orderId = event.params.orderId;

  console.log(`🚀 [CONSOLIDADO] Procesando ACTUALIZACIÓN de orden: ${orderId}`);

  await Promise.allSettled([
    onOrderStatusChangeLogic(beforeData, afterData, orderId),
    notifyDeliveryAssignmentLogic(beforeData, afterData, orderId),
    notifyStoreOnDeliveryAcceptanceLogic(beforeData, afterData, orderId)
  ]);
});

/**
 * Cloud Function: Único disparador para CUALQUIER cambio en negocios
 */
exports.onBusinessWritten = onDocumentWritten("businesses/{businessId}", async (event) => {
  const businessId = event.params.businessId;
  const before = event.data.before ? event.data.before.data() : null;
  const after = event.data.after ? event.data.after.data() : null;

  if (!after) return; // Eliminación

  if (!before) {
    // Es una creación
    await emailServices.sendBusinessCreatedEmail(after);
  } else {
    // Es una actualización
    const loginChanged = after.lastLoginAt && (!before.lastLoginAt || !after.lastLoginAt.isEqual(before.lastLoginAt));
    const isNewRegistration = after.lastRegistrationAt && (!before.lastRegistrationAt || !after.lastRegistrationAt.isEqual(before.lastRegistrationAt));

    if (loginChanged && !isNewRegistration) {
      await emailServices.sendBusinessLoginEmail(after);
    }
  }
});

/**
 * Cloud Function: Recordatorios programados
 */
exports.sendScheduledOrderReminders = onSchedule({
  schedule: "*/5 * * * *",
  timeZone: "America/Guayaquil",
  retryCount: 0
}, async (event) => {
  console.log('⏰ Verificando órdenes programadas para recordatorios...');
  try {
    const nowUtc = new Date();
    const nowEcuador = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
    const reminderStart = new Date(nowEcuador.getTime() + 30 * 60 * 1000); // +30 min
    const reminderEnd = new Date(nowEcuador.getTime() + 35 * 60 * 1000);   // +35 min

    const ordersSnapshot = await admin.firestore()
      .collection('orders')
      .where('timing.type', '==', 'scheduled')
      .where('status', 'in', ['pending', 'confirmed', 'preparing'])
      .get();

    for (const orderDoc of ordersSnapshot.docs) {
      const order = orderDoc.data();
      const orderId = orderDoc.id;

      if (order.reminderSent) continue;

      const scheduledDate = order.timing?.scheduledDate;
      const scheduledTime = order.timing?.scheduledTime;
      if (!scheduledDate || !scheduledTime) continue;

      // Convertir Firestore Timestamp a Date
      let dateObj;
      if (scheduledDate.seconds || scheduledDate._seconds) {
        const seconds = scheduledDate.seconds || scheduledDate._seconds;
        dateObj = new Date(seconds * 1000);
      } else if (scheduledDate instanceof Date) {
        dateObj = scheduledDate;
      } else {
        continue;
      }

      // Parsear la hora
      const timeParts = scheduledTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!timeParts) continue;

      let hours = parseInt(timeParts[1]);
      const minutes = parseInt(timeParts[2]);
      const meridiem = timeParts[3];

      if (meridiem) {
        if (meridiem.toUpperCase() === 'PM' && hours !== 12) hours += 12;
        else if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0;
      }

      const deliveryDateTime = new Date(dateObj);
      deliveryDateTime.setHours(hours, minutes, 0, 0);

      if (deliveryDateTime >= reminderStart && deliveryDateTime <= reminderEnd) {
        console.log(`📧 Enviando recordatorio para orden ${orderId}`);

        // Recopilar datos
        let businessEmail = 'info@fuddi.shop';
        let recipients = [];

        if (order.businessId) {
          const businessDoc = await admin.firestore().collection('businesses').doc(order.businessId).get();
          if (businessDoc.exists) {
            const businessData = businessDoc.data();
            businessEmail = businessData.email || businessEmail;
            if (businessEmail) recipients.push(businessEmail);

            const adminEmails = await getBusinessAdminEmails(order.businessId);
            adminEmails.forEach(email => {
              if (!recipients.includes(email)) recipients.push(email);
            });
          }
        }
        if (recipients.length === 0) recipients.push(businessEmail);

        // Datos cliente
        let customerName = order.customer?.name || 'Cliente no especificado';
        let customerPhone = order.customer?.phone || 'No registrado';
        try {
          if (order.customer?.id) {
            const clientDoc = await admin.firestore().collection('clients').doc(order.customer.id).get();
            if (clientDoc.exists) {
              customerName = clientDoc.data().nombres || customerName;
              customerPhone = clientDoc.data().celular || customerPhone;
            }
          }
        } catch (e) { }

        // HTML products
        let productsHtml = '<ul style="padding-left:20px;">';
        let previewItems = [];
        if (Array.isArray(order.items)) {
          order.items.forEach(item => {
            productsHtml += `<li style="margin-bottom:8px;"><strong>${item.name}</strong> (${item.quantity})</li>`;
            previewItems.push(`x${item.quantity} ${item.name}`);
          });
        }
        productsHtml += '</ul>';

        const scheduledDateStr = deliveryDateTime.toLocaleDateString('es-EC', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const deliveryInfo = order.delivery?.type === 'delivery' ? (order.delivery?.references || '') : 'Retiro en tienda';

        await emailServices.sendReminderEmail(
          order, orderId, recipients, scheduledTime, scheduledDateStr, customerName, customerPhone, deliveryInfo, previewItems.join(', '), productsHtml
        );

        await orderDoc.ref.update({
          reminderSent: true,
          reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  } catch (error) {
    console.error('❌ Error en sendScheduledOrderReminders:', error);
  }
});

/**
 * Cloud Function: Resumen diario
 */
exports.sendDailyOrderSummary = onSchedule({
  schedule: "0 7 * * *",
  timeZone: "America/Guayaquil",
  retryCount: 0
}, async (event) => {
  console.log('📊 Iniciando envío de resumen diario de órdenes programadas (7 AM)...');
  try {
    const nowUtc = new Date();
    const nowEcuador = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
    const startOfDay = new Date(nowEcuador); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(nowEcuador); endOfDay.setHours(23, 59, 59, 999);
    const startSeconds = Math.floor(startOfDay.getTime() / 1000);
    const endSeconds = Math.floor(endOfDay.getTime() / 1000);

    const todayFormatted = nowEcuador.toLocaleDateString('es-EC', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const previewDateStr = nowEcuador.toLocaleDateString('es-EC', { day: 'numeric', month: 'long' });

    const businessesSnapshot = await admin.firestore().collection('businesses').get();

    for (const businessDoc of businessesSnapshot.docs) {
      const business = businessDoc.data();
      const businessId = businessDoc.id;
      const businessEmail = business.email;

      let recipients = [];
      if (businessEmail) recipients.push(businessEmail);
      const adminEmails = await getBusinessAdminEmails(businessId);
      adminEmails.forEach(email => { if (!recipients.includes(email)) recipients.push(email); });

      if (recipients.length === 0 || business.isHidden) continue;

      const ordersSnapshot = await admin.firestore().collection('orders')
        .where('businessId', '==', businessId)
        .where('timing.type', '==', 'scheduled')
        .get();

      const todayOrders = [];
      for (const orderDoc of ordersSnapshot.docs) {
        const order = orderDoc.data();
        const scheduledDate = order.timing?.scheduledDate;
        if (!scheduledDate) continue;
        const orderSeconds = scheduledDate.seconds || scheduledDate._seconds;

        if (orderSeconds && orderSeconds >= startSeconds && orderSeconds <= endSeconds) {
          // Procesar datos (Customer name, items summary...) - Simplificado para brevedad
          let customerName = order.customer?.name || 'Cliente';
          let itemsSummary = (order.items || []).map(i => `${i.quantity} ${i.name}`).join(', ');

          todayOrders.push({
            id: orderDoc.id,
            scheduledTime: order.timing?.scheduledTime || '00:00',
            customerName,
            itemsSummary,
            total: order.total || 0,
            deliveryType: order.delivery?.type || 'pickup'
          });
        }
      }

      todayOrders.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      await emailServices.sendDailySummaryEmail(business, todayOrders, recipients, todayFormatted, previewDateStr);
    }
  } catch (error) {
    console.error('❌ Error en sendDailyOrderSummary:', error);
  }
});

// Exports para Telegram y Hooks
exports.telegramWebhook = onRequest(telegramServices.handleStoreWebhook);
exports.telegramDeliveryWebhook = onRequest(telegramServices.handleDeliveryWebhook);
exports.handleDeliveryOrderAction = onRequest(deliveryServices.handleDeliveryOrderAction);
