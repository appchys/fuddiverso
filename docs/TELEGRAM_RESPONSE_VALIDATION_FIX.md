# 🔧 Corrección: Validación de Respuestas Telegram

## ❌ Problema Identificado

Los logs mostraban errores: **"Respuesta inválida del servidor"**

```
2026-02-26T17:30:04.142395Z ? onordercreated: ÔØî [Telegram] Error enviando mensaje: {
2026-02-26T17:30:04.142416Z ? onordercreated: ÔØî [Telegram] Respuesta inválida del servidor para chat 5209728948
```

### Causa Raíz

La validación en el código estaba **incompleta**:

```javascript
// ❌ INCORRECTO
if (result && result.result) {
    // Éxito
} else {
    // Error
}
```

El problema: **Se validaba si `result` y `result.result` existen, pero NO se validaba el campo `ok` de la API de Telegram.**

La API de Telegram **siempre** retorna:
```json
{
  "ok": true/false,    // ← Campo crítico que faltaba validar
  "result": {...}      // ← Datos del resultado
}
```

Cuando `ok: false`, significa que hubo un error, incluso si `result` tiene algo de data. Por eso el código decía "respuesta inválida" - técnicamente la respuesta de Telegram era inválida (ok: false).

---

## ✅ Solución Implementada

### Cambio de Validación

**ANTES (incorrecto):**
```javascript
if (result && result.result) {
    // Éxito
} else {
    console.error(`Respuesta inválida del servidor`);
}
```

**DESPUÉS (correcto):**
```javascript
if (result.ok && result.result) {
    // Éxito
    console.log(`Mensaje enviado. Message ID: ${result.result.message_id}`);
} else if (result) {
    // Telegram respondió pero con error
    console.error(`Error en respuesta de Telegram:`, {
        ok: result.ok,
        errorCode: result.error_code,
        description: result.description
    });
} else {
    // No hay respuesta en absoluto
    console.error(`No hay respuesta de Telegram`);
}
```

### Funciones Corregidas

1. **sendTelegramMessageGeneric()** - Función centralizada de envío
   - Ahora valida `result.ok` antes de procesar
   - Retorna información del error de Telegram si falló
   - Logging mejorado con `errorCode` y `description`

2. **sendBusinessTelegramNotification()** - Notificaciones a tienda
   - Valida `result.ok && result.result` para confirmar éxito
   - Registra detalles del error si `ok: false`
   - Evita guardar `telegramBusinessMessages` si falla

3. **sendDeliveryTelegramNotification()** - Notificaciones a delivery
   - La misma validación de `ok`
   - Mejor logging de errores

4. **sendCustomerTelegramNotification()** - Notificaciones a cliente
   - La misma validación de `ok`
   - Detalles de error más claros

---

## 📊 Campos de Error de Telegram

Cuando `ok: false`, Telegram devuelve:

```json
{
  "ok": false,
  "error_code": 400,
  "description": "Bad Request: chat not found"
}
```

**Errores comunes:**

| Error Code | Description | Causa |
|-----------|-------------|--------|
| 400 | `chat not found` | El chat ID no existe o el usuario bloqueó al bot |
| 403 | `Forbidden: bot was blocked by the user` | Usuario bloqueó al bot |
| 429 | `Too Many Requests: retry after 60` | Rate limiting - esperar antes de reintentar |
| 401 | `Unauthorized` | Token inválido o expirado |

---

## 🚀 Cómo Verificar que Funciona

### 1. **Crear orden de prueba**

```bash
# Desde el navegador o app
1. Ve a [negocio]
2. Agrega productos al carrito
3. Completa checkout
4. Confirma la orden
```

### 2. **Revisar logs inmediatamente**

```powershell
firebase functions:log --lines=100 | Select-String -Pattern "Telegram|enviado"
```

**Esperado - Éxito:**
```
✅ Enviando notificación de orden a negocio. ChatIDs: 5209728948, 8207556985
✅ Enviando mensaje a chat 5209728948...
✅ Mensaje enviado exitosamente a 5209728948. Message ID: 12345
✅ Notificación enviada a chat 5209728948
```

