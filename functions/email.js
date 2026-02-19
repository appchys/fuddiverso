const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const { getBusinessAdminEmails } = require('./utils');

// Configurar el transportador de email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'appchys.ec@gmail.com',
    pass: process.env.EMAIL_PASS || 'oukz zreo izmi clul'
  },
  tls: {
    rejectUnauthorized: false // Permite certificados auto-firmados
  }
});

/**
 * Enviar email cuando se crea una nueva orden
 */
async function sendOrderCreatedEmail(order, orderId) {
  try {
    console.log(`📧 Procesando email para orden: ${orderId}`);

    // Obtener datos del negocio desde Firestore
    let businessEmail = 'info@fuddi.shop';
    let recipients = [];
    if (order.businessId) {
      try {
        const businessDoc = await admin.firestore().collection('businesses').doc(order.businessId).get();
        if (businessDoc.exists) {
          const businessData = businessDoc.data();
          if (businessData.email) {
            businessEmail = businessData.email;
            recipients.push(businessEmail);
          }

          // Obtener emails de administradores
          const adminEmails = await getBusinessAdminEmails(order.businessId);
          adminEmails.forEach(email => {
            if (!recipients.includes(email)) {
              recipients.push(email);
            }
          });

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

    if (recipients.length === 0) {
      recipients.push(businessEmail);
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

    // Texto de vista previa para notificaciones
    const previewText = order.delivery?.type === 'delivery'
      ? `🏍️ ${order.delivery?.references || 'Dirección no especificada'}`
      : '🏪 Retiro en tienda';

    // Generar HTML del email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <!-- Preview text (visible in notification preview, hidden in email body) -->
        <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
          ${previewText}
        </div>
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
      to: recipients.join(', '),
      subject: subject,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email enviado correctamente a: ${recipients.join(', ')}`);

  } catch (error) {
    console.error(`❌ Error enviando email para orden ${orderId}:`, error);
  }
}

/**
 * Enviar email de actualización de negocio (login)
 */
async function sendBusinessLoginEmail(business) {
  const adminEmail = 'appchys.ec@gmail.com';
  try {
    console.log(`🔓 Negocio inició sesión: ${business.name}`);
    const mailOptions = {
      from: 'sistema@fuddi.shop',
      to: adminEmail,
      subject: `🔓 Negocio inició sesión [${business.loginSource || 'N/A'}] - ${business.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #444;">🔓 Inicio de Sesión de Negocio</h2>
          <p>El administrador del negocio ha ingresado desde: <strong>${business.loginSource || 'Desconocido'}</strong></p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr><td style="padding: 5px;"><strong>Negocio:</strong></td><td>${business.name}</td></tr>
            <tr><td style="padding: 5px;"><strong>Email:</strong></td><td>${business.email}</td></tr>
            <tr><td style="padding: 5px;"><strong>Origen:</strong></td><td>${business.loginSource || 'No especificado'}</td></tr>
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

/**
 * Enviar email de registro de negocio
 */
async function sendBusinessCreatedEmail(business) {
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
}

/**
 * Enviar email de progreso de checkout
 */
async function sendCheckoutProgressEmail(clientData, businessData, clientId, businessId) {
  try {
    const businessEmail = businessData.email || 'info@fuddi.shop';
    const businessName = businessData.name || 'Negocio';
    const customerName = clientData.nombres || 'Cliente';

    // Verificar configuración
    const settings = businessData.notificationSettings || {
      emailCheckoutProgress: false
    };

    if (!settings.emailCheckoutProgress) {
      console.log(`🔕 Notificaciones de checkout desactivadas para negocio ${businessId}. Email cancelado.`);
      return;
    }

    const mailOptions = {
      from: 'sistema@fuddi.shop',
      to: businessEmail,
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
    console.log(`✅ Email de checkout enviado a ${businessEmail} para cliente ${clientId} en negocio ${businessId}`);

  } catch (error) {
    console.error(`❌ Error enviando email de checkout:`, error);
  }
}

/**
 * Enviar email de resumen diario
 */
async function sendDailySummaryEmail(business, todayOrders, recipients, todayFormatted, previewDateStr) {
  const businessName = business.name || 'Tu Negocio';
  const businessEmail = business.email;

  let ordersHtml = '';
  let totalRevenue = 0;

  if (todayOrders.length === 0) {
    ordersHtml = `
        <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="font-size: 16px; color: #666; margin: 0;">
            📭 No hay órdenes programadas para hoy
          </p>
          <p style="font-size: 14px; color: #999; margin: 10px 0 0 0;">
            ¡Un buen momento para promocionar tus productos!
          </p>
        </div>
      `;
  } else {
    ordersHtml = `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background-color: #aa1918; color: white;">
              <th style="padding: 12px 8px; text-align: left; border-radius: 8px 0 0 0;">Hora</th>
              <th style="padding: 12px 8px; text-align: left;">Cliente</th>
              <th style="padding: 12px 8px; text-align: left;">Productos</th>
              <th style="padding: 12px 8px; text-align: right; border-radius: 0 8px 0 0;">Total</th>
            </tr>
          </thead>
          <tbody>
      `;

    todayOrders.forEach((order, index) => {
      totalRevenue += order.total;
      const bgColor = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
      const deliveryIcon = order.deliveryType === 'delivery' ? '🚚' : '🏪';

      ordersHtml += `
          <tr style="background-color: ${bgColor};">
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #aa1918;">
              ${order.scheduledTime}
            </td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee;">
              ${deliveryIcon} ${order.customerName}
            </td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; font-size: 13px; color: #666;">
              ${order.itemsSummary}
            </td>
            <td style="padding: 12px 8px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">
              $${order.total.toFixed(2)}
            </td>
          </tr>
        `;
    });

    ordersHtml += `
          </tbody>
          <tfoot>
            <tr style="background-color: #f0f0f0;">
              <td colspan="3" style="padding: 12px 8px; font-weight: bold; border-radius: 0 0 0 8px;">
                📊 Total del día (${todayOrders.length} ${todayOrders.length === 1 ? 'orden' : 'órdenes'})
              </td>
              <td style="padding: 12px 8px; text-align: right; font-weight: bold; font-size: 18px; color: #aa1918; border-radius: 0 0 8px 0;">
                $${totalRevenue.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      `;
  }

  const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #333;">
        <!-- Preview text (visible in notification preview, hidden in email body) -->
        <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
          Resumen del ${previewDateStr}
        </div>
        <div style="background: linear-gradient(135deg, #aa1918 0%, #8a1515 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">📋 Resumen de Órdenes del Día</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">${todayFormatted}</p>
        </div>

        <div style="background-color: #ffffff; padding: 24px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
          
          <p style="margin: 0 0 16px 0; font-size: 16px;">
            ¡Buenos días, <strong>${businessName}</strong>! 👋
          </p>
          
          <p style="margin: 0 0 20px 0; color: #666;">
            Aquí tienes el resumen de las órdenes programadas para hoy:
          </p>

          ${ordersHtml}

          <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;">

          <div style="text-align: center;">
            <a href="https://fuddi.shop/business/dashboard" 
               style="display: inline-block; background-color: #aa1918; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
              📊 Ir al Dashboard
            </a>
          </div>

          <p style="margin: 20px 0 0 0; font-size: 12px; color: #999; text-align: center;">
            Este es un correo automático enviado a las 7:00 AM. No responder.
          </p>
        </div>
      </div>
    `;

  const mailOptions = {
    from: 'resumen@fuddi.shop',
    to: recipients.join(', '),
    subject: `${businessName}! Tienes ${todayOrders.length} ${todayOrders.length === 1 ? 'pedido programado' : 'pedidos programados'} para hoy!`,
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Resumen enviado a ${businessName} (${businessEmail})`);
    return true;
  } catch (emailError) {
    console.error(`❌ Error enviando resumen a ${businessName}:`, emailError);
    return false;
  }
}

/**
 * Enviar email de asignación a delivery
 */
async function sendDeliveryAssignmentEmail(order, orderId, deliveryEmail, customerName, customerPhone, businessData) {
  const businessName = businessData.name || 'Negocio';
  const businessLogo = businessData.image || '';
  const businessPhone = businessData.phone || '';

  // Información de entrega
  let deliveryInfo = 'Retiro en tienda';
  let deliveryType = 'pickup';
  let mapHtml = '';
  let photoHtml = '';

  if (order.delivery?.type === 'delivery') {
    deliveryType = 'delivery';
    deliveryInfo = order.delivery?.references || 'Dirección no especificada';

    if (order.delivery?.latlong) {
      const [lat, lng] = order.delivery.latlong.split(',').map(s => s.trim());
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

    if (order.delivery?.photo) {
      photoHtml = `
          <div style="margin-top: 12px; margin-bottom: 12px;">
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;"><strong>Foto de referencia:</strong></p>
            <img src="${order.delivery.photo}" alt="Foto de referencia" style="border-radius:8px;border:1px solid #ddd;max-width:100%;height:200px;object-fit:cover;">
          </div>
        `;
    }
  }

  // Generar HTML de productos
  let productsHtml = '<ul style="padding-left:20px; margin: 8px 0;">';
  let itemCount = 0;
  if (Array.isArray(order.items)) {
    order.items.forEach(item => {
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
  const paymentMethod = order.payment?.method || 'No especificado';
  let paymentMethodText = '';
  if (paymentMethod === 'cash') paymentMethodText = '💵 Efectivo';
  else if (paymentMethod === 'transfer') paymentMethodText = '🏦 Transferencia';
  else if (paymentMethod === 'mixed') paymentMethodText = '💳 Mixto';

  let paymentDetailsHtml = '';
  if (paymentMethod === 'mixed') {
    const cash = order.payment?.cashAmount || 0;
    const transfer = order.payment?.transferAmount || 0;
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
  const subtotal = order.subtotal || 0;
  const total = order.total || 0;
  let deliveryCost = order.delivery?.deliveryCost;
  if (deliveryCost === undefined) {
    deliveryCost = Math.max(0, total - subtotal);
  }

  // Formatear fecha y hora de entrega
  let scheduledDateStr = 'Hoy';
  let scheduledTimeStr = 'Lo antes posible';
  let timingType = 'Inmediato';

  if (order.timing?.type === 'scheduled') {
    timingType = 'Programado';
    const dateObj = order.timing.scheduledDate;
    const seconds = dateObj?.seconds || dateObj?._seconds;
    if (seconds) {
      scheduledDateStr = new Date(seconds * 1000).toLocaleDateString('es-EC', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }
    scheduledTimeStr = order.timing.scheduledTime || 'No especificada';
  }

  // Token/código único
  const confirmToken = Buffer.from(`${orderId}|confirm`).toString('base64');
  const discardToken = Buffer.from(`${orderId}|discard`).toString('base64');

  // URLs de acción
  const dashboardUrl = 'https://fuddi.shop/delivery/dashboard';
  const confirmUrl = `https://fuddi.shop/api/delivery/handle-order?action=confirm&token=${confirmToken}`;
  const discardUrl = `https://fuddi.shop/api/delivery/handle-order?action=discard&token=${discardToken}`;

  // Header del negocio para el email
  let businessHeaderHtml = '';
  if (businessName !== 'Negocio') {
    businessHeaderHtml = `
        <table border="0" cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
          <tr>
            <td width="50" style="vertical-align: middle; padding-right: 12px;">
              ${businessLogo ? `
                <img src="${businessLogo}" alt="${businessName}" style="width: 45px; height: 45px; border-radius: 50%; object-fit: cover; display: block; border: 1px solid #eee;">
              ` : `
                <div style="width: 45px; height: 45px; border-radius: 50%; background-color: #aa1918; color: white; text-align: center; line-height: 45px; font-weight: bold; font-size: 20px;">
                  ${businessName.charAt(0).toUpperCase()}
                </div>
              `}
            </td>
            <td style="vertical-align: middle;">
              <div style="font-weight: bold; font-size: 16px; color: #333; line-height: 1.2;">${businessName}</div>
              ${businessPhone ? `
                <div style="margin-top: 2px;">
                  <a href="https://wa.me/593${businessPhone.replace(/^0/, '')}" style="color: #25D366; text-decoration: none; font-size: 13px; font-weight: bold;">
                    📱 WhatsApp: ${businessPhone}
                  </a>
                </div>
              ` : ''}
            </td>
          </tr>
        </table>
      `;
  }

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
          
          ${businessHeaderHtml}

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

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de nueva orden enviado a: ${deliveryEmail}`);
  } catch (e) {
    console.error(`❌ Error enviando email a delivery: ${e.message}`);
  }
}

/**
 * Enviar email de recordatorio
 */
async function sendReminderEmail(order, orderId, recipients, scheduledTime, scheduledDateStr, customerName, customerPhone, deliveryInfo, previewText, productsHtml) {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <!-- Preview text (visible in notification preview, hidden in email body) -->
      <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        ${previewText}
      </div>
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
    to: recipients.join(', '),
    subject: `⏰ Recordatorio: ${customerName}`,
    html: htmlContent
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  transporter,
  sendOrderCreatedEmail,
  sendBusinessCreatedEmail,
  sendBusinessLoginEmail,
  sendCheckoutProgressEmail,
  sendDailySummaryEmail,
  sendDeliveryAssignmentEmail,
  sendReminderEmail
};
