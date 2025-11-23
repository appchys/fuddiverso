# Fuddiverso Cloud Functions

Cloud Functions para Fuddiverso que envían notificaciones por email cuando se crea una nueva orden.

## Configuración

### 1. Instalar dependencias

```bash
cd functions
npm install
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env` y llena con tus credenciales:

```bash
cp .env.example .env
```

Edita `.env` con:
- EMAIL_USER: Tu correo de Gmail
- EMAIL_PASS: Tu contraseña de aplicación de Gmail (https://myaccount.google.com/apppasswords)

### 3. Probar localmente con emuladores

Desde la carpeta raíz del proyecto:

```bash
firebase emulators:start
```

Esto abrirá una interfaz en `http://localhost:4000` donde puedes simular eventos de Firestore.

### 4. Desplegar a Firebase

```bash
firebase deploy --only functions
```

O desde la carpeta functions:

```bash
cd functions
npm run deploy
```

## Funciones disponibles

### `sendOrderEmail`

Se ejecuta automáticamente cuando se crea un nuevo documento en la colección `orders`.

**Estructura esperada de orden:**

```javascript
{
  id: "orderId",
  businessId: "businessId",
  customer: {
    id: "clientId",
    name: "Nombre del Cliente",
    phone: "0912345678"
  },
  items: [
    {
      name: "Producto",
      price: 10.99,
      quantity: 1,
      variant: "Tamaño M"
    }
  ],
  delivery: {
    type: "delivery" | "pickup",
    references: "Calle Principal 123",
    latlong: "-0.3566,78.5249",
    deliveryCost: 2.50
  },
  timing: {
    type: "immediate" | "scheduled",
    scheduledTime: "14:30",
    scheduledDate: Timestamp
  },
  payment: {
    method: "cash" | "transfer" | "mixed",
    paymentStatus: "pending" | "paid" | "validating"
  },
  subtotal: 10.99,
  total: 13.49,
  status: "pending"
}
```

**Email enviado a:**
- Email del negocio (obtenido de la colección `businesses`)

**Información incluida:**
- Datos del cliente con link de WhatsApp
- Lista de productos con cantidades y precios
- Ubicación con mapa de Google Maps (si es delivery)
- Resumen de pago
- Método y estado de pago
- Información de entrega

### `onOrderStatusChange`

Se ejecuta cuando cambia el estado de una orden. Actualmente solo registra el cambio en los logs.

## Notas importantes

- Las credenciales de email están en `.env` (no commitear)
- Los emails se envían desde `pedidos@fuddi.shop`
- Se usa la API de Gmail segura (no requiere "modo menos seguro")
- Asegúrate de usar contraseña de aplicación, no la contraseña de Gmail regular

## Troubleshooting

**Error: "Invalid login"**
- Verifica que EMAIL_USER y EMAIL_PASS sean correctos
- Usa contraseña de aplicación, no contraseña de Gmail

**Las funciones no se ejecutan**
- Verifica que el documento se cree en la colección correcta: `orders`
- Revisa los logs: `firebase functions:log`

**Email no llega**
- Revisa spam/promotions en Gmail
- Verifica que el email del negocio exista en Firestore

## Recursos

- [Firebase Functions Documentation](https://firebase.google.com/docs/functions)
- [Nodemailer Documentation](https://nodemailer.com/)
- [Gmail App Passwords](https://myaccount.google.com/apppasswords)
