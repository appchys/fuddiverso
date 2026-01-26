/**
 * Cloud Functions para Fuddiverso
 * - Enviar email cuando se crea una nueva orden
 * - Notificaciones de cambios de estado
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
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
 * Cloud Function: Notificar cuando un cliente empieza el checkout de un negocio específico
 * Se ejecuta cuando se crea un documento en la colección 'checkoutProgress'
 */
exports.onCheckoutProgressUpdate = onDocumentCreated("checkoutProgress/{docId}", async (event) => {
  const afterData = event.data.data();

  if (!afterData) {
    return;
  }

  const docId = event.params.docId;
  const clientId = afterData.clientId;
  const businessId = afterData.businessId;

  if (!clientId || !businessId) {
    console.warn(`⚠️ Documento ${docId} no tiene clientId o businessId`);
    return;
  }

  try {
    console.log(`🛒 Cliente ${clientId} empezó checkout en negocio ${businessId}`);

    // Obtener datos del cliente
    let customerName = 'Cliente';
    try {
      const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();
      if (clientDoc.exists) {
        const clientData = clientDoc.data();
        customerName = clientData.nombres || customerName;
      }
    } catch (e) {
      console.warn(`⚠️ No se pudo obtener datos del cliente ${clientId}:`, e.message);
    }

    // Obtener datos del negocio
    let businessName = 'Negocio';
    try {
      const businessDoc = await admin.firestore().collection('businesses').doc(businessId).get();
      if (businessDoc.exists) {
        const businessData = businessDoc.data();
        businessName = businessData.name || businessName;
      }
    } catch (e) {
      console.warn(`⚠️ No se pudo obtener datos del negocio ${businessId}:`, e.message);
    }

    const mailOptions = {
      from: 'sistema@fuddi.shop',
      to: 'appchys.ec@gmail.com',
      subject: `🛒 ${customerName} está haciendo checkout en ${businessName}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #aa1918;">🛒 Checkout Iniciado</h2>
          <p><strong>${customerName}</strong> ha comenzado el proceso de checkout en <strong>${businessName}</strong>.</p>
          
          <div style="background-color: #e8f5e8; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin-top: 0; color: #2e7d32;">
              <strong>💡 Monitoreo en tiempo real:</strong> Usa el botón abajo para ver el progreso del checkout.
            </p>
            <p style="margin-bottom: 0; color: #2e7d32; font-size: 12px;">
              Verás en tiempo real cómo avanza en el proceso: productos, datos, dirección, horario y pago.
            </p>
          </div>

          <div style="text-align: center; margin: 20px 0;">
            <a href="https://fuddi.shop/admin/checkout-monitor/${clientId}?businessId=${businessId}" 
               style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
              👁️ Ver Avance del Checkout
            </a>
            <p style="margin-top: 10px; font-size: 12px; color: #666;">
              URL: <code>https://fuddi.shop/admin/checkout-monitor/${clientId}?businessId=${businessId}</code>
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background-color: #f9f9f9; border-radius: 4px; overflow: hidden;">
            <tr><td style="padding: 10px; background-color: #aa1918; color: white; font-weight: bold;" colspan="2">Detalles</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Cliente ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${clientId}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Negocio ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${businessId}</td></tr>
            <tr><td style="padding: 8px;"><strong>Fecha:</strong></td><td style="padding: 8px;">${new Date().toLocaleString('es-EC')}</td></tr>
          </table>

          <p style="font-size: 12px; color: #999; margin-top: 20px;">
            Esta es una notificación automática del sistema de monitoreo. No responder.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de checkout enviado para cliente ${clientId} en negocio ${businessId}`);

  } catch (error) {
    console.error(`❌ Error enviando email de checkout para ${docId}:`, error);
  }
});

/**
 * Cloud Function: Notificar cuando un CLIENTE ya existente inicia sesión
 */
