# Reglas y Preferencias del Asistente (AGENTS.md)

Este archivo define las reglas de comportamiento, diseño y estructura del proyecto.

## Reglas de Comunicación e Idioma

- **Idioma Obligatorio**: Todas las respuestas y explicaciones del asistente deben ser en **español**.
- **Planes de Implementación**: Todos los planes de implementación y diseño (`implementation_plan.md`, `task.md`, `walkthrough.md`) deben redactarse en **español**.
- **Enlaces**: Mantener siempre enlaces clicables para archivos y símbolos usando el esquema `file://`.

## Directrices de Diseño y Estética

- **Estética Premium**: La aplicación debe tener un diseño visual de alta calidad, moderno, con combinaciones de colores armónicas (evitando colores puros como rojo, azul o verde genéricos).
- **Directrices de Tipografía Principal (Basadas en [username])**:
  - **Nombre de la Tienda**: Utilizar peso súper enérgico `font-black` (900), color principal `text-gray-900`, interletrado ajustado `tracking-tight` e interlineado apretado `leading-tight`.
  - **Nombre del Producto**: Utilizar peso destacado `font-black` (900), color principal `text-gray-900`, interletrado `tracking-tight` y `leading-tight`.
  - **Descripción (Tienda / Producto)**: Utilizar peso medio `font-medium` (500) o regular, color secundario `text-gray-500` / `text-gray-700` e interlineado relajado `leading-relaxed`.
- **Sin Marcadores de Posición**: Evitar el uso de imágenes placeholder genéricas. En su lugar, generar recursos reales o descriptivos.

## Estructura de la Aplicación y Desarrollo

- **Rutas de Next.js**: Utilizar el App Router de Next.js (`src/app/...`) para páginas nuevas.
- **Componentes**: Diseñar componentes enfocados, reutilizables y con tipado estricto en TypeScript.
- **Bases de Datos y Firebase**:
  - Las suscripciones en tiempo real deben limpiarse correctamente en los hooks de efecto (`useEffect`) retornando la función de desuscripción.
  - Asegurar la compatibilidad con el entorno offline usando colas y validaciones locales.

No uses el navegador dom, es muy tardado
