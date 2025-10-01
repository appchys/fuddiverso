# Instrucciones para Agregar Reportes de Costos al Dashboard

## Cambios necesarios en: `src\app\business\dashboard\page.tsx`

### 1. Agregar botón de Reportes en el Sidebar (después del botón de Administradores, línea ~2575)

Después de este bloque:
```tsx
              <button
                onClick={() => {
                  setActiveTab('admins')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                  activeTab === 'admins'
                    ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <i className="bi bi-people me-3 text-lg"></i>
                <span className="font-medium">Administradores</span>
              </button>
```

Agregar:
```tsx
              
              <button
                onClick={() => {
                  setActiveTab('reports')
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${
                  activeTab === 'reports'
                    ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <i className="bi bi-graph-up me-3 text-lg"></i>
                <span className="font-medium">Reportes de Costos</span>
              </button>
```

### 2. Agregar el contenido del tab de Reportes (después del tab de Administradores, línea ~3450)

Después del cierre del tab de Administradores `)}`, agregar:

```tsx

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <CostReports business={business} />
        )}
```

## Resumen de lo que hace el sistema:

### ✅ Ya implementado:
1. **Función `calculateCostReport`** en `database.ts` que:
   - Analiza todas las órdenes completadas en un rango de fechas
   - Calcula el consumo de ingredientes por producto/variante
   - Suma los costos totales de ingredientes
   - Calcula ingresos, costos y márgenes de ganancia

2. **Componente `CostReports.tsx`** que muestra:
   - Resumen con 4 métricas principales (ingresos, costos, ganancia, margen)
   - Tabla de consumo de ingredientes con detalles expandibles
   - Tabla de productos más vendidos con análisis de rentabilidad
   - Filtros por período (hoy, 7 días, 30 días, personalizado)

### 📊 Cómo funciona:

**Ejemplo: Vendiste 10 hamburguesas clásicas**

Si cada hamburguesa tiene:
- 1 Pan ($0.20)
- 1 Carne ($0.35)
- 2 Mayonesa ($0.10 c/u)

El reporte mostrará:
- **Pan**: 10 unidades usadas = $2.00
- **Carne**: 10 unidades usadas = $3.50
- **Mayonesa**: 20 unidades usadas = $2.00
- **Costo Total**: $7.50
- **Ingresos**: $25.00 (si vendes a $2.50 c/u)
- **Ganancia**: $17.50
- **Margen**: 70%

### 🔄 Funciona con:
- ✅ Órdenes manuales (ManualOrderSidebar)
- ✅ Órdenes de clientes (Checkout)
- ✅ Productos con ingredientes base
- ✅ Variantes con ingredientes específicos

El sistema es automático y solo analiza órdenes con estado `delivered` o `completed`.
