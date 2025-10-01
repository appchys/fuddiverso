# 🚚 Configuración del Sistema de Delivery

## 📋 Checklist de Verificación

### 1. Estructura de Datos en Firestore

#### Colección `deliveries`
Cada documento debe tener:
```javascript
{
  celular: "0978697867",
  createdAt: Timestamp,
  email: "delivery@example.com",  // ← IMPORTANTE: Este email debe coincidir con la cuenta de Google
  estado: "activo",               // ← Debe estar "activo" para poder hacer login
  fechaRegistro: "2025-09-03T20:14:02.526Z",
  fotoUrl: "https://...",
  nombres: "Nombre del Delivery",
  updatedAt: Timestamp,
  uid: "firebase-uid"             // ← Se vincula automáticamente al hacer login
}
```

#### Colección `orders`
Los pedidos deben tener el campo `delivery.assignedDelivery`:
```javascript
{
  businessId: "0FeNtdYThoTRMPJ6qaS7",
  customer: {
    name: "Cliente",
    phone: "0989323102"
  },
  delivery: {
    assignedDelivery: "SskWkBmgVtI2j9WJdUDZ",  // ← ID del documento en la colección deliveries
    deliveryCost: 1,
    latlong: "",
    references: "Emapa Daule",
    type: "delivery"
  },
  items: [...],
  payment: {...},
  status: "pending",
  timing: {...},
  total: 5,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### 2. Índice Compuesto en Firestore (Opcional pero Recomendado)

Para mejorar el rendimiento, crea un índice compuesto:

1. Ve a Firebase Console → Firestore Database → Indexes
2. Crea un índice compuesto con:
   - **Colección**: `orders`
   - **Campos**:
     - `delivery.assignedDelivery` (Ascending)
     - `createdAt` (Descending)
   - **Query scope**: Collection

**Nota**: Si no creas el índice, el sistema funcionará igual pero ordenará los resultados en memoria.

### 3. Reglas de Seguridad de Firestore

Asegúrate de que las reglas permitan a los deliveries leer sus pedidos:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Deliveries pueden leer su propia información
    match /deliveries/{deliveryId} {
      allow read: if request.auth != null && 
                     (request.auth.uid == resource.data.uid || 
                      request.auth.token.email == resource.data.email);
      allow write: if false; // Solo admin puede escribir
    }
    
    // Deliveries pueden leer pedidos asignados a ellos
    match /orders/{orderId} {
      allow read: if request.auth != null && 
                     resource.data.delivery.assignedDelivery == request.auth.uid;
      allow update: if request.auth != null && 
                       resource.data.delivery.assignedDelivery == request.auth.uid &&
                       request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'updatedAt']);
    }
  }
}
```

## 🧪 Pasos para Probar

### Paso 1: Preparar un Delivery de Prueba

1. Ve a Firestore Console
2. En la colección `deliveries`, verifica que tengas un documento con:
   - `email`: Tu email de Google (ej: "tumail@gmail.com")
   - `estado`: "activo"
   - `nombres`: Tu nombre

### Paso 2: Asignar un Pedido al Delivery

1. Ve a la colección `orders`
2. Edita o crea un pedido
3. En el campo `delivery.assignedDelivery`, coloca el **ID del documento** del delivery (no el email, sino el ID del documento)

### Paso 3: Probar el Login

1. Abre tu navegador en modo incógnito o privado
2. Ve a: `http://localhost:3000/delivery/login`
3. Haz clic en "Continuar con Google"
4. Selecciona la cuenta de Google que coincida con el email del delivery
5. Deberías ser redirigido a `/delivery/dashboard`

### Paso 4: Verificar el Dashboard

En el dashboard deberías ver:
- ✅ Tu nombre y foto de perfil en el header
- ✅ Los pedidos asignados a ti
- ✅ Filtros: Activos, Completados, Todos
- ✅ Al hacer clic en un pedido, ver todos los detalles
- ✅ Botones para llamar, WhatsApp y abrir Google Maps

## 🔍 Troubleshooting

### Error: "No tienes una cuenta de delivery registrada"
**Solución**: Verifica que el email en Firestore coincida exactamente con tu cuenta de Google.

### Error: "Tu cuenta de delivery está inactiva"
**Solución**: Cambia el campo `estado` a "activo" en Firestore.

### No veo pedidos en el dashboard
**Posibles causas**:
1. No hay pedidos con `delivery.assignedDelivery` igual al ID de tu delivery
2. El ID en `assignedDelivery` no coincide con el ID del documento del delivery
3. Problema con las reglas de seguridad de Firestore

**Verificación**:
```javascript
// En la consola del navegador (F12):
console.log('Delivery ID:', localStorage.getItem('deliveryId'))

// Luego busca en Firestore si hay pedidos con ese ID en delivery.assignedDelivery
```

### Los pedidos no se actualizan automáticamente
**Solución**: El dashboard se recarga cada 30 segundos. Espera o recarga la página manualmente.

## 📱 Características Mobile

El sistema está completamente optimizado para móviles:
- ✅ Diseño responsive
- ✅ Botones grandes y fáciles de tocar
- ✅ Scroll horizontal en filtros
- ✅ Modal de detalles en pantalla completa
- ✅ Enlaces directos a WhatsApp y Google Maps
- ✅ Información clara y jerárquica

## 🔗 URLs del Sistema

- **Login**: `/delivery/login`
- **Dashboard**: `/delivery/dashboard`

## 📊 Flujo Completo

```
1. Delivery abre /delivery/login
   ↓
2. Hace clic en "Continuar con Google"
   ↓
3. Sistema verifica email en colección deliveries
   ↓
4. Verifica que estado = "activo"
   ↓
5. Vincula UID de Firebase con el delivery
   ↓
6. Redirige a /delivery/dashboard
   ↓
7. Carga pedidos donde delivery.assignedDelivery = deliveryId
   ↓
8. Muestra pedidos con filtros y detalles
   ↓
9. Delivery puede actualizar estado a "delivered"
```

## ✅ Checklist Final

- [ ] Delivery registrado en Firestore con email correcto
- [ ] Estado del delivery = "activo"
- [ ] Al menos un pedido con delivery.assignedDelivery = ID del delivery
- [ ] Reglas de Firestore configuradas
- [ ] Índice compuesto creado (opcional)
- [ ] Login exitoso con Google
- [ ] Dashboard muestra pedidos correctamente
- [ ] Botones de WhatsApp y Maps funcionan
- [ ] Actualización de estado funciona

---

**¿Necesitas ayuda?** Revisa la consola del navegador (F12) para ver mensajes de error detallados.
