const axios = require('axios');
const admin = require('firebase-admin');
const { processOrderAction } = require('./delivery');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8275094091:AAGDO1PSfE1bQn5u0zLWoC4yb6Or093lc6k';

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

        // Agrupar por nombre de producto SOLO si existe productName (indicativo de variante)
        // Si no tiene productName, se considera un item independiente y no se agrupa bajo un título
        const groupedItems = {};
        const standaloneItems = []; // Items que no tienen variante o productName definido explícitamente

        orderData.items.forEach(item => {
            // Un item tiene variante típicamente si tiene 'productName' (nombre del padre) Y 'name' (nombre de la variante)
            const parentName = item.productName;

            if (parentName) {
                // Es una variante
                if (!groupedItems[parentName]) {
                    groupedItems[parentName] = [];
                }
                groupedItems[parentName].push(item);
            } else {
                // Es un producto simple (sin variantes) O la estructura no tiene productName
                standaloneItems.push(item);
            }
        });

        // 1. Renderizar items agrupados (Con variantes)
        Object.keys(groupedItems).forEach(parentName => {
            itemsText += `${parentName}\n`;
            groupedItems[parentName].forEach(item => {
                const quantity = item.quantity || 1;
                // Si es variante, 'name' o 'variantName' suele ser el nombre de la variante (ej: "12 wantancitos")
                const detail = item.variantName || item.name || 'Variante';
                itemsText += `( ${quantity} ) ${detail}\n`;
            });
            itemsText += `\n`;
        });

        // 2. Renderizar items independientes (Sin variantes)
        standaloneItems.forEach(item => {
            const quantity = item.quantity || 1;
            const name = item.name || 'Producto';
            // Para productos simples, no ponemos título de grupo, se muestra directo
            itemsText += `( ${quantity} ) ${name}\n`;
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

    return { text, mapsLink };
}

/**
 * Función para enviar mensajes de Telegram
 */
async function sendTelegramMessage(chatId, text, replyMarkup = null, linkPreviewOptions = null) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
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
        await axios.post(url, data);
    } catch (error) {
        console.error('Error sending Telegram message:', error.response?.data || error.message);
    }
}

/**
 * Función para manejar el webhook de Telegram
 */