**Esperado - Error (Chat no encontrado):**
```
❌ Enviando notificación de orden a negocio. ChatIDs: 5209728948
❌ Error en respuesta de Telegram: {
  ok: false,
  errorCode: 400,
  description: "Bad Request: chat not found"
}
```

### 3. **Verificar en Telegram**

- ✅ Bot recibe mensaje en la app
- ✅ Aparecen los botones de acción (Aceptar/Descartar)
- ✅ Puedo clickear los botones

### 4. **En Firebase Console**

```
firebase console → Functions → Logs
- Buscar "onOrderCreated"
- Buscar líneas con "Telegram"
- Verificar que sea "✅ Éxito" no "❌ Error"
```

---

## 🔍 Debugging si Sigue Sin Funcionar

### Si ves: "chat not found"

```
Error Code 400: "Bad Request: chat not found"
```

**Solución:**
1. Asegúrate que el `telegramChatId` en Firestore es un **número**, no un string
2. Abre Telegram y escribe `/start` al bot
3. El bot debe estar activo en BotFather (@BotFather)

### Si ves: "retry after 60"

```
Error Code 429: "Too Many Requests: retry after 60"
```

**Solución:**
- Esperé 60 segundos antes de enviar más órdenes
- Los errores de rate limiting son normales con muchas órdenes simultáneamente

### Si ves: "Unauthorized"

```
Error Code 401: "Unauthorized"
```

**Solución:**
1. El token en `.env.local` puede estar incorrecto
2. Verifica `firebase functions:config:get | grep telegram`
3. Los tokens están bien? Redeploy las funciones

---

## 📋 Cambios Específicos en Código

### telegram.js - sendTelegramMessageGeneric()

**Líneas ~495-530:**
```javascript
const responseData = response.data;

// ✅ NUEVO: Validar que response.ok sea true
if (!responseData.ok) {
    console.error('❌ Error en respuesta de Telegram:', {
        chatId: chatId,
        ok: responseData.ok,
        errorCode: responseData.error_code,
        description: responseData.description
    });
    return responseData;
}
```

### telegram.js - sendStoreTelegramMessage()

**Líneas ~1265-1310:**
```javascript
// ✅ ANTES: if (result && result.result)
// ✅ AHORA: if (result.ok && result.result)

if (result.ok && result.result) {
    sentMessages.push({...});
    console.log(`✅ Notificación enviada`);
} else {
    console.error(`❌ Error en respuesta:`, {
        ok: result.ok,
        errorCode: result.error_code,
        description: result.description
    });
}
```

---

## 🧪 Checklist de Verificación

- [ ] Deploy completado sin errores
- [ ] Crear orden de prueba desde checkout
- [ ] Revisar logs: `firebase functions:log --lines=100`
- [ ] Verificar si hay línea ✅ o ❌ en logs de Telegram
- [ ] Si ❌: anotar el `errorCode` y `description`
- [ ] Verificar en Telegram Desktop/Mobile si llegó mensaje
- [ ] Si llegó mensaje: ¡Implementación exitosa! 🎉
- [ ] Si NO llegó: usar el `errorCode` para diagnosticar (tabla arriba)

---

## 📊 Resumen de Cambios

| Función | Línea | Cambio |
|---------|-------|--------|
| sendTelegramMessageGeneric() | ~510 | Agregar validación `result.ok` |
| sendBusinessTelegramNotification() | ~1292 | Cambiar `if (result && result.result)` a `if (result.ok && result.result)` |
| sendDeliveryTelegramNotification() | ~1154 | La misma validación |
| sendCustomerTelegramNotification() | ~1154 | La misma validación |

---

## 🎯 Próximas Acciones

1. **Verificar que el deploy tomó los cambios:**
   ```bash
   firebase functions:log --lines=30 | Select-String "STORE_BOT_TOKEN"
   ```

2. **Crear orden de prueba y revisar logs**

3. **Si sigue sin funcionar, proporcionar:**
   - El `errorCode` exacto del log
   - El `description` que devuelve Telegram
   - El `telegramChatId` que está intentando usar (sin exponer número completo)

Esto debería resolver el issue de "respuesta inválida del servidor". 🚀
