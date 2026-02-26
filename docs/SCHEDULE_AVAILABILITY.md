# Sistema de Disponibilidad por Horarios y Días

## 🎯 Descripción General

El sistema permite configurar la disponibilidad de productos de manera granular por horarios y días específicos. Por ejemplo:

- **Desayunos**: Solo de lunes a viernes, de 08:00 a 11:00
- **Platos especiales**: Solo los domingos, de 12:00 a 18:00  
- **Café todo el día**: Lunes a viernes, de 08:00 a 22:00
- **Menú nocturno**: De miércoles a sábado, de 18:00 a 02:00

## 🔧 Configuración en la Dashboard

### Paso 1: Editar o crear un producto

En la sección de **Productos** de tu negocio:

1. Haz clic en "Nuevo Producto" o edita uno existente
2. Completa los datos básicos (nombre, precio, descripción)

### Paso 2: Activar disponibilidad por horarios

En el formulario del producto, verás una sección azul:

```
☑ Disponibilidad por Horarios
  Configura días y horas específicas cuando ese producto está disponible
```

Marca esta casilla para habilitar la configuración.

### Paso 3: Añadir horarios

Una vez activado, aparecerá un panel donde puedes:

1. **Seleccionar días**: Elige los días de la semana (Lun, Mar, Mié, Jue, Vie, Sáb, Dom)
2. **Establecer horario**: Define la hora de inicio y fin
3. **Guardar**: Haz clic en "Agregar Horario"

### Ejemplo práctico

**Configurar un desayuno disponible de lunes a viernes, 08:00 a 11:00:**

1. Marca: Lun, Mar, Mié, Jue, Vie
2. Hora inicio: 08:00
3. Hora fin: 11:00
4. Clic en "Agregar Horario"

**Nota**: Si necesitas múltiples rangos de horarios (ej: 10:00-12:00 y 14:00-16:00), puedes agregar varios horarios para los mismos días.

## 📱 Comportamiento en el Cliente (Checkout)

### Restricciones automáticas

Cuando un cliente llega al checkout:

1. **Productos no disponibles se ocultan**: Si un producto no está disponible en ese momento, no aparecerá como disponible
2. **Si intenta agregar un producto fuera de su horario**: Se mostrará un mensaje indicando cuándo estará disponible
3. **Programación restringida**: Si el cliente elige una fecha/hora para una orden programada, no podrá seleccionar una hora en la que los productos no estén disponibles

### Mensajes a clientes

El sistema mostrará:
- ✅ "Disponible hoy: 08:00 - 11:00"
- ✅ "Disponible mañana: 10:00 - 22:00"
- ❌ "No disponible hoy"
- ❌ "No puedes programar esta orden a esa hora (Producto X no disponible)"

## 🛠️ Funciones Disponibles (Para Desarrolladores)

### 1. `isProductAvailableBySchedule(product, checkDate, checkTime)`

Verifica si un producto está disponible en un momento específico.

```javascript
import { isProductAvailableBySchedule } from '@/lib/product-availability-utils'

const available = isProductAvailableBySchedule(
  product,
  new Date(),           // Fecha a verificar
  "14:30"              // Hora a verificar (opcional)
)
```

**Parámetros:**
- `product`: Objeto Product de Firestore
- `checkDate`: Fecha a verificar (por defecto la actual)
- `checkTime`: Hora en formato HH:mm (por defecto la hora actual)

**Retorna:** `boolean`

### 2. `checkCartAvailability(products, checkDate, checkTime)`

Verifica si todos los productos del carrito están disponibles.

```javascript
const result = checkCartAvailability(
  cartProducts,
  scheduledDate,
  "15:00"
)

if (!result.available) {
  console.log('No disponibles:', result.unavailableProducts)
  // ['Desayuno', 'Café especial']
}
```

**Retorna:** 
```javascript
{
  available: boolean,
  unavailableProducts: string[]  // Nombres de productos no disponibles
}
```

### 3. `getNextAvailableSlots(product, maxDaysAhead)`

