# Sistema de Códigos QR para Colección

## 📌 Visión General
Implementar un sistema de 5 códigos QR únicos que los clientes puedan escanear para completar una colección. Cada código puede ser escaneado por múltiples usuarios, pero cada usuario solo puede escanear cada código una vez.

## 🏗️ Estructura de Datos (Firestore)

### 1. Colección `qrCodes`
- `id` (string): Identificador único del código QR
- `name` (string): Nombre descriptivo (ej: "Código 1 - Entrada Principal")
- `points` (number): Puntos que otorga al ser escaneado
- `isActive` (boolean): Si el código está activo
- `createdAt` (timestamp): Fecha de creación
- `businessId` (string): ID del negocio dueño del código

### 2. Subcolección `userProgress/{userId}`
- `userId` (string): ID del usuario
- `scannedCodes` (array): IDs de los códigos escaneados
- `completed` (boolean): Si completó la colección (5/5)
- `lastScanned` (timestamp): Fecha del último escaneo
- `rewardClaimed` (boolean): Si reclamó la recompensa

## 🔄 Flujo de Usuario

1. **Escaneo de Código QR**
   - Usuario autenticado escanea un código QR
   - La app valida:
     - Si el código existe y está activo
     - Si el usuario ya lo escaneó previamente
     - Si el código pertenece a un negocio existente

2. **Procesamiento**
   - Si es válido y no escaneado:
     - Se registra el escaneo en `userProgress/{userId}`
     - Se actualiza el contador de progreso
     - Se muestra confirmación
   - Si ya fue escaneado:
     - Se muestra mensaje "Ya escaneaste este código"

3. **Recompensa**
   - Al completar los 5 códigos:
     - Se marca `completed: true`
     - Se habilita botón para reclamar recompensa
     - Se otorga recompensa (descuento, producto gratis, etc.)

## 🛠️ Componentes Necesarios

1. **QRScanner**
   - Lector de códigos QR con cámara
   - Manejo de permisos de cámara
   - Feedback visual al escanear

2. **ProgressTracker**
   - Muestra progreso actual (ej: 3/5 códigos)
   - Lista de códigos con estado (obtenido/pendiente)
   - Detalles de cada código escaneado

3. **RewardModal**
   - Se muestra al completar la colección
   - Muestra recompensa obtenida
   - Botón para reclamar

## 🔒 Seguridad
- Validar autenticación del usuario
- Verificar validez de códigos en el backend
- Prevenir inyección de datos
- Validar permisos de negocio

## 📱 Experiencia Móvil
- Interfaz táctil y responsiva
- Feedback táctil al escanear
- Notificaciones push para recordatorios
- Carga rápida incluso con conexión lenta

## 📅 Próximos Pasos
1. Configurar estructura de Firestore
2. Crear endpoints de API para validación
3. Desarrollar componente de escaneo
4. Implementar seguimiento de progreso
5. Diseñar interfaz de usuario
6. Probar flujo completo

## 📝 Notas Adicionales
- Usar `Suspense` para componentes asíncronos
- Manejar estados de carga/error
- Optimizar para rendimiento en móviles
- Seguir guías de accesibilidad

  clients: colección que contiene los datos de los clientes, cada documento tiene el id del cliente y los siguientes campos, se llaman así tal cual:
    - celular
    - fecha_de_registro
    - id
    - nombres

  ubicaciones: colección que contiene las ubicaciones de los clientes, cada documento tiene el id del cliente y los siguientes campos, se llaman así tal cual:
    - id
    - id_cliente
    - latlong
    - referencia
    - sector (este campo existe pero no lo uso, lo dejo para que lo tengas en cuenta)
    - tarifa

En checkout y en registro de ordenes manuales y en otras partes de la app, se usa la colección clients para obtener los datos del cliente, y la colección ubicaciones para obtener la ubicación del cliente refereciada por el campo id_cliente que es igual al id del cliente.


Necesito revisar el código de checkout y registro de ordenes manuales, ya que las órdenes creadas desde el checkout no tienen la misma estructura en firebase que las manuales.

Te comparto como es la estructura de una orden manual para que la uses de referencia:


businessId
"0FeNtdYThoTRMPJ6qaS7"
(cadena)


createdAt
5 de septiembre de 2025, 1:16:59 p.m. UTC-5
(marca de tiempo)


createdByAdmin
true
(booleano)



customer
(mapa)


name
"Meury Herederos"
(cadena)


phone
"0986454274"
(cadena)



delivery
(mapa)


deliveryCost
0
(número)


latlong
""
(cadena)


references
""
(cadena)


type
"pickup"
(cadena)



items
(array)



0
(mapa)


name
"Wantancitos BBQ - 30 wantancitos "
(cadena)


price
5.5
(número)


productId
"RJdtOLmoYvLORpmzJysL"
(cadena)


quantity
1
(número)


variant
"30 wantancitos "
(cadena)



1
(mapa)


name
"Wantancitos BBQ - 100 wantancitos"
(cadena)


price
18
(número)


productId
"RJdtOLmoYvLORpmzJysL"
(cadena)


quantity
1
(número)


variant
"100 wantancitos"
(cadena)



payment
(mapa)


method
"transfer"
(cadena)


paymentStatus
"pending"
(cadena)


selectedBank
""
(cadena)


status
"delivered"
(cadena)


subtotal
23.5
(número)



timing
(mapa)



scheduledDate
(mapa)


nanoseconds
0
(número)


seconds
1757169000
(número)


scheduledTime
"09:30"
(cadena)


type
"scheduled"
(cadena)


total
23.5
(número)


updatedAt
6 de septiembre de 2025, 1:21:55 p.m. UTC-5
(marca de tiempo)


