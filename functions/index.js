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
const cors = require('cors')({ origin: true });

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

  // Notificar al cliente por Telegram
  await telegramServices.sendCustomerTelegramNotification(afterData, orderId);

  // Si pasa a cancelado, actualizar mensaje del delivery anterior/actual indicando cancelación
  if (afterData.status === 'cancelled') {
    const deliveryMsg = afterData.telegramDeliveryMessage || beforeData.telegramDeliveryMessage;
    if (deliveryMsg) {
      try {
        console.log(`🔄 [Telegram] Pedido ${orderId} cancelado. Actualizando mensaje del delivery (${deliveryMsg.chatId})...`);
        let businessName = afterData.businessName;
        if (!businessName && afterData.businessId) {
          const businessDoc = await admin.firestore().collection('businesses').doc(afterData.businessId).get();
          if (businessDoc.exists) businessName = businessDoc.data().name;
        }
        if (!businessName) businessName = 'Negocio';

        await telegramServices.updateCancelledDeliveryTelegramMessage(deliveryMsg, businessName);
      } catch (error) {
        console.error('❌ Error al actualizar mensaje de delivery cancelado:', error);
      }
    }
  }
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
      message: `Total: $${order.total?.toFixed(2) || '0.00'}`,
      read: false,
      orderData: {
        id: orderId,
        customer: order.customer,
        items: order.items?.map(item => ({
          ...item,
          name: item.variant?.name ? `${item.name} - ${item.variant.name}` : item.name
        })) || [],
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

  // No notificar si el pedido es un borrador
  if (orderData.status === 'borrador') {
    console.log(`ℹ️ Orden ${orderId} es un borrador, omitiendo notificación a la tienda.`);
    return;
  }

  try {
    console.log(`📬 [Telegram] Obteniendo datos de negocio ${orderData.businessId} para notificación...`);
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

    console.log(`📨 [Telegram] Enviando notificación a tienda ${businessData.name || 'desconocida'}...`);
    // Enviar notificación de Telegram a la tienda
    await telegramServices.sendBusinessTelegramNotification(businessData, orderData, orderId);
  } catch (error) {
    console.error(`❌ Error enviando notificación de Telegram a la tienda para orden ${orderId}:`, error);
  }
}

/**
 * Notificar al administrador por Telegram cuando se crea una orden
 */
async function notifyAdminTelegramOnOrderCreation(orderData, orderId) {
  try {
    console.log(`📨 [Telegram Admin] Preparando notificación para Admin de orden ${orderId}...`);
    
    // Obtener datos del negocio
    let businessData = {};
    if (orderData.businessId) {
      const businessDoc = await admin.firestore().collection('businesses').doc(orderData.businessId).get();
      if (businessDoc.exists) {
        businessData = businessDoc.data();
      }
    }

    if (!businessData.name) {
      businessData.name = 'Negocio';
    }

    const normalizedBusinessName = String(businessData.name || '').trim().toLowerCase();
    const normalizedUsername = String(businessData.username || '').trim().toLowerCase();
    const isMunchysBusiness =
      orderData.businessId === '0FeNtdYThoTRMPJ6qaS7' ||
      normalizedBusinessName === 'munchys' ||
      normalizedUsername === 'munchys';

    if (isMunchysBusiness) {
      console.log(`ℹ️ Orden ${orderId} es de munchys, omitiendo notificación al admin bot.`);
      return;
    }

    const notificationSent = await telegramServices.sendAdminNewOrderNotification(businessData, orderData, orderId);
    if (notificationSent) {
      console.log(`✅ [Telegram Admin] Notificación enviada exitosamente para orden ${orderId}`);
    } else {
      console.warn(`⚠️ [Telegram Admin] No se pudo enviar la notificación para orden ${orderId}. Revisa el estado del bot o del chat.`);
    }
  } catch (error) {
    console.error(`❌ Error enviando notificación de Telegram a Admin para orden ${orderId}:`, error);
  }
}


