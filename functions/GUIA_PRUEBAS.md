# 🧪 Guía de Pruebas - Sistema de Recordatorios

## Cómo Probar la Función

### Opción 1: Crear Orden de Prueba Manualmente

Para probar el sistema, necesitas crear una orden programada en Firebase con los siguientes datos:

#### Estructura de la Orden de Prueba

```javascript
{
  // Información básica
  businessId: "tu_business_id",
  status: "pending",  // o "confirmed" o "preparing"
  
  // Información del cliente
  customer: {
    id: "cliente_id",
    name: "Juan Pérez",
    phone: "0987654321"
  },
  
  // IMPORTANTE: Timing debe ser 'scheduled'
  timing: {
    type: "scheduled",  // ← ESTO ES CRÍTICO
    scheduledTime: "14:30",  // Hora en formato HH:MM o HH:MM AM/PM
    scheduledDate: Timestamp  // Timestamp de Firebase para HOY + 30 minutos
  },
  
  // Información de entrega
  delivery: {
    type: "delivery",  // o "pickup"
    references: "Av. Principal 123, Casa blanca"
  },
  
  // Productos
  items: [
    {
      name: "Pizza Margarita",
      quantity: 2,
      price: 10.50,
      variant: "Grande"
    },
    {
      name: "Coca Cola 2L",
      quantity: 1,
      price: 2.50
    }
  ],
  
  // Totales
  subtotal: 23.50,
  total: 25.50,
  
  // Pago
  payment: {
    method: "cash",
    paymentStatus: "pending"
  },
  
  // NO incluir estos campos (se agregan automáticamente)
  // reminderSent: false,
  // reminderSentAt: null,
  
  createdAt: Timestamp
}
```

### Opción 2: Script de Prueba Rápida

Puedes usar este código JavaScript en la consola de Firebase para crear una orden de prueba:

```javascript
// En la consola de Firebase Firestore

// 1. Calcular la hora de entrega (30 minutos desde ahora)
const now = new Date();
const deliveryTime = new Date(now.getTime() + 30 * 60 * 1000);

// 2. Formatear la hora
const hours = deliveryTime.getHours();
const minutes = deliveryTime.getMinutes().toString().padStart(2, '0');
const scheduledTime = `${hours}:${minutes}`;

// 3. Crear la orden
const testOrder = {
  businessId: "TU_BUSINESS_ID_AQUI",  // ← CAMBIAR ESTO
  status: "pending",
  
  customer: {
    id: "test_client_123",
    name: "Cliente de Prueba",
    phone: "0999999999"
  },
  
  timing: {
    type: "scheduled",
    scheduledTime: scheduledTime,
    scheduledDate: firebase.firestore.Timestamp.fromDate(deliveryTime)
  },
  
  delivery: {
    type: "delivery",
    references: "Dirección de prueba 123"
  },
  
  items: [
    {
      name: "Producto de Prueba",
      quantity: 1,
      price: 10.00
    }
  ],
  
  subtotal: 10.00,
  total: 10.00,
  
  payment: {
    method: "cash",
    paymentStatus: "pending"
  },
  
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
};

// 4. Guardar en Firestore
db.collection('orders').add(testOrder)
  .then(doc => console.log('✅ Orden de prueba creada:', doc.id))
  .catch(err => console.error('❌ Error:', err));
```

### Opción 3: Desde el Dashboard

Si tienes acceso al dashboard de administración:

1. Ve a la sección de "Crear Orden Manual"
2. Selecciona **"Programada"** como tipo de entrega
3. Configura la hora para **30 minutos desde ahora**
4. Completa los demás campos
5. Guarda la orden

## Verificación de la Prueba

### 1. Verificar que la Orden se Creó Correctamente

En Firebase Console:
- Ve a Firestore
- Abre la colección `orders`
- Busca tu orden de prueba
- Verifica que tenga:
  - `timing.type === "scheduled"` ✅
  - `status` sea `pending`, `confirmed` o `preparing` ✅
  - `timing.scheduledTime` esté en formato correcto ✅
  - `timing.scheduledDate` sea un Timestamp ✅
  - NO tenga `reminderSent: true` ✅

### 2. Monitorear los Logs

Después de crear la orden, espera hasta que falten 30-35 minutos para la entrega.

```bash
# Ver logs en tiempo real
firebase functions:log --only sendScheduledOrderReminders

# O ver todos los logs de funciones
firebase functions:log
```

