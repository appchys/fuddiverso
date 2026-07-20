# Plan de Finanzas y Liquidaciones de Restaurantes

Este documento describe la arquitectura, flujo de trabajo y experiencia de usuario (UX) para el módulo de **Finanzas** (panel del restaurante) y **Cierre de Caja / Liquidaciones** (panel de administración y sidebar de pedidos).

---

## 1. Flujo de Trabajo (Paso a Paso)

### Paso 1: El Corte Automático de Visualización
- **Propósito**: Prevenir que las nuevas órdenes que entran durante la revisión de caja o liquidación alteren los totales del día.
- **Funcionamiento**:
  - Se define un horario de corte visual fijo (por ejemplo, `00:00` medianoche o la hora de cierre configurada del local).
  - Todas las ventas completadas/entregadas hasta la hora del corte pertenecen al periodo que se va a liquidar.
  - Las ventas recibidas después de esa hora pasan automáticamente al ciclo del día siguiente.
  - En la interfaz del restaurante, el resumen de ventas digitales y efectivo queda bloqueado visualmente para el periodo cerrado.

### Paso 2: Estado "Pendiente de Pago"
- **Propósito**: Dar visibilidad y certidumbre al restaurante sobre los valores registrados pendientes de transferir.
- **Funcionamiento**:
  - Al realizarse el corte, el saldo acumulado del periodo anterior cambia a estado:
    - 🟡 **Pendiente de depósito** (`pending`)
  - En el panel del restaurante (**Finanzas**), se muestra una tarjeta destacada con el neto exacto a recibir, el desglose de ventas con tarjeta/transferencia vs efectivo, comisiones descontadas y la cuenta bancaria de destino.

### Paso 3: Validación y Pago por el Administrador
- **Propósito**: Permitir al administrador revisar, transferir y adjuntar respaldos.
- **Funcionamiento**:
  - El administrador accede a la sección de **Liquidaciones Pendientes** (en el Panel de Administrador o desde Cierre de Caja).
  - Verifica los valores consolidados (Total Ventas Digitales - Comisión Fuddi - Ventas en Efectivo retenidas).
  - Realiza la transferencia bancaria desde su banca móvil.
  - Descarga el comprobante bancario (imagen o PDF) e ingresa el número de referencia.

### Paso 4: Cambio de Estado a "Depositado"
- **Propósito**: Confirmar la transacción y notificar al restaurante.
- **Funcionamiento**:
  - El administrador marca el periodo como **Pagado** (`settled`), adjuntando opcionalmente el comprobante de pago o número de referencia.
  - El estado en el panel del restaurante pasa inmediatamente a:
    - 🟢 **Depositado** (`settled`)
  - El restaurante puede visualizar y descargar el comprobante adjunto dentro de su historial de liquidaciones en **Finanzas**.

---

## 2. Vista del Panel de Administrador: "Liquidaciones Pendientes"

El administrador cuenta con una vista consolidada estructurada en forma de tabla para procesar rápidamente los pagos pendientes por restaurante:

| Restaurante | Periodo / Día | Total Ventas Digitales | Comisión a Descontar | Monto Neto a Transferir | Cuenta Bancaria | Acción |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hollyfood** | 19 Julio | $150.00 | $15.00 | **$135.00** | Pichincha Ahorros (***1234) | `[ Marcar como Pagado ]` |
| **Alys Bakery** | 19 Julio | $80.00 | $8.00 | **$72.00** | Produbanco Cte (***5678) | `[ Marcar como Pagado ]` |

---

## 3. Recomendaciones de UX para Evitar Fricciones

1. **Diferenciación Clara de Saldos (Neto Único)**:
   - **Ventas Digitales (Tarjeta / Transferencia)**: Dinero en poder de Fuddi que debe transferirse al restaurante.
   - **Ventas en Efectivo**: Dinero cobrado directamente por el restaurante en su local o por sus repartidores.
   - **Comisión Fuddi**: Tarifa del servicio calculada por orden o porcentaje.
   - **Resultado Neto**:
     - Si `Ventas Digitales - Comisión > Ventas Efectivo Retenidas`: Se muestra el mensaje claro **"Te transferiremos $X.XX"** (Verde).
     - Si `Ventas Efectivo Retenidas > Ventas Digitales - Comisión`: Se muestra el mensaje claro **"Debes pagar de comisiones $Y.YY"** (Naranja/Rojo).

2. **Horario Fijo de Pago y Notificación Preventiva**:
   - Se incluye una nota permanente en el panel de Finanzas del restaurante:
     > ℹ️ *Los cortes se realizan a las 00:00 y las transferencias se procesan al día siguiente antes de las 2:00 PM.*
   - Esto reduce drásticamente las consultas repetitivas de soporte técnico o mensajes de seguimiento.

3. **Gestión Dual en Cierre de Caja (`/pedidos`)**:
   - En el sidebar de Cierre de Caja, se habilita una pestaña o conmutador selector para alternar o administrar tanto **Deliverys** (repartidores) como **Restaurantes**.

---

## 4. Cambios en la Navegación y Código

1. **Renombrar Billetera a Finanzas en `Business/dashboard`**:
   - `DashboardSidebar.tsx`: Renombrar la opción "Billetera" a **Finanzas** (y unificar o actualizar el enlace a la vista financiera).
   - `WalletView.tsx`: Actualizar encabezados, títulos y textos a **Finanzas**, enfocándose en "Valores a recibir" y liquidaciones.
2. **CierreSidebarView.tsx**:
   - Agregar selector de tipo de entidad en Cierre de caja (`Deliverys` | `Restaurantes`).
   - Permitir consultar el balance diario y cierre en tiempo real tanto para repartidores como para restaurantes.