async function notifyDeliveryAssignmentLogic(beforeData, afterData, orderId) {
  const beforeDeliveryId = beforeData.delivery?.assignedDelivery;
  const afterDeliveryId = afterData.delivery?.assignedDelivery;

  if (beforeDeliveryId === afterDeliveryId) {
    console.log(`ℹ️ Orden ${orderId} delivery no cambió`);
    return;
  }

  // Si había un delivery asignado antes y cambió (a otro o a ninguno, sin ser un descarte iniciado por el propio delivery)
  if (beforeDeliveryId && beforeData.telegramDeliveryMessage) {
    const isDiscardedByDelivery = (afterData.delivery?.rejectedBy || []).includes(beforeDeliveryId) &&
                                  !(beforeData.delivery?.rejectedBy || []).includes(beforeDeliveryId);

    if (!isDiscardedByDelivery) {
      try {
        console.log(`🔄 [Telegram] Pedido ${orderId} reasignado/desvinculado. Actualizando mensaje del delivery anterior (${beforeDeliveryId})...`);
        let businessName = afterData.businessName;
        if (!businessName && afterData.businessId) {
          const businessDoc = await admin.firestore().collection('businesses').doc(afterData.businessId).get();
          if (businessDoc.exists) businessName = businessDoc.data().name;
        }
        if (!businessName) businessName = 'Negocio';
        await telegramServices.updateReassignedDeliveryTelegramMessage(
          beforeData.telegramDeliveryMessage,
          businessName
        );
      } catch (error) {
        console.error('❌ Error al actualizar mensaje de delivery anterior:', error);
      }
    }
  }

  if (!afterDeliveryId) {
    console.log(`ℹ️ Orden ${orderId} no tiene delivery asignado`);
    return;
  }

  console.log(`📦 Orden ${orderId} asignada al delivery: ${afterDeliveryId}`);
  await notifyDeliveryCommon(afterData, orderId, afterDeliveryId, afterData.businessId);

  // Notificar al cliente por Telegram (Opcional: podrías querer notificar específicamente que ya hay repartidor)
  await telegramServices.sendCustomerTelegramNotification(afterData, orderId);
}

/**
 * Cloud Function: Único disparador para CREACIÓN de órdenes
 */
/**
 * Cloud Function: Vincular automáticamente telegramChatId del cliente a la orden
 */
async function linkCustomerTelegramToOrderLogic(order, orderId) {
  // Si la orden ya tiene telegramChatId, no hacer nada
  if (order.customer?.telegramChatId) {
    console.log(`✅ Orden ${orderId} ya tiene telegramChatId: ${order.customer.telegramChatId}`);
    return;
  }

  let clientId = order.customer?.id || order.clientId;
  const clientPhone = order.customer?.phone;

  // Si no hay clientId pero hay teléfono, intentar buscar por teléfono
  if (!clientId && clientPhone) {
    console.log(`🔍 Buscando cliente por teléfono: ${clientPhone}`);
    try {
      const clientsSnapshot = await admin.firestore().collection('clients')
        .where('celular', '==', clientPhone)
        .limit(1)
        .get();

      if (!clientsSnapshot.empty) {
        clientId = clientsSnapshot.docs[0].id;
        console.log(`✅ Cliente encontrado por teléfono: ${clientId}`);
      } else {
        console.warn(`⚠️ No se encontró cliente con teléfono: ${clientPhone}`);
      }
    } catch (err) {
      console.error(`❌ Error buscando cliente por teléfono en orden ${orderId}:`, err);
    }
  }

  // Si aún no tenemos clientId, no podemos proceder
  if (!clientId) {
    console.warn(`⚠️ No se puede encontrar cliente para orden ${orderId} (sin ID ni teléfono)`);
    return;
  }

  try {
    // Buscar el cliente en Firestore
    const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();

    if (clientDoc.exists) {
      const clientData = clientDoc.data();
      const telegramChatId = clientData.telegramChatId;

      if (telegramChatId) {
        console.log(`🔗 Vinculando telegramChatId de cliente ${clientId} a orden ${orderId}`);

        // Actualizar la orden con el telegramChatId del cliente Y el clientId si no estaba
        const updateData = {
          customer: {
            ...order.customer,
            telegramChatId: telegramChatId,
            // Guardar el cliente ID si no lo estaba
            ...(order.customer?.id ? {} : { id: clientId })
          }
        };

        await admin.firestore().collection('orders').doc(orderId).update(updateData);

        console.log(`✅ TelegramChatId vinculado a orden ${orderId}: ${telegramChatId}`);
      } else {
        console.log(`ℹ️ Cliente ${clientId} encontrado pero sin telegramChatId`);
      }
    } else {
      console.warn(`⚠️ Cliente ${clientId} no encontrado en Firestore`);
    }
  } catch (error) {
    console.error(`❌ Error vinculando telegramChatId a orden ${orderId}:`, error);
  }
}

exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const order = snap.data();
  const orderId = event.params.orderId;

  console.log(`🚀 [CONSOLIDADO] Procesando CREACIÓN de orden: ${orderId}`);
  console.log(`📋 [Order Details] businessId: ${order.businessId}, customer: ${order.customer?.name}, createdByAdmin: ${order.createdByAdmin}`);

  await Promise.allSettled([
    linkCustomerTelegramToOrderLogic(order, orderId),
    sendOrderEmailLogic(order, orderId),
    createOrderNotificationLogic(order, orderId),
    notifyDeliveryOnOrderCreationLogic(order, orderId),
    notifyBusinessTelegramOnOrderCreation(order, orderId),
    notifyAdminTelegramOnOrderCreation(order, orderId)
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
 * Cloud Function: Actualizar mensajes de Telegram de la tienda, admin y delivery si cambian datos clave
 */
async function updateTelegramMessagesOnOrderChange(beforeData, afterData, orderId) {
  // Comparar campos relevantes que cambiaron
  const fieldsChanged = [
    // Método de pago
    beforeData.payment?.method !== afterData.payment?.method,
    // Monto efectivo (pago mixto)
    beforeData.payment?.cashAmount !== afterData.payment?.cashAmount,
    // Total
    beforeData.total !== afterData.total,
    // Costo de envío
    beforeData.delivery?.deliveryCost !== afterData.delivery?.deliveryCost,
    // Dirección / referencias
    beforeData.delivery?.references !== afterData.delivery?.references,
    // Coordenadas
    beforeData.delivery?.latlong !== afterData.delivery?.latlong,
    // Items (comparar como JSON)
    JSON.stringify(beforeData.items) !== JSON.stringify(afterData.items),
    // Subtotal
    beforeData.subtotal !== afterData.subtotal,
    // Tipo de entrega
    beforeData.delivery?.type !== afterData.delivery?.type,
    // Horario programado
    beforeData.timing?.scheduledTime !== afterData.timing?.scheduledTime,
    beforeData.timing?.type !== afterData.timing?.type,
  ];

  if (!fieldsChanged.some(Boolean)) {
    return; // Nada relevante cambió, no hacer nada
  }

  console.log(`🔄 [Telegram] Campos relevantes cambiaron en orden ${orderId}. Actualizando mensajes en Telegram...`);

  // 1. Actualizar mensaje de la Tienda (Store) si existe la referencia
  if (afterData.telegramBusinessMessages && afterData.telegramBusinessMessages.length > 0) {
    try {
      await telegramServices.updateBusinessTelegramMessage(afterData, orderId, true);
      console.log(`✅ [Telegram] Mensajes de tienda actualizados para orden ${orderId}`);
    } catch (err) {
      console.error(`❌ [Telegram] Error actualizando mensajes de tienda para orden ${orderId}:`, err);
    }
  }

  // 2. Actualizar mensaje del Administrador si existe la referencia
  if (afterData.telegramAdminMessage) {
    try {
      await telegramServices.updateAdminTelegramMessage(afterData, orderId, true);
      console.log(`✅ [Telegram] Mensaje de admin actualizado para orden ${orderId}`);
    } catch (err) {
      console.error(`❌ [Telegram] Error actualizando mensaje de admin para orden ${orderId}:`, err);
    }
  }

  // 3. Actualizar mensaje del Delivery (si tiene referencia y hay un delivery asignado)
  if (afterData.delivery?.assignedDelivery && afterData.telegramDeliveryMessage) {
    // Si el delivery asignado cambió en esta actualización, NO actualizamos el mensaje anterior
    // con los nuevos datos; la lógica de reasignación en notifyDeliveryAssignmentLogic se encarga de esto.
    const deliveryChanged = beforeData.delivery?.assignedDelivery !== afterData.delivery?.assignedDelivery;
    if (!deliveryChanged) {
      try {
        await telegramServices.updateDeliveryTelegramMessage(afterData, orderId);
        console.log(`✅ [Telegram] Mensaje de delivery actualizado para orden ${orderId}`);
      } catch (err) {
        console.error(`❌ [Telegram] Error actualizando mensaje de delivery para orden ${orderId}:`, err);
      }
    }
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
    notifyStoreOnDeliveryAcceptanceLogic(beforeData, afterData, orderId),
    updateTelegramMessagesOnOrderChange(beforeData, afterData, orderId)
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

        // Recordatorio por Telegram a la Tienda
        if (order.businessId) {
          try {
            const businessDoc = await admin.firestore().collection('businesses').doc(order.businessId).get();
            if (businessDoc.exists) {
              const businessData = businessDoc.data();
              // Usar un nuevo método que definiremos en telegramServices
              if (typeof telegramServices.sendBusinessReminderNotification === 'function') {
                await telegramServices.sendBusinessReminderNotification(businessData, order, orderId);
              } else {
                // Fallback si el método aún no está definido, usar el estándar con la clave 'store_reminder'
                await telegramServices.sendBusinessTelegramNotification(businessData, order, orderId, 'store_reminder');
              }
            }
          } catch (telError) {
            console.error(`❌ Error enviando recordatorio por Telegram para orden ${orderId}:`, telError);
          }
        }

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

      if (todayOrders.length > 0) {
        todayOrders.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
        await emailServices.sendDailySummaryEmail(business, todayOrders, recipients, todayFormatted, previewDateStr);
      }
    }
  } catch (error) {
    console.error('❌ Error en sendDailyOrderSummary:', error);
  }
});

