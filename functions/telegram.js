const axios = require('axios');
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { processOrderAction } = require('./delivery');

// Obtener tokens de Telegram (primero intenta process.env, luego functions.config())
let STORE_BOT_TOKEN = process.env.STORE_BOT_TOKEN;
let DELIVERY_BOT_TOKEN = process.env.DELIVERY_BOT_TOKEN;
let CUSTOMER_BOT_TOKEN = process.env.CUSTOMER_BOT_TOKEN;

// Fallback a functions.config() si no está en process.env
try {
  const config = functions.config();
  if (config.telegram) {
    if (!STORE_BOT_TOKEN) STORE_BOT_TOKEN = config.telegram.store_token;
    if (!DELIVERY_BOT_TOKEN) DELIVERY_BOT_TOKEN = config.telegram.delivery_token;
    if (!CUSTOMER_BOT_TOKEN) CUSTOMER_BOT_TOKEN = config.telegram.customer_token;
  }
} catch (e) {
  console.warn('⚠️ No se pudo acceder a functions.config(), usando process.env');
}

// LOG INICIAL PARA VALIDAR TOKENS
console.log('🔍 [Telegram Init] Validando tokens de Telegram:');
console.log(`✓ STORE_BOT_TOKEN: ${STORE_BOT_TOKEN ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO'}`);
console.log(`✓ DELIVERY_BOT_TOKEN: ${DELIVERY_BOT_TOKEN ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO'}`);
console.log(`✓ CUSTOMER_BOT_TOKEN: ${CUSTOMER_BOT_TOKEN ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO'}`);

// ─── Template Engine ─────────────────────────────────────────
let _templateCache = null;
let _templateCacheTime = 0;
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Obtener plantillas de Firestore con cache en memoria
 */
async function getTemplatesFromFirestore() {
    const now = Date.now();
    if (_templateCache && (now - _templateCacheTime) < TEMPLATE_CACHE_TTL) {
        return _templateCache;
    }
    try {
        const snapshot = await admin.firestore().collection('telegramTemplates').get();
        const templates = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const key = `${data.recipient}_${data.event}`;
            templates[key] = data.template || '';
        });
        _templateCache = templates;
        _templateCacheTime = now;
        return templates;
    } catch (error) {
        console.error('Error fetching telegram templates:', error);
        return _templateCache || {};
    }
}

/**
 * Reemplazar {{variables}} en un template string y soportar lógica condicional simple
 * Sintaxis bloque if: {{#if variable == 'valor'}} ... {{/if}}
 * Soporta: ==, !=, y solo variable (existencia)
 */
function renderTemplate(templateString, variables) {
    if (!templateString) return null;
    let result = templateString;

    // 1. Procesar bloques condicionales: {{#if condition}} content [{{else}} alternative] {{/if}}
    // Regex para capturar {{#if (variable)(operator)?('value')?}} (content) [{{else}} (alternative)] {{/if}}
    const ifRegex = /\{\{#if\s+([\w.]+)(?:\s*(==|!=|contains)\s*(?:'([^']*)'|"([^"]*)"))?\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

    result = result.replace(ifRegex, (match, variable, operator, val1, val2, content, alternative) => {
        const varValue = variables[variable];
        const compareValue = val1 || val2;
        let show = false;

        if (operator === '==') {
            show = String(varValue) === String(compareValue);
        } else if (operator === '!=') {
            show = String(varValue) !== String(compareValue);
        } else if (operator === 'contains') {
            show = String(varValue).toLowerCase().includes(String(compareValue).toLowerCase());
        } else {
            // Solo {{#if variable}} -> chequear si existe y es truthy
            show = !!varValue;
        }

        if (show) return content;
        return alternative || '';
    });

    // 2. Reemplazar variables normales: {{variable}}
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, value != null ? String(value) : '');
    }

    return result;
}

/**
 * Construir mapa de variables a partir de una orden
 */
function buildTemplateVariables(orderData, businessName, options = {}) {
    const orderId = orderData.id || '';
    const customerName = orderData.customer?.name || 'No especificado';
    const phone = orderData.customer?.phone || '';
    const total = orderData.total || 0;
    const subtotal = orderData.subtotal || 0;
    const deliveryCost = orderData.delivery?.deliveryCost !== undefined
        ? orderData.delivery.deliveryCost
        : Math.max(0, total - subtotal);
    const paymentMethod = orderData.payment?.method || 'No especificado';
    let paymentMethodText = '';
    if (paymentMethod === 'cash') paymentMethodText = '💵 Efectivo';
    else if (paymentMethod === 'transfer') paymentMethodText = '🏦 Transferencia';
    else if (paymentMethod === 'mixed') paymentMethodText = '💳 Mixto';

    const deliveryAddress = orderData.delivery?.type === 'pickup'
        ? '🏪 Retiro en tienda'
        : (orderData.delivery?.references || 'Dirección no especificada');
    const deliveryType = orderData.delivery?.type || 'delivery';

    // Timing
    let scheduledTimeStr = 'Inmediato';
    if (orderData.timing?.type === 'scheduled') {
        scheduledTimeStr = orderData.timing.scheduledTime || 'Programado';
    }

    // Maps link
    let mapsLink = '';
    if (orderData.delivery?.latlong) {
        const [lat, lng] = orderData.delivery.latlong.split(',').map(s => s.trim());
        if (lat && lng) {
            mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        }
    }

    // Items text
    let itemsText = '';
    if (Array.isArray(orderData.items) && orderData.items.length > 0) {
        const groupedItems = {};
        orderData.items.forEach(item => {
            const productName = item.name || 'Producto';
            if (!groupedItems[productName]) groupedItems[productName] = [];
            groupedItems[productName].push(item);
        });
        Object.keys(groupedItems).forEach(productName => {
            const items = groupedItems[productName];
            const hasVariants = items.some(item => item.variant && item.variant.trim() !== '');
            if (hasVariants) {
                itemsText += `${productName}\n`;
                items.forEach(item => {
                    itemsText += `( ${item.quantity || 1} ) ${item.variant || productName}\n`;
                });
            } else {
                items.forEach(item => {
                    itemsText += `( ${item.quantity || 1} ) ${productName}\n`;
                });
            }
        });
    }

    // WhatsApp link
    let whatsappLink = '';
    if (phone) {
        const formattedPhone = phone.replace(/^0/, '');
        const waMessage = encodeURIComponent(`Hola, soy delivery de ${businessName}.`);
        whatsappLink = `https://wa.me/593${formattedPhone}?text=${waMessage}`;
    }

    return {
        businessName: businessName || 'Negocio',
        customerName,
        customerPhone: phone,
        orderId: orderId.slice(0, 6),
        total: `$${total.toFixed(2)}`,
        subtotal: `$${subtotal.toFixed(2)}`,
        deliveryCost: `$${deliveryCost.toFixed(2)}`,
        paymentMethod: paymentMethodText,
        deliveryAddress,
        deliveryType,
        scheduledTime: scheduledTimeStr,
        items: itemsText.trim(),
        mapsLink: mapsLink ? `<a href="${mapsLink}">Ver en Google Maps</a>` : '',
        deliveryName: options.deliveryName || '',
        whatsappLink: whatsappLink ? `<a href="${whatsappLink}">${phone}</a>` : (phone || ''),
        locationPhoto: orderData.delivery?.photo || '',
        orderStatus: orderData.status || 'pending',
        orderStatusLabel: ({
            pending: 'Pendiente',
            confirmed: 'Confirmado',
            preparing: 'Preparando',
            ready: 'Listo',
            on_way: 'En camino',
            delivered: 'Entregado',
            cancelled: 'Cancelado',
            borrador: 'Borrador'
        })[orderData.status || 'pending'] || (orderData.status || 'Pendiente'),
        paymentMethodRaw: paymentMethod,
    };
}

