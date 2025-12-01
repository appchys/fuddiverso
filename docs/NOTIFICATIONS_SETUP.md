# Sistema de Notificaciones del Dashboard

## Descripción

El sistema de notificaciones permite que los administradores de negocios reciban notificaciones en tiempo real cuando los clientes crean órdenes a través del checkout, sin necesidad de recargar la página manualmente.

## Características

✅ **Ícono de campana con contador**: Muestra el número de notificaciones no leídas
✅ **Notificaciones en tiempo real**: Detecta nuevas órdenes automáticamente
✅ **Sonido de notificación**: Genera un sonido beep cuando hay una nueva orden
✅ **Notificaciones del navegador**: Muestra notificaciones nativas del sistema (si está permitido)
✅ **Dropdown de notificaciones**: Lista completa de notificaciones con detalles de la orden
✅ **Marcar como leída**: Actualiza el estado de cada notificación

## Componentes

### NotificationsBell (`src/components/NotificationsBell.tsx`)

Componente React que maneja:
- Escucha de nuevas órdenes en Firestore
- Reproducción de sonido de notificación
- Visualización del contador de no leídas
- Dropdown con historial de notificaciones
- Marcar notificaciones como leídas

**Props:**
```typescript
interface NotificationsBellProps {
  businessId: string              // ID del negocio
  onNewOrder?: (order: Order) => void  // Callback cuando hay nueva orden
}
```

### API Endpoint (`src/app/api/notifications/route.ts`)

Proporciona endpoints para:
- **POST /api/notifications**: Guardar nueva notificación
- **GET /api/notifications**: Obtener notificaciones

Requiere variable de entorno:
```
FIREBASE_SERVICE_ACCOUNT_KEY=<JSON con credenciales de Firebase Admin>
```

## Estructura de Datos (Firestore)

Las notificaciones se almacenan en:
```
businesses/{businessId}/notifications/{notificationId}
```

Estructura de documento:
```typescript
{
  orderId: string              // ID de la orden
  type: 'new_order'           // Tipo de notificación
  title: string               // "Nueva orden #ABC123"
  message: string             // Descripción
  orderData: {
    id: string
    customer: { name, phone }
    items: []
    total: number
    status: string
  }
  read: boolean              // Si ya fue leída
  createdAt: Timestamp       // Fecha/hora de creación
}
```

## Cómo Funciona

### 1. **Escucha de Órdenes**
El componente escucha cambios en la colección `orders` de Firestore:
- Filtra órdenes del negocio actual
- Solo procesa órdenes creadas por clientes (`createdByAdmin: false`)
- Detecta documentos nuevos con `docChanges()`

### 2. **Creación de Notificación**
Cuando se detecta una nueva orden:
1. Se crea un documento en `businesses/{businessId}/notifications`
2. Se reproduce un sonido de notificación
3. Se muestra notificación del navegador (si está permitida)
4. Se ejecuta el callback `onNewOrder` para que el dashboard recargue órdenes

### 3. **Sonido de Notificación**
Utiliza **Web Audio API** para generar un sonido beep sin depender de archivos:
- Dos tonos: 800 Hz y 1000 Hz
- Duración: 200ms total
- Fallback: Si Web Audio no está disponible, se intenta reproducir archivo MP3

### 4. **Visualización**
- **Campana**: Muestra ícono con número de no leídas
- **Dropdown**: Lista todas las notificaciones ordenadas por fecha
- **Detalles**: Muestra cliente, total y productos de la orden

## Integración en el Dashboard

En `src/app/business/dashboard/page.tsx`:

```tsx
// En las importaciones
import NotificationsBell from '@/components/NotificationsBell'

// En el JSX del header
<NotificationsBell 
  businessId={selectedBusinessId}
  onNewOrder={handleNewOrder}
/>

// Función callback
const handleNewOrder = (newOrder: Order) => {
  // Recargar órdenes para que aparezcan inmediatamente
  loadOrders()
}
```

## Permisos Requeridos

### Firestore Rules
```firestore
match /businesses/{businessId}/notifications/{notificationId} {
  allow read, write: if request.auth.uid == resource.data.businessId ||
    isAdmin(businessId);
}
```

### Notificaciones del Navegador
El usuario debe permitir notificaciones en:
1. Primera vez que se ejecuta `Notification.requestPermission()`
2. Configuración del navegador (browser settings)

## Pruebas

### Crear orden de prueba
1. Ir a `http://localhost:3000/checkout?businessId=<ID>`
2. Completar formulario y confirmar pedido
3. Debería ver:
   - Sonido beep en el dashboard
   - Número aumentado en campana
   - Nueva notificación en el dropdown
   - Nueva orden listada en órdenes de hoy

### Debug
```typescript
// En NotificationsBell.tsx
console.log('Nueva orden:', order)
console.log('Notificaciones:', notifications)
```

## Variables de Entorno

`.env.local`:
```
NEXT_PUBLIC_FIREBASE_API_KEY=xxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=xxx
NEXT_PUBLIC_FIREBASE_PROJECT_ID=xxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=xxx
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxx
NEXT_PUBLIC_FIREBASE_APP_ID=xxx

FIREBASE_SERVICE_ACCOUNT_KEY=<JSON>
```

## Limitaciones y Consideraciones

1. **Sonido**: Algunos navegadores bloquean reproducción automática sin interacción del usuario. Se usa Web Audio API como fallback.

2. **Notificaciones del navegador**: Requieren permiso explícito del usuario.

3. **Firestore Read**: Cada notificación requiere una lectura de Firestore. Considerar límites de quota.

4. **Tiempo real**: Las notificaciones se actualizan cada ~100-500ms (latencia de Firestore).

5. **Offline**: Las notificaciones no funcionan sin conexión a internet.

## Mejoras Futuras

- [ ] Sonidos personalizables
- [ ] Notificaciones push con FCM
- [ ] Historial persistente de notificaciones
- [ ] Diferentes tipos de notificaciones (cambio de estado, pago recibido, etc.)
- [ ] Filtros de notificaciones (por tipo, por cliente, etc.)
- [ ] Integración con WhatsApp para notificar al cliente
- [ ] Badge de app (si es PWA)

## Recursos

- [Firebase Real-time Listeners](https://firebase.google.com/docs/firestore/query-data/listen)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notification)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)
