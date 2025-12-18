# Sistema de Gestión de Stock de Ingredientes

## 📌 Descripción General

Sistema completo de gestión de stock para ingredientes usados en productos. Permite:

1. **Registrar entradas** de stock (compras de ingredientes)
2. **Visualizar consumo automático** desde órdenes
3. **Ajustes manuales** de stock
4. **Historial diario** de movimientos
5. **Predicción de disponibilidad** de stock actual

## 🏗️ Estructura de Datos (Firestore)

### Colección: `ingredientStockMovements`

Cada documento representa un movimiento de stock:

```
{
  id: string                    // Auto-generado por Firestore
  ingredientId: string          // ID único del ingrediente
  ingredientName: string        // Nombre del ingrediente (ej: "Tequeños")
  type: 'entry' | 'sale' | 'adjustment'  // Tipo de movimiento
  quantity: number              // Cantidad
  date: string                  // Fecha en formato 'YYYY-MM-DD'
  notes: string                 // Notas opcionales
  businessId: string            // ID del negocio dueño
  createdAt: Timestamp          // Fecha/hora de creación
}
```

### Ejemplos de Movimientos

**Ejemplo 1: Entrada de stock (compra)**
```
{
  ingredientId: "ing_tequeños",
  ingredientName: "Tequeños",
  type: "entry",
  quantity: 200,
  date: "2025-01-18",
  notes: "Compra a proveedor ABC, inversión $100",
  businessId: "negocio123"
}
```

**Ejemplo 2: Venta (consumo desde orden)**
```
{
  ingredientId: "ing_tequeños",
  ingredientName: "Tequeños",
  type: "sale",
  quantity: 50,
  date: "2025-01-18",
  notes: "Venta en orden - Pack 50 tequeños",
  businessId: "negocio123"
}
```

**Ejemplo 3: Ajuste manual**
```
{
  ingredientId: "ing_tequeños",
  ingredientName: "Tequeños",
  type: "adjustment",
  quantity: -10,
  date: "2025-01-18",
  notes: "Ajuste: tequeños vencidos",
  businessId: "negocio123"
}
```

## 🔄 Flujo de Usuario

### 1. Visualizar Gestión de Stock

1. Ir al **Dashboard** de tu negocio
2. Hacer clic en **"Stock de Ingredientes"** en el menú lateral izquierdo
3. O navegar directamente a `/business/stock`

### 2. Panel Principal

El dashboard muestra:

- **Panel lateral izquierdo**: Lista de todos los ingredientes con stock actual
- **Panel principal derecho**: Detalles del ingrediente seleccionado
  - Stock actual
  - Consumo en el período seleccionado
  - Total de movimientos
  - Historial de todas las transacciones

### 3. Filtros de Fecha

Cambiar el rango de fecha para ver:
- **Hoy**: Solo movimientos del día actual
- **7 días**: Última semana
- **30 días**: Último mes
- **Todo**: Historial completo

### 4. Registrar Nuevo Movimiento

Hacer clic en "Nuevo Movimiento" para:

1. **Seleccionar ingrediente**: Nombre del ingrediente
2. **Tipo de movimiento**:
   - Entrada (Compra): Stock que llega
   - Salida (Venta/Uso): Stock que se usa manualmente
   - Ajuste Manual: Correcciones
3. **Cantidad**: Cuántas unidades
4. **Fecha**: Cuándo ocurrió
5. **Notas**: Detalles adicionales (opcional)

## 🤖 Consumo Automático

### Cómo Funciona

Cuando se crea una orden (checkout o manual):

1. El sistema identifica los ingredientes en cada producto/variante
2. Calcula el consumo basado en la cantidad de productos ordenados
3. Registra automáticamente un movimiento de tipo "sale"
4. Descuenta del stock actual

**Ejemplo**:
- Orden: 2x "Pack 50 tequeños" (cada pack usa 50 tequeños)
- Consumo automático: 2 × 50 = 100 tequeños descontados
- El registro aparece en el historial automáticamente

### Integración con Productos

Los ingredientes se definen en dos lugares:

