const axios = require('axios');
const admin = require('firebase-admin');
const { processOrderAction } = require('./delivery');

const STORE_BOT_TOKEN = process.env.STORE_BOT_TOKEN || '8415155805:AAHU6nXGA1ZK8HVFHtTOJbcfa57Dsmbd7pg';
const DELIVERY_BOT_TOKEN = process.env.DELIVERY_BOT_TOKEN || '8275094091:AAGDO1PSfE1bQn5u0zLWoC4yb6Or093lc6k';
const CUSTOMER_BOT_TOKEN = process.env.CUSTOMER_BOT_TOKEN || '8506021400:AAFY2SnbM2ZoJwWYlqKPq5qzE_c5gmbJc8k';

/**
 * Función para formatear el mensaje de Telegram
 */
function formatTelegramMessage(orderData, businessName, isAccepted = false) {
    const orderId = orderData.id || '';

    // Información de entrega
    let scheduledTimeStr = 'Inmediato';
    let timingType = 'Inmediato';

    if (orderData.timing?.type === 'scheduled') {
        timingType = 'Programado';
        scheduledTimeStr = orderData.timing.scheduledTime || '';
    }

    const deliveryInfo = orderData.delivery?.references || 'Dirección no especificada';
    let mapsLink = '';
    if (orderData.delivery?.latlong) {
        const [lat, lng] = orderData.delivery.latlong.split(',').map(s => s.trim());
        if (lat && lng) {
            mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        }
    }
    const locationImageLink = orderData.delivery?.image || '';

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
        if (mapsLink) {
            text += `🗺️ <a href="${mapsLink}">Ver en Google Maps</a>\n`;
        }
        if (locationImageLink) {
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
        if (phone) {
            const waMessage = encodeURIComponent(`Hola, soy delivery de ${businessName}.`);
            const formattedPhone = phone.replace(/^0/, '');
            const waLink = `https://wa.me/593${formattedPhone}?text=${waMessage}`;
            text += `📱 Whatsapp: <a href="${waLink}">${phone}</a>\n`;
        } else {
            text += `📱 Whatsapp: No registrado\n`;
        }

        text += `\n<b>Datos de entrega</b>\n`;
        if (mapsLink) {
            text += `🗺️ <a href="${mapsLink}">Ver en Google Maps</a>\n`;
        }
        if (locationImageLink) {
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
 */
async function sendTelegramMessageGeneric(token, chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const data = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        };
        if (replyMarkup) {
            data.reply_markup = replyMarkup;
        }
        if (linkPreviewOptions) {
            data.link_preview_options = linkPreviewOptions;
        }
        const response = await axios.post(url, data);
        return response.data;
    } catch (error) {
        console.error('Error sending Telegram message:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Enviar mensaje usando el bot de Tienda
 */
async function sendStoreTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    return sendTelegramMessageGeneric(STORE_BOT_TOKEN, chatId, text, replyMarkup, linkPreviewOptions);
}

/**
 * Enviar mensaje usando el bot de Delivery
 */
async function sendDeliveryTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    return sendTelegramMessageGeneric(DELIVERY_BOT_TOKEN, chatId, text, replyMarkup, linkPreviewOptions);
}

/**
 * Enviar mensaje usando el bot de Cliente
 */
async function sendCustomerTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
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

                    try {
                        const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();
                        const orderData = orderDoc.data();
                        // ACCIÓN SINCRONIZADA PARA LA TIENDA
                        const businessName = orderData.businessName || 'Tienda';
                        const { text: telegramText } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);

                        const handlerName = callbackQuery.from.first_name || 'Alguien';
                        let finalStatusText = '';

                        if (action === 'biz_confirm') {
                            // Guardar quién confirmó
                            await admin.firestore().collection('orders').doc(orderId).update({ confirmedBy: handlerName });

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

                        // Actualizar TODOS los mensajes enviados a los administradores
                        const editUrl = `https://api.telegram.org/bot${STORE_BOT_TOKEN}/editMessageText`;
                        const updatePromises = businessMessages.map(msg =>
                            axios.post(editUrl, {
                                chat_id: msg.chatId,
                                message_id: msg.messageId,
                                text: syncText,
                                parse_mode: 'HTML',
                                link_preview_options: { is_disabled: true }
                            }).catch(err => console.error(`Error actualizando mensaje sincronizado en ${msg.chatId}:`, err.response?.data || err.message))
                        );
                        await Promise.allSettled(updatePromises);

                    } catch (err) {
                        console.error('Error updating business message:', err);
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
        const businessMessages = orderData.telegramBusinessMessages || [];
        if (businessMessages.length === 0) return;

        const businessName = orderData.businessName || 'Tienda';
        const { text: telegramText } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);

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

        const editUrl = `https://api.telegram.org/bot${STORE_BOT_TOKEN}/editMessageText`;
        const updatePromises = businessMessages.map(msg =>
            axios.post(editUrl, {
                chat_id: msg.chatId,
                message_id: msg.messageId,
                text: syncText,
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true }
            }).catch(err => console.error(`Error actualizando mensaje sincronizado en ${msg.chatId}:`, err.response?.data || err.message))
        );
        await Promise.allSettled(updatePromises);
    } catch (error) {
        console.error('Error en updateBusinessTelegramMessage:', error);
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
                                const { text: formattedText, mapsLink, locationImageLink } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);
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
    let chatId = orderData.customer?.telegramChatId;

    // Si no está en la orden, buscar en el perfil del cliente
    if (!chatId) {
        const clientId = orderData.customer?.id || orderData.clientId;
        if (clientId) {
            try {
                const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();
                if (clientDoc.exists && clientDoc.data().telegramChatId) {
                    chatId = clientDoc.data().telegramChatId;
                    console.log(`📱 ChatID recuperado del perfil de cliente ${clientId}: ${chatId}`);
                }
            } catch (error) {
                console.error('Error fetching client telegram info:', error);
            }
        }
    }

    if (!chatId) return;

    const businessName = orderData.businessName || 'Tu pedido';
    const status = orderData.status;
    let message = '';

    // Emojis y mensajes según estado
    if (status === 'confirmed') {
        message = `✅ <b>¡Pedido Confirmado!</b>\n\nEl negocio <b>${businessName}</b> ha aceptado tu pedido y comenzará a prepararlo pronto.`;
    } else if (status === 'preparing') {
        message = `👨‍🍳 <b>¡Manos a la obra!</b>\n\nEstán preparando tu pedido en <b>${businessName}</b>.`;
    } else if (status === 'ready') {
        message = `🎉 <b>¡Tu pedido está listo!</b>\n\nPronto será entregado o ya puedes pasar a retirarlo.`;
    } else if (status === 'on_way') {
        if (orderData.delivery?.assignedDelivery) {
            let deliveryName = 'Un repartidor';
            // Intentar obtener nombre del repartidor si lo tenemos disponible o hacer fetch si es crítico
            // Para simplicidad, usaremos un genérico o si ya viene en orderData (a veces se denormaliza)
            message = `🚴 <b>¡Tu pedido va en camino!</b>\n\nEl repartidor ya tiene tu orden y se dirige a tu ubicación.`;
        } else {
            message = `🚴 <b>¡Tu pedido va en camino!</b>`;
        }
    } else if (status === 'delivered') {
        message = `🎊 <b>¡Pedido Entregado!</b>\n\nGracias por comprar en <b>${businessName}</b>. ¡Buen provecho!`;
    } else if (status === 'cancelled') {
        message = `❌ <b>Pedido Cancelado</b>\n\nLo sentimos, tu pedido ha sido cancelado.`;
    }

    if (message) {
        // Añadir enlace al seguimiento
        // URL base: https://app.fuddiverso.com/o/ORDERID (Ajustar según dominio real)
        // message += `\n\n<a href="https://app.fuddiverso.com/o/${orderId}">Ver detalles del pedido</a>`;

        await sendCustomerTelegramMessage(chatId, message);
        console.log(`✅ Notificación (Customer Bot) enviada a: ${chatId} para orden ${orderId}`);
    }
}