// Exports para Telegram y Hooks
exports.telegramWebhook = onRequest(telegramServices.handleStoreWebhook);
exports.telegramDeliveryWebhook = onRequest(telegramServices.handleDeliveryWebhook);
exports.telegramCustomerWebhook = onRequest(telegramServices.handleCustomerWebhook);
exports.telegramAdminWebhook = onRequest(telegramServices.handleAdminWebhook);
exports.handleDeliveryOrderAction = onRequest(deliveryServices.handleDeliveryOrderAction);

/**
 * Cloud Function: Enviar broadcast a todos los clientes por Telegram
 * Requiere autenticación del usuario (acceso al panel admin ya está protegido)
 */
exports.sendTelegramBroadcast = onRequest((req, res) => {
  cors(req, res, async () => {
    // Solo permitir POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      // Validar autenticación del usuario
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      const token = authHeader.substring(7);
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(token);
      } catch (error) {
        console.error('❌ Error validando token:', error.message);
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }

      // Obtener el UID del usuario
      const uid = decodedToken.uid;
      const email = decodedToken.email || 'unknown';

      // Obtener el mensaje del body
      const { message } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Mensaje requerido' });
      }

      console.log(`📢 [API Broadcast] Usuario autenticado ${email} (${uid}) iniciando broadcast`);

      // Enviar el broadcast
      const result = await telegramServices.sendBroadcastToCustomers(message);

      return res.status(200).json({
        success: result.success,
        message: result.message || result.error,
        stats: {
          total: result.total,
          successful: result.successful,
          failed: result.failed
        },
        errors: result.errors || []
      });

    } catch (error) {
      console.error('❌ Error en sendTelegramBroadcast:', error);
      return res.status(500).json({
        error: 'Error interno en el servidor',
        message: error.message
      });
    }
  });
});

/**
 * Cloud Function: Procesar broadcasts programados
 */