/**
 * Función para formatear el mensaje de Telegram
 * Intenta usar plantilla de Firestore primero, luego fallback a hardcoded.
 */
async function formatTelegramMessage(orderData, businessName, isAccepted = false) {
    // ─── Try template from Firestore ───
    try {
        const templates = await getTemplatesFromFirestore();
        const templateKey = isAccepted ? 'store_new_order' : 'delivery_assigned';
        const template = templates[templateKey];
        if (template) {
            const variables = buildTemplateVariables(orderData, businessName);
            const rendered = renderTemplate(template, variables);
            if (rendered) {
                let mapsLink = '';
                let locationImageLink = '';
                if (orderData.delivery?.latlong) {
                    const [lat, lng] = orderData.delivery.latlong.split(',').map(s => s.trim());
                    if (lat && lng) {
                        mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                        locationImageLink = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=400x200&markers=color:red%7C${lat},${lng}&key=`;
                    }
                }
                return { text: rendered, mapsLink, locationImageLink };
            }
        }
    } catch (err) {
        console.log('Template lookup failed, using hardcoded:', err.message);
    }

    // ─── Fallback: hardcoded message ───
    const orderId = orderData.id || '';

    // Información de entrega
    let scheduledTimeStr = 'Inmediato';
    let timingType = 'Inmediato';

    if (orderData.timing?.type === 'scheduled') {
        const scheduledTime = orderData.timing.scheduledTime || '';
        timingType = 'Programado';

        // Intentar parsear la fecha programada
        let dateObj = null;
        if (orderData.timing.scheduledDate) {
            const sd = orderData.timing.scheduledDate;
            // Manejar Timestamp de Firestore (objeto con seconds) o Date nativo
            if (sd.toDate && typeof sd.toDate === 'function') {
                dateObj = sd.toDate();
            } else if (sd.seconds) {
                dateObj = new Date(sd.seconds * 1000);
            } else if (sd._seconds) {
                dateObj = new Date(sd._seconds * 1000);
            } else {
                dateObj = new Date(sd);
            }
        }

        if (dateObj && !isNaN(dateObj.getTime())) {
            // Configuración para Zona Horaria de Ecuador
            const timeZone = 'America/Guayaquil';
            const now = new Date();

            // Formateadores
            const isoDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

            const todayStr = isoDateFormatter.format(now);
            const scheduledStr = isoDateFormatter.format(dateObj);

            // Calcular mañana
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = isoDateFormatter.format(tomorrow);

            if (scheduledStr === todayStr) {
                scheduledTimeStr = `Hoy a las ${scheduledTime}`;
            } else if (scheduledStr === tomorrowStr) {
                scheduledTimeStr = `Mañana a las ${scheduledTime}`;
            } else {
                // Formato: "Sábado 21 de febrero"
                const fullDateFormatter = new Intl.DateTimeFormat('es-EC', {
                    timeZone,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long'
                });

                let datePart = fullDateFormatter.format(dateObj);
                // Capitalizar primera letra
                datePart = datePart.charAt(0).toUpperCase() + datePart.slice(1);

                scheduledTimeStr = `${datePart} a las ${scheduledTime}`;
            }
        } else {
            // Fallback si no hay fecha válida
            scheduledTimeStr = scheduledTime;
        }
    }

    let deliveryInfo = orderData.delivery?.references || 'Dirección no especificada';
    if (orderData.delivery?.type === 'pickup') {
        deliveryInfo = '🏪 Retiro en tienda';
    }
    let mapsLink = '';
    if (orderData.delivery?.latlong) {
        const [lat, lng] = orderData.delivery.latlong.split(',').map(s => s.trim());
        if (lat && lng && lat.length > 0 && lng.length > 0) {
            mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        }
    }
    let locationImageLink = orderData.delivery?.photo || orderData.delivery?.image || '';
    // Asegurar que locationImageLink sea una URL válida
    if (locationImageLink && typeof locationImageLink === 'string' && locationImageLink.trim().length === 0) {
        locationImageLink = '';
    }

    // Información de pago
    const paymentMethod = orderData.payment?.method || 'No especificado';
    let paymentMethodText = '';
    if (paymentMethod === 'cash') paymentMethodText = '💵 Efectivo';
    else if (paymentMethod === 'transfer') paymentMethodText = '🏦 Transferencia';
    else if (paymentMethod === 'mixed') paymentMethodText = '💳 Mixto';

    const total = orderData.total || 0;
    const subtotal = orderData.subtotal || 0;
    const deliveryCost = orderData.delivery?.deliveryCost !== undefined
        ? orderData.delivery.deliveryCost
        : Math.max(0, total - subtotal);

    const customerName = orderData.customer?.name || 'No especificado';
    const phone = orderData.customer?.phone || '';

    // Detalles del pedido
    let itemsText = "";
    if (Array.isArray(orderData.items) && orderData.items.length > 0) {
        itemsText += `\n<b>Detalles del pedido</b>\n`;

        // Agrupar por nombre de producto
        const groupedItems = {};

        orderData.items.forEach(item => {
            const productName = item.name || 'Producto';

            if (!groupedItems[productName]) {
                groupedItems[productName] = [];
            }
            groupedItems[productName].push(item);
        });

        // Renderizar items agrupados
        Object.keys(groupedItems).forEach(productName => {
            const items = groupedItems[productName];

            // Si el producto tiene variantes (campo variant no vacío)
            const hasVariants = items.some(item => item.variant && item.variant.trim() !== '');

            if (hasVariants) {
                // Mostrar nombre del producto como título
                itemsText += `${productName}\n`;
                // Mostrar cada variante con su cantidad
                items.forEach(item => {
                    const quantity = item.quantity || 1;
                    const variantName = item.variant || productName;
                    itemsText += `( ${quantity} ) ${variantName}\n`;
                });
            } else {
                // Producto sin variantes: mostrar directamente con cantidad
                items.forEach(item => {
                    const quantity = item.quantity || 1;
                    itemsText += `( ${quantity} ) ${productName}\n`;
                });
            }
        });
    }

    let text = "";

    if (!isAccepted) {
        // FORMATO PARA PEDIDO ASIGNADO
        text += `🛵 <b>[${businessName}]</b> tiene un pedido para ti!\n\n`;

        text += `<b>Datos de entrega</b>\n`;
        if (mapsLink && mapsLink.trim().length > 0) {
            text += `🗺️ <a href="${mapsLink}">Ver en Google Maps</a>\n`;
        }
        if (locationImageLink && locationImageLink.trim().length > 0) {
            text += `📸 <a href="${locationImageLink}">Ver foto de ubicación</a>\n`;
        }
        text += `${deliveryInfo}\n`;

        if (itemsText) {
            text += itemsText;
        }

        text += `\nEnvío: $${deliveryCost.toFixed(0)}\n\n`;

        text += `<b>Datos del cliente</b>\n`;
        text += `👤 ${customerName}`;
    } else {
        // FORMATO PARA PEDIDO ACEPTADO
        text += `🛵 <b>${businessName}!</b>\n`;

        const timingIcon = timingType === 'Inmediato' ? '⚡' : '⏰';
        text += `Hora estimada: ${timingIcon} ${scheduledTimeStr}\n\n`;

        text += `<b>Datos del cliente</b>\n`;
        text += `👤 Nombres: ${customerName}\n`;
        if (phone && phone.trim().length > 0) {
            const waMessage = encodeURIComponent(`Hola, soy delivery de ${businessName}.`);
            const formattedPhone = phone.replace(/^0/, '').trim();
            if (formattedPhone.length > 0) {
                const waLink = `https://wa.me/593${formattedPhone}?text=${waMessage}`;
                text += `📱 Whatsapp: <a href="${waLink}">${phone}</a>\n`;
            } else {
                text += `📱 Whatsapp: ${phone}\n`;
            }
        } else {
            text += `📱 Whatsapp: No registrado\n`;
        }

        text += `\n<b>Datos de entrega</b>\n`;
        if (mapsLink && mapsLink.trim().length > 0) {
            text += `🗺️ <a href="${mapsLink}">Ver en Google Maps</a>\n`;
        }
        if (locationImageLink && locationImageLink.trim().length > 0) {
            text += `📸 <a href="${locationImageLink}">Ver foto de ubicación</a>\n`;
        }
        text += `${deliveryInfo}\n`;

        if (itemsText) {
            text += itemsText;
        }

        text += `\n<b>Detalles del pago</b>\n`;
        text += `Pedido: $${subtotal.toFixed(2)}\n`;
        text += `Envío: $${deliveryCost.toFixed(2)}\n\n`;

        text += `${paymentMethodText}\n`;

        // Mostrar "Valor a cobrar" solo si hay efectivo involucrado y no es solo transferencia
        if (paymentMethod === 'cash') {
            text += `💰 Valor a cobrar: $${total.toFixed(2)}\n`;
        } else if (paymentMethod === 'mixed') {
            const cashAmount = orderData.payment?.cashAmount || 0;
            if (cashAmount > 0) {
                text += `💰 Valor a cobrar: $${cashAmount.toFixed(2)}\n`;
            }
        }
    }

    return { text, mapsLink, locationImageLink };
}

/**
 * Función genérica para enviar mensajes de Telegram
 * Valida respuesta y maneja errores correctamente
 */
async function sendTelegramMessageGeneric(token, chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    try {
        // VALIDAR TOKEN
        if (!token) {
            console.error('❌ [Telegram] Token de Telegram no configurado. Verifique las variables de entorno.');
            return null;
        }

        // VALIDAR TOKEN NO TENGA ESPACIOS
        if (token !== token.trim()) {
            console.error('❌ [Telegram] Token tiene espacios al inicio o final. Limpiando...');
            token = token.trim();
        }

        // VALIDAR FORMATO DE TOKEN (debe empezar con números seguidos de :)
        if (!token.includes(':') || token.split(':').length !== 2) {
            console.error('❌ [Telegram] Formato de token inválido. Esperado: "botid:token"');
            return null;
        }

        // VALIDAR CHAT ID
        if (!chatId) {
            console.warn('⚠️ [Telegram] Chat ID vacío o indefinido');
            return null;
        }

        // Convertir chatId a número si es string
        const numericChatId = typeof chatId === 'string' ? parseInt(chatId, 10) : chatId;
        if (isNaN(numericChatId)) {
            console.warn('⚠️ [Telegram] Chat ID no es un número válido:', chatId);
            return null;
        }

        const botId = token.substring(0, token.indexOf(':'));
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        console.log(`📤 [Telegram-Generic] Bot: ${botId} | Chat: ${numericChatId} | URL longitud: ${url.length}`);
        console.log(`📤 [Telegram-Generic] Intentando conexión a Telegram...`);
        
        const data = {
            chat_id: numericChatId,
            text: text,
            parse_mode: 'HTML'
        };
        if (replyMarkup) {
            data.reply_markup = replyMarkup;
        }
        if (linkPreviewOptions) {
            data.link_preview_options = linkPreviewOptions;
        }
        
        console.log(`📤 [Telegram-Generic] Enviando payload. Tamaño: ${JSON.stringify(data).length} bytes`);
        
        const startTime = Date.now();
        const response = await axios.post(url, data, {
            timeout: 10000  // 10 segundos timeout
        });
        const duration = Date.now() - startTime;
        
        const responseData = response.data;
        console.log(`✅ [Telegram-Generic] Respuesta recibida en ${duration}ms. Status HTTP: ${response.status}`);
        console.log(`✅ [Telegram-Generic] Response.ok: ${responseData.ok}, tiene result: ${!!responseData.result}`);
        
        // Validar que la respuesta fue exitosa (ok: true en Telegram API)
        if (!responseData.ok) {
            console.error('❌ [Telegram] Error en respuesta de Telegram:', {
                chatId: numericChatId,
                botId: botId,
                ok: responseData.ok,
                errorCode: responseData.error_code,
                description: responseData.description,
                fullResponse: responseData
            });
            return responseData; // Retornar igual para análisis downstream
        }
        
        const messageId = responseData.result?.message_id;
        console.log(`✅ [Telegram] Mensaje enviado exitosamente. Bot: ${botId} | Chat: ${numericChatId} | Message ID: ${messageId}`);
        return responseData;
    } catch (error) {
        console.error('❌ [Telegram] Error enviando mensaje:', {
            chatId: chatId,
            token: token ? `${token.substring(0,10)}...` : 'null',
            statusCode: error.response?.status,
            errorData: error.response?.data,
            errorCode: error.code,
            errorMessage: error.message,
            errorType: error.constructor?.name,
            isTimeout: error.code === 'ECONNABORTED',
            isNetworkError: error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED'
        });
        return null;
    }
}

/**
 * Enviar mensaje usando el bot de Tienda
 */
async function sendStoreTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    if (!STORE_BOT_TOKEN) {
        console.error('❌ [Telegram] STORE_BOT_TOKEN no configurado. No se puede enviar mensaje a tienda.');
        return null;
    }
    return sendTelegramMessageGeneric(STORE_BOT_TOKEN, chatId, text, replyMarkup, linkPreviewOptions);
}

/**
 * Enviar mensaje usando el bot de Delivery
 */
async function sendDeliveryTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    if (!DELIVERY_BOT_TOKEN) {
        console.error('❌ [Telegram] DELIVERY_BOT_TOKEN no configurado. No se puede enviar mensaje a delivery.');
        return null;
    }
    return sendTelegramMessageGeneric(DELIVERY_BOT_TOKEN, chatId, text, replyMarkup, linkPreviewOptions);
}

