# Guía de Configuración y Troubleshooting - Notificaciones Telegram

## 🚨 PROBLEMA IDENTIFICADO

Las notificaciones de Telegram no se están enviando porque **los tokens de Telegram no están configurados en las variables de entorno de Firebase Cloud Functions**.

## ✅ SOLUCIÓN: Configura los Tokens de Telegram

### 1. Verifica tus Tokens de Telegram Bot

Necesitas tener 3 bots de Telegram creados (uno para tienda, uno para delivery, uno para cliente). Si no los tienes:

```
1. Abre Telegram y busca @BotFather
2. Escribe /newbot y sigue las instrucciones
3. BotFather te dará un token parecido a esto:
   123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
```

### 2. Configura los Tokens en Firebase

#### Opción A: Desde línea de comandos

```bash
# Desde la raíz del proyecto
firebase functions:config:set telegram.store_token="TU_STORE_BOT_TOKEN" telegram.delivery_token="TU_DELIVERY_BOT_TOKEN" telegram.customer_token="TU_CUSTOMER_BOT_TOKEN"

# Verifica que se guardaron correctamente
firebase functions:config:get
```

#### Opción B: Manualmente en Firebase Console

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto
3. Ir a Functions → Configuración (Settings tab)
4. En "Runtime configuration variables" agrega:
   - `STORE_BOT_TOKEN`: Tu token del bot de tienda
   - `DELIVERY_BOT_TOKEN`: Tu token del bot de delivery
   - `CUSTOMER_BOT_TOKEN`: Tu token del bot de cliente

### 3. redeploy las funciones

```bash
cd functions
npm run deploy
# O
firebase deploy --only functions
```

## 📊 Verificar que funciona

Después del deploy:

1. **Revisa los logs** para confirmar que se detectaron los tokens:
   ```bash
   firebase functions:log --lines=100
   ```

   Deberías ver algo como:
   ```
   🔍 [Telegram Init] Validando tokens de Telegram:
   ✓ STORE_BOT_TOKEN: ✅ CONFIGURADO
   ✓ DELIVERY_BOT_TOKEN: ✅ CONFIGURADO
   ✓ CUSTOMER_BOT_TOKEN: ✅ CONFIGURADO
   ```

2. **Crea una orden de prueba** desde:
   - Checkout (para órdenes de cliente)
   - Panel de órdenes manuales (para órdenes de admin)

3. **Revisa los logs nuevamente** para ver si hay errores:
   ```bash
   firebase functions:log --lines=100
   ```

   Si todo está bien, deberías ver:
   ```
   📢 [Telegram] Enviando notificación de orden a negocio. ChatIDs: 123456789
   📤 [Telegram] Enviando mensaje a chat 123456789...
   ✅ [Telegram] Mensaje enviado exitosamente a 123456789. Message ID: 12345
   ```

## 🔍 Troubleshooting

### Error: "STORE_BOT_TOKEN no está configurado"

**Causa**: Los tokens no están en las variables de entorno

**Solución**: 
1. Verifica que ejecutaste `firebase functions:config:set` correctamente
2. Ejecuta `firebase functions:config:get` para confirmar
3. Redeploy las funciones

### Error: "Chat ID vacío"

**Causa**: El negocio/cliente/delivery no tiene `telegramChatId` configurado

**Solución**:
1. Para **negocios**: Asegúrate de que el negocio tiene `telegramChatIds` (array) o `telegramChatId` (string) en Firestore
2. Para **clientes**: El cliente debe tener `telegramChatId` configurado en su perfil
3. Para **delivery**: El delivery debe tener `telegramChatId` en su perfil

### Error: "Respuesta inválida del servidor"

**Causa**: El token es inválido o el chat ID no es válido

**Solución**:
1. Verifica que los tokens sean correctos
2. Verifica que los `chatId` sean números válidos (no strings)
3. Asegúrate de que los bots están activos en Telegram

### Los mensajes se envían pero no llegan

**Causa**: Posibles problemas con el bot:
1. El bot no tiene permisos para enviar mensajes
2. El usuario no ha iniciado conversación con el bot
3. El bot está deshabilitado

**Solución**:
1. Abre una conversación manual con tu bot en Telegram
2. Escribe `/start`
3. Verifica en BotFather que el bot está activo
4. Asegúrate de que el bot no tiene restricciones

## 📝 Variables de Entorno - Referencia

| Variable | Descripción | Ejemplo |
|----------|------------|---------|
| `STORE_BOT_TOKEN` | Token del bot para notificaciones de tienda | `123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh` |
| `DELIVERY_BOT_TOKEN` | Token del bot para notificaciones de delivery | `987654321:XYZabcdefghIJKLMNOPQRSTUVWabcdefgh` |
| `CUSTOMER_BOT_TOKEN` | Token del bot para notificaciones de cliente | `555555555:qwertyuiopasdfghjklzxcvbnmQWERTYUI` |

## 🔐 Seguridad

⚠️ **IMPORTANTE**: Nunca commitees los tokens a Git. Usa Firebase environment variables.

Verifica que están en `.gitignore`:
```
# functions/.gitignore
.env
.env.local
.env.*.local
```

## 📱 Flujo de Notificaciones Esperado

### Cuando se crea una orden (Checkout):

1. ✅ Orden se crea en Firestore
2. ✅ Cloud Function `onOrderCreated` se dispara
3. ✅ Se obtienen datos del negocio
4. ✅ Se envía notificación a `STORE_BOT_TOKEN` → Tienda
5. ✅ Si hay delivery asignado, se envía notificación a `DELIVERY_BOT_TOKEN` → Delivery
6. (Futuro) Se envía notificación a `CUSTOMER_BOT_TOKEN` → Cliente

### Cuando cambia el estado de la orden:

1. ✅ Cloud Function `onOrderUpdated` se dispara
2. ✅ Se envía notificación al cliente sobre cambios de estado

## 📞 Debugging Avanzado

Para obtener más información sobre por qué no se envían mensajes:

1. **Revisa los logs en tiempo real**:
   ```bash
   firebase functions:log --follow
   ```

2. **Busca errores específicos de Telegram**:
   ```bash
   firebase functions:log | grep -i telegram
   ```

3. **Verifica que los datos están en Firestore**:
   - Ve a Firebase Console
   - Colección `businesses` → Tu negocio → `telegramChatIds` o `telegramChatId`
   - Colección `clients` → Tu cliente → `telegramChatId`
   - Colección `deliveries` → Tu repartidor → `telegramChatId`

## ✨ Mejoras Implementadas

Para esta versión se agregó:

1. **Logging mejorado**: Ahora se ve claramente qué está pasando en cada paso
2. **Validación de tokens**: Se valida que los tokens existan antes de intentar enviar
3. **Validación de chatIds**: Se verifica que los IDs de chat sean válidos
4. **Mensajes de error más descriptivos**: Incluyen el statusCode y errorData de Telegram
5. **Tracking de Message IDs**: Se guardan los IDs de los mensajes enviados para poder editarlos luego