async function sendDeliveryTelegramNotification(deliveryData, orderData, orderId, businessName) {
    if (deliveryData && deliveryData.telegramChatId) {
        const { text: telegramText, mapsLink, locationImageLink } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, false);

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

        await sendDeliveryTelegramMessage(deliveryData.telegramChatId, telegramText, replyMarkup, linkPreviewOptions);
        console.log(`✅ Notificación de Telegram (Delivery Bot) enviada a: ${deliveryData.telegramChatId}`);
    }
}

/**
 * Enviar notificación de Telegram a la tienda cuando se crea una orden
 */
async function sendBusinessTelegramNotification(businessData, orderData, orderId) {
    if (!businessData) return;

    // Obtener IDs de chat (nuevos y antiguos para migración)
    let chatIds = businessData.telegramChatIds || [];

    // Si existe el ID antiguo y no está en la lista nueva, incluirlo
    if (businessData.telegramChatId && !chatIds.includes(businessData.telegramChatId)) {
        chatIds = [...chatIds, businessData.telegramChatId];
    }

    if (chatIds.length === 0) return;

    const businessName = businessData.name || 'Tienda';
    const { text: telegramText } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);

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
        try {
            const result = await sendStoreTelegramMessage(chatId, telegramText, replyMarkup, linkPreviewOptions);
            if (result && result.result) {
                sentMessages.push({
                    chatId: chatId.toString(),
                    messageId: result.result.message_id
                });
                console.log(`✅ Notificación (Store Bot) enviada a chat ${chatId} (ID: ${result.result.message_id})`);
            }
        } catch (err) {
            console.error(`❌ Error enviando a chat ${chatId}:`, err);
        }
    }

    // Guardar los IDs de los mensajes en el pedido para actualización sincronizada
    if (sentMessages.length > 0) {
        try {
            await admin.firestore().collection('orders').doc(orderId).update({
                telegramBusinessMessages: sentMessages
            });
            console.log(`📝 Mensajes de negocio vinculados al pedido ${orderId}`);
        } catch (err) {
            console.error(`❌ Error guardando mensajes de negocio en Firestore:`, err);
        }
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