### 3. Logs Esperados

Deberías ver algo como esto:

```
⏰ Verificando órdenes programadas para recordatorios...
🔍 Buscando órdenes entre 14:30:00 y 14:35:00
📦 Encontradas 1 órdenes programadas activas
📧 Enviando recordatorio para orden abc123... - Entrega: 15/01/2026 14:30:00
✅ Recordatorio enviado para orden abc123 a negocio@email.com
✅ Proceso completado. Recordatorios enviados: 1
```

### 4. Verificar el Email

- Revisa la bandeja de entrada del email del negocio
- Busca un email con asunto: `⏰ Recordatorio: Entrega en 30 min - [Cliente] - Fuddi`
- Verifica que contenga toda la información de la orden

### 5. Verificar la Actualización de la Orden

Después de enviar el recordatorio, la orden debe actualizarse:

```javascript
{
  ...otros_campos,
  reminderSent: true,
  reminderSentAt: Timestamp  // Momento exacto del envío
}
```

## Casos de Prueba Recomendados

### ✅ Caso 1: Orden Programada Normal
- `timing.type: "scheduled"`
- `status: "pending"`
- Hora: 30 minutos en el futuro
- **Resultado esperado**: Email enviado ✅

### ❌ Caso 2: Orden Inmediata (No debe enviar)
- `timing.type: "immediate"`
- `status: "pending"`
- **Resultado esperado**: No envía email ❌

### ❌ Caso 3: Orden Completada (No debe enviar)
- `timing.type: "scheduled"`
- `status: "completed"`
- **Resultado esperado**: No envía email ❌

### ❌ Caso 4: Recordatorio Ya Enviado (No debe duplicar)
- `timing.type: "scheduled"`
- `status: "pending"`
- `reminderSent: true`
- **Resultado esperado**: No envía email ❌

### ❌ Caso 5: Hora Muy Lejana (No debe enviar)
- `timing.type: "scheduled"`
- `status: "pending"`
- Hora: 2 horas en el futuro
- **Resultado esperado**: No envía email ❌

### ❌ Caso 6: Hora Ya Pasada (No debe enviar)
- `timing.type: "scheduled"`
- `status: "pending"`
- Hora: 10 minutos en el pasado
- **Resultado esperado**: No envía email ❌

## Troubleshooting

### El email no se envía

**Posibles causas:**

1. **La función no está desplegada**
   ```bash
   firebase deploy --only functions:sendScheduledOrderReminders
   ```

2. **La hora no está en el rango de 30-35 minutos**
   - Verifica que la hora programada esté exactamente 30-35 min en el futuro

3. **El formato de hora es incorrecto**
   - Usa formato `"HH:MM"` (ej: `"14:30"`) o `"HH:MM AM/PM"` (ej: `"2:30 PM"`)

4. **El status no es válido**
   - Debe ser `pending`, `confirmed` o `preparing`

5. **Ya se envió el recordatorio**
   - Verifica que `reminderSent` no sea `true`

### Ver errores específicos

```bash
# Ver logs con errores
firebase functions:log --only sendScheduledOrderReminders | grep "❌"

# Ver todas las ejecuciones
firebase functions:log --only sendScheduledOrderReminders --lines 100
```

## Limpieza Después de Pruebas

Después de probar, puedes:

1. **Eliminar órdenes de prueba** desde Firebase Console
2. **O marcarlas como completadas**:
   ```javascript
   db.collection('orders').doc('orden_prueba_id').update({
     status: 'completed'
   });
   ```

## Frecuencia de Ejecución

Recuerda que la función se ejecuta **cada 5 minutos**, así que:

- Si creas una orden a las 14:00 para entrega a las 14:30
- La función verificará a las: 14:00, 14:05, 14:10, 14:15, 14:20, 14:25, 14:30...
- Enviará el email en la ejecución de las **14:00** (30 min antes)

## Notas Importantes

⚠️ **Zona Horaria**: La función usa `America/Guayaquil`. Asegúrate de que las horas estén en esa zona horaria.

⚠️ **Costos**: Cada ejecución de la función consume cuota de Firebase. En el plan gratuito tienes límites.

⚠️ **Email**: Asegúrate de que el email del negocio esté correctamente configurado en Firebase.

✅ **Producción**: Una vez probado, la función funcionará automáticamente sin intervención manual.
