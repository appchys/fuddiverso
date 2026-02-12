# Actualización de Formato de Notificaciones Telegram

Se ha actualizado el formato de los mensajes enviados a los repartidores vía Telegram para mejorar la legibilidad y corregir el estilo visual de los encabezados.

## Resumen de Cambios

1.  **Reordenamiento de Información**: Ahora los **Datos del cliente** aparecen antes que los **Datos de entrega**. Esto permite que el repartidor identifique primero a quién atiende antes de ver la ubicación.
2.  **Limpieza de Estilo**: Se eliminaron los caracteres asterisco (`*`) de los encabezados. Anteriormente se usaban como `*Datos de entrega*`, lo cual en formato HTML de Telegram mostraba los asteriscos literalmente. Ahora se utiliza únicamente etiquetas de negrita `<b>`.

---

## Ejemplos de Mensajes Actualizados

### 1. Vista Previa / Pedido Asignado (Antes de aceptar)
*Prioridad en ubicación (Mapa como tarjeta de vista previa grande ARRIBA del texto).*

> 🗺️ **[TARJETA DE GOOGLE MAPS EN GRANDE]**
>
> 🛵 **[Nombre Tienda]** tiene un pedido para ti!
>
> **Datos de entrega**
> 🗺️ [Ver en Google Maps](https://google.com)
> Calle Principal 123...
> Envío: $3
>
> **Datos del cliente**
> 👤 Juan Pérez

---

### 2. Pedido Aceptado (Flujo Interactivo)
*Al aceptar, se habilitan botones para gestionar el estado de la entrega sin salir de Telegram.*

> 🗺️ **[TARJETA DE GOOGLE MAPS EN GRANDE]**
>
> 🛵 **Nombre Tienda!**
> Hora estimada: ⚡ Inmediato
>
> **Datos del cliente**
> 👤 Nombres: Juan Pérez
> 📱 Whatsapp: [Enviar Mensaje](https://wa.me/...)
>
> **Datos de entrega**
> 🗺️ [Ver en Google Maps](https://google.com)
> Calle Principal 123...
>
> **Detalles del pago**
> Pedido: $15.00
> Envío: $3.00
> 💵 Efectivo
> 💰 Valor a cobrar: $18.00
>
> ✅ **Aceptado**
> [ 🛵 En camino ] [ ✅ Entregada ]

---

### 3. Estados de Entrega
El mensaje se actualiza dinámicamente según la acción del repartidor:
1.  **Aceptado**: Muestra botones "En camino" y "Entregada".
2.  **En camino**: Se actualiza el texto a "🛵 En camino" y solo queda el botón "Entregada".
3.  **Entregado (Resumen Final)**: El mensaje se transforma en un resumen compacto, se desactiva la vista previa del mapa y se eliminan los botones.
    > **Nombre Negocio** · Juan Pérez
    > Calle Principal 123... (Referencias)
    >
    > Pedido: $15.00
    > Envío: $3.00
    > 💵 Efectivo: $18.00
    >
    > 🎉 **Entregado**

*Nota: Se ha implementado el uso oficial de `link_preview_options` de la API de Telegram. Durante el proceso de entrega, el mapa se muestra en tamaño grande para guiar al repartidor. Al finalizar (Estado Entregado), la vista previa se oculta automáticamente para mantener un historial limpio y conciso.*

---

## Archivos Modificados
- `functions/index.js`: Se modificó la función `formatTelegramMessage` para cambiar el orden de las secciones y actualizar las etiquetas de encabezado.
