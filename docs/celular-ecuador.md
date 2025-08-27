# Guía de Implementación - Validación de Celular Ecuatoriano

## 📱 Formato de Celular para Ecuador

### Formato Esperado en Base de Datos
- **Formato almacenado**: `0959036708` (10 dígitos empezando con 09)
- **Patrón**: `09XXXXXXXX` (empezar con 09, seguido de 8 dígitos más)

### Formatos de Entrada Soportados (Normalización Automática)
El sistema ahora acepta múltiples formatos de entrada y los normaliza automáticamente:

#### ✅ Formatos Válidos de Entrada
- `0959036708` → `0959036708` (ya normalizado)
- `+593959036708` → `0959036708` (código de país +593)
- `+593 95 903 6708` → `0959036708` (con espacios)
- `+593-95-903-6708` → `0959036708` (con guiones)
- `593959036708` → `0959036708` (código país sin +)
- `959036708` → `0959036708` (sin 0 inicial)

#### ❌ Formatos Inválidos
- `0890815097` (no empieza con 09)
- `09908150979` (más de 10 dígitos)
- `099081509` (menos de 10 dígitos)
- `+1234567890` (código de país incorrecto)

## 🔄 Normalización Automática

### Proceso de Normalización
1. **Limpieza**: Remover espacios, guiones y paréntesis
2. **Código de país**: Detectar y remover +593 o 593
3. **Prefijo cero**: Agregar 0 inicial si falta
4. **Validación**: Verificar formato final 09XXXXXXXX

### Funciones Disponibles

#### `normalizeEcuadorianPhone(phone: string): string`
Normaliza un número al formato de base de datos:
```typescript
import { normalizeEcuadorianPhone } from '@/lib/validation'

normalizeEcuadorianPhone('+593 95 903 6708') // '0959036708'
normalizeEcuadorianPhone('959036708')        // '0959036708'
normalizeEcuadorianPhone('0959036708')       // '0959036708'
```

#### `validateAndNormalizePhone(phone: string): string | null`
Normaliza y valida en un solo paso:
```typescript
import { validateAndNormalizePhone } from '@/lib/validation'

validateAndNormalizePhone('+593 95 903 6708') // '0959036708'
validateAndNormalizePhone('invalid')           // null
```

## 🛠️ Funciones de Validación

### Uso Básico
```typescript
import { validateEcuadorianPhone, formatEcuadorianPhone } from '@/lib/validation'

// Validar
const isValid = validateEcuadorianPhone('0990815097') // true

// Formatear para mostrar
const formatted = formatEcuadorianPhone('0990815097') // "099 081 5097"
```

### En Formularios React
```typescript
const [phone, setPhone] = useState('')
const [phoneError, setPhoneError] = useState('')

const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const value = e.target.value
  setPhone(value)
  
  if (value && !validateEcuadorianPhone(value)) {
    setPhoneError('Ingrese un número de celular ecuatoriano válido (formato: 0990815097)')
  } else {
    setPhoneError('')
  }
}
```

### Validación Completa
```typescript
import { getPhoneValidationMessage } from '@/lib/validation'

const validateForm = () => {
  const phoneError = getPhoneValidationMessage(phone)
  if (phoneError) {
    setPhoneError(phoneError)
    return false
  }
  return true
}
```

## 🎨 Componentes HTML

### Input con Validación
```html
<input
  type="tel"
  pattern="^09[0-9]{8}$"
  placeholder="0990815097"
  title="Ingrese un número de celular ecuatoriano válido (10 dígitos empezando con 09)"
  maxLength="10"
/>
```

### Mensaje de Ayuda
```html
<small className="text-gray-500">
  Formato: 0990815097 (10 dígitos empezando con 09)
</small>
```

## 🔧 Implementación en Formularios

### Registro de Negocio
- ✅ Campo actualizado a "Celular"
- ✅ Placeholder con formato ecuatoriano
- ✅ Validación con pattern HTML5
- ✅ Mensaje de ayuda incluido

### Checkout de Cliente
- ✅ Campo actualizado a "Número de Celular"
- ✅ Validación del formato
- ✅ Ejemplo visual en placeholder

### Dashboard de Negocios
- ✅ Datos simulados actualizados con formato ecuatoriano
- ✅ Visualización de números sin formato internacional

## 📊 Datos de Ejemplo Actualizados

### Clientes
- Juan Pérez: `0990815097`
- María García: `0987654321`

### Restaurantes
- Burger Palace: `0990815097`

## 🌍 Consideraciones Internacionales

Si en el futuro necesitas expandir a otros países:

```typescript
// Función extensible para múltiples países
const validatePhone = (phone: string, country: 'EC' | 'PE' | 'CO') => {
  switch (country) {
    case 'EC':
      return /^09[0-9]{8}$/.test(phone)
    case 'PE':
      return /^9[0-9]{8}$/.test(phone)
    case 'CO':
      return /^3[0-9]{9}$/.test(phone)
    default:
      return false
  }
}
```

## ✅ Checklist de Implementación

- [x] Cambiar "Teléfono" por "Celular" en toda la app
- [x] Actualizar placeholders a formato ecuatoriano (0990815097)
- [x] Agregar validación HTML5 con pattern
- [x] Actualizar datos simulados
- [x] Crear funciones de validación utilitarias
- [x] Documentar el formato en README
- [x] Actualizar tipos TypeScript con comentarios

## 🚀 Próximos Pasos

1. **Integrar validación en tiempo real** en los formularios
2. **Agregar feedback visual** (colores de validación)
3. **Implementar formateo automático** mientras el usuario escribe
4. **Conectar con APIs de validación** de operadoras ecuatorianas
5. **Agregar autocompletado** de prefijos (099, 098, 097, etc.)