/**
 * Enviar mensaje usando el bot de Cliente
 */
async function sendCustomerTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    if (!CUSTOMER_BOT_TOKEN) {
        console.error('❌ [Telegram] CUSTOMER_BOT_TOKEN no configurado. No se puede enviar mensaje a cliente.');
        return null;
    }
    return sendTelegramMessageGeneric(CUSTOMER_BOT_TOKEN, chatId, text, replyMarkup, linkPreviewOptions);
}

/**
 * Webhook para el bot de TIENDA
 */
async function handleStoreWebhook(req, res) {
    try {
        const update = req.body;
        console.log('📬 Store Bot Update:', JSON.stringify(update));

        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;

            if (text.startsWith('/start')) {
                const entityId = text.split(' ')[1];
                if (entityId) {
                    try {
                        const businessDoc = await admin.firestore().collection('businesses').doc(entityId).get();

                        if (businessDoc.exists) {
                            await admin.firestore().collection('businesses').doc(entityId).update({
                                telegramChatIds: admin.firestore.FieldValue.arrayUnion(chatId.toString())
                            });
                            const businessName = businessDoc.data().name || 'Tu tienda';
                            await sendStoreTelegramMessage(chatId, `✅ <b>¡Vinculación Exitosa!</b>\n\n<b>${businessName}</b> ahora enviará notificaciones de nuevos pedidos a este chat.\n\n(Puedes vincular múltiples cuentas usando el mismo link)`);
                        } else {
                            await sendStoreTelegramMessage(chatId, "❌ No se encontró la tienda. Este bot es solo para tiendas. Si eres repartidor, usa el bot @fuddi_delivery_bot");
                        }
                    } catch (error) {
                        console.error('Error vinculando tienda:', error);
                        await sendStoreTelegramMessage(chatId, "❌ Hubo un error al vincular tu cuenta.");
                    }
                } else {
                    await sendStoreTelegramMessage(chatId, "¡Hola! Para vincular tu tienda, usa el botón 'Vincular Telegram' en tu panel de administración.");
                }
            }
        } else if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;

            const [actionType, token] = data.split('|');
            // Store Bot solo maneja confirmaciones y descartes de negocio
            if (actionType.startsWith('biz_')) {
                const action = actionType; // biz_confirm, biz_discard
                const result = await processOrderAction(token, action);

                if (result.error) {
                    await sendStoreTelegramMessage(chatId, `❌ Error: ${result.error}`);
                } else {
                    const orderId = result.orderId;
                    console.log(`⚠️ [Store Webhook] Procesando callback biz_confirm para orden ${orderId}`);

                    try {
                        const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();
                        const orderData = orderDoc.data();
                        console.log(`📋 [Store Webhook] Orden recuperada. telegramBusinessMessages: ${JSON.stringify(orderData.telegramBusinessMessages)}`);
                        
                        // ACCIÓN SINCRONIZADA PARA LA TIENDA
                        const businessName = orderData.businessName || 'Tienda';
                        const { text: telegramText } = await formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);

                        const handlerName = callbackQuery.from.first_name || 'Alguien';
                        let finalStatusText = '';

                        if (action === 'biz_confirm') {
                            // Guardar quién confirmó
                            await admin.firestore().collection('orders').doc(orderId).update({ confirmedBy: handlerName });
                            console.log(`✍️ [Store Webhook] Guardado confirmedBy: ${handlerName}`);

                            const deliveryName = result.assignedDeliveryName;
                            finalStatusText = `\n\n✅ <b>Pedido Confirmado por ${handlerName}</b>`;
                            if (deliveryName) {
                                finalStatusText += `\n🛵 Repartidor asignado: <b>${deliveryName}</b> <i>.. Esperando confirmación</i>`;
                            } else if (orderData.delivery?.type === 'delivery') {
                                finalStatusText += `\n⚠️ (No se pudo auto-asignar repartidor)`;
                            }
                        } else {
                            finalStatusText = `\n\n❌ <b>Pedido Cancelado por ${handlerName}</b>`;
                        }

                        const syncText = telegramText + finalStatusText;
                        const businessMessages = orderData.telegramBusinessMessages || [];
                        console.log(`📝 [Store Webhook] Mensajes a editar: ${businessMessages.length}`);

                        // Actualizar TODOS los mensajes enviados a los administradores
                        const editUrl = `https://api.telegram.org/bot${STORE_BOT_TOKEN}/editMessageText`;
                        const updatePromises = businessMessages.map(msg => {
                            console.log(`📤 [Store Webhook] Editando: chat=${msg.chatId}, messageId=${msg.messageId}`);
                            return axios.post(editUrl, {
                                chat_id: msg.chatId,
                                message_id: msg.messageId,
                                text: syncText,
                                parse_mode: 'HTML',
                                link_preview_options: { is_disabled: true }
                            }).then(response => {
                                console.log(`✅ [Store Webhook] Mensaje editado en chat ${msg.chatId}: ok=${response.data.ok}`);
                                return response;
                            }).catch(err => {
                                console.error(`❌ [Store Webhook] Error editando en ${msg.chatId}:`, {
                                    messageId: msg.messageId,
                                    errorCode: err.response?.data?.error_code,
                                    description: err.response?.data?.description,
                                    message: err.message
                                });
                                return err;
                            });
                        });
                        const results = await Promise.allSettled(updatePromises);
                        console.log(`📊 [Store Webhook] Ediciones completadas: ${results.filter(r => r.status === 'fulfilled').length}/${businessMessages.length}`);

                    } catch (err) {
                        console.error('❌ Error updating business message:', err);
                    }
                }

                // Responder al callback
                const answerUrl = `https://api.telegram.org/bot${STORE_BOT_TOKEN}/answerCallbackQuery`;
                let answerText = "Acción procesada";
                if (action === 'biz_confirm') answerText = "Pedido Aceptado";
                else if (action === 'biz_discard') answerText = "Pedido Rechazado";

                await axios.post(answerUrl, {
                    callback_query_id: callbackQuery.id,
                    text: answerText
                });
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error en handleStoreWebhook:', error);
        res.status(200).send('OK');
    }
}