exports.onClientUpdated = onDocumentUpdated("clients/{clientId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const clientId = event.params.clientId;
  const adminEmail = 'appchys.ec@gmail.com';

  // Solo notificar si cambió lastLoginAt y NO es un registro nuevo (lastRegistrationAt no cambió)
  const loginChanged = after.lastLoginAt && (!before.lastLoginAt || !after.lastLoginAt.isEqual(before.lastLoginAt));
  const isNewRegistration = after.lastRegistrationAt && (!before.lastRegistrationAt || !after.lastRegistrationAt.isEqual(before.lastRegistrationAt));

  if (loginChanged && !isNewRegistration) {
    try {
      console.log(`🔑 Cliente inició sesión: ${after.nombres}`);

      // Token para el botón de "Ver avance" (será usado con un businessId específico)
      const monitorToken = Buffer.from(`${clientId}|${new Date().getTime()}`).toString('base64'); const businessId = after.businessId || '';// INSERT_BUSINESS_ID_HERE\n      const businessId = after.businessId || '';

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

            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

            <div style="background-color: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin-top: 0; color: #1565c0;">
                <strong>💡 Tip:</strong> Usa el botón abajo para ver en tiempo real el progreso del pedido que está creando este cliente.
              </p>
              <p style="margin-bottom: 0; color: #1565c0; font-size: 12px;">
                Se actualizará automáticamente mientras selecciona productos, dirección, horario y método de pago.
              </p>
            </div>

            <div style="text-align: center; margin: 20px 0;">
              <a href="https://fuddi.shop/admin/checkout-monitor/${clientId}?businessId=${businessId}" 
                 style="display: inline-block; background-color: #2196F3; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
                👁️ Ver Avance del Checkout
              </a>
              <p style="margin-top: 10px; font-size: 12px; color: #666;">
                <strong>Importante:</strong> Reemplaza <code>${businessId}</code> con el ID del negocio que está visitando el cliente.
              </p>
            </div>

            <p style="font-size: 12px; color: #999; margin-top: 20px;">
              Este es un email automático de monitoreo del sistema. No responder.
            </p>
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
    // Obtener hora actual en Ecuador explícitamente
    const nowUtc = new Date();
    // Ajustar a UTC-5 (Ecuador) manualmente para asegurar consistencia
    // Cloud Functions corre en UTC. Restamos 5 horas.
    const nowEcuador = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));

    // Calcular el rango de tiempo: 30-35 minutos en el futuro
    const reminderStart = new Date(nowEcuador.getTime() + 30 * 60 * 1000); // +30 min
    const reminderEnd = new Date(nowEcuador.getTime() + 35 * 60 * 1000);   // +35 min

    const options = { timeZone: 'America/Guayaquil', hour12: true, hour: 'numeric', minute: 'numeric', second: 'numeric' };
    console.log(`🔍 Hora Servidor (UTC): ${nowUtc.toISOString()}`);
    console.log(`🔍 Hora Ecuador Calculada: ${nowEcuador.toISOString()}`);
    console.log(`🔍 Buscando órdenes para entrega entre: ${reminderStart.toLocaleTimeString('es-EC', options)} y ${reminderEnd.toLocaleTimeString('es-EC', options)}`);

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

/**
 * Cloud Function: Notificar al delivery cuando se crea una orden con delivery asignado
 * Se ejecuta cuando se CREA una orden que ya tiene assignedDelivery
 */
exports.notifyDeliveryOnOrderCreation = onDocumentCreated("orders/{orderId}", async (event) => {
  const orderData = event.data.data();
  const orderId = event.params.orderId;
  const assignedDeliveryId = orderData.delivery?.assignedDelivery;

  // Solo procesar si la orden fue creada con un delivery asignado
  if (!assignedDeliveryId) {
    console.log(`⏭️ Orden ${orderId} creada sin delivery asignado, abortando notificación`);
    return;
  }

  console.log(`📦 Nueva orden ${orderId} con delivery: ${assignedDeliveryId}`);

  // Reutilizar la lógica de envío de email
  try {
    // Obtener datos del delivery
    let deliveryEmail = null;
    let deliveryName = 'Repartidor';

    try {
      const deliveryDoc = await admin.firestore().collection('deliveries').doc(assignedDeliveryId).get();
      if (deliveryDoc.exists) {
        const deliveryData = deliveryDoc.data();
        deliveryEmail = deliveryData.email;
        deliveryName = deliveryData.name || `${deliveryData.firstName} ${deliveryData.lastName}` || deliveryName;
        console.log(`✅ Datos del delivery encontrados: ${deliveryName} (${deliveryEmail})`);
      } else {
        console.warn(`⚠️ Documento de delivery ${assignedDeliveryId} no encontrado`);
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Error obteniendo datos del delivery:`, e.message);
      return;
    }

    if (!deliveryEmail) {
      console.warn(`⚠️ El delivery no tiene email registrado`);
      return;
    }

    // Obtener datos del cliente
    let customerName = orderData.customer?.name || 'Cliente no especificado';
    let customerPhone = orderData.customer?.phone || 'No registrado';

    if (orderData.customer?.id) {
      try {
        const clientDoc = await admin.firestore().collection('clients').doc(orderData.customer.id).get();
        if (clientDoc.exists) {
          const clientData = clientDoc.data();
          customerName = clientData.nombres || customerName;
          customerPhone = clientData.celular || customerPhone;
        }
      } catch (e) {
        console.warn(`⚠️ Error obteniendo datos del cliente:`, e.message);
      }
    }

    // Preparar información de entrega (código duplicado pero necesario)
    let deliveryInfo = 'Retiro en tienda';
    let deliveryType = 'pickup';
    let mapHtml = '';
    let photoHtml = '';

    if (orderData.delivery?.type === 'delivery') {
      deliveryType = 'delivery';
      deliveryInfo = orderData.delivery?.references || 'Dirección no especificada';

      if (orderData.delivery?.latlong) {
        const [lat, lng] = orderData.delivery.latlong.split(',').map(s => s.trim());
        if (lat && lng) {
          const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=400x200&markers=color:red%7C${lat},${lng}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`;
          const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
          mapHtml = `
            <div style="margin-top: 12px; margin-bottom: 12px;">
              <a href="${mapsLink}" target="_blank" style="text-decoration:none;">
                <img src="${staticMapUrl}" alt="Ver ubicación" style="border-radius:8px;border:1px solid #ddd;max-width:100%;display:block;height:200px;object-fit:cover;">
              </a>
            </div>
          `;
        }
      }

      if (orderData.delivery?.photo) {
        photoHtml = `
          <div style="margin-top: 12px; margin-bottom: 12px;">
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;"><strong>Foto de referencia:</strong></p>
            <img src="${orderData.delivery.photo}" alt="Foto de referencia" style="border-radius:8px;border:1px solid #ddd;max-width:100%;height:200px;object-fit:cover;">
          </div>
        `;
      }
    }

    // Generar HTML de productos
    let productsHtml = '<ul style="padding-left:20px; margin: 8px 0;">';
    let itemCount = 0;
    if (Array.isArray(orderData.items)) {
      orderData.items.forEach(item => {
        const itemTotal = (item.price * item.quantity).toFixed(2);
        const variant = item.variant || '';
        productsHtml += `
          <li style="margin-bottom:8px;">
            <strong>${item.name}</strong>${variant ? ` (${variant})` : ''}
            <br/>
            <small style="color: #666;">Cantidad: ${item.quantity} × $${item.price.toFixed(2)} = $${itemTotal}</small>
          </li>
        `;
        itemCount++;
      });
    }
    productsHtml += '</ul>';

    // Información de pago
    const paymentMethod = orderData.payment?.method || 'No especificado';
    let paymentMethodText = '';
    if (paymentMethod === 'cash') paymentMethodText = '💵 Efectivo';
    else if (paymentMethod === 'transfer') paymentMethodText = '🏦 Transferencia';
    else if (paymentMethod === 'mixed') paymentMethodText = '💳 Mixto';

    let paymentDetailsHtml = '';
    if (paymentMethod === 'mixed') {
      const cash = orderData.payment?.cashAmount || 0;
      const transfer = orderData.payment?.transferAmount || 0;
      paymentDetailsHtml = `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px;">💵 Efectivo:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-size: 12px;">$${cash.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px;">🏦 Transferencia:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-size: 12px;">$${transfer.toFixed(2)}</td>
        </tr>
      `;
    }

    // Detalles de costo
    const subtotal = orderData.subtotal || 0;
    const total = orderData.total || 0;
    let deliveryCost = orderData.delivery?.deliveryCost;
    if (deliveryCost === undefined) {
      deliveryCost = Math.max(0, total - subtotal);
    }

    // Formatear fecha y hora de entrega
    let scheduledDateStr = 'Hoy';
    let scheduledTimeStr = 'Lo antes posible';
    let timingType = 'Inmediato';

    if (orderData.timing?.type === 'scheduled') {
      timingType = 'Programado';
      const dateObj = orderData.timing.scheduledDate;
      const seconds = dateObj?.seconds || dateObj?._seconds;
      if (seconds) {
        scheduledDateStr = new Date(seconds * 1000).toLocaleDateString('es-EC', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
      }
      scheduledTimeStr = orderData.timing.scheduledTime || 'No especificada';
    }

    // Token/código único
    const confirmToken = Buffer.from(`${orderId}|confirm`).toString('base64');
    const discardToken = Buffer.from(`${orderId}|discard`).toString('base64');

    // URLs de acción
    const dashboardUrl = 'https://fuddi.shop/delivery/dashboard';
    const confirmUrl = `https://fuddi.shop/api/delivery/handle-order?action=confirm&token=${confirmToken}`;
    const discardUrl = `https://fuddi.shop/api/delivery/handle-order?action=discard&token=${discardToken}`;

    // Obtener datos del negocio
    let businessName = 'Negocio';
    if (orderData.businessId) {
      try {
        const businessDoc = await admin.firestore().collection('businesses').doc(orderData.businessId).get();
        if (businessDoc.exists) {
          businessName = businessDoc.data().name || businessName;
        }
      } catch (e) {
        console.warn(`⚠️ Error obteniendo datos del negocio:`, e.message);
      }
    }

    // Email HTML (igual al de actualización)
    const htmlContent = `
      <div style="display: none; max-height: 0px; overflow: hidden;">
        📍 ${deliveryInfo}
      </div>
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">🚚 ¡Nuevo Pedido Asignado!</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">Pedido #${orderId.substring(0, 8).toUpperCase()}</p>
        </div>

        <div style="background-color: #f9f9f9; padding: 24px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          
          <!-- Información de Entrega -->
          <div style="background-color: #e8f5e9; border-left: 4px solid #4CAF50; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #2E7D32; font-size: 14px;">
              <strong>⏰ ${timingType}</strong><br/>
              ${scheduledTimeStr} - ${scheduledDateStr}
            </p>
          </div>

          <h3 style="color: #2E7D32; margin-top: 0; font-size: 16px;">👤 Datos del Cliente</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Nombre:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${customerName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>WhatsApp:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                <a href="https://wa.me/593${customerPhone.replace(/^0/, '')}" style="color: #4CAF50; text-decoration: none; font-weight: bold;">
                  ${customerPhone}
                </a>
              </td>
            </tr>
          </table>

          <!-- Información de Dirección -->
          ${deliveryType === 'delivery' ? `
            <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">📍 Dirección de Entrega</h3>
            <p style="margin: 8px 0; padding: 8px; background-color: #fff9c4; border-radius: 4px; font-size: 14px;">
              ${deliveryInfo}
            </p>
            ${mapHtml}
            ${photoHtml}
          ` : `
            <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">🏪 Retiro en Tienda</h3>
            <p style="margin: 8px 0; font-size: 14px;">El cliente retirará el pedido en la tienda</p>
          `}

          <!-- Detalles de la Orden -->
          <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">📦 Detalle del Pedido (${itemCount} artículos)</h3>
          ${productsHtml}

          <!-- Resumen de Pago -->
          <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">💰 Resumen a Cobrar</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Subtotal:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;"><strong>$${subtotal.toFixed(2)}</strong></td>
            </tr>
            ${deliveryCost > 0.01 ? `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">Envío:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">$${deliveryCost.toFixed(2)}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 12px 0; font-size: 16px;"><strong>TOTAL A COBRAR:</strong></td>
              <td style="padding: 12px 0; text-align: right; font-size: 18px; color: #2E7D32;"><strong>$${total.toFixed(2)}</strong></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 12px; color: #666;"><strong>Método de Pago:</strong></td>
              <td style="padding: 8px 0; text-align: right; font-size: 12px; color: #666;"><strong>${paymentMethodText}</strong></td>
            </tr>
            ${paymentDetailsHtml}
          </table>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

          <!-- Botones de Acción -->
          <div style="text-align: center; margin: 20px 0;">
            <p style="margin: 0 0 12px 0; font-size: 14px; color: #666;"><strong>¿Aceptarás este pedido?</strong></p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 0 6px; width: 50%;">
                  <a href="${confirmUrl}" style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; border: 2px solid #4CAF50;">
                    ✅ Confirmar
                  </a>
                </td>
                <td style="padding: 0 6px; width: 50%;">
                  <a href="${discardUrl}" style="display: inline-block; background-color: #f44336; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; border: 2px solid #f44336;">
                    ❌ Descartar
                  </a>
                </td>
              </tr>
            </table>
          </div>

          <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
            O accede a tu <a href="${dashboardUrl}" style="color: #4CAF50; text-decoration: none;"><strong>Dashboard de Entrega</strong></a> para más opciones
          </p>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
          
          <p style="font-size: 11px; color: #999; margin: 0; text-align: center;">
            Este es un email automático. No responder a este correo.
          </p>
        </div>
      </div>
    `;

    // Enviar email
    const mailOptions = {
      from: 'pedidos@fuddi.shop',
      to: deliveryEmail,
      subject: `🛵 Asignado - ${customerName} - ${businessName}`,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de nueva orden enviado a: ${deliveryEmail}`);

  } catch (error) {
    console.error(`❌ Error notificando al delivery:`, error);
  }
});