1. **En el producto base**: Si todos los productos usan los mismos ingredientes
   ```
   Product {
     name: "Tequeños",
     ingredients: [
       { name: "Tequeños", quantity: 30, unitCost: 0.50 },
       { name: "Salsa", quantity: 0.05, unitCost: 0.10 }
     ]
   }
   ```

2. **En cada variante**: Si varían según el tamaño/tipo
   ```
   Variant {
     name: "50 Tequeños",
     ingredients: [
       { name: "Tequeños", quantity: 50, unitCost: 0.50 }
     ]
   }
   ```

## 📊 Cálculos de Stock

### Stock Actual

```
Stock = (Suma de ENTRADAS) - (Suma de VENTAS/CONSUMO) + (Ajustes)

Ejemplo:
  Inicio: 0
  + Entrada 200 (18 ene) = 200
  - Venta 50 (18 ene)   = 150
  + Entrada 300 (19 ene) = 450
  - Venta 75 (19 ene)   = 375
  
  Stock actual: 375
```

### Nunca es Negativo

El sistema nunca permite stock negativo:
```javascript
stock = Math.max(0, calculatedStock)
```

### Cálculo por Fecha

Puedes ver el stock en cualquier fecha histórica:
```javascript
const stockOn18Jan = await calculateCurrentStock(businessId, ingredientId, "2025-01-18")
// Retorna: 150 (stock al final del 18 de enero)
```

## 🛠️ Funciones de Base de Datos

Todas estas funciones están en `src/lib/database.ts`:

### 1. Registrar Movimiento
```typescript
await recordStockMovement({
  ingredientId: "ing_tequeños",
  ingredientName: "Tequeños",
  type: "entry",
  quantity: 200,
  date: "2025-01-18",
  notes: "Compra",
  businessId: "negocio123"
})
```

### 2. Obtener Movimientos
```typescript
const movements = await getStockMovements(
  businessId,
  ingredientId,  // opcional
  startDate,     // Date
  endDate        // Date
)
```

### 3. Calcular Stock Actual
```typescript
const stock = await calculateCurrentStock(businessId, ingredientId)
// Con fecha específica:
const stockOnDate = await calculateCurrentStock(businessId, ingredientId, "2025-01-18")
```

### 4. Resumen de Todos los Ingredientes
```typescript
const summary = await getIngredientStockSummary(businessId)
// Retorna: [ { ingredientId, ingredientName, currentStock, movements } ]
```

### 5. Consumo Desde Órdenes
```typescript
const consumption = await calculateIngredientConsumption(
  businessId,
  ingredientName,  // ej: "Tequeños"
  startDate,
  endDate
)
```

### 6. Historial Diario
```typescript
const history = await getIngredientStockHistory(
  businessId,
  ingredientId,
  startDate,
  endDate
)
// Retorna: [ { date, movements, stockAtEndOfDay } ]
```

### 7. Registrar Consumo de Orden (Automático)
```typescript
await registerOrderConsumption(businessId, items)
// items: [{ productId, variant, name, quantity }]
```

## 📱 Interfaz de Usuario

### Página: `/business/stock`

Disponible desde el dashboard de tu negocio en el menú lateral izquierdo. Solo para usuarios autenticados como dueños o administradores del negocio.

**Componente**: `src/components/IngredientStockManagement.tsx`

### Características del Panel

1. **Selector de Ingredientes** (Panel lateral)
   - Lista de todos los ingredientes
   - Stock actual destacado
   - Indicador visual de disponibilidad (✓ en stock, ✗ sin stock)

2. **Resumen del Ingrediente** (Panel principal superior)
   - Stock actual en grande
   - Consumo en el período
   - Total de movimientos
   - Últimos movimientos

3. **Historial de Movimientos** (Tabla)
   - Fecha
   - Tipo (Entrada/Salida/Ajuste) con colores
   - Cantidad (+/- automático)
   - Notas

4. **Modal de Nuevo Movimiento**
   - Campos: Ingrediente, Tipo, Cantidad, Fecha, Notas
   - Validación de datos
   - Confirmación

## 📈 Casos de Uso

### Caso 1: Registro de Compra de Ingredientes

**Escenario**: Compraste 200 tequeños al proveedor