/**
 * Actualizar el mensaje de Telegram del negocio cuando cambia el estado (ej: delivery acepta)
 */
async function updateBusinessTelegramMessage(orderData, orderId) {
    try {
        console.log(`🔄 [updateBusinessTelegramMessage] Iniciando actualización para orden ${orderId}`);
        
        const businessMessages = orderData.telegramBusinessMessages || [];
        console.log(`📋 [updateBusinessTelegramMessage] telegramBusinessMessages: ${JSON.stringify(businessMessages)}`);
        
        if (businessMessages.length === 0) {
            console.warn(`⚠️ [updateBusinessTelegramMessage] No hay mensajes guardados para editar en orden ${orderId}`);
            return;
        }

        const businessName = orderData.businessName || 'Tienda';
        const { text: telegramText } = await formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);

        const handlerName = orderData.confirmedBy || 'Tienda';
        let finalStatusText = '';

        // Reconstruir el estado
        if (orderData.status !== 'cancelled') {
            finalStatusText = `\n\n✅ <b>Pedido Confirmado por ${handlerName}</b>`;

            if (orderData.delivery?.assignedDelivery) {
                // Necesitamos el nombre del delivery
                let deliveryName = 'Repartidor';
                try {
                    const deliveryDoc = await admin.firestore().collection('deliveries').doc(orderData.delivery.assignedDelivery).get();
                    if (deliveryDoc.exists) {
                        deliveryName = deliveryDoc.data().nombres;
                    }
                } catch (e) {
                    console.error('Error fetching delivery name for update:', e);
                }

                finalStatusText += `\n🛵 Repartidor asignado: <b>${deliveryName}</b>`;

                // Estado de aceptación del delivery
                if (orderData.delivery.acceptanceStatus === 'accepted') {
                    finalStatusText += ` ✅ Confirmado`;
                } else {
                    finalStatusText += ` <i>.. Esperando confirmación</i>`;
                }
            } else if (orderData.delivery?.type === 'delivery') {
                finalStatusText += `\n⚠️ (No se pudo auto-asignar repartidor)`;
            }
        } else {
            finalStatusText = `\n\n❌ <b>Pedido Cancelado</b>`;
        }

        const syncText = telegramText + finalStatusText;
        console.log(`📝 [updateBusinessTelegramMessage] Texto preparado. Longitud: ${syncText.length}`);

        const editUrl = `https://api.telegram.org/bot${STORE_BOT_TOKEN}/editMessageText`;
        console.log(`🔗 [updateBusinessTelegramMessage] URL de edición: ${editUrl.substring(0, 50)}...`);
        
        const updatePromises = businessMessages.map(msg => {
            console.log(`📤 [updateBusinessTelegramMessage] Editando mensaje en chat ${msg.chatId}, messageId ${msg.messageId}`);
            return axios.post(editUrl, {
                chat_id: msg.chatId,
                message_id: msg.messageId,
                text: syncText,
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true }
            }).then(response => {
                console.log(`✅ [updateBusinessTelegramMessage] Mensaje actualizado en chat ${msg.chatId}: ${response.data.ok}`);
                return response;
            }).catch(err => {
                console.error(`❌ [updateBusinessTelegramMessage] Error actualizando mensaje en ${msg.chatId}:`, {
                    messageId: msg.messageId,
                    errorCode: err.response?.data?.error_code,
                    description: err.response?.data?.description,
                    message: err.message
                });
                throw err;
            });
        });
        
        const results = await Promise.allSettled(updatePromises);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log(`📊 [updateBusinessTelegramMessage] Actualización completada. Exitosos: ${successful}, Fallidos: ${failed}`);
        
    } catch (error) {
        console.error('❌ Error en updateBusinessTelegramMessage:', error);
    }
}