Obtiene los próximos horarios disponibles de un producto.

```javascript
import { getNextAvailableSlots } from '@/lib/product-availability-utils'

const slots = getNextAvailableSlots(product, 7)
// Retorna próximos 7 días con sus horarios disponibles

slots.forEach(slot => {
  console.log(slot.date)  // Fecha
  console.log(slot.timeSlots)  // ['08:00 - 11:00', '14:00 - 18:00']
})
```

### 4. `formatAvailabilityMessage(product)`

Crea un mensaje amigable sobre disponibilidad.

```javascript
import { formatAvailabilityMessage } from '@/lib/product-availability-utils'

const message = formatAvailabilityMessage(product)
// "Disponible hoy: 08:00 - 11:00"
// "Disponible mañana (Lunes): 10:00 - 22:00"
// "No disponible hoy"
```

## 📊 Estructura de Datos en Firestore

Cada producto puede tener un campo `scheduleAvailability`:

```typescript
{
  id: "producto123",
  name: "Desayuno especial",
  price: 5.50,
  // ... otros campos ...
  scheduleAvailability: {
    enabled: true,
    schedules: [
      {
        id: "schedule1",
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        startTime: "08:00",
        endTime: "11:00"
      },
      {
        id: "schedule2",
        days: ["Saturday", "Sunday"],
        startTime: "09:00",
        endTime: "13:00"
      }
    ]
  }
}
```

## ⚡ Casos de Uso Comunes

### 1. Producto disponible solo en horario específico

```
Desayuno: Lun-Vie 08:00-11:00, Sáb-Dom 09:00-13:00
```

Crea 2 horarios diferentes.

### 2. Producto disponible todo el día entre semana

```
Hamburguesas: Lun-Vie 10:00-23:00
```

Selecciona Lun-Vie, 10:00 a 23:00.

### 3. Happy Hour con precio diferente

Para implementar happy hour:
1. Crea una **variante** del producto con precio reducido
2. Configura disponibilidad solo para el happy hour (ej: 18:00-20:00)

### 4. Producto especial de fin de semana

```
Especial domingo: Domingo 12:00-20:00
```

Selecciona solo Dom, 12:00 a 20:00.

## 🔒 Detalles técnicos

### Lógica de tiempo

- Los horarios soportan rangos que cruzan medianoche (ej: 22:00 - 06:00)
- Se usa zona horaria del dispositivo del cliente
- Si un producto no tiene horarios configurados, se considera disponible siempre (si `isAvailable` es true)

### Performance

- Las validaciones se ejecutan en el cliente (sin latencia)
- Los horarios se guardan con el producto (sin consultas adicionales)
- Optimizado para móviles y conexiones lentas

## 🧪 Testing

Para probar la funcionalidad:

```javascript
// Inicia sesión en la dashboard
// Ve a Productos > Editar un producto
// Activa "Disponibilidad por Horarios"
// Configura un horario simple (ej: hoy de 14:00 a 16:00)
// Abre el checkout en el navegador
// Prueba agregar el producto dentro y fuera del horario
// Intenta programar una orden para un horario no disponible
```

## 📝 Errores Comunes

### "El producto desapareció del carrito"
- El producto salió de su horario disponible
- Solución: Verifica los horarios configurados

### "No puedo programar para esa hora"
- Uno o más productos no están disponibles en esa hora
- Solución: Elige una hora donde todos estén disponibles

### "El horario no se guarda"
- No seleccionaste ningún día
- No completaste las horas
- Solución: Marca al menos un día y completa inicio/fin

## 🚀 Próximas mejoras

- [ ] Vistas de resumen de disponibilidad
- [ ] Estadísticas de qué horarios son más populares
- [ ] Notificaciones cuando se activa un horario
- [ ] Descuentos automáticos por horario
- [ ] Cálculo automático de rutas de entrega por horario

---

**Para más ayuda**: Contacta a soporte o revisa la documentación en la sección de [Configuración Avanzada](./docs/)
