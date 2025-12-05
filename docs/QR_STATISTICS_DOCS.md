# 📊 Estadísticas de Códigos QR - Documentación

## 📋 Overview

Se ha agregado un nuevo componente de **estadísticas** para la página de códigos QR que muestra:

1. **Resumen General** - Métricas globales de la campaña
2. **Escaneos por QR** - Cantidad de veces que se escaneó cada código
3. **Top Usuarios** - Ranking de usuarios con más escaneos

## 🏗️ Estructura

### Componente Principal: `QRStatistics.tsx`

```typescript
// Ubicación: src/components/QRStatistics.tsx
// Props:
interface QRStatisticsProps {
  businessId: string        // ID del negocio
  qrCodes: QRCode[]        // Array de códigos QR del negocio
}
```

### Funciones en `database.ts`

Se agregaron tres funciones para obtener datos:

#### 1. `getQRScanStatistics(businessId: string)`
```typescript
// Retorna: { [qrCodeId: string]: number }
// Ejemplo: { "code1": 45, "code2": 32, "code3": 18 }
```
**Uso:** Obtiene la cantidad total de escaneos para cada código QR

#### 2. `getTopQRScanners(businessId: string, limit?: number)`
```typescript
// Retorna: Array<{
//   userId: string
//   scannedCount: number
//   completed: boolean
//   lastScanned?: Date
// }>
```
**Uso:** Obtiene los N usuarios (default 10) con más escaneos

#### 3. `getQRStatisticsDetail(businessId: string)`
```typescript
// Retorna: {
//   totalUsers: number
//   totalScans: number
//   averageScansPerUser: number
//   usersCompleted: number
//   completionRate: number  // Porcentaje
// }
```
**Uso:** Obtiene estadísticas generales de la campaña

## 📊 Tabs Disponibles

### Tab 1: Resumen General
Muestra 5 tarjetas con información clave:
- **Total Usuarios** - Cantidad de usuarios que han escaneado al menos un código
- **Total Escaneos** - Número total de escaneos realizados
- **Promedio** - Promedio de escaneos por usuario
- **Completados** - Cantidad de usuarios que completaron la colección (5/5)
- **Completación** - Porcentaje de usuarios con colección completa

### Tab 2: Escaneos por QR
Muestra una tabla con:
- Nombre del código QR
- Color del código (indicador visual)
- Cantidad de escaneos (número grande)
- Barra de progreso visual
- Porcentaje relativo al máximo

### Tab 3: Top Usuarios
Ranking de usuarios con:
- Posición (🥇 🥈 🥉 o número)
- ID del usuario (teléfono)
- Cantidad de escaneos
- Indicador si completó la colección
- Fecha del último escaneo
- Barra de progreso visual

## 🔄 Datos en Tiempo Real

Las estadísticas se cargan cuando:
1. El componente se monta
2. Se hace click en "Refrescar Estadísticas"

Datos fuente: Colección `userQRProgress` en Firestore

## 📁 Estructura de Archivos

```
src/
├── components/
│   └── QRStatistics.tsx        ← Componente nuevo
├── lib/
│   └── database.ts             ← 3 funciones nuevas
└── app/
    └── business/
        └── qr-codes/
            └── page.tsx        ← Integración del componente
```

## 🎨 Diseño Visual

- **Colors:** Gradientes suaves y colores por tipo de métrica
- **Icons:** Bootstrap Icons para cada sección
- **Responsive:** Adapta a desktop, tablet y móvil
- **Interactivo:** Tabs, hover effects, barras de progreso animadas

## 📈 Casos de Uso

### Ejemplo 1: Ver cuál código se escaneó más
1. Ir a la página de Códigos QR
2. Scroll hasta "Estadísticas de Códigos QR"
3. Click en tab "Escaneos por QR"
4. Ver qué código tiene más escaneos

### Ejemplo 2: Encontrar clientes más participativos
1. Click en tab "Top Usuarios"
2. Ver los usuarios con más escaneos
3. Identificar los más comprometidos con la campaña

### Ejemplo 3: Monitorear progreso de campaña
1. Ver el tab "Resumen General"
2. Seguimiento de % Completación
3. Decidir si prolongar o finalizar campaña

## 🔐 Permisos

- **Lectura:** Solo usuarios autenticados (staff del negocio)
- **Datos:** Leídos desde Firestore
- **Seguridad:** No expone información sensible (solo agregados)

## 🚀 Mejoras Futuras (Opcionales)

1. **Gráficas avanzadas**
   - Gráficos de línea para tendencias
   - Gráficos de pastel para distribución
   - Exportar a PDF/Excel

2. **Filtros**
   - Por fecha (últimos 7 días, 30 días, todo)
   - Por estado del usuario (completados, en progreso)
   - Por código QR específico

3. **Notificaciones**
   - Alertar cuando se alcanza el 50% de completación
   - Notificar nuevos usuarios
   - Reminder para códigos no escaneados

4. **Análisis avanzados**
   - Tiempo promedio para completar la colección
   - Correlación entre ubicación del código y escaneos
   - Predicción de completación total

5. **Integración**
   - Webhook para enviar notificaciones a admin
   - API para integrar en sistemas externos
   - Exportación de datos a Google Sheets

## 📝 Notas de Implementación

### Rendimiento
- Las funciones usan `Promise.all()` para paralelizar queries
- No hay paginación (limit a 10 usuarios top)
- Caché local en component state

### Consideraciones
- `userId` se obtiene de `userQRProgress` (puede ser teléfono)
- Los datos se refresca manualmente con botón
- Sin auto-refresh en tiempo real (usar `onSnapshot` si se necesita)

## 🧪 Test

Para probar las estadísticas:

1. Escanear códigos QR desde la app de clientes
2. Ir a Códigos QR → Estadísticas
3. Verificar que los números coincidan con los escaneos realizados
4. Probar todos los tabs
5. Click en "Refrescar Estadísticas"

## 📞 Soporte

Archivos relacionados:
- `src/components/QRStatistics.tsx` - Componente UI
- `src/lib/database.ts` - Funciones de datos (líneas 2955+)
- `src/types/index.ts` - Tipos `UserQRProgress`
