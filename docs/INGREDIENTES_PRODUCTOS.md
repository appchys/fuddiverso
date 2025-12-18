# Sistema de Gestión de Ingredientes para Productos

## 📋 Overview

Se ha implementado un sistema completo de gestión de ingredientes tanto en **ProductManagement.tsx** como en **ProductList.tsx**, permitiendo a los negocios:

1. Agregar ingredientes a productos sin variantes
2. Agregar ingredientes específicos a cada variante
3. Mantener una biblioteca de ingredientes reutilizables
4. Calcular costos automáticamente
5. Visualizar márgenes de ganancia

---

## 🏗️ Estructura de Datos

### Producto sin Variantes
```typescript
{
  id: string
  name: string
  description: string
  price: number
  category: string
  image: string
  businessId: string
  isAvailable: boolean
  ingredients: Array<{      // ← Ingredientes del producto
    id: string
    name: string
    unitCost: number        // Costo por unidad
    quantity: number        // Cantidad usada
  }>
  createdAt: timestamp
  updatedAt: timestamp
}
```

### Producto con Variantes
```typescript
{
  id: string
  name: string
  description: string
  price: number              // Precio base (opcional)
  category: string
  image: string
  businessId: string
  isAvailable: boolean
  variants: Array<{
    id: string
    name: string
    description: string
    price: number
    isAvailable: boolean
    ingredients: Array<{     // ← Ingredientes específicos de la variante
      id: string
      name: string
      unitCost: number
      quantity: number
    }>
  }>
  createdAt: timestamp
  updatedAt: timestamp
}
```

---

## 🎯 Características Principales

### 1. **Pestaña de Información General**
- Nombre, descripción, precio
- Categoría
- Imagen
- Disponibilidad
- Gestión de variantes

### 2. **Pestaña de Ingredientes y Costos**

#### Para Productos Sin Variantes:
- ✅ Agregar/eliminar ingredientes
- ✅ Especificar costo unitario y cantidad
- ✅ Autocompletado desde biblioteca
- ✅ Cálculo automático de costo total
- ✅ Cálculo automático de margen de ganancia

#### Para Productos Con Variantes:
- ✅ Cada variante tiene sus propios ingredientes
- ✅ Expandir/contraer cada variante
- ✅ Visualizar:
  - Costo total de ingredientes
  - Precio de venta
  - Ganancia estimada
  - Número de ingredientes
- ✅ Agregar/eliminar ingredientes por variante

### 3. **Biblioteca de Ingredientes**
- Los ingredientes se guardan automáticamente
- Se reutilizan en futuros productos
- Muestra contador de uso
- Autocompletado inteligente

---

## 💡 Flujo de Uso

### Crear Producto Sin Variantes con Ingredientes

1. Click en "Nuevo Producto"
2. Rellenar pestaña "Información General"
3. Click en pestaña "Ingredientes y Costos"
4. Agregar ingredientes:
   - Escribir nombre (o seleccionar de biblioteca)
   - Especificar costo unitario
   - Especificar cantidad
   - Click "Agregar Ingrediente"
5. Ver costo total automáticamente
6. Ver margen de ganancia
7. Click "Guardar Cambios"

### Crear Producto Con Variantes y Ingredientes por Variante

1. Click en "Nuevo Producto"
2. Rellenar pestaña "Información General"
3. Agregar variantes (Tamaño grande, Con queso, etc.)
4. Click en pestaña "Ingredientes y Costos"
5. Para cada variante:
   - Click en la variante para expandir
   - Agregar ingredientes específicos
   - Ver costo y ganancia calculados automáticamente
6. Click "Guardar Cambios"

---

## 🔄 Persistencia

Cuando guardas un producto, los ingredientes se persisten automáticamente:

```typescript
// Sin variantes
{
  name: "Hamburguesa",
  price: 10,
  ingredients: [
    { id: "123", name: "Pan", unitCost: 0.5, quantity: 1 },
    { id: "124", name: "Carne", unitCost: 3, quantity: 1 },
    { id: "125", name: "Lechuga", unitCost: 0.2, quantity: 2 }
  ]
}

// Con variantes
{
  name: "Hamburguesa",
  variants: [
    {
      id: "var1",
      name: "Tamaño grande",
      price: 12,
      ingredients: [
        { id: "123", name: "Pan", unitCost: 0.5, quantity: 2 },
        { id: "124", name: "Carne", unitCost: 3, quantity: 2 }
      ]
    },
    {
      id: "var2",
      name: "Tamaño chico",
      price: 8,
      ingredients: [
        { id: "123", name: "Pan", unitCost: 0.5, quantity: 1 },
        { id: "124", name: "Carne", unitCost: 3, quantity: 1 }
      ]
    }
  ]
}
```

---

## 📊 Cálculos Automáticos

### Costo Total de Ingredientes
```
Costo Total = Σ(unitCost × quantity)
```

### Margen de Ganancia
```
Margen = Precio - Costo Total
Porcentaje = (Margen / Precio) × 100
```

---

## 🎨 Interfaz

### Visual Indicators

- **Verde**: Ganancia positiva
- **Rojo**: Ganancia negativa (precio menor que costo)
- **Gris**: Sin ingredientes
- **Chevron**: Indicador de expandible

### Estados

- Expandido: Muestra formulario para agregar ingredientes
- Colapsado: Muestra resumen compacto

---

## 🔧 Funciones Clave

### ProductManagement.tsx / ProductList.tsx

```typescript
// Manejar cambios en el input de ingredientes
handleIngredientChange(e)

// Obtener ingredientes filtrados de la biblioteca
getFilteredIngredients()

// Seleccionar ingrediente de biblioteca
selectIngredientFromLibrary(ingredient)

// Agregar ingrediente al producto
addIngredient()

// Eliminar ingrediente
removeIngredient(ingredientId)

// Agregar ingrediente a variante específica
addIngredientToVariant(variantId)

// Eliminar ingrediente de variante
removeIngredientFromVariant(variantId, ingredientId)

// Expandir/contraer variante
toggleVariantExpanded(variantId)

// Calcular costo total
calculateTotalIngredientCost()
```

---

## 📝 Notas Importantes

1. **Biblioteca de Ingredientes**: Se actualiza automáticamente cuando agregas un nuevo ingrediente
2. **Validación**: Se valida que:
   - El nombre no esté vacío
   - El costo unitario sea un número válido ≥ 0
   - La cantidad sea un número válido > 0
3. **Persistencia**: Los ingredientes se guardan en Firestore junto con el producto
4. **Compatibilidad**: Funciona tanto para productos nuevos como para edición de existentes

---

## 🚀 Próximas Mejoras Potenciales

- [ ] Importar ingredientes desde archivo CSV
- [ ] Categorías de ingredientes
- [ ] Historial de cambios de precios de ingredientes
- [ ] Reportes de costos de producción
- [ ] Fórmulas personalizadas de cálculo
- [ ] Conversión de unidades automática
