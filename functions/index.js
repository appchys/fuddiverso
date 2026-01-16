/**
 * Cloud Functions para Fuddiverso
 * - Enviar email cuando se crea una nueva orden
 * - Notificaciones de cambios de estado
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

// Configurar el transportador de email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'appchys.ec@gmail.com',
    pass: process.env.EMAIL_PASS || 'oukz zreo izmi clul'
  }
});

/**
 * Cloud Function: Enviar email cuando se crea una nueva orden
 * Se ejecuta cuando se crea un documento en la colección 'orders'
 */
exports.sendOrderEmail = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const order = snap.data();
  const orderId = event.params.orderId;

  try {
    console.log(`📧 Procesando email para orden: ${orderId}`);

    // Obtener datos del negocio desde Firestore
    let businessEmail = 'info@fuddi.shop';
    if (order.businessId) {
      try {
        const businessDoc = await admin.firestore().collection('businesses').doc(order.businessId).get();
        if (businessDoc.exists) {
          const businessData = businessDoc.data();
          if (businessData.email) {
            businessEmail = businessData.email;
          }

          // Verificar configuración de notificaciones
          const settings = businessData.notificationSettings || {
            emailOrderClient: true,
            emailOrderManual: true
          };

          const isManualOrder = !!order.createdByAdmin;
          const shouldSendEmail = isManualOrder
            ? settings.emailOrderManual
            : settings.emailOrderClient;

          if (!shouldSendEmail) {
            console.log(`🔕 Notificaciones desactivadas para este tipo de orden (${isManualOrder ? 'Manual' : 'Cliente'}). Email cancelado.`);
            return;
          }
        }
      } catch (e) {
        console.warn('⚠️ No se pudo obtener datos del negocio:', e.message);
      }
    }

    // Obtener datos del cliente desde la colección 'clients' usando su ID
    let customerName = order.customer?.name || 'Cliente no especificado';
    let customerPhone = order.customer?.phone || 'No registrado';

    if (order.customer?.id) {
      try {
        const clientDoc = await admin.firestore().collection('clients').doc(order.customer.id).get();
        if (clientDoc.exists) {
          const clientData = clientDoc.data();
          customerName = clientData.nombres || customerName;
          customerPhone = clientData.celular || customerPhone;
        }
      } catch (e) {
        console.warn('⚠️ No se pudo obtener los datos del cliente:', e.message);
      }
    }

    // Información de entrega
    let deliveryInfo = 'No aplica (retiro en tienda)';
    let mapHtml = '';

    if (order.delivery?.type === 'delivery') {
      deliveryInfo = order.delivery?.references || 'Dirección no especificada';

      if (order.delivery?.latlong) {
        // Parsear latlong si viene en formato "lat,lng"
        const [lat, lng] = order.delivery.latlong.split(',').map(s => s.trim());
        if (lat && lng) {
          const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=400x200&markers=color:red%7C${lat},${lng}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`;
          const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
          mapHtml = `
            <div style="margin-top: 16px;">
              <a href="${mapsLink}" target="_blank" style="text-decoration:none;">
                <img src="${staticMapUrl}" alt="Ver ubicación" style="border-radius:8px;border:1px solid #ddd;max-width:100%;display:block;">
                <p style="text-align:center;color:#aa1918;margin:8px 0 0 0;font-weight:bold;">📍 Abrir en Google Maps</p>
              </a>
            </div>
          `;
        }
      }
    }

    // Generar HTML de productos
    let productsHtml = '<ul style="padding-left:20px;">';
    let itemCount = 0;
    if (Array.isArray(order.items)) {
      order.items.forEach(item => {
        const itemTotal = (item.price * item.quantity).toFixed(2);
        const variant = item.variant || '';
        productsHtml += `
          <li style="margin-bottom:8px;">
            <strong>${item.name}</strong>${variant ? ` (${variant})` : ''}
            <br/>
            <small>Cantidad: ${item.quantity} × $${item.price.toFixed(2)} = $${itemTotal}</small>
          </li>
        `;
        itemCount++;
      });
    }
    productsHtml += '</ul>';

    // Información de pago
    const paymentMethod = order.payment?.method || 'No especificado';
    const paymentStatus = order.payment?.paymentStatus || 'pending';
    let paymentStatusText = '';

    if (paymentStatus === 'pending') paymentStatusText = '⏳ Pendiente';
    else if (paymentStatus === 'paid') paymentStatusText = '✅ Pagado';
    else if (paymentStatus === 'validating') paymentStatusText = '⏱️ Validando';

    let paymentDetailsHtml = '';
    if (paymentMethod === 'mixed') {
      const cash = order.payment?.cashAmount || 0;
      const transfer = order.payment?.transferAmount || 0;
      paymentDetailsHtml = `
        <br/><small style="color: #666;">
          💵 Efectivo: $${cash.toFixed(2)}<br/>
          🏦 Transferencia: $${transfer.toFixed(2)}
        </small>
      `;
    }

    // Detalles de costo
    const subtotal = order.subtotal || 0;
    const total = order.total || 0;
    // Calcular envío si no viene explícito (Total - Subtotal)
    let deliveryCost = order.delivery?.deliveryCost;
    if (deliveryCost === undefined) {
      deliveryCost = Math.max(0, total - subtotal);
    }

    // Formatear fecha programada
    let scheduledDateStr = 'Hoy';
    if (order.timing?.scheduledDate) {
      const dateObj = order.timing.scheduledDate;
      // Manejar tanto Timestamp de Firestore como objeto con seconds
      const seconds = dateObj.seconds || dateObj._seconds;
      if (seconds) {
        scheduledDateStr = new Date(seconds * 1000).toLocaleDateString('es-EC', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
      }
    }

    // Generar HTML del email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background-color: #aa1918; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">¡Nuevo Pedido Recibido!</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">Pedido #${orderId.substring(0, 8).toUpperCase()}</p>
          ${order.createdByAdmin ? '<span style="background:rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-top: 4px; display: inline-block;">Creado por Admin</span>' : ''}
        </div>

        <div style="background-color: #f9f9f9; padding: 24px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          
          <h3 style="color: #aa1918; margin-top: 0;">👤 Datos del Cliente</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Nombre:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${customerName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>WhatsApp:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                <a href="https://wa.me/593${customerPhone.replace(/^0/, '')}" style="color: #aa1918; text-decoration: none;">
                  ${customerPhone}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Dirección:</strong></td>
              <td style="padding: 8px 0;">${deliveryInfo}</td>
            </tr>
          </table>
          ${mapHtml}

          <h3 style="color: #aa1918; margin-top: 20px;">📦 Productos (${itemCount})</h3>
          ${productsHtml}

          <h3 style="color: #aa1918; margin-top: 20px;">💰 Resumen de Pago</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">Subtotal:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">$${subtotal.toFixed(2)}</td>
            </tr>
            ${deliveryCost > 0.01 ? `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">Envío:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">$${deliveryCost.toFixed(2)}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 8px 0;"><strong>Total:</strong></td>
              <td style="padding: 8px 0; text-align: right;"><strong style="font-size: 16px; color: #aa1918;">$${total.toFixed(2)}</strong></td>
            </tr>
          </table>

          <h3 style="color: #aa1918; margin-top: 20px;">💳 Método de Pago</h3>
          <p style="margin: 8px 0;">
            <strong>Método:</strong> ${paymentMethod.toUpperCase()}${paymentDetailsHtml}<br/>
            <strong>Estado:</strong> ${paymentStatusText}
          </p>

          <h3 style="color: #aa1918; margin-top: 20px;">⏰ Información de Entrega</h3>
          <p style="margin: 8px 0;">
            <strong>Tipo:</strong> ${order.delivery?.type === 'delivery' ? '🚚 Envío a domicilio' : '🏪 Retiro en tienda'}<br/>
            ${order.timing?.type === 'scheduled' ? `
              <strong>Hora:</strong> ${order.timing?.scheduledTime || 'No especificada'}<br/>
              <strong>Fecha:</strong> ${scheduledDateStr}
            ` : '<strong>Entrega:</strong> Lo antes posible'}
          </p>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
          
          <p style="font-size: 12px; color: #666; margin: 0;">
            <strong>Nota:</strong> Revisa tu panel de administración en 
            <a href="https://fuddi.shop/business/dashboard" style="color: #aa1918;">Fuddi Dashboard</a>
            para más opciones y confirmar este pedido.
          </p>
        </div>

        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          <p>Este es un email automático. No responder a este correo.</p>
        </div>
      </div>
    `;

    // Determinar el ícono según el tipo de tiempo (inmediato o programado)
    const isScheduled = order.timing?.type === 'scheduled';
    const timeIcon = isScheduled ? '⏰' : '⚡';

    // Definir el asunto del correo según quién creó la orden
    const subject = order.createdByAdmin
      ? `🔔 ¡Nuevo pedido de ${customerName}! - Fuddi`
      : `${timeIcon} ${customerName} ha hecho un pedido! - Fuddi`;

    // Enviar email
    const mailOptions = {
      from: 'pedidos@fuddi.shop',
      to: businessEmail,
      subject: subject,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email enviado correctamente a: ${businessEmail}`);

  } catch (error) {
    console.error(`❌ Error enviando email para orden ${orderId}:`, error);
  }
});

