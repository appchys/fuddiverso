const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'functions', 'telegram.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix the double-start logic in handleStoreWebhook
const messyBlock = `                    } catch (error) {
                        console.error('Error vinculando tienda:', error);
                        await sendStoreTelegramMessage(chatId, "❌ Hubo un error al vincular tu cuenta.");
                    }
                } else {
                    await sendStoreTelegramMessage(chatId, "¡Hola! Para vincular tu tienda, usa el botón 'Vincular Telegram' en tu panel de administración.");
                }
            }
        }

                            const businessName = businessDoc.data().name || 'Tu tienda';
                            await sendStoreTelegramMessage(chatId, \`✅ <b>¡Vinculación Exitosa!</b>\\n\\n<b>\${businessName}</b> ahora enviará notificaciones de nuevos pedidos a este chat.\\n\\n(Puedes vincular múltiples cuentas usando el mismo link)\`);
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
        }`;

const correctBlock = `                    } catch (error) {
                        console.error('Error vinculando tienda:', error);
                        await sendStoreTelegramMessage(chatId, "❌ Hubo un error al vincular tu cuenta.");
                    }
                } else {
                    await sendStoreTelegramMessage(chatId, "¡Hola! Para vincular tu tienda, usa el botón 'Vincular Telegram' en tu panel de administración.");
                }
            }
        }`;

if (content.includes(messyBlock)) {
    content = content.replace(messyBlock, correctBlock);
    console.log('✅ Cleaned up handleStoreWebhook duplicates');
}

// 2. Fix the syntax error at line 834 area (which was caused by the mess above)
// The previous replace might have already fixed it, let's check for remaining stray });

// 3. Update handleAdminWebhook properly
const adminWebhookOld = `async function handleAdminWebhook(req, res) {
    try {
        const update = req.body;
        console.log('📬 Admin Bot Update:', JSON.stringify(update));

        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;

            if (text.startsWith('/start')) {
                // Guardar el Chat ID del admin en Firestore
                await admin.firestore().collection('settings').doc('admin_telegram').set({
                    chatId: chatId.toString(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, "✅ <b>¡Bot de Admin vinculado con éxito!</b>\\n\\nDesde ahora recibirás notificaciones aquí de cada orden creada en Fuddi.");
            }
        }
        return res.status(200).send('ok');
    } catch (error) {
        console.error('❌ Error en Admin Webhook:', error);
        return res.status(500).send('error');
    }
}`;

const adminWebhookNew = `async function handleAdminWebhook(req, res) {
    try {
        const update = req.body;
        console.log('📬 Admin Bot Update:', JSON.stringify(update));

        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;

            if (text.startsWith('/start')) {
                // Guardar el Chat ID del admin en Firestore
                await admin.firestore().collection('settings').doc('admin_telegram').set({
                    chatId: chatId.toString(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, "✅ <b>¡Bot de Admin vinculado con éxito!</b>\\n\\nDesde ahora recibirás notificaciones aquí de cada orden creada en Fuddi.");
            }
        } else if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            
            const [actionType, value] = data.split('|');
            
            if (actionType === 'admin_manual_confirm') {
                const { processOrderAction } = require('./delivery');
                const result = await processOrderAction(value, 'biz_confirm');
                if (result.error) {
                    await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, \`❌ Error: \${result.error}\`);
                } else {
                    await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, \`✅ Pedido \${result.orderId} confirmado manualmente por administrador.\`);
                }
            } else if (actionType === 'admin_whatsapp_store') {
                try {
                    const bizDoc = await admin.firestore().collection('businesses').doc(value).get();
                    if (bizDoc.exists) {
                        const phone = bizDoc.data().phone || '';
                        if (phone) {
                            const waLink = \`https://wa.me/593\${phone.replace(/^0/, '')}\`;
                            await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, \`📱 Whatsapp Tienda (\${bizDoc.data().name}):\\n\${waLink}\`);
                        } else {
                             await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, '❌ La tienda no tiene teléfono configurado.');
                        }
                    } else {
                        await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, '❌ Negocio no encontrado.');
                    }
                } catch (e) {
                    await sendTelegramMessageGeneric(ADMIN_BOT_TOKEN, chatId, \`❌ Error al obtener datos del negocio: \${e.message}\`);
                }
            }
        }
        return res.status(200).send('ok');
    } catch (error) {
        console.error('❌ Error en Admin Webhook:', error);
        return res.status(500).send('error');
    }
}`;

if (content.includes(adminWebhookOld)) {
    content = content.replace(adminWebhookOld, adminWebhookNew);
    console.log('✅ Updated handleAdminWebhook');
} else {
    // If exact match fails, use a more flexible replacement
    const adminRegex = /async function handleAdminWebhook\(req, res\) \{[\s\S]*?return res\.status\(500\)\.send\('error'\);\s*\}\s*\}/;
    if (adminRegex.test(content)) {
        content = content.replace(adminRegex, adminWebhookNew);
        console.log('✅ Updated handleAdminWebhook (regex)');
    }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done.');
