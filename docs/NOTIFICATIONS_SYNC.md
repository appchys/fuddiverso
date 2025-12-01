# Sincronización de Notificaciones en Múltiples Dispositivos

## 📱 Overview
Las notificaciones se sincronizan automáticamente entre dispositivos mediante **Firestore Real-time Listeners**. Cuando un usuario marca una notificación como leída en un dispositivo, se actualiza en Firebase y todos los otros dispositivos del mismo usuario reciben el cambio automáticamente.

## 🏗️ Arquitectura

### Flujo de Sincronización

```
Dispositivo 1                Firebase Firestore              Dispositivo 2
─────────────                ──────────────────              ─────────────

Usuario abre app
     │
     ├─→ Inicia listener onSnapshot()
     │          ├────────→ Lee notificaciones
     │          │          ┌─────────────────┐
     │          │          │ notifications:  │
     │          └─────────→│ [notif1, notif2]│
     │                     └─────────────────┘
     │                              ▲
     │                              │
     │                        Usuario abre app
     │                        en otro dispositivo
     │                              │
     │                        Inicia listener
     │                              │
     │                    Lee las MISMAS notifs
     │
Usuario marca como leído
     │
     └─→ updateDoc(notifications/id, {read: true})
                │
                └────────→ Actualiza en Firebase
                               │
                               └───────────→ onSnapshot dispara
                                           en TODOS los devices
                                           
                                           Dispositivo 2:
                                           - recibe {read: true}
                                           - actualiza estado
                                           - quita highlight azul
```

## 🔄 Funcionalidad Clave

### 1. Listener en Tiempo Real
```typescript
// NotificationsBell.tsx - useEffect
useEffect(() => {
  const q = query(
    collection(db, 'businesses', businessId, 'notifications'),
    orderBy('createdAt', 'desc')
  )

  // Este listener se ejecuta INMEDIATAMENTE y cada vez
  // que hay cambios en la colección
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const notifs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    setNotifications(notifs) // Actualiza UI
  })

  return () => unsubscribe() // Cleanup
}, [businessId])
```

**Lo importante:** 
- El listener se actualiza **automáticamente** cuando Firebase detecta cambios
- No hay que hacer polling ni recargas manuales
- Los cambios se reciben en < 1 segundo

### 2. Marcar como Leído
```typescript
const markAsRead = async (notificationId: string) => {
  const notifRef = doc(
    db,
    'businesses',
    businessId,
    'notifications',
    notificationId
  )

  // Actualizar SOLO el campo 'read'
  await updateDoc(notifRef, { read: true })
  // Firebase dispara onSnapshot en TODOS los devices
}
```

**Lo importante:**
- Usa `updateDoc()` para actualizar solo algunos campos
- Los listeners en **otros dispositivos** detectan este cambio
- El UI se actualiza automáticamente sin recargar

### 3. Marcar Todas como Leídas
```typescript
const markAllAsRead = async () => {
  const unreadNotifications = notifications.filter(n => !n.read)
  
  // Ejecutar TODAS las actualizaciones en paralelo
  const updatePromises = unreadNotifications.map(notif => 
    markAsRead(notif.id)
  )
  
  await Promise.all(updatePromises) // Más rápido que secuencial
}
```

## 📊 Estructura en Firebase

```
businesses/
└── {businessId}/
    └── notifications/
        ├── {notificationId1}/
        │   ├── orderId: "order123"
        │   ├── type: "new_order"
        │   ├── title: "Nueva orden #ABC123"
        │   ├── message: "Cliente ha creado una nueva orden"
        │   ├── read: false          ← Campo que se sincroniza
        │   ├── createdAt: 2025-01-15T10:30:00Z
        │   └── orderData: {...}
        │
        └── {notificationId2}/
            ├── type: "qr_scan"
            ├── read: true            ← Ya fue leída
            ├── createdAt: 2025-01-15T09:15:00Z
            └── ...
```

## ✅ Verificación de Sincronización

### Prueba Manual
1. **Dispositivo 1:** Abre el dashboard en un navegador
2. **Dispositivo 2:** Abre el dashboard en otra computadora
3. **Crea una orden** (por ejemplo, desde checkout)
4. **Observa:**
   - La notificación aparece en AMBOS dispositivos
   - El contador (badge) se actualiza en ambos
   - El color azul indica "no leído"

5. **Marca como leído en Dispositivo 1:**
   - Click en la notificación
   - La notificación se vuelve blanca en Dispositivo 1

6. **Observa en Dispositivo 2:**
   - La MISMA notificación se vuelve blanca
   - El contador disminuye automáticamente
   - **Sin necesidad de recargar la página**

### Verificar en Firestore Console
1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Proyecto: `multitienda-69778`
3. Firestore → Colecciones
4. `businesses` → {businessId} → `notifications`
5. Haz click en una notificación y edita el campo `read`
6. **Instantáneamente** verás el cambio en la UI del dashboard

## 🔧 Consideraciones Técnicas

### Ventajas del Sistema Actual
✅ **Real-time**: Cambios reflejados en < 1 segundo
✅ **Offline-safe**: Firestore guarda cambios locales
✅ **Escalable**: Soporta múltiples dispositivos
✅ **Eficiente**: Solo sincroniza cambios, no toda la data

### Limitaciones
⚠️ **Conexión requerida**: Necesita internet para sincronizar
⚠️ **Quota de Firestore**: Cada listener = 1 lectura por segundo
⚠️ **Latencia**: ~1-2 segundos en conexiones lentas

## 🔒 Reglas de Firestore

Las reglas están configuradas para:
- ✅ Lectura: Permitida a usuarios autenticados con rol de staff
- ✅ Escritura: Permitida desde Cloud Functions y API
- ✅ Actualización del campo `read`: Permitida desde el cliente

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /businesses/{businessId}/notifications/{notificationId} {
      // Permitir lectura
      allow read: if request.auth != null;
      
      // Permitir actualizar el campo 'read'
      allow update: if request.auth != null 
        && request.resource.data.keys().hasOnly(['read', 'updatedAt']);
    }
  }
}
```

## 🚀 Próximas Mejoras (Opcionales)

1. **Timestamp de actualización**
   ```typescript
   await updateDoc(notifRef, {
     read: true,
     updatedAt: serverTimestamp() // Rastrear cuándo se leyó
   })
   ```

2. **Marcar como visto sin click**
   ```typescript
   // Auto-marcar como leído después de 3 segundos de verlo
   useEffect(() => {
     const timer = setTimeout(() => {
       if (visible && !read) {
         markAsRead(id)
       }
     }, 3000)
     return () => clearTimeout(timer)
   }, [visible, read, id])
   ```

3. **Notificaciones del navegador**
   ```typescript
   if ('Notification' in window && Notification.permission === 'granted') {
     new Notification(notif.title, { body: notif.message })
   }
   ```

4. **Persistencia local**
   ```typescript
   // Guardar en localStorage como backup
   localStorage.setItem('notifications', JSON.stringify(notifications))
   ```

## 📚 Referencias

- [Firestore Real-time Listeners](https://firebase.google.com/docs/firestore/query-data/listen)
- [Firestore Rules](https://firebase.google.com/docs/firestore/security/rules-structure)
- [updateDoc()](https://firebase.google.com/docs/reference/js/firestore_.updatedoc)
- [onSnapshot()](https://firebase.google.com/docs/reference/js/firestore_.onsnapshot)