exports.processScheduledBroadcasts = onSchedule("every 5 minutes", async (event) => {
  console.log('⏰ [CRON] Procesando broadcasts de Telegram programados...');
  const now = new Date();

  try {
    const db = admin.firestore();
    const broadcastsRef = db.collection('telegramBroadcasts');
    
    const pendingSnapshot = await broadcastsRef
      .where('status', '==', 'pending')
      .get();

    if (pendingSnapshot.empty) {
      console.log('✅ [CRON] No hay broadcasts pendientes para procesar en este momento.');
      return;
    }

    const docsToProcess = pendingSnapshot.docs.filter(doc => {
      const data = doc.data();
      if (!data.scheduledAt) return false;
      return new Date(data.scheduledAt) <= now;
    });

    if (docsToProcess.length === 0) {
      console.log('✅ [CRON] Hay broadcasts pendientes, pero ninguno está programado para enviarse todavía.');
      return;
    }

    console.log(`🚀 [CRON] Encontrados ${docsToProcess.length} broadcasts listos para procesar.`);

    for (const doc of docsToProcess) {
      const data = doc.data();
      console.log(`📤 Procesando broadcast ${doc.id} programado para ${data.scheduledAt}`);
      
      const message = data.message;
      const button = data.button;

      // Usar la lógica existente para enviar
      const result = await telegramServices.sendBroadcastToCustomers(message, button);

      // Actualizar el documento
      await doc.ref.update({
        status: 'completed',
        totalRecipients: result.total || 0,
        successful: result.successful || 0,
        failed: result.failed || 0,
        errors: result.errors || [],
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ Broadcast ${doc.id} completado.`);
    }

  } catch (error) {
    console.error('❌ [CRON] Error procesando broadcasts programados:', error);
  }
});

/**
 * Cloud Function: Envía email a las tiendas 30 minutos antes de abrir
 */
exports.sendPreOpeningNotifications = onSchedule({
  schedule: "*/5 * * * *", // Cada 5 minutos
  timeZone: "America/Guayaquil",
  retryCount: 0
}, async (event) => {
  console.log('⏰ [CRON Pre-Apertura] Iniciando verificación de horarios de apertura...');
  try {
    const nowUtc = new Date();
    // Hora local en Ecuador (UTC-5)
    const nowEcuador = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[nowEcuador.getDay()];
    
    // Obtener la fecha en formato YYYY-MM-DD en Ecuador
    const year = nowEcuador.getFullYear();
    const month = String(nowEcuador.getMonth() + 1).padStart(2, '0');
    const date = String(nowEcuador.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${date}`;

    console.log(`📅 [CRON Pre-Apertura] Hora local Ecuador: ${todayStr} ${nowEcuador.toLocaleTimeString()} - Día: ${currentDay}`);

    const businessesSnapshot = await admin.firestore().collection('businesses').get();

    for (const businessDoc of businessesSnapshot.docs) {
      const business = businessDoc.data();
      const businessId = businessDoc.id;

      // Omitir si el negocio no está activo o está oculto
      if (business.isActive === false || business.isHidden === true) {
        continue;
      }

      // Omitir si la configuración de notificaciones pre-apertura está desactivada
      if (business.notificationSettings?.emailPreOpeningReminder === false) {
        continue;
      }

      // Omitir si ya se le envió el correo hoy
      if (business.lastPreOpeningEmailDate === todayStr) {
        continue;
      }

      const schedule = business.schedule?.[currentDay];
      if (!schedule || !schedule.isOpen || !schedule.open) {
        continue;
      }

      // Limpiar y parsear la hora de apertura (ej: "09:00" o "9:00")
      const openTimeClean = schedule.open.trim();
      const parts = openTimeClean.split(':');
      if (parts.length < 2) continue;
      
      const openH = parseInt(parts[0]);
      const openM = parseInt(parts[1]);
      if (isNaN(openH) || isNaN(openM)) continue;

      const openingDateTime = new Date(nowEcuador);
      openingDateTime.setHours(openH, openM, 0, 0);

      // Calcular diferencia en minutos (opening - now)
      const diffMs = openingDateTime.getTime() - nowEcuador.getTime();
      const diffMins = diffMs / (1000 * 60);

      // Si falta entre 25 y 30 minutos
      if (diffMins >= 25 && diffMins <= 30) {
        console.log(`📧 Tienda "${business.name || businessId}" abre en ${Math.round(diffMins)} minutos (a las ${schedule.open}). Iniciando proceso de envío...`);

        // Obtener productos disponibles del negocio
        const productsSnapshot = await admin.firestore()
          .collection('products')
          .where('businessId', '==', businessId)
          .where('isAvailable', '==', true)
          .get();

        const availableProducts = [];
        productsSnapshot.forEach(prodDoc => {
          const prodData = prodDoc.data();
          availableProducts.push({
            id: prodDoc.id,
            name: prodData.name,
            price: prodData.price || 0,
            category: prodData.category || ''
          });
        });

        // Obtener correos destinatarios
        let businessEmail = business.email;
        let recipients = [];
        if (businessEmail) {
          recipients.push(businessEmail);
        }
        const adminEmails = await getBusinessAdminEmails(businessId);
        adminEmails.forEach(email => {
          if (!recipients.includes(email)) {
            recipients.push(email);
          }
        });

        if (recipients.length === 0) {
          console.warn(`⚠️ Tienda "${business.name || businessId}" no tiene destinatarios configurados.`);
          continue;
        }

        // Llamar al servicio de email
        const emailSent = await emailServices.sendPreOpeningEmail(
          business,
          recipients,
          schedule.open,
          availableProducts
        );

        if (emailSent) {
          // Registrar que ya se envió hoy
          await businessDoc.ref.update({
            lastPreOpeningEmailDate: todayStr,
            lastPreOpeningEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`✅ Registro de envío actualizado para "${business.name || businessId}" el día ${todayStr}.`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error en sendPreOpeningNotifications:', error);
  }
});

