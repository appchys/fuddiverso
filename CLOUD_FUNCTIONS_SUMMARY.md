# 📧 Cloud Functions - Sistema de Notificaciones por Email

## ✅ Lo que se implementó

Se migró tu sistema de notificaciones por email desde el proyecto anterior a la nueva estructura de **Fuddiverso**. 

### Archivos creados:

```
functions/
├── package.json              # Dependencias (firebase-admin, firebase-functions, nodemailer)
├── package-lock.json         # Lock de dependencias
├── index.js                  # 🔥 Cloud Functions principales
├── .env                      # Variables de entorno (NO commitear)
├── .env.example              # Template de .env (commitear)
├── .gitignore                # Ignorar node_modules y .env
├── README.md                 # Documentación de functions
├── test-email.js             # Script para probar emails
└── node_modules/             # Dependencias instaladas

firebase.json                # Configuración de Firebase (emuladores, deploy)
CLOUD_FUNCTIONS_DEPLOY.md   # Guía de despliegue
```

## 🎯 Funciones implementadas

### 1. **sendOrderEmail** ✉️
Trigger: `onDocumentCreated("orders/{orderId}")`

**¿Qué hace?**
- Se dispara automáticamente cuando se crea una orden en Firestore
- Obtiene datos del negocio desde la colección `businesses`
- Obtiene datos del cliente desde la colección `clients`
- Genera un HTML profesional con:
  - Datos del cliente con link de WhatsApp
  - Mapa con ubicación de entrega
  - Lista de productos con cantidades y precios
  - Resumen de pago
  - Información de envío/retiro
- Envía email al negocio

**Email se envía a:** Email del negocio (desde `businesses` collection)

**Estructura esperada de orden:**
```javascript
{
  businessId: "id_del_negocio",
  customer: { id, name, phone },
  items: [{ name, price, quantity, variant }],
  delivery: { type, references, latlong, deliveryCost },
  payment: { method, paymentStatus },
  total: 50.00
}
```

### 2. **onOrderStatusChange** 📌
Trigger: `onDocumentUpdated("orders/{orderId}")`

**¿Qué hace?**
- Monitorea cambios en el estado de las órdenes
- Registra en logs cuando cambia el estado
- Base para futuras notificaciones (se puede expandir)

## 🚀 Cómo desplegar

### Opción 1: Despliegue manual desde terminal

```bash
# 1. Configurar credenciales
firebase login
firebase use --add  # Selecciona el proyecto

# 2. Instalar dependencias
cd functions
npm install --legacy-peer-deps

# 3. Configurar .env
cp .env.example .env
# Edita .env con EMAIL_USER y EMAIL_PASS

# 4. Desplegar
firebase deploy --only functions
```

### Opción 2: Desde Vercel (después del push a GitHub)

Si configuraste GitHub deployment en Vercel:
```bash
git push origin main
```

Las funciones se desplegarán automáticamente a Firebase (si tienes un script de deploy en package.json).

## 🧪 Probar localmente

### Con emuladores:
```bash
firebase emulators:start
```

Accede a http://localhost:4000 y crea órdenes de prueba en Firestore Emulator.

### Con script:
```bash
cd functions
node test-email.js
```

## ⚙️ Configuración necesaria

### 1. Credenciales de Gmail

En `functions/.env`:
```
EMAIL_USER=tu_email@gmail.com
EMAIL_PASS=contraseña_de_aplicación
```

**Para obtener contraseña de aplicación:**
1. Ve a: https://myaccount.google.com/apppasswords
2. Selecciona: Mail → Windows Computer
3. Copia la contraseña generada
4. Pégala en .env

### 2. Configuración de Firestore

Asegúrate que exista:

**Colección `businesses`:**
```javascript
{
  id: "businessId",
  email: "negocio@email.com",
  name: "Nombre del Negocio"
}
```

**Colección `clients` (opcional):**
```javascript
{
  id: "clientId",
  nombres: "Nombre",
  celular: "0912345678"
}
```

**Colección `orders`:**
Se crea automáticamente con estructura del checkout.

## 📊 Cambios en estructura de datos

Comparación con tu proyecto anterior:

| Campo | Anterior | Nuevo |
|-------|----------|-------|
| ID de tienda | `storeId` | `businessId` |
| Colección | `stores` | `businesses` |
| Correo tienda | En tabla separada | En `businesses` documento |
| Cliente | `userId` → `users` | `customer.id` → `clients` |

## 🔍 Monitoreo

Ver logs en tiempo real:
```bash
firebase functions:log
```

O en Firebase Console:
1. Ve a https://console.firebase.google.com
2. Proyecto: multitienda-69778
3. Funciones → Logs

## 📝 Próximos pasos (opcionales)

1. **Notificar al cliente**: Crear función que envíe email al cliente también
2. **Notificaciones push**: Agregar notificaciones push cuando cambia estado
3. **Descuento automático**: Aplicar códigos de descuento automáticamente
4. **SMS**: Enviar SMS en lugar de/además de email
5. **WhatsApp API**: Integración con WhatsApp Business API

## ⚠️ Consideraciones importantes

- ✅ `.env` está en `.gitignore` (no se commitea)
- ✅ `node_modules/` está en `.gitignore`
- ✅ Las credenciales son seguras (usa variables de entorno)
- ✅ Compatible con Firestore emulator para testing
- ✅ Compatible con Firebase Blaze Plan (requiere plan de pago para despliegue)

## 📞 Soporte

Si las funciones no se disparan:
1. Verifica que creaste el documento en la colección `orders`
2. Revisa que el `businessId` sea válido
3. Verifica logs: `firebase functions:log`
4. Asegúrate que credenciales de Gmail son correctas
