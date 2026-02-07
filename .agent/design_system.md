# Fuddi Design System - Typography Defaults

Adoptar estos estilos como predeterminados para todas las modificaciones visuales y nuevos componentes.

## 1. Título Principal
**Origen:** Nombre de la tienda en el perfil de tienda (`src/app/[username]/page.tsx`)
**Estilo:**
- **Clases:** `text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight`
- **Peso:** Black (900)
- **Tracking:** Tight
- **Color:** Gray 900

## 2. Título Secundario
**Origen:** Nombre del producto en la sección de productos aleatorios (`src/app/page.tsx`)
**Estilo:**
- **Clases:** `text-sm font-bold text-gray-900 line-clamp-1`
- **Peso:** Bold (700)
- **Color:** Gray 900

## 3. Contenido Principal
**Origen:** Descripción del producto en la sección de productos aleatorios (`src/app/page.tsx`)
**Estilo:**
- **Clases:** `text-xs text-gray-600 line-clamp-2`
- **Peso:** Regular (400)
- **Color:** Gray 600

## 4. Contenido Secundario / Tags
**Origen:** Selector de categorías (`src/app/page.tsx`)
**Estilo:**
- **Clases:** `inline-flex items-center px-3 py-1 rounded-full text-xs font-bold transition-all whitespace-nowrap`
- **Fondo:** `bg-gray-100` (Base) o `bg-[#aa1918]` (Activo/Fuerte)
- **Texto:** `text-gray-600` (Base) o `text-white` (Activo/Fuerte)
- **Peso:** Bold (700)
- **Forma:** Rounded-full (Cápsula)

## 5. Estilo de Tarjetas
**Origen:** Productos aleatorios (`src/app/page.tsx`)
**Estilo:**
- **Fondo:** `bg-white`
- **Bordes:** `rounded-2xl` (bordes suavizados premium)
- **Borde exterior:** `border border-gray-100`
- **Sombra base:** `shadow-sm`
- **Interacción (Hover):** `hover:shadow-md hover:scale-[1.02] transition-all duration-300`
- **Contenedor:** `overflow-hidden`

---
*Nota: Estos estilos garantizan la consistencia visual premium de la plataforma Fuddi.*