/**
 * Webhook para el bot de DELIVERY
 */
async function handleDeliveryWebhook(req, res) {
    try {
        const update = req.body;
        console.log('📬 Delivery Bot Update:', JSON.stringify(update));

        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;

            if (text.startsWith('/start')) {
                const entityId = text.split(' ')[1];
                if (entityId) {
                    try {
                        const deliveryDoc = await admin.firestore().collection('deliveries').doc(entityId).get();

                        if (deliveryDoc.exists) {
                            await admin.firestore().collection('deliveries').doc(entityId).update({
                                telegramChatId: chatId.toString()
                            });
                            await sendDeliveryTelegramMessage(chatId, "✅ <b>¡Vinculación Exitosa!</b>\n\nDesde ahora recibirás las notificaciones de nuevos pedidos aquí.");
                        } else {
                            await sendDeliveryTelegramMessage(chatId, "❌ No se encontró tu perfil de delivery. Si eres una tienda, usa el bot antiguo.");
                        }
                    } catch (error) {
                        console.error('Error vinculando delivery:', error);
                        await sendDeliveryTelegramMessage(chatId, "❌ Hubo un error al vincular tu cuenta.");
                    }
                } else {
                    await sendDeliveryTelegramMessage(chatId, "¡Hola! Para vincular tu cuenta, usa el botón 'Vincular Telegram' en tu app de delivery.");
                }
            }
        } else if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;

            console.log(`Processing callback: ${data} from ${chatId}`);

            const answerUrl = `https://api.telegram.org/bot${DELIVERY_BOT_TOKEN}/answerCallbackQuery`;
            let answerText = "Acción procesada";

            try {
                const [actionType, token] = data.split('|');

                // Delivery Bot maneja acciones de orden (order_*)
                let action = actionType.replace('order_', '');

                // Seguridad: Asegurar que no sea una acción de negocio
                if (action.startsWith('biz_')) {
                    await axios.post(answerUrl, {
                        callback_query_id: callbackQuery.id,
                        text: 'Acción no permitida'
                    });
                    return res.status(200).send('OK');
                }

                const result = await processOrderAction(token, action);

                if (result.error) {
                    console.error(`Error processing action ${action}: ${result.error}`);
                    await sendDeliveryTelegramMessage(chatId, `❌ Error: ${result.error}`);
                    answerText = `Error: ${result.error}`;
                } else {
                    const orderId = result.orderId;
                    let statusLabel = '';
                    if (action === 'confirm') {
                        statusLabel = '✅ <b>Aceptado</b>';
                        answerText = "Pedido Aceptado";
                    }
                    else if (action === 'on_way') {
                        statusLabel = '🛵 <b>En camino</b>';
                        answerText = "Pedido En Camino";
                    }
                    else if (action === 'delivered') {
                        statusLabel = '🏁 <b>Entregado</b>';
                        answerText = "Pedido Entregado";
                    }
                    else if (action === 'discard') {
                        statusLabel = '❌ <b>Descartado</b>';
                        answerText = "Pedido Descartado";
                    }

                    try {
                        // Obtener datos frescos
                        const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();

                        if (orderDoc.exists) {
                            const orderData = orderDoc.data();
                            console.log(`Updating message for order ${orderId}, action ${action}`);

                            let businessName = 'Negocio';
                            if (orderData.businessId) {
                                const businessDoc = await admin.firestore().collection('businesses').doc(orderData.businessId).get();
                                if (businessDoc.exists) {
                                    businessName = businessDoc.data().name || businessName;
                                }
                            }

                            let newText = "";
                            let replyMarkup = undefined;
                            let linkPreviewOptions = { is_disabled: true };

                            if (action === 'delivered') {
                                // ... Lógica existente para delivered ...
                                const customerName = orderData.customer?.name || 'Cliente';
                                const references = orderData.delivery?.references || 'Sin referencias';
                                const total = orderData.total || orderData.payment?.total || 0;
                                const subtotal = orderData.subtotal || orderData.payment?.subtotal || 0;
                                const deliveryCost = orderData.delivery?.deliveryCost || orderData.delivery?.cost || Math.max(0, total - subtotal);
                                const paymentMethod = orderData.payment?.method || 'cash';

                                newText = `<b>${businessName}</b> · ${customerName}\n`;
                                newText += `${references}\n\n`;
                                newText += `Pedido: $${subtotal.toFixed(2)}\n`;
                                newText += `Envío: $${deliveryCost.toFixed(2)}\n`;

                                if (paymentMethod === 'cash') {
                                    newText += `💵 Efectivo: $${total.toFixed(2)}`;
                                } else if (paymentMethod === 'mixed') {
                                    const cash = orderData.payment?.cashAmount || 0;
                                    const transfer = orderData.payment?.transferAmount || 0;
                                    newText += `💵 Efectivo: $${cash.toFixed(2)}\n`;
                                    newText += `🏦 Transferencia: $${transfer.toFixed(2)}`;
                                } else {
                                    newText += `🏦 Transferencia`;
                                }
                                newText += `\n\n🎉 <b>Entregado</b>`;

                            } else if (action !== 'discard') {
                                const { text: formattedText, mapsLink, locationImageLink } = await formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);
                                newText = formattedText + `\n\n${statusLabel}`;

                                replyMarkup = { inline_keyboard: [] };
                                const onWayToken = Buffer.from(`${orderId}|on_way`).toString('base64');
                                const deliveredToken = Buffer.from(`${orderId}|delivered`).toString('base64');

                                console.log('[Telegram Debug] Action:', action);

                                if (action === 'confirm') {
                                    replyMarkup.inline_keyboard.push([
                                        { text: "🛵 En camino", callback_data: `order_on_way|${onWayToken}` },
                                        { text: "✅ Entregada", callback_data: `order_delivered|${deliveredToken}` }
                                    ]);
                                } else if (action === 'on_way') {
                                    replyMarkup.inline_keyboard.push([
                                        { text: "✅ Entregada", callback_data: `order_delivered|${deliveredToken}` }
                                    ]);
                                }

                                console.log('[Telegram Debug] Generated ReplyMarkup:', JSON.stringify(replyMarkup));

                                linkPreviewOptions = { is_disabled: true };

                                if (locationImageLink) {
                                    linkPreviewOptions = {
                                        url: locationImageLink,
                                        prefer_large_media: true,
                                        show_above_text: true
                                    };
                                } else if (mapsLink) {
                                    linkPreviewOptions = {
                                        url: mapsLink,
                                        prefer_large_media: true,
                                        show_above_text: true
                                    };
                                }
                            } else {
                                const customerName = orderData.customer?.name || 'Cliente';
                                newText = `<b>${businessName}</b> · ${customerName}\n\nx Descartado`;
                            }

                            // Editar mensaje
                            const editUrl = `https://api.telegram.org/bot${DELIVERY_BOT_TOKEN}/editMessageText`;
                            try {
                                const payload = {
                                    chat_id: chatId,
                                    message_id: messageId,
                                    text: newText,
                                    parse_mode: 'HTML',
                                    reply_markup: replyMarkup,
                                    link_preview_options: linkPreviewOptions
                                };
                                console.log('[Telegram Debug] Sending Edit Payload:', JSON.stringify(payload));

                                await axios.post(editUrl, payload);
                            } catch (editError) {
                                console.error('[Telegram Debug] Error editing message:', editError.response?.data || editError.message);
                            }
                        }
                    } catch (fetchError) {
                        console.error('Error fetching data/updating message:', fetchError);
                    }
                }

            } catch (error) {
                console.error('Error in callback processing:', error);
                answerText = "Error procesando solicitud";
            } finally {
                // SIEMPRE responder al callback
                try {
                    await axios.post(answerUrl, {
                        callback_query_id: callbackQuery.id,
                        text: answerText
                    });
                } catch (e) {
                    console.error('Error sending answerCallbackQuery:', e.message);
                }
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error en handleDeliveryWebhook:', error);
        res.status(200).send('OK');
    }
}