/**
 * Cloud Function: Notificar cambio de estado de orden (opcional)
 * Se ejecuta cuando se actualiza un documento en la colección 'orders'
 */
exports.onOrderStatusChange = onDocumentUpdated("orders/{orderId}", async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  // Solo procesar si cambió el estado
  if (beforeData.status === afterData.status) {
    return;
  }

  const orderId = event.params.orderId;
  console.log(`📌 Orden ${orderId}: Estado cambió de "${beforeData.status}" a "${afterData.status}"`);

  // Aquí puedes agregar más lógica si necesitas notificaciones de cambio de estado
  // Por ejemplo: enviar email al cliente o actualizar un dashboard en tiempo real
});

/**
 * Cloud Function: Crear notificación en el panel cuando llega una nueva orden
 * Se ejecuta cuando se crea un documento en la colección 'orders'
 */
exports.createOrderNotification = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const order = snap.data();
  const orderId = event.params.orderId;

  // Ignorar órdenes creadas por administradores (opcional, según lógica de negocio)
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
});

/**
 * Cloud Function: Notificar cuando un nuevo CLIENTE se registra
 */
exports.onClientCreated = onDocumentCreated("clients/{clientId}", async (event) => {
  const client = event.data.data();
  const clientId = event.params.clientId;
  const adminEmail = 'appchys.ec@gmail.com';

  try {
    console.log(`👤 Nuevo cliente registrado: ${client.nombres} (${client.celular})`);

    const mailOptions = {
      from: 'sistema@fuddi.shop',
      to: adminEmail,
      subject: `🆕 ¡Nuevo Cliente! [${client.loginSource || 'N/A'}] - ${client.nombres}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #aa1918;">🆕 Nuevo Registro de Cliente</h2>
          <p>Se ha registrado un nuevo cliente en Fuddi desde: <strong>${client.loginSource || 'Desconocido'}</strong></p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr><td style="padding: 5px;"><strong>Nombre:</strong></td><td>${client.nombres}</td></tr>
            <tr><td style="padding: 5px;"><strong>WhatsApp:</strong></td><td>${client.celular}</td></tr>
            <tr><td style="padding: 5px;"><strong>ID:</strong></td><td>${clientId}</td></tr>
            <tr><td style="padding: 5px;"><strong>Origen:</strong></td><td>${client.loginSource || 'No especificado'}</td></tr>
            <tr><td style="padding: 5px;"><strong>Fecha:</strong></td><td>${new Date().toLocaleString('es-EC')}</td></tr>
          </table>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">Fuddiverso System Notification</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('❌ Error enviando email de nuevo cliente:', error);
  }
});

/**
 * Cloud Function: Notificar cuando un CLIENTE ya existente inicia sesión
 */
exports.onClientUpdated = onDocumentUpdated("clients/{clientId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const adminEmail = 'appchys.ec@gmail.com';

  // Solo notificar si cambió lastLoginAt y NO es un registro nuevo (lastRegistrationAt no cambió)
  const loginChanged = after.lastLoginAt && (!before.lastLoginAt || !after.lastLoginAt.isEqual(before.lastLoginAt));
  const isNewRegistration = after.lastRegistrationAt && (!before.lastRegistrationAt || !after.lastRegistrationAt.isEqual(before.lastRegistrationAt));

  if (loginChanged && !isNewRegistration) {
    try {
      console.log(`🔑 Cliente inició sesión: ${after.nombres}`);

      const mailOptions = {
        from: 'sistema@fuddi.shop',
        to: adminEmail,
        subject: `🔑 Cliente inició sesión [${after.loginSource || 'N/A'}] - ${after.nombres}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #444;">🔑 Inicio de Sesión de Cliente</h2>
            <p>Un cliente recurrente ha ingresado desde: <strong>${after.loginSource || 'Desconocido'}</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
              <tr><td style="padding: 5px;"><strong>Nombre:</strong></td><td>${after.nombres}</td></tr>
              <tr><td style="padding: 5px;"><strong>WhatsApp:</strong></td><td>${after.celular}</td></tr>
              <tr><td style="padding: 5px;"><strong>Origen:</strong></td><td>${after.loginSource || 'No especificado'}</td></tr>
              <tr><td style="padding: 5px;"><strong>Fecha:</strong></td><td>${new Date().toLocaleString('es-EC')}</td></tr>
            </table>
          </div>
        `
      };
      await transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('❌ Error enviando email de login de cliente:', error);
    }
  }
});

/**
 * Cloud Function: Notificar cuando un nuevo NEGOCIO se registra
 */
exports.onBusinessCreated = onDocumentCreated("businesses/{businessId}", async (event) => {
  const business = event.data.data();
  const adminEmail = 'appchys.ec@gmail.com';

  try {
    console.log(`🏪 Nuevo negocio registrado: ${business.name}`);

    const mailOptions = {
      from: 'sistema@fuddi.shop',
      to: adminEmail,
      subject: `🏪 ¡Nuevo Negocio! [${business.loginSource || 'N/A'}] - ${business.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #aa1918;">🏪 Nuevo Registro de Negocio</h2>
          <p>Un nuevo local se ha unido a Fuddiverso desde: <strong>${business.loginSource || 'Desconocido'}</strong></p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr><td style="padding: 5px;"><strong>Negocio:</strong></td><td>${business.name}</td></tr>
            <tr><td style="padding: 5px;"><strong>Email:</strong></td><td>${business.email}</td></tr>
            <tr><td style="padding: 5px;"><strong>Teléfono:</strong></td><td>${business.phone}</td></tr>
            <tr><td style="padding: 5px;"><strong>Origen:</strong></td><td>${business.loginSource || 'No especificado'}</td></tr>
            <tr><td style="padding: 5px;"><strong>Vínculo:</strong></td><td>fuddi.shop/@${business.username}</td></tr>
          </table>
        </div>
      `
    };
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('❌ Error enviando email de nuevo negocio:', error);
  }
});

/**
 * Cloud Function: Notificar cuando un NEGOCIO inicia sesión
 */
exports.onBusinessUpdated = onDocumentUpdated("businesses/{businessId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const adminEmail = 'appchys.ec@gmail.com';

  const loginChanged = after.lastLoginAt && (!before.lastLoginAt || !after.lastLoginAt.isEqual(before.lastLoginAt));
  const isNewRegistration = after.lastRegistrationAt && (!before.lastRegistrationAt || !after.lastRegistrationAt.isEqual(before.lastRegistrationAt));

  if (loginChanged && !isNewRegistration) {
    try {
      console.log(`🔓 Negocio inició sesión: ${after.name}`);

      const mailOptions = {
        from: 'sistema@fuddi.shop',
        to: adminEmail,
        subject: `🔓 Negocio inició sesión [${after.loginSource || 'N/A'}] - ${after.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #444;">🔓 Inicio de Sesión de Negocio</h2>
            <p>El administrador del negocio ha ingresado desde: <strong>${after.loginSource || 'Desconocido'}</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
              <tr><td style="padding: 5px;"><strong>Negocio:</strong></td><td>${after.name}</td></tr>
              <tr><td style="padding: 5px;"><strong>Email:</strong></td><td>${after.email}</td></tr>
              <tr><td style="padding: 5px;"><strong>Origen:</strong></td><td>${after.loginSource || 'No especificado'}</td></tr>
              <tr><td style="padding: 5px;"><strong>Fecha:</strong></td><td>${new Date().toLocaleString('es-EC')}</td></tr>
            </table>
          </div>
        `
      };
      await transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('❌ Error enviando email de login de negocio:', error);
    }
  }
});

/**
 * Cloud Function: Enviar recordatorio 30 minutos antes de la hora de entrega programada
 * Se ejecuta cada 5 minutos para verificar órdenes que necesitan recordatorio
 */
exports.sendScheduledOrderReminders = onSchedule({
  schedule: "*/5 * * * *", // Cada 5 minutos
  timeZone: "America/Guayaquil",
  retryCount: 0
}, async (event) => {
  console.log('⏰ Verificando órdenes programadas para recordatorios...');

  try {
    const now = new Date();
    // Calcular el rango de tiempo: 30-35 minutos en el futuro
    const reminderStart = new Date(now.getTime() + 30 * 60 * 1000); // +30 min
    const reminderEnd = new Date(now.getTime() + 35 * 60 * 1000);   // +35 min

    console.log(`🔍 Buscando órdenes entre ${reminderStart.toLocaleTimeString('es-EC')} y ${reminderEnd.toLocaleTimeString('es-EC')}`);

    // Obtener todas las órdenes programadas que no han sido completadas o canceladas
    const ordersSnapshot = await admin.firestore()
      .collection('orders')
      .where('timing.type', '==', 'scheduled')
      .where('status', 'in', ['pending', 'confirmed', 'preparing'])
      .get();

    if (ordersSnapshot.empty) {
      console.log('ℹ️ No hay órdenes programadas activas');
      return;
    }

    console.log(`📦 Encontradas ${ordersSnapshot.size} órdenes programadas activas`);

    let remindersSent = 0;

    for (const orderDoc of ordersSnapshot.docs) {
      const order = orderDoc.data();
      const orderId = orderDoc.id;

      // Verificar si ya se envió el recordatorio
      if (order.reminderSent) {
        continue;
      }

      // Construir la fecha y hora de entrega programada
      const scheduledDate = order.timing?.scheduledDate;
      const scheduledTime = order.timing?.scheduledTime;

      if (!scheduledDate || !scheduledTime) {
        console.warn(`⚠️ Orden ${orderId} no tiene fecha/hora programada completa`);
        continue;
      }

      // Convertir Firestore Timestamp a Date
      let dateObj;
      if (scheduledDate.seconds || scheduledDate._seconds) {
        const seconds = scheduledDate.seconds || scheduledDate._seconds;
        dateObj = new Date(seconds * 1000);
      } else if (scheduledDate instanceof Date) {
        dateObj = scheduledDate;
      } else {
        console.warn(`⚠️ Orden ${orderId} tiene formato de fecha inválido`);
        continue;
      }

      // Parsear la hora (formato: "HH:MM" o "HH:MM AM/PM")
      const timeParts = scheduledTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!timeParts) {
        console.warn(`⚠️ Orden ${orderId} tiene formato de hora inválido: ${scheduledTime}`);
        continue;
      }

      let hours = parseInt(timeParts[1]);
      const minutes = parseInt(timeParts[2]);
      const meridiem = timeParts[3];

      // Convertir a formato 24 horas si es necesario
      if (meridiem) {
        if (meridiem.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (meridiem.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      }

      // Crear la fecha/hora completa de entrega
      const deliveryDateTime = new Date(dateObj);
      deliveryDateTime.setHours(hours, minutes, 0, 0);

      // Verificar si está en el rango de 30-35 minutos
      if (deliveryDateTime >= reminderStart && deliveryDateTime <= reminderEnd) {
        console.log(`📧 Enviando recordatorio para orden ${orderId} - Entrega: ${deliveryDateTime.toLocaleString('es-EC')}`);

        // Obtener datos del negocio
        let businessEmail = 'info@fuddi.shop';
        let businessName = 'Tu negocio';

        if (order.businessId) {
          try {
            const businessDoc = await admin.firestore().collection('businesses').doc(order.businessId).get();
            if (businessDoc.exists) {
              const businessData = businessDoc.data();
              businessEmail = businessData.email || businessEmail;
              businessName = businessData.name || businessName;
            }
          } catch (e) {
            console.warn(`⚠️ No se pudo obtener datos del negocio para orden ${orderId}:`, e.message);
          }
        }

        // Obtener datos del cliente
        let customerName = order.customer?.name || 'Cliente no especificado';
        let customerPhone = order.customer?.phone || 'No registrado';

        if (order.customer?.id) {
          try {
            const clientDoc = await admin.firestore().collection('clients').doc(order.customer.id).get();
            if (clientDoc.exists) {
              const clientData = clientDoc.data();
              customerName = clientData.nombres || customerName;
              customerPhone = clientData.celular || customerPhone;
            }
          } catch (e) {
            console.warn(`⚠️ No se pudo obtener datos del cliente para orden ${orderId}:`, e.message);
          }
        }

        // Información de entrega
        let deliveryInfo = 'Retiro en tienda';
        if (order.delivery?.type === 'delivery') {
          deliveryInfo = order.delivery?.references || 'Dirección no especificada';
        }

        // Generar HTML de productos
        let productsHtml = '<ul style="padding-left:20px;">';
        if (Array.isArray(order.items)) {
          order.items.forEach(item => {
            const variant = item.variant || '';
            productsHtml += `
              <li style="margin-bottom:8px;">
                <strong>${item.name}</strong>${variant ? ` (${variant})` : ''}
                <br/>
                <small>Cantidad: ${item.quantity}</small>
              </li>
            `;
          });
        }
        productsHtml += '</ul>';

        // Formatear fecha de entrega
        const scheduledDateStr = deliveryDateTime.toLocaleDateString('es-EC', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        // Crear el email de recordatorio
        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <div style="background: linear-gradient(135deg, #ff6b35 0%, #aa1918 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">⏰ Recordatorio de Entrega</h1>
              <p style="margin: 8px 0 0 0; opacity: 0.9;">¡Faltan 30 minutos para la entrega!</p>
              <p style="margin: 8px 0 0 0; font-size: 14px;">Pedido #${orderId.substring(0, 8).toUpperCase()}</p>
            </div>

            <div style="background-color: #f9f9f9; padding: 24px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
              
              <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
                <p style="margin: 0; color: #856404;">
                  <strong>⏰ Hora de entrega programada:</strong><br/>
                  ${scheduledTime} - ${scheduledDateStr}
                </p>
              </div>

              <h3 style="color: #aa1918; margin-top: 0;">👤 Cliente</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Nombre:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${customerName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>WhatsApp:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <a href="https://wa.me/593${customerPhone.replace(/^0/, '')}" style="color: #aa1918; text-decoration: none;">
                      ${customerPhone}
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>${order.delivery?.type === 'delivery' ? 'Dirección:' : 'Retiro:'}</strong></td>
                  <td style="padding: 8px 0;">${deliveryInfo}</td>
                </tr>
              </table>

              <h3 style="color: #aa1918; margin-top: 20px;">📦 Productos</h3>
              ${productsHtml}

              <h3 style="color: #aa1918; margin-top: 20px;">💰 Total</h3>
              <p style="font-size: 20px; font-weight: bold; color: #aa1918; margin: 8px 0;">
                $${(order.total || 0).toFixed(2)}
              </p>

              <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
              
              <p style="font-size: 12px; color: #666; margin: 0;">
                <strong>Nota:</strong> Este es un recordatorio automático. Revisa tu 
                <a href="https://fuddi.shop/business/dashboard" style="color: #aa1918;">panel de administración</a>
                para gestionar este pedido.
              </p>
            </div>

            <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
              <p>Este es un email automático. No responder a este correo.</p>
            </div>
          </div>
        `;

        // Enviar el email
        const mailOptions = {
          from: 'recordatorios@fuddi.shop',
          to: businessEmail,
          subject: `⏰ Recordatorio: Entrega en 30 min - ${customerName} - Fuddi`,
          html: htmlContent
        };

        try {
          await transporter.sendMail(mailOptions);

          // Marcar la orden como recordatorio enviado
          await orderDoc.ref.update({
            reminderSent: true,
            reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
          });

          remindersSent++;
          console.log(`✅ Recordatorio enviado para orden ${orderId} a ${businessEmail}`);
        } catch (emailError) {
          console.error(`❌ Error enviando recordatorio para orden ${orderId}:`, emailError);
        }
      }
    }

    console.log(`✅ Proceso completado. Recordatorios enviados: ${remindersSent}`);

  } catch (error) {
    console.error('❌ Error en sendScheduledOrderReminders:', error);
  }
});

