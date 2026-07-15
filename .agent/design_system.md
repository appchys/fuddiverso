# Sistema de Diseño de Fuddi - Panel de Pedidos ("Pedidos de hoy")

Este documento detalla los estilos predeterminados de diseño, tipografía, espacios y sombras utilizados en la sección "Pedidos de hoy" de `business/dashboard`. Deben ser replicados de manera exacta en cualquier panel de gestión de pedidos equivalente (como `/pedidos`).

## 1. Columnas y Contenedores Principales

- **Disposición de Columnas**:
  - **Fondo General**: `bg-gray-100 flex flex-col min-h-screen`
  - **Contenedor de Columnas**: `flex flex-col lg:flex-row gap-6 items-start`
  - **Columnas**: `w-full lg:flex-1 lg:min-w-0 space-y-6`

## 2. Secciones Colapsables (`CollapsibleSection`)

- **Botonera / Cabecera de la Sección**:
  - **Clases**: `w-full px-4 py-3 flex justify-between items-center bg-gray-100 hover:bg-gray-200 transition-colors`
  - **Título**: `font-bold text-gray-800 text-lg`
  - **Contador de pedidos**: `bg-gray-200 border border-gray-300 text-gray-700 text-xs font-bold px-2.5 py-0.5 rounded-full`
- **Contenedor de Contenido (Abierto)**:
  - **Clases**: `p-4 space-y-3 bg-gray-100 animate-in slide-in-from-top-2 duration-200`
  - **Efecto**: Fondo gris continuo para mantener las tarjetas contenidas visualmente.

## 3. Tarjeta de Pedido (`OrderCard`)

- **Contenedor Principal de la Tarjeta**:
  - **Clases**: `bg-white rounded-xl shadow-sm border border-gray-100 transition-all`
  - **Sombra**: `shadow-sm`
  - **Bordes**: `rounded-xl` y `border-gray-100`

- **Cabecera de la Tarjeta (Clickable)**:
  - **Estado Contraído (no expandido)**: `px-4 py-3 border-b cursor-pointer transition-colors border-gray-50 bg-gray-50/50 hover:bg-gray-100`
  - **Estado Expandido**: `px-4 py-3 border-b cursor-pointer transition-colors border-gray-200 bg-gray-200 hover:bg-gray-200`

- **Tipografía y Elementos de Cabecera**:
  - **Nombre del Cliente**: `text-sm sm:text-base font-bold text-gray-900`
  - **Hora del Pedido**: `font-mono text-sm sm:font-medium text-gray-600`
  - **Lista de Ítems (Contraído)**: `text-lg sm:text-sm leading-tight text-gray-600`
  - **Badge de Estado de Entrega (Delivery/Pickup)**: `flex h-[20px] min-h-[20px] max-h-[20px] w-36 items-center justify-center truncate rounded-[3px] border px-2 py-0 text-[11px] font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]`

- **Cuerpo Expandido de la Tarjeta**:
  - **Contenedor**: `p-4 bg-white animate-in slide-in-from-top-2 duration-200` (Padding 4 en los 4 lados)
  - **Fila de Referencias / Dirección**: `group flex w-full max-w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-700`
  - **Contenedor del Mapa estático**: `overflow-hidden rounded-xl border border-red-100 bg-red-50/50 animate-in slide-in-from-top-1 duration-150`
  - **Caja de Notas de Pedido**: `mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg`
  - **Listado de Ítems Expandido**:
    - **Fila del Producto**: `flex justify-between text-base` (Texto a tamaño completo)
    - **Nombre de Variante o Producto**: `text-gray-700` y cantidad destacada: `font-medium text-gray-900`
    - **Precio Recibido por Tienda**: `text-emerald-600 font-bold text-sm`
    - **Precio al Público (si difiere)**: `text-[9px] text-gray-400 font-medium`
  - **Sección de Pago y Total**:
    - **Botón de Comprobante / Pago**: `flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium transition-colors`
    - **Texto de Total Neto Tienda**: `text-emerald-600 font-black`
    - **Precio Público Total**: `text-[9px] text-gray-400 font-bold uppercase tracking-tighter`

- **Fila de Acciones Inferior**:
  - **Contenedor**: `flex gap-2 pt-4 border-t border-gray-100` (Padding superior 4 con borde gris tenue)
  - **Botón Notificar (WhatsApp)**: `flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors cursor-pointer`
  - **Botón Editar**: `flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors`
  - **Botón Eliminar**: `flex items-center justify-center p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors`