/**
 * Webhook para el bot de CLIENTE
 */
async function handleCustomerWebhook(req, res) {
    try {
        console.log('🚀 [TELEGRAM CUSTOMER WEBHOOK TRIGGERED]');
        console.log('📦 Headers:', JSON.stringify(req.headers));
        console.log('� Body:', JSON.stringify(req.body));

        const update = req.body;

        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;
            console.log(`💬 Message received: "${text}" from ${chatId}`);

            if (text.startsWith('/start')) {
                const param = text.split(' ')[1]; // order_ORDERID
                console.log(`⚙️ Start param: "${param}"`);

                if (param && param.startsWith('order_')) {
                    const orderId = param.replace('order_', '');
                    try {
                        console.log(`🔍 Intentando vincular orden ${orderId} con chat ${chatId}`);
                        const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();

                        if (orderDoc.exists) {
                            console.log(`✅ Orden encontrada: ${orderId}. Actualizando...`);

                            const orderData = orderDoc.data();

                            let clientId = orderData.customer?.id || orderData.clientId;

                            // FALLBACK: Si no hay ID, buscar por teléfono
                            if (!clientId && orderData.customer?.phone) {
                                console.log(`🔍 Buscando cliente por teléfono: ${orderData.customer.phone}`);
                                try {
                                    const clientsSnapshot = await admin.firestore().collection('clients')
                                        .where('celular', '==', orderData.customer.phone)
                                        .limit(1)
                                        .get();

                                    if (!clientsSnapshot.empty) {
                                        clientId = clientsSnapshot.docs[0].id;
                                        console.log(`✅ Cliente encontrado por teléfono: ${clientId}`);
                                    }
                                } catch (err) {
                                    console.error('Error buscando cliente por teléfono:', err);
                                }
                            }

                            // 1. Guardar en la ORDEN (para referencia rápida)
                            const orderUpdate = {
                                customer: {
                                    ...orderData.customer,
                                    telegramChatId: chatId.toString()
                                }
                            };

                            // Si encontramos el ID recién ahora, lo guardamos también en la orden para futuro
                            if (clientId && !orderData.customer?.id) {
                                orderUpdate.customer.id = clientId;
                            }

                            await admin.firestore().collection('orders').doc(orderId).update(orderUpdate);

                            // 2. Guardar en el CLIENTE (para persistencia)
                            if (clientId) {
                                console.log(`👤 Vinculando cliente ${clientId} con Telegram ${chatId}`);
                                await admin.firestore().collection('clients').doc(clientId).set({
                                    telegramChatId: chatId.toString(),
                                    lastTelegramLinkDate: admin.firestore.FieldValue.serverTimestamp()
                                }, { merge: true });
                            } else {
                                console.warn(`⚠️ Orden ${orderId} no tiene clientId ni se encontró por teléfono. Solo se vinculó la orden.`);
                            }

                            await sendCustomerTelegramMessage(chatId, "¡Hola! 👋 Soy tu asistente de Fuddi. Te avisaré por aquí las novedades de este y tus próximos pedidos!");
                        } else {
                            console.warn(`❌ Orden ${orderId} no encontrada en Firestore`);
                            await sendCustomerTelegramMessage(chatId, "❌ No encontramos el pedido. Verifica el enlace o contacta a soporte.");
                        }
                    } catch (error) {
                        console.error('Error vinculando cliente:', error);
                        await sendCustomerTelegramMessage(chatId, "❌ Hubo un error al activar las notificaciones.");
                    }
                } else {
                    await sendCustomerTelegramMessage(chatId, "¡Hola! Para recibir notificaciones de tu pedido, usa el botón 'Avísame por Telegram' en la página de seguimiento de tu orden.");
                }
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error en handleCustomerWebhook:', error);
        res.status(200).send('OK');
    }
}

async function sendCustomerTelegramNotification(orderData, orderId) {
    // VALIDAR TOKEN ANTES DE CONTINUAR
    if (!CUSTOMER_BOT_TOKEN) {
        console.error(`❌ [Telegram] CUSTOMER_BOT_TOKEN no está configurado. No se pueden enviar notificaciones a clientes.`);
        return;
    }

    let chatId = orderData.customer?.telegramChatId;

    // Si no está en la orden, buscar en el perfil del cliente por ID o teléfono
    if (!chatId) {
        let clientId = orderData.customer?.id || orderData.clientId;

        // Si no hay clientId pero hay teléfono, buscar por teléfono
        if (!clientId && orderData.customer?.phone) {
            try {
                console.log(`🔍 Buscando cliente por teléfono: ${orderData.customer.phone}`);
                const clientsSnapshot = await admin.firestore().collection('clients')
                    .where('celular', '==', orderData.customer.phone)
                    .limit(1)
                    .get();

                if (!clientsSnapshot.empty) {
                    clientId = clientsSnapshot.docs[0].id;
                    console.log(`✅ Cliente encontrado por teléfono: ${clientId}`);
                }
            } catch (err) {
                console.error('❌ Error buscando cliente por teléfono:', err);
            }
        }

        // Ahora intentar obtener el telegramChatId si tenemos clientId
        if (clientId) {
            try {
                const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();
                if (clientDoc.exists && clientDoc.data().telegramChatId) {
                    chatId = clientDoc.data().telegramChatId;
                    console.log(`📱 ChatID recuperado del perfil de cliente ${clientId}: ${chatId}`);
                }
            } catch (error) {
                console.error('❌ Error fetching client telegram info:', error);
            }
        }
    }

    if (!chatId) {
        console.warn(`⚠️ [Telegram] No se encontró chatId para orden ${orderId}, no se enviará notificación`);
        return;
    }

    console.log(`📢 [Telegram] Enviando notificación de orden a cliente con chatId: ${chatId}`);

    let businessName = orderData.businessName;

    // Si no tenemos el nombre del negocio, intentar obtenerlo de Firestore
    if (!businessName && orderData.businessId) {
        try {
            const businessDoc = await admin.firestore().collection('businesses').doc(orderData.businessId).get();
            if (businessDoc.exists) {
                businessName = businessDoc.data().name;
            }
        } catch (error) {
            console.error('❌ Error fetching business name for notification:', error);
        }
    }

    if (!businessName) {
        businessName = 'Tu pedido';
    }

    const status = orderData.status;
    let message = '';

    // ─── Try template from Firestore ───
    try {
        const templates = await getTemplatesFromFirestore();
        const templateKey = `customer_${status}`;
        const template = templates[templateKey];
        if (template) {
            const variables = buildTemplateVariables(orderData, businessName);
            const rendered = renderTemplate(template, variables);
            if (rendered) {
                message = rendered;
            }
        }
    } catch (err) {
        console.log('⚠️ Customer template lookup failed, using hardcoded:', err.message);
    }

    // ─── Fallback: hardcoded messages ───
    if (!message) {
        if (status === 'confirmed') {
            message = `✅ <b>¡Pedido Confirmado!</b>\n\nEl negocio <b>${businessName}</b> ha aceptado tu pedido y comenzará a prepararlo pronto.`;
        } else if (status === 'preparing') {
            message = `👨‍🍳 <b>¡Manos a la obra!</b>\n\nEstán preparando tu pedido en <b>${businessName}</b>.`;
        } else if (status === 'ready') {
            message = `🎉 <b>¡Tu pedido está listo!</b>\n\nPronto será entregado o ya puedes pasar a retirarlo.`;
        } else if (status === 'on_way') {
            if (orderData.delivery?.assignedDelivery) {
                message = `🚴 <b>¡Tu pedido va en camino!</b>\n\nEl repartidor ya tiene tu orden y se dirige a tu ubicación.`;
            } else {
                message = `🚴 <b>¡Tu pedido va en camino!</b>`;
            }
        } else if (status === 'delivered') {
            message = `🎊 <b>¡Pedido Entregado!</b>\n\nGracias por comprar en <b>${businessName}</b>. ¡Buen provecho!`;
        } else if (status === 'cancelled') {
            message = `❌ <b>Pedido Cancelado</b>\n\nLo sentimos, tu pedido ha sido cancelado.`;
        }
    }

    if (message) {
        const result = await sendCustomerTelegramMessage(chatId, message);
        if (result && result.ok && result.result) {
            console.log(`✅ Notificación (Customer Bot) enviada a: ${chatId} para orden ${orderId}`);
        } else if (result) {
            console.error(`❌ [Telegram] Error en respuesta para cliente ${chatId}:`, {
                ok: result.ok,
                errorCode: result.error_code,
                description: result.description
            });
        } else {
            console.error(`❌ [Telegram] Fallo al enviar notificación a cliente ${chatId}`);
        }
    } else {
        console.warn(`⚠️ [Telegram] No se pudo construir mensaje para cliente en orden ${orderId}`);
    }
}

async function sendDeliveryTelegramNotification(deliveryData, orderData, orderId, businessName) {
    if (!deliveryData) {
        console.warn(`⚠️ [Telegram] No hay datos de delivery para orden ${orderId}`);
        return;
    }

    if (!deliveryData.telegramChatId) {
        console.warn(`⚠️ [Telegram] Delivery sin telegramChatId. ID: ${deliveryData.id}`);
        return;
    }

    // VALIDAR TOKEN ANTES DE CONTINUAR
    if (!DELIVERY_BOT_TOKEN) {
        console.error(`❌ [Telegram] DELIVERY_BOT_TOKEN no está configurado. No se pueden enviar notificaciones a delivery.`);
        return;
    }

    console.log(`📢 [Telegram] Enviando notificación de orden a delivery ${deliveryData.id}`);

    const { text: telegramText, mapsLink, locationImageLink } = await formatTelegramMessage({ ...orderData, id: orderId }, businessName, false);

    // Botones de acción
    const confirmToken = Buffer.from(`${orderId}|confirm`).toString('base64');
    const discardToken = Buffer.from(`${orderId}|discard`).toString('base64');

    const replyMarkup = {
        inline_keyboard: [
            [
                { text: "✅ Aceptar", callback_data: `order_confirm|${confirmToken}` },
                { text: "❌ Descartar", callback_data: `order_discard|${discardToken}` }
            ]
        ]
    };

    let linkPreviewOptions = null;
    if (locationImageLink) {
        linkPreviewOptions = {
            url: locationImageLink,
            prefer_large_media: true,
            show_above_text: true
        };
    } else if (mapsLink) {
        linkPreviewOptions = {
            url: mapsLink,
            prefer_large_media: true,
            show_above_text: true
        };
    }

    const result = await sendDeliveryTelegramMessage(deliveryData.telegramChatId, telegramText, replyMarkup, linkPreviewOptions);
    
    if (result && result.ok && result.result) {
        console.log(`✅ Notificación de Telegram (Delivery Bot) enviada a: ${deliveryData.telegramChatId}`);
    } else if (result) {
        console.error(`❌ [Telegram] Error en respuesta para delivery ${deliveryData.id}:`, {
            ok: result.ok,
            errorCode: result.error_code,
            description: result.description
        });
    } else {
        console.error(`❌ [Telegram] Fallo al enviar notificación a delivery ${deliveryData.id}`);
    }
}

/**
 * Enviar notificación de Telegram a la tienda cuando se crea una orden
 */
async function sendBusinessTelegramNotification(businessData, orderData, orderId) {
    console.log(`🔍 [sendBusinessTelegramNotification] Iniciando para orden ${orderId}`);
    
    if (!businessData) {
        console.warn(`⚠️ [Telegram] No se encontró datos del negocio para orden ${orderId}`);
        return;
    }

    console.log(`📋 [sendBusinessTelegramNotification] businessData.id: ${businessData.id}, name: ${businessData.name}`);

    // Obtener IDs de chat (nuevos y antiguos para migración)
    let chatIds = businessData.telegramChatIds || [];
    console.log(`📝 [sendBusinessTelegramNotification] telegramChatIds array: ${JSON.stringify(chatIds)}`);

    // Si existe el ID antiguo y no está en la lista nueva, incluirlo
    if (businessData.telegramChatId && !chatIds.includes(businessData.telegramChatId)) {
        chatIds = [...chatIds, businessData.telegramChatId];
        console.log(`📝 [sendBusinessTelegramNotification] Se agregó telegramChatId antiguo: ${businessData.telegramChatId}`);
    }

    if (chatIds.length === 0) {
        console.warn(`⚠️ [Telegram] Negocio ${businessData.id} no tiene telegramChatIds configurados. No se puede notificar.`);
        return;
    }

    console.log(`📢 [Telegram] Enviando notificación de orden a negocio. ChatIDs: ${chatIds.join(', ')}`);

    // VALIDAR TOKEN ANTES DE CONTINUAR
    if (!STORE_BOT_TOKEN) {
        console.error(`❌ [Telegram] STORE_BOT_TOKEN no está configurado. No se pueden enviar notificaciones de tienda.`);
        console.error(`❌ STORE_BOT_TOKEN valor: "${STORE_BOT_TOKEN}"`);
        return;
    }

    console.log(`✅ [Telegram] STORE_BOT_TOKEN está configurado: ${STORE_BOT_TOKEN.substring(0, 10)}...${STORE_BOT_TOKEN.substring(STORE_BOT_TOKEN.length - 10)}`);

    const businessName = businessData.name || 'Tienda';
    const { text: telegramText } = await formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);
    console.log(`📝 [Telegram] Mensaje formateado. Longitud: ${telegramText.length}`);
        console.log(`🔍 [Telegram-DEBUG] Primeros 200 caracteres del HTML: ${telegramText.substring(0, 200)}`);
        console.log(`🔍 [Telegram-DEBUG] Buscando tags <a> en el mensaje...`);
        const aTagMatches = telegramText.match(/<a[^>]*>/g);
        if (aTagMatches) {
            console.log(`🔍 [Telegram-DEBUG] Tags <a> encontrados: ${JSON.stringify(aTagMatches)}`);
        } else {
            console.log(`✅ [Telegram-DEBUG] No hay tags <a> en el mensaje`);
        }
    const linkPreviewOptions = { is_disabled: true };

    // Botones de acción para la tienda
    const confirmToken = Buffer.from(`${orderId}|biz_confirm`).toString('base64');
    const discardToken = Buffer.from(`${orderId}|biz_discard`).toString('base64');

    const replyMarkup = {
        inline_keyboard: [
            [
                { text: "✅ Aceptar Pedido", callback_data: `biz_confirm|${confirmToken}` },
                { text: "❌ Descartar", callback_data: `biz_discard|${discardToken}` }
            ]
        ]
    };

    const sentMessages = [];

    // Enviar a todos los IDs registrados y capturar Message IDs
    for (const chatId of chatIds) {
        console.log(`📤 [Telegram] Enviando a chatId: ${chatId} (tipo: ${typeof chatId})`);
        try {
            const result = await sendStoreTelegramMessage(chatId, telegramText, replyMarkup, linkPreviewOptions);
            console.log(`📥 [Telegram] Respuesta de sendStoreTelegramMessage: ${JSON.stringify(result).substring(0, 100)}...`);
            
            if (!result) {
                console.error(`❌ [Telegram] No hay respuesta de Telegram para chat ${chatId}. El servidor retornó null.`);
                continue;
            }
            if (result.ok === true && result.result) {
                sentMessages.push({
                    chatId: chatId.toString(),
                    messageId: result.result.message_id
                });
                console.log(`✅ Notificación (Store Bot) enviada a chat ${chatId} (ID: ${result.result.message_id})`);
            } else {
                console.error(`❌ [Telegram] Error en respuesta para chat ${chatId}:`, {
                    ok: result.ok,
                    result: !!result.result,
                    errorCode: result.error_code,
                    description: result.description
                });
            }
        } catch (err) {
            console.error(`❌ [Telegram] Excepción enviando a chat ${chatId}:`, {
                message: err.message,
                code: err.code,
                type: err.constructor?.name,
                fullError: err
            });
        }
    }

    // Guardar los IDs de los mensajes en el pedido para actualización sincronizada
    if (sentMessages.length > 0) {
        try {
            await admin.firestore().collection('orders').doc(orderId).update({
                telegramBusinessMessages: sentMessages
            });
            console.log(`📝 Mensajes de negocio vinculados al pedido ${orderId}. Total: ${sentMessages.length}`);
            console.log(`📝 Detalles de mensajes guardados: ${JSON.stringify(sentMessages)}`);
        } catch (err) {
            console.error(`❌ Error guardando mensajes de negocio en Firestore:`, err);
        }
    } else {
        console.warn(`⚠️ [Telegram] No se pudo enviar mensaje a ningún chat del negocio para orden ${orderId}`);
    }
}


module.exports = {
    formatTelegramMessage,
    sendStoreTelegramMessage,
    sendDeliveryTelegramMessage,
    handleStoreWebhook,
    handleDeliveryWebhook,
    handleCustomerWebhook,
    sendDeliveryTelegramNotification,
    sendBusinessTelegramNotification,
    updateBusinessTelegramMessage,
    sendCustomerTelegramNotification
};
