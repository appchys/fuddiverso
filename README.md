# Fuddiverso - Aplicación de Delivery de Comida

Una plataforma completa de delivery de comida desarrollada con Next.js, TypeScript, Tailwind CSS y Firebase.

## 🍔 Características Principales

### Para Negocios de Comida
- **Registro de Negocios**: Los restaurantes pueden registrarse con información completa
- **Gestión de Productos**: Subir y administrar menús con categorías
- **Gestión de Pedidos**: Recibir, confirmar y gestionar el estado de los pedidos
- **Panel de Administración**: Dashboard completo para monitorear el negocio

### Para Clientes
- **Explorar Restaurantes**: Ver todos los negocios disponibles con filtros
- **Navegación por Menú**: Explorar productos por categorías
- **Carrito de Compras**: Agregar productos y gestionar cantidades
- **Proceso de Checkout Completo**:
  1. **Datos del Cliente**: Nombre y celular
  2. **Tipo de Entrega**: Delivery (con ubicación) o Retiro en tienda
  3. **Programación**: Inmediata (30 min) o programada (fecha/hora)
  4. **Método de Pago**: Efectivo o transferencia bancaria
  5. **Resumen y Confirmación**: Revisar antes de confirmar

## 🛠️ Tecnologías Utilizadas

- **Frontend**: Next.js 15, React, TypeScript
- **Estilos**: Tailwind CSS
- **Base de Datos**: Firebase Firestore
- **Almacenamiento**: Firebase Storage
- **Autenticación**: Firebase Auth
- **Deployment**: Preparado para Vercel

## 🚀 Instalación y Configuración

### 1. Clonar e Instalar
```bash
git clone <tu-repositorio>
cd fuddiverso
npm install
```

### 2. Configurar Firebase
1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Crea un nuevo proyecto
3. Habilita Firestore Database y Storage
4. Copia las credenciales de tu proyecto

### 3. Variables de Entorno
Crea un archivo `.env.local` basado en `.env.local.example`:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=tu_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tu_proyecto_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tu_proyecto.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=tu_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=tu_app_id
```

### 4. Ejecutar en Desarrollo
```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`

### 5. Construir para Producción
```bash
npm run build
npm start
```

## 📱 Estructura de la Aplicación

### Páginas Principales
- `/` - Página principal con lista de restaurantes y búsqueda
- `/info` - Información sobre Fuddiverso y características de la plataforma
- `/restaurant/[id]` - Página individual del restaurante con menú
- `/checkout` - Proceso completo de checkout
- `/business/register` - Registro de nuevos negocios
- `/business/login` - Login para negocios
- `/business/dashboard` - Panel de administración para negocios

### Componentes Clave
- **Layout Responsivo**: Optimizado para móvil y desktop
- **Carrito Dinámico**: Gestión de productos en tiempo real
- **Formularios Interactivos**: Validación y navegación entre pasos
- **Estados de Pedidos**: Seguimiento completo del flujo de pedidos

## 🔥 Configuración de Firebase

### Colecciones de Firestore
```
businesses/
  - id: string
  - name: string
  - description: string
  - address: string
  - phone: string (formato ecuatoriano: 09XXXXXXXX)
  - email: string
  - mapLocation: { lat: number, lng: number }
  - references: string
  - bankAccount: { bankName, accountType, accountNumber, accountHolder }
  - schedule: { [day]: { open, close, isOpen } }
  - isActive: boolean
  - createdAt: timestamp
  - updatedAt: timestamp

products/
  - id: string
  - businessId: string
  - name: string
  - description: string
  - price: number
  - category: string
  - image: string (URL)
  - isAvailable: boolean
  - createdAt: timestamp
  - updatedAt: timestamp

orders/
  - id: string
  - businessId: string
  - customer: { name, phone } (phone formato ecuatoriano)
  - items: [{ product, quantity, subtotal }]
  - delivery: { type, references?, mapLocation?, photo? }
  - timing: { type, scheduledDate?, scheduledTime? }
  - payment: { method, bankAccount? }
  - total: number
  - status: "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled"
  - createdAt: timestamp
  - updatedAt: timestamp
```

### Reglas de Seguridad de Firestore
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir lectura pública de negocios y productos
    match /businesses/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    match /products/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // Los pedidos solo pueden ser creados por usuarios autenticados
    match /orders/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## 🚀 Deployment en Vercel

### 1. Preparar para Deployment
```bash
npm run build
```

### 2. Configurar Vercel
1. Conecta tu repositorio de GitHub con Vercel
2. Configura las variables de entorno en Vercel Dashboard
3. Deploy automático en cada push a main

### 3. Variables de Entorno en Vercel
Agrega todas las variables `NEXT_PUBLIC_FIREBASE_*` en la configuración de Vercel.

## 📋 Funcionalidades por Implementar

### Integración con Firebase (Próximos pasos)
- [ ] Autenticación de usuarios
- [ ] CRUD completo para negocios
- [ ] CRUD completo para productos
- [ ] Sistema de pedidos en tiempo real
- [ ] Notificaciones push
- [ ] Subida de imágenes a Storage
- [ ] Integración con mapas (Google Maps/OpenStreetMap)
- [ ] Sistema de calificaciones y reseñas

### Mejoras Adicionales
- [ ] Sistema de cupones y descuentos
- [ ] Historial de pedidos
- [ ] Chat en tiempo real
- [ ] Métricas y analytics
- [ ] Sistema de delivery con tracking
- [ ] Multi-idioma
- [ ] PWA (Progressive Web App)

## 🎨 Personalización

### Colores de la Marca
El tema principal usa rojo (`red-600`) pero puede ser personalizado en `tailwind.config.ts`:

```typescript
theme: {
  extend: {
    colors: {
      primary: {
        // Personaliza aquí tus colores
      }
    }
  }
}
```

### Modificar Flujo de Checkout
El proceso de checkout está modularizado en `src/app/checkout/page.tsx` y puede ser personalizado según las necesidades específicas.

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-caracteristica`)
3. Commit tus cambios (`git commit -m 'Agregar nueva característica'`)
4. Push a la rama (`git push origin feature/nueva-caracteristica`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 📞 Soporte

Para soporte y preguntas:
- Crea un issue en GitHub
- Contacta al equipo de desarrollo

---

**¡Disfruta construyendo tu plataforma de delivery con Fuddiverso! 🍕🚚**