/**
 * Cloud Function: Notificar al delivery cuando se le asigna una orden
 * Se ejecuta cuando se actualiza una orden y se asigna un delivery
 */
exports.notifyDeliveryAssignment = onDocumentUpdated("orders/{orderId}", async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  const orderId = event.params.orderId;

  // Verificar si el delivery fue asignado o cambió
  const beforeDeliveryId = beforeData.delivery?.assignedDelivery;
  const afterDeliveryId = afterData.delivery?.assignedDelivery;

  // Log detallado para debugging
  console.log(`🔍 Analizando cambio en orden ${orderId}:`, {
    beforeDeliveryId: beforeDeliveryId || 'sin asignar',
    afterDeliveryId: afterDeliveryId || 'sin asignar',
    deliveryChanged: beforeDeliveryId !== afterDeliveryId
  });

  // Solo procesar si:
  // 1. Ahora hay un delivery asignado
  // 2. Y es diferente al anterior (o no había anterior)
  if (!afterDeliveryId) {
    console.log(`⏭️ No hay delivery asignado en esta orden, abortando notificación`);
    return;
  }

  if (beforeDeliveryId === afterDeliveryId) {
    console.log(`⏭️ El delivery no cambió, abortando notificación`);
    return;
  }

  try {
    console.log(`📦 Orden ${orderId} asignada al delivery: ${afterDeliveryId} (anterior: ${beforeDeliveryId || 'sin asignar'})`);

    // Obtener datos del delivery (repartidor)
    let deliveryEmail = null;
    let deliveryName = 'Repartidor';

    try {
      const deliveryDoc = await admin.firestore().collection('deliveries').doc(afterDeliveryId).get();
      if (deliveryDoc.exists) {
        const deliveryData = deliveryDoc.data();
        deliveryEmail = deliveryData.email;
        deliveryName = deliveryData.name || `${deliveryData.firstName} ${deliveryData.lastName}` || deliveryName;
        console.log(`✅ Datos del delivery encontrados: ${deliveryName} (${deliveryEmail})`);
      } else {
        console.warn(`⚠️ Documento de delivery ${afterDeliveryId} no encontrado`);
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Error obteniendo datos del delivery ${afterDeliveryId}:`, e.message);
      return; // Si no podemos obtener el email, no continuamos
    }

    if (!deliveryEmail) {
      console.warn(`⚠️ El delivery ${afterDeliveryId} no tiene email registrado en Firestore`);
      return;
    }

    // Obtener datos del cliente
    let customerName = afterData.customer?.name || 'Cliente no especificado';
    let customerPhone = afterData.customer?.phone || 'No registrado';

    if (afterData.customer?.id) {
      try {
        const clientDoc = await admin.firestore().collection('clients').doc(afterData.customer.id).get();
        if (clientDoc.exists) {
          const clientData = clientDoc.data();
          customerName = clientData.nombres || customerName;
          customerPhone = clientData.celular || customerPhone;
          console.log(`✅ Cliente encontrado: ${customerName}`);
        }
      } catch (e) {
        console.warn(`⚠️ Error obteniendo datos del cliente:`, e.message);
      }
    }

    // Información de entrega
    let deliveryInfo = 'Retiro en tienda';
    let deliveryType = 'pickup';
    let mapHtml = '';
    let photoHtml = '';

    if (afterData.delivery?.type === 'delivery') {
      deliveryType = 'delivery';
      deliveryInfo = afterData.delivery?.references || 'Dirección no especificada';

      if (afterData.delivery?.latlong) {
        const [lat, lng] = afterData.delivery.latlong.split(',').map(s => s.trim());
        if (lat && lng) {
          const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=400x200&markers=color:red%7C${lat},${lng}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`;
          const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
          mapHtml = `
            <div style="margin-top: 12px; margin-bottom: 12px;">
              <a href="${mapsLink}" target="_blank" style="text-decoration:none;">
                <img src="${staticMapUrl}" alt="Ver ubicación" style="border-radius:8px;border:1px solid #ddd;max-width:100%;display:block;height:200px;object-fit:cover;">
              </a>
            </div>
          `;
        }
      }

      if (afterData.delivery?.photo) {
        photoHtml = `
          <div style="margin-top: 12px; margin-bottom: 12px;">
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;"><strong>Foto de referencia:</strong></p>
            <img src="${afterData.delivery.photo}" alt="Foto de referencia" style="border-radius:8px;border:1px solid #ddd;max-width:100%;height:200px;object-fit:cover;">
          </div>
        `;
      }
    }

    // Generar HTML de productos
    let productsHtml = '<ul style="padding-left:20px; margin: 8px 0;">';
    let itemCount = 0;
    if (Array.isArray(afterData.items)) {
      afterData.items.forEach(item => {
        const itemTotal = (item.price * item.quantity).toFixed(2);
        const variant = item.variant || '';
        productsHtml += `
          <li style="margin-bottom:8px;">
            <strong>${item.name}</strong>${variant ? ` (${variant})` : ''}
            <br/>
            <small style="color: #666;">Cantidad: ${item.quantity} × $${item.price.toFixed(2)} = $${itemTotal}</small>
          </li>
        `;
        itemCount++;
      });
    }
    productsHtml += '</ul>';

    // Información de pago
    const paymentMethod = afterData.payment?.method || 'No especificado';
    let paymentMethodText = '';
    if (paymentMethod === 'cash') paymentMethodText = '💵 Efectivo';
    else if (paymentMethod === 'transfer') paymentMethodText = '🏦 Transferencia';
    else if (paymentMethod === 'mixed') paymentMethodText = '💳 Mixto';

    let paymentDetailsHtml = '';
    if (paymentMethod === 'mixed') {
      const cash = afterData.payment?.cashAmount || 0;
      const transfer = afterData.payment?.transferAmount || 0;
      paymentDetailsHtml = `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px;">💵 Efectivo:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-size: 12px;">$${cash.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px;">🏦 Transferencia:</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-size: 12px;">$${transfer.toFixed(2)}</td>
        </tr>
      `;
    }

    // Detalles de costo
    const subtotal = afterData.subtotal || 0;
    const total = afterData.total || 0;
    let deliveryCost = afterData.delivery?.deliveryCost;
    if (deliveryCost === undefined) {
      deliveryCost = Math.max(0, total - subtotal);
    }

    // Formatear fecha y hora de entrega
    let scheduledDateStr = 'Hoy';
    let scheduledTimeStr = 'Lo antes posible';
    let timingType = 'Inmediato';

    if (afterData.timing?.type === 'scheduled') {
      timingType = 'Programado';
      const dateObj = afterData.timing.scheduledDate;
      const seconds = dateObj?.seconds || dateObj?._seconds;
      if (seconds) {
        scheduledDateStr = new Date(seconds * 1000).toLocaleDateString('es-EC', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
      }
      scheduledTimeStr = afterData.timing.scheduledTime || 'No especificada';
    }

    // Token/código único para la orden (usar orderId como base)
    const confirmToken = Buffer.from(`${orderId}|confirm`).toString('base64');
    const discardToken = Buffer.from(`${orderId}|discard`).toString('base64');

    // URLs de acción (ajustar el dominio según tu entorno)
    const dashboardUrl = 'https://fuddi.shop/delivery/dashboard';
    const confirmUrl = `https://fuddi.shop/api/delivery/handle-order?action=confirm&token=${confirmToken}`;
    const discardUrl = `https://fuddi.shop/api/delivery/handle-order?action=discard&token=${discardToken}`;

    // Obtener datos del negocio
    let businessName = 'Negocio';
    if (afterData.businessId) {
      try {
        const businessDoc = await admin.firestore().collection('businesses').doc(afterData.businessId).get();
        if (businessDoc.exists) {
          businessName = businessDoc.data().name || businessName;
        }
      } catch (e) {
        console.warn(`⚠️ Error obteniendo datos del negocio:`, e.message);
      }
    }

    // Generar HTML del email
    const htmlContent = `
      <div style="display: none; max-height: 0px; overflow: hidden;">
        📍 ${deliveryInfo}
      </div>
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">🚚 ¡Nuevo Pedido Asignado!</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9;">Pedido #${orderId.substring(0, 8).toUpperCase()}</p>
        </div>

        <div style="background-color: #f9f9f9; padding: 24px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          
          <!-- Información de Entrega -->
          <div style="background-color: #e8f5e9; border-left: 4px solid #4CAF50; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #2E7D32; font-size: 14px;">
              <strong>⏰ ${timingType}</strong><br/>
              ${scheduledTimeStr} - ${scheduledDateStr}
            </p>
          </div>

          <h3 style="color: #2E7D32; margin-top: 0; font-size: 16px;">👤 Datos del Cliente</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Nombre:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${customerName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>WhatsApp:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                <a href="https://wa.me/593${customerPhone.replace(/^0/, '')}" style="color: #4CAF50; text-decoration: none; font-weight: bold;">
                  ${customerPhone}
                </a>
              </td>
            </tr>
          </table>

          <!-- Información de Dirección -->
          ${deliveryType === 'delivery' ? `
            <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">📍 Dirección de Entrega</h3>
            <p style="margin: 8px 0; padding: 8px; background-color: #fff9c4; border-radius: 4px; font-size: 14px;">
              ${deliveryInfo}
            </p>
            ${mapHtml}
            ${photoHtml}
          ` : `
            <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">🏪 Retiro en Tienda</h3>
            <p style="margin: 8px 0; font-size: 14px;">El cliente retirará el pedido en la tienda</p>
          `}

          <!-- Detalles de la Orden -->
          <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">📦 Detalle del Pedido (${itemCount} artículos)</h3>
          ${productsHtml}

          <!-- Resumen de Pago -->
          <h3 style="color: #2E7D32; margin-top: 20px; font-size: 16px;">💰 Resumen a Cobrar</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Subtotal:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;"><strong>$${subtotal.toFixed(2)}</strong></td>
            </tr>
            ${deliveryCost > 0.01 ? `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">Envío:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">$${deliveryCost.toFixed(2)}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 12px 0; font-size: 16px;"><strong>TOTAL A COBRAR:</strong></td>
              <td style="padding: 12px 0; text-align: right; font-size: 18px; color: #2E7D32;"><strong>$${total.toFixed(2)}</strong></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 12px; color: #666;"><strong>Método de Pago:</strong></td>
              <td style="padding: 8px 0; text-align: right; font-size: 12px; color: #666;"><strong>${paymentMethodText}</strong></td>
            </tr>
            ${paymentDetailsHtml}
          </table>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

          <!-- Botones de Acción -->
          <div style="text-align: center; margin: 20px 0;">
            <p style="margin: 0 0 12px 0; font-size: 14px; color: #666;"><strong>¿Aceptarás este pedido?</strong></p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 0 6px; width: 50%;">
                  <a href="${confirmUrl}" style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; border: 2px solid #4CAF50;">
                    ✅ Confirmar
                  </a>
                </td>
                <td style="padding: 0 6px; width: 50%;">
                  <a href="${discardUrl}" style="display: inline-block; background-color: #f44336; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; border: 2px solid #f44336;">
                    ❌ Descartar
                  </a>
                </td>
              </tr>
            </table>
          </div>

          <p style="font-size: 12px; color: #666; text-align: center; margin-top: 20px;">
            O accede a tu <a href="${dashboardUrl}" style="color: #4CAF50; text-decoration: none;"><strong>Dashboard de Entrega</strong></a> para más opciones
          </p>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
          
          <p style="font-size: 11px; color: #999; margin: 0; text-align: center;">
            Este es un email automático. No responder a este correo.
          </p>
        </div>
      </div>
    `;

    // Enviar email
    const mailOptions = {
      from: 'pedidos@fuddi.shop',
      to: deliveryEmail,
      subject: `🛵 Asignado - ${customerName} - ${businessName}`,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de asignación enviado exitosamente a: ${deliveryEmail} para orden ${orderId}`);

  } catch (error) {
    console.error(`❌ Error notificando al delivery para orden ${orderId}:`, error);
  }
});

