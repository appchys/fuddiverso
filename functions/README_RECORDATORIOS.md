# 📧 Sistema de Recordatorios de Órdenes Programadas

## Descripción

Este sistema envía automáticamente notificaciones por correo electrónico **30 minutos antes** de la hora de entrega programada, pero **solo para órdenes programadas** (scheduled orders).

## Características

### ✅ Funcionalidad Principal

- **Ejecución automática**: Se ejecuta cada 5 minutos mediante Cloud Scheduler
- **Solo órdenes programadas**: Filtra únicamente órdenes con `timing.type === 'scheduled'`
- **Ventana de tiempo**: Detecta órdenes cuya entrega está entre 30-35 minutos en el futuro
- **Sin duplicados**: Marca las órdenes con `reminderSent: true` para evitar envíos repetidos
- **Estados activos**: Solo procesa órdenes con estado `pending`, `confirmed`, o `preparing`

### 📋 Información Incluida en el Email

El correo de recordatorio incluye:

1. **Encabezado destacado** con gradiente naranja-rojo
2. **Hora y fecha de entrega programada** en un banner amarillo
3. **Datos del cliente**:
   - Nombre
   - WhatsApp (con enlace directo)
   - Dirección de entrega o punto de retiro
4. **Lista de productos** con cantidades
5. **Total del pedido**
6. **Enlace al dashboard** para gestionar la orden

### 🔧 Configuración Técnica

```javascript
exports.sendScheduledOrderReminders = onSchedule({
  schedule: "*/5 * * * *",        // Cada 5 minutos
  timeZone: "America/Guayaquil",  // Zona horaria Ecuador
  retryCount: 0                    // Sin reintentos automáticos
}, async (event) => { ... });
```

## Flujo de Funcionamiento

```
┌─────────────────────────────────────────────────────────┐
│  Cloud Scheduler ejecuta cada 5 minutos                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Buscar órdenes programadas activas                     │
│  - timing.type === 'scheduled'                          │
│  - status in ['pending', 'confirmed', 'preparing']      │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Para cada orden:                                       │
│  1. Verificar si reminderSent === false                 │
│  2. Calcular fecha/hora de entrega                      │
│  3. Verificar si está en ventana de 30-35 min           │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Si cumple condiciones:                                 │
│  1. Obtener datos del negocio y cliente                 │
│  2. Generar HTML del email                              │
│  3. Enviar correo                                       │
│  4. Marcar reminderSent = true                          │
└─────────────────────────────────────────────────────────┘
```

## Campos Agregados a las Órdenes

Cuando se envía un recordatorio, se agregan estos campos a la orden:

```javascript
{
  reminderSent: true,                    // Bandera para evitar duplicados
  reminderSentAt: Timestamp              // Momento exacto del envío
}
```

## Formato de Hora Soportado

La función soporta múltiples formatos de hora:

- **24 horas**: `"14:30"`, `"09:15"`
- **12 horas con AM/PM**: `"2:30 PM"`, `"9:15 AM"`

## Despliegue

Para desplegar esta función a Firebase:

```bash
# Desde el directorio functions/
npm install

# Desplegar todas las funciones
firebase deploy --only functions

# O desplegar solo esta función
firebase deploy --only functions:sendScheduledOrderReminders
```

## Monitoreo

### Ver logs en tiempo real:

```bash
firebase functions:log --only sendScheduledOrderReminders
```

### Logs importantes a buscar:

- `⏰ Verificando órdenes programadas...` - Inicio de ejecución
- `📦 Encontradas X órdenes programadas activas` - Órdenes encontradas
- `📧 Enviando recordatorio para orden...` - Enviando email
- `✅ Recordatorio enviado para orden...` - Email enviado exitosamente
- `✅ Proceso completado. Recordatorios enviados: X` - Resumen final

## Consideraciones

### ⚠️ Importante

1. **Zona horaria**: La función usa `America/Guayaquil` (Ecuador). Si tu negocio está en otra zona, modifica el parámetro `timeZone`.

2. **Ventana de 5 minutos**: Como la función se ejecuta cada 5 minutos, hay una ventana de 30-35 minutos para capturar las órdenes. Esto asegura que no se pierda ninguna orden.

3. **Formato de fecha**: La función maneja tanto Firestore Timestamps como objetos Date estándar.

4. **Email del negocio**: Se envía al email registrado en la colección `businesses`. Si no existe, usa `info@fuddi.shop` como fallback.

### 💡 Optimizaciones Futuras

- Agregar soporte para múltiples recordatorios (ej: 1 hora antes, 15 minutos antes)
- Permitir que cada negocio configure sus propios tiempos de recordatorio
- Agregar notificaciones por WhatsApp además de email
- Dashboard para ver historial de recordatorios enviados

## Ejemplo de Email

El email tiene este aspecto:

```
┌──────────────────────────────────────────┐
│  ⏰ Recordatorio de Entrega              │
│  ¡Faltan 30 minutos para la entrega!     │
│  Pedido #A1B2C3D4                        │
├──────────────────────────────────────────┤
│                                          │
│  ⏰ Hora de entrega programada:          │
│  14:30 - miércoles, 15 de enero de 2026  │
│                                          │
│  👤 Cliente                              │
│  Nombre: Juan Pérez                      │
│  WhatsApp: 0987654321                    │
│  Dirección: Av. Principal 123            │
│                                          │
│  📦 Productos                            │
│  • Pizza Margarita (Cantidad: 2)         │
│  • Coca Cola 2L (Cantidad: 1)            │
│                                          │
│  💰 Total                                │
│  $25.50                                  │
└──────────────────────────────────────────┘
```

## Soporte

Para problemas o preguntas, revisa los logs de Firebase Functions o contacta al equipo de desarrollo.