1. Ir a `/admin/ingredients`
2. Hacer clic en "Nuevo Movimiento"
3. Llenar formulario:
   - Ingrediente: "Tequeños"
   - Tipo: "Entrada (Compra)"
   - Cantidad: "200"
   - Fecha: "2025-01-18"
   - Notas: "Compra a Proveedor ABC, $100"
4. Guardar

**Resultado**: Stock se incrementa en 200

---

### Caso 2: Ajuste Manual por Merma

**Escenario**: Se vencieron 10 tequeños

1. Ir a `/admin/ingredients`
2. Hacer clic en "Nuevo Movimiento"
3. Llenar formulario:
   - Ingrediente: "Tequeños"
   - Tipo: "Ajuste Manual"
   - Cantidad: "-10"
   - Fecha: "2025-01-18"
   - Notas: "Tequeños vencidos"
4. Guardar

**Resultado**: Stock se reduce en 10

---

### Caso 3: Visualizar Consumo de Hoy

**Escenario**: Quieres saber cuántos tequeños vendiste hoy

1. Ir a `/admin/ingredients`
2. Filtro: "Hoy"
3. Seleccionar "Tequeños"
4. Mirar tarjeta de resumen: "Consumo en el período: 125"

**Resultado**: Consumiste 125 tequeños (automático desde órdenes)

---

### Caso 4: Proyectar Stock Futuro

**Escenario**: ¿Cuándo necesito pedir más?

1. Ir a `/admin/ingredients`
2. Ver "Stock Actual: 45"
3. Ver "Consumo en 7 días: 200"
4. Decidir: Necesito pedir pronto

**Acción**: Registrar compra de 300 más

---

## 🔒 Seguridad

- ✅ Cada negocio solo ve su propio stock
- ✅ Solo administradores/dueños pueden registrar movimientos
- ✅ Historial completo e inmutable (Firestore audita)
- ✅ Las órdenes registran consumo automáticamente (no se olvida)

## 📝 Notas Técnicas

### Campos Requeridos en Productos

Para que el consumo automático funcione, los productos deben tener:

```typescript
// Opción 1: Ingredientes a nivel de producto
{
  id: "prod_tequeños",
  name: "Tequeños",
  ingredients: [
    { name: "Tequeños", quantity: 30, unitCost: 0.50 }
  ]
}

// Opción 2: Ingredientes por variante
{
  id: "prod_tequeños",
  name: "Tequeños",
  variants: [
    {
      name: "50 Tequeños",
      ingredients: [
        { name: "Tequeños", quantity: 50, unitCost: 0.50 }
      ]
    },
    {
      name: "100 Tequeños",
      ingredients: [
        { name: "Tequeños", quantity: 100, unitCost: 0.50 }
      ]
    }
  ]
}
```

### Sincronización Manual-Automática

- **Automático**: Órdenes desde checkout o panel manual → se descuenta stock
- **Manual**: Usar "Nuevo Movimiento" para entradas o ajustes
- **No hay duplicidad**: Cada orden se registra una sola vez

### Performance

- Queries optimizadas con índices Firestore
- Cálculos en tiempo real
- Filtros de fecha eficientes
- Paginación en tabla de movimientos (próximamente)

## 🚀 Próximas Mejoras

- [ ] Alertas cuando stock baja de mínimo
- [ ] Predicción de agotamiento basada en consumo promedio
- [ ] Histogramas de consumo por ingrediente
- [ ] Exportar reporte de stock en CSV/PDF
- [ ] Integración con proveedores (órdenes automáticas)
- [ ] Costo total de stock (valoración del inventario)

## ❓ Preguntas Frecuentes

**P: ¿Qué pasa si cancelo una orden?**
A: El consumo de stock se mantiene registrado. Usa un "Ajuste Manual" positivo para devolverlo.

**P: ¿Puedo editar un movimiento?**
A: No (por auditoría). Registra un ajuste negativo/positivo en su lugar.

**P: ¿Desaparece el histórico?**
A: Nunca. Todo queda guardado por seguridad y auditoría.

**P: ¿Funciona con múltiples sucursales?**
A: Sí, cada businessId es independiente. Los datos nunca se mezclan.

**P: ¿Qué pasa si no defino ingredientes?**
A: El consumo automático no ocurre. Solo puedes registrar manualmente.
