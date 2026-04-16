# Sistema de Broadcast de Mensajes Telegram para Clientes

## 📋 Descripción General

Se ha implementado un sistema completo para enviar mensajes personalizados a todos los clientes que tienen Telegram vinculado. Los administradores pueden escribir, previsualizar y enviar mensajes a toda la base de clientes desde el panel de administración.

## 🏗️ Componentes Implementados

### 1. **Backend - Cloud Functions** (`functions/telegram.js`)

#### Nueva Función: `sendBroadcastToCustomers(message)`
```javascript
/**
 * Enviar un mensaje de broadcast a todos los clientes con Telegram vinculado
 * @param {string} message - Mensaje a enviar (puede incluir HTML)
 * @returns {Promise<Object>} { success, message, total, successful, failed, errors }
 */
```

**Funcionalidades:**
- Obtiene todos los clientes de la colección `clients` que tengan `telegramChatId` vinculado
- Envía el mensaje a cada cliente en paralelo (no secuencial)
- Registra estadísticas de envío en Firestore
- Retorna detalles de éxitos y errores
- Maneja errores de HTML malformado automáticamente

**Registro de Broadcasts:**
Se guarda en la colección `telegramBroadcasts` con:
```firestore
{
  message: string,           // El mensaje enviado
  totalRecipients: number,   // Total de clientes con Telegram
  successful: number,        // Mensajes enviados correctamente
  failed: number,            // Mensajes que fallaron
  createdAt: timestamp,      // Fecha de creación
  timestamp: string,         // ISO timestamp
  errors: Array             // Array de errores (primeros 10)
}
```

### 2. **API HTTP Endpoint** (`functions/index.js`)

#### Nueva Function: `sendTelegramBroadcast`
```javascript
exports.sendTelegramBroadcast = onRequest(async (req, res) => {...})
```

**Características:**
- Ubicación: `https://us-central1-fuddiverso.cloudfunctions.net/sendTelegramBroadcast`
- Método: `POST`
- Requiere autenticación (Bearer token)
- Valida que el usuario sea admin verificando en la colección `admins`
- Payload:
  ```json
  {
    "message": "Tu mensaje aquí con <b>HTML</b>"
  }
  ```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Broadcast completado. 12/15 mensajes enviados exitosamente.",
  "stats": {
    "total": 15,
    "successful": 12,
    "failed": 3
  },
  "errors": [
    {
      "clientId": "...",
      "chatId": "...",
      "clientName": "Juan",
      "error": "Chat blocked"
    }
  ]
}
```

### 3. **Cliente TypeScript** (`src/lib/database.ts`)

#### Nueva Función: `sendTelegramBroadcast(message)`
```typescript
export async function sendTelegramBroadcast(message: string): Promise<{
  success: boolean
  message?: string
  error?: string
  stats?: {
    total: number
    successful: number
    failed: number
  }
  errors?: Array<{...}>
}>
```

**Funcionalidades:**
- Obtiene el token de autenticación del usuario actual
- Llama al endpoint de Cloud Functions
- Maneja errores de autenticación
- Retorna los resultados en un formato consistente

### 4. **Componente React Frontend** (`src/components/CustomerBroadcastPanel.tsx`)

#### Características del Componente:

**1. Editor de Mensaje:**
- Textarea con soporte para HTML
- Contador de caracteres (límite: 4096)
- Indicador visual si se excede el límite

**2. Toolbar de Formatos:**
- Botón **Negrita** - Inserta `<b>texto</b>`
- Botón *Cursiva* - Inserta `<i>texto</i>`
- Botón <u>Subrayado</u> - Inserta `<u>texto</u>`
- Selector de Emojis con 5 categorías:
  - 🍕 Comida
  - ✅ Estado
  - 👤 Personas
  - 💵 Dinero
  - 📍 Ubicación

**3. Vista Previa:**
- Muestra cómo se verá el mensaje en Telegram
- Renderiza HTML correctamente
- Se actualiza en tiempo real

**4. Estado de Envío:**
- Indicador de carga durante el envío
- Botón deshabilitado mientras se envía
- Prevención de caracteres excedidos

**5. Resultados:**
- Tarjeta con estado de éxito/error
- Grid con estadísticas de envío:
  - Total de clientes
  - Mensajes enviados exitosamente
  - Fallos
- Detalles de errores (máximo 5 mostrados)
- Botón para cerrar resultado

**6. Información de Seguridad:**
- Aviso sobre que solo clientes con Telegram vinculado recibirán el mensaje
- Mención de que se guarda registro de broadcasts

## 🔒 Seguridad

### Autenticación:
1. El usuario debe estar autenticado en Firebase
2. El endpoint valida que el usuario sea admin
3. El token de autenticación se valida en Cloud Functions

### Validación:
- El mensaje no puede estar vacío
- No se puede exceder 4096 caracteres
- Se valida que el usuario tenga permisos de admin

### Límites:
- Envío en paralelo con límite implícito de Telegram (rate limiting)
- Manejo de errores no bloqueante
- Rollback automático en caso de fallas generales

## 📱 Integración en Admin Dashboard

### Navegación:
1. Va al Panel de Administración
2. Selecciona pestaña **"Notificaciones"** o similar → **"Templates"**
3. Verás 3 pestañas:
   - WhatsApp
   - Telegram - Plantillas
   - **Broadcast a Clientes** ← Nueva

### Uso:
```
1. Click en "Broadcast a Clientes"
2. Escribe tu mensaje en el área de texto
3. Usa los botones de formato o emojis si deseas
4. Revisa la vista previa
5. Click en "Enviar a Todos"
6. Espera el resultado
```

## 🎯 Casos de Uso

### 1. **Promociones y Descuentos**
```html
🎉 <b>¡PROMOCIÓN ESPECIAL!</b>