/**
 * HTTP Function: Manejar acciones de confirmación/descarte de orden por parte del delivery
 * Accesible desde los links en el email
 */
exports.handleDeliveryOrderAction = onRequest(async (request, response) => {
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
    let orderId, actionType;
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      [orderId, actionType] = decoded.split('|');
    } catch (e) {
      return response.status(400).json({ error: 'Token inválido' });
    }

    // Validar que el action sea válido
    if (!['confirm', 'discard'].includes(action) || actionType !== action) {
      return response.status(400).json({ error: 'Acción inválida' });
    }

    // Obtener la orden
    const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return response.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = orderDoc.data();

    // Actualizar estado según la acción
    let newStatus;
    if (action === 'confirm') {
      newStatus = 'preparing'; // Cambiar a "Preparando"
      console.log(`✅ Orden ${orderId} confirmada por delivery`);
    } else if (action === 'discard') {
      newStatus = 'cancelled'; // Cambiar a "Cancelado"
      console.log(`❌ Orden ${orderId} descartada por delivery`);
    }

    // Actualizar la orden
    await orderDoc.ref.update({
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Responder con HTML que redirige al dashboard
    const redirectHtml = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Procesando orden...</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
          }
          .container {
            text-align: center;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          h1 {
            color: #2E7D32;
            margin: 0 0 16px 0;
          }
          p {
            color: #666;
            margin: 8px 0;
          }
          .icon {
            font-size: 48px;
            margin-bottom: 16px;
          }
          .button {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            margin-top: 20px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">${action === 'confirm' ? '✅' : '❌'}</div>
          <h1>${action === 'confirm' ? '¡Pedido Confirmado!' : '¡Pedido Descartado!'}</h1>
          <p>Tu acción ha sido procesada exitosamente.</p>
          <p>Redirigiendo al dashboard en 3 segundos...</p>
          <a href="https://fuddi.shop/delivery/dashboard" class="button">Ir al Dashboard</a>
        </div>
        <script>
          setTimeout(() => {
            window.location.href = 'https://fuddi.shop/delivery/dashboard';
          }, 3000);
        </script>
      </body>
      </html>
    `;

    response.type('text/html').send(redirectHtml);

  } catch (error) {
    console.error('❌ Error en handleDeliveryOrderAction:', error);
    response.status(500).json({ error: 'Error procesando la acción' });
  }
});