async function handleTelegramWebhook(req, res) {
    try {
        const update = req.body;
        console.log('📬 Telegram Update:', JSON.stringify(update));

        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;

            if (text.startsWith('/start')) {
                const deliveryId = text.split(' ')[1];
                if (deliveryId) {
                    try {
                        await admin.firestore().collection('deliveries').doc(deliveryId).update({
                            telegramChatId: chatId.toString()
                        });
                        await sendTelegramMessage(chatId, "✅ <b>¡Vinculación Exitosa!</b>\n\nDesde ahora recibirás las notificaciones de nuevos pedidos aquí.");
                    } catch (error) {
                        console.error('Error vincualndo delivery:', error);
                        await sendTelegramMessage(chatId, "❌ Hubo un error al vincular tu cuenta. Por favor verifica el enlace.");
                    }
                } else {
                    await sendTelegramMessage(chatId, "¡Hola! Para vincular tu cuenta, usa el botón 'Vincular Telegram' en tu panel de administración.");
                }
            }
        } else if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;

            const [actionType, token] = data.split('|');
            const action = actionType.replace('order_', '');

            const result = await processOrderAction(token, action);

            if (result.error) {
                await sendTelegramMessage(chatId, `❌ Error: ${result.error}`);
            } else {
                const orderId = result.orderId;
                let statusText = '';
                if (action === 'confirm') statusText = '✅ <b>Aceptado</b>';
                else if (action === 'on_way') statusText = '🛵 <b>En camino</b>';
                else if (action === 'delivered') statusText = '🏁 <b>Entregado</b>';
                else if (action === 'discard') statusText = '❌ <b>Descartado</b>';
                let newText = "";

                try {
                    // Obtener datos frescos para reconstruir el mensaje
                    const orderDoc = await admin.firestore().collection('orders').doc(orderId).get();
                    const orderData = orderDoc.data();

                    let businessName = 'Negocio';
                    if (orderData.businessId) {
                        const businessDoc = await admin.firestore().collection('businesses').doc(orderData.businessId).get();
                        if (businessDoc.exists) {
                            businessName = businessDoc.data().name || businessName;
                        }
                    }

                    if (action === 'delivered') {
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

                        const editUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
                        await axios.post(editUrl, {
                            chat_id: chatId,
                            message_id: messageId,
                            text: newText,
                            parse_mode: 'HTML',
                            link_preview_options: { is_disabled: true }
                        });
                    } else if (action !== 'discard') {
                        const { text: formattedText, mapsLink } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, true);
                        newText = formattedText + `\n\n${statusText}`;

                        // Preparar botones dinámicos según el estado
                        const replyMarkup = { inline_keyboard: [] };

                        const onWayToken = Buffer.from(`${orderId}|on_way`).toString('base64');
                        const deliveredToken = Buffer.from(`${orderId}|delivered`).toString('base64');

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

                        // Editar el mensaje original para quitar botones y mostrar estado
                        const editUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;

                        const editData = {
                            chat_id: chatId,
                            message_id: messageId,
                            text: newText,
                            parse_mode: 'HTML',
                            reply_markup: replyMarkup.inline_keyboard.length > 0 ? replyMarkup : undefined
                        };

                        if (mapsLink) {
                            editData.link_preview_options = {
                                url: mapsLink,
                                prefer_large_media: true,
                                show_above_text: true
                            };
                        } else {
                            editData.link_preview_options = { is_disabled: true };
                        }

                        await axios.post(editUrl, editData);
                    } else {
                        // Caso de descarte
                        const customerName = orderData.customer?.name || 'Cliente';
                        newText = `<b>${businessName}</b> · ${customerName}\n\nx Descartado`;

                        const editUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
                        await axios.post(editUrl, {
                            chat_id: chatId,
                            message_id: messageId,
                            text: newText,
                            parse_mode: 'HTML'
                        });
                    }
                } catch (fetchError) {
                    console.error('Error fetching data for message update:', fetchError);
                    newText = `${callbackQuery.message.text}\n\n${statusText}`;

                    const editUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
                    await axios.post(editUrl, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: newText,
                        parse_mode: 'HTML'
                    });
                }
            }

            // Responder al callback para quitar el relojito
            const answerUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
            let answerText = "Acción procesada";
            if (action === 'confirm') answerText = "Pedido Aceptado";
            else if (action === 'on_way') answerText = "Pedido En Camino";
            else if (action === 'delivered') answerText = "Pedido Entregado";
            else if (action === 'discard') answerText = "Pedido Descartado";

            await axios.post(answerUrl, {
                callback_query_id: callbackQuery.id,
                text: answerText
            });
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error en telegramWebhook:', error);
        res.status(200).send('OK'); // Siempre responder 200 a Telegram para evitar reintentos infinitos
    }
}

async function sendDeliveryTelegramNotification(deliveryData, orderData, orderId, businessName) {
    if (deliveryData && deliveryData.telegramChatId) {
        const { text: telegramText, mapsLink } = formatTelegramMessage({ ...orderData, id: orderId }, businessName, false);

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

        const linkPreviewOptions = mapsLink ? {
            url: mapsLink,
            prefer_large_media: true,
            show_above_text: true
        } : null;

        await sendTelegramMessage(deliveryData.telegramChatId, telegramText, replyMarkup, linkPreviewOptions);
        console.log(`✅ Notificación de Telegram enviada a: ${deliveryData.telegramChatId}`);
    }
}


module.exports = {
    TELEGRAM_TOKEN,
    formatTelegramMessage,
    sendTelegramMessage,
    handleTelegramWebhook,
    sendDeliveryTelegramNotification
};