Hoy va a tener <b>20% de descuento</b> en toda la tienda "La Pizzería"

📍 <a href="https://fuddiverso.app">Ver en Fuddi</a>
```

### 2. **Recordatorios de Compra**
```html
👋 ¡Hola de nuevo!

Hace un tiempo compraste en La Pizzería y nos encantaría verte de nuevo.

<b>Hoy tenemos especiales en:</b>
• 🍕 Pizzas medianas: $8.99
• 🥗 Ensaladas: $5.99

¿Qué esperas? 🚀
```

### 3. **Cambios en Horarios**
```html
⏰ <b>CAMBIO DE HORARIO</b>

A partir de mañana, La Pizzería abrirá una hora más tarde.

<b>Nuevo horario:</b>
Lunes a Viernes: 12:00 PM - 10:00 PM
Sábados y Domingos: 1:00 PM - 11:00 PM
```

### 4. **Comunicados Importantes**
```html
📢 <b>Comunicado Importante</b>

Por mantenimiento en nuestros sistemas,
los pedidos podrán tener <u>pequeños cambios en tiempos de entrega</u>.

Gracias por tu paciencia 🙏
```

## 📊 Monitoreo y Estadísticas

### Colección `telegramBroadcasts`
Accesible en Firestore para auditoría:
- Ver historial completo de broadcasts enviados
- Fecha y hora de cada envío
- Tasa de éxito (successful / total)
- Errores registrados para análisis

### Logs en Cloud Functions
Todos los envíos quedan registrados en los logs con:
- Timestamp
- Nombre del cliente
- Estado de envío
- Errores específicos

## 🚀 Mejoras Futuras

### Posibles Extensiones:
1. **Segmentación de Clientes:**
   - Por ciudad
   - Por negocio favorito
   - Por frecuencia de compra

2. **Programación de Broadcasts:**
   - Enviar en horarios específicos
   - Enviar en días específicos

3. **Plantillas Predefinidas:**
   - Guardar mensajes frecuentes
   - Reutilizar broadcasts previos

4. **A/B Testing:**
   - Enviar variantes a diferentes grupos
   - Medir engagement

5. **Analytics:**
   - Clicks en enlaces
   - Ingresos generados por broadcast

## ⚠️ Consideraciones Importantes

### 1. **Privacidad:**
- Solo se envían a clientes que han vinculado voluntariamente su Telegram
- Se respeta el derecho a no recibir mensajes (pueden desvincularse)
- No se comparten datos con terceros

### 2. **Frecuencia:**
- Recomendable no enviar más de 1-2 mensajes por semana
- Evitar spam para mantener engagement

### 3. **Horarios:**
- Evitar enviar fuera de horarios comerciales
- Considerar la zona horaria de los clientes

### 4. **Contenido:**
- Ser respetuoso y profesional
- Evitar spam o contenido promocional excesivo
- Mantener la identidad del negocio

## 🐛 Troubleshooting

### Problema: "No tienes permisos para esta acción"
**Solución:** Verifica que el usuario esté registrado en la colección `admins` en Firestore.

### Problema: "CUSTOMER_BOT_TOKEN no está configurado"
**Solución:** Verifica que el bot de cliente esté configurado en las variables de entorno de Cloud Functions.

### Problema: "No hay clientes con Telegram vinculado"
**Solución:** Los clientes necesitan vincular su Telegram desde la app antes de recibir broadcasts.

### Problema: "Error parseando HTML"
**Solución:** El sistema reintenta sin HTML automáticamente. Verifica que las etiquetas HTML sean válidas.

## 📞 Soporte

Para problemas o preguntas:
1. Revisa los logs en Cloud Functions
2. Verifica la colección `telegramBroadcasts` para historiales
3. Consulta los errores registrados en la respuesta del API

