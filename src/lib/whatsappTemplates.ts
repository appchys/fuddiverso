export interface WhatsAppTemplateDefinition {
  key: string
  label: string
  description: string
  defaultTemplate: string
}

export const WHATSAPP_TEMPLATE_DEFINITIONS: WhatsAppTemplateDefinition[] = [
  {
    key: 'delivery_assignment',
    label: 'Asignacion al delivery',
    description: 'Mensaje que recibe el delivery cuando se le asigna un pedido.',
    defaultTemplate: `*Pedido de {{businessName}}*
{{businessPhoneLine}}

*Datos del cliente*
Cliente: {{customerName}}
Celular: {{customerPhone}}

{{deliverySection}}
*Detalle del pedido*
{{productsList}}

*Detalles del pago*
Valor del pedido: \${{subtotal}}
{{deliveryCostLine}}
{{paymentDetailsBlock}}`
  },
  {
    key: 'pickup_store_notification',
    label: 'Notificacion a tienda por retiro',
    description: 'Mensaje interno a la tienda cuando el pedido es para retiro.',
    defaultTemplate: `*Pedido de {{businessName}}*
{{businessPhoneLine}}

*Datos del cliente*
Cliente: {{customerName}}
Celular: {{customerPhone}}

*Tipo de entrega*
{{pickupLine}}
{{orderType}}

*Detalle del pedido*
{{productsList}}

*Detalles del pago*
Valor del pedido: \${{subtotal}}
{{paymentDetailsBlock}}`
  },
  {
    key: 'customer_status',
    label: 'Actualizacion al cliente',
    description: 'Mensaje al cliente cuando su pedido fue tomado o esta en preparacion.',
    defaultTemplate: `{{initialMessage}}

*Direccion:*
{{deliveryInfo}}

*Tipo de entrega:*
{{orderType}}

Detalle del pedido:
{{productsList}}

Subtotal: \${{subtotal}}
{{deliveryCostLine}}
{{customerTotalBlock}}Forma de pago: {{paymentMethod}}
{{orderLinkLine}}`
  },
  {
    key: 'client_to_store',
    label: 'Cliente a tienda',
    description: 'Mensaje que el cliente envia a la tienda al completar su pedido.',
    defaultTemplate: `*Hola {{businessName}}, he realizado un pedido!*

*Nombres:* {{customerName}}

*Detalles de la entrega*
{{orderType}}
Referencias: {{references}}
{{locationLine}}
*Detalle del pedido*
{{productsList}}

*Total* \${{total}}
*Forma de pago:* {{paymentMethod}}
{{orderLinkLine}}`
  },
  {
    key: 'admin_to_store',
    label: 'Admin a tienda',
    description: 'Mensaje del panel admin para pedir confirmacion a la tienda.',
    defaultTemplate: `*Hola {{businessName}}, tienes un pedido por confirmar!*

*Nombres:* {{customerName}}

*Detalles de la entrega*
{{orderType}}
Referencias: {{references}}

*Detalle del pedido*
{{productsList}}

*Total* \${{total}}

¿En qué tiempo estaría listo para recoger?`
  }
]

export const WHATSAPP_TEMPLATE_DEFAULTS = WHATSAPP_TEMPLATE_DEFINITIONS.reduce<Record<string, string>>(
  (acc, definition) => {
    acc[definition.key] = definition.defaultTemplate
    return acc
  },
  {}
)

export function getDefaultWhatsAppTemplate(key: string): string {
  return WHATSAPP_TEMPLATE_DEFAULTS[key] || ''
}

export function renderWhatsAppTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = variables[key]
      return value === null || value === undefined ? '' : String(value)
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const WHATSAPP_TEMPLATE_VARIABLES: Array<{ key: string; label: string; example: string }> = [
  { key: 'businessName', label: 'Nombre del negocio', example: 'Pizza House' },
  { key: 'businessPhoneLine', label: 'Linea de telefono negocio', example: '+593999999999' },
  { key: 'customerName', label: 'Nombre del cliente', example: 'Juan Perez' },
  { key: 'customerPhone', label: 'Telefono del cliente', example: '+593999999999' },
  { key: 'deliverySection', label: 'Bloque de entrega', example: '*Detalles de la entrega*\n⚡ Inmediato\nReferencias: Frente al parque\nUbicacion: https://maps.google.com/...' },
  { key: 'pickupLine', label: 'Linea de retiro', example: '🏪 Retiro en tienda' },
  { key: 'orderType', label: 'Tipo / horario del pedido', example: '⚡ Inmediato' },
  { key: 'productsList', label: 'Listado de productos', example: '(2) Hamburguesa doble\n\n(1) Cola 500ml' },
  { key: 'subtotal', label: 'Subtotal', example: '12.50' },
  { key: 'deliveryCostLine', label: 'Linea de envio', example: 'Envío: $2.00\n' },
  { key: 'paymentDetailsBlock', label: 'Bloque de pago', example: '💵 *Cobrar:* $14.50' },
  { key: 'initialMessage', label: 'Mensaje inicial al cliente', example: 'Tu pedido está en preparación!' },
  { key: 'deliveryInfo', label: 'Direccion o retiro', example: 'Retiro en tienda' },
  { key: 'customerTotalBlock', label: 'Bloque total cliente', example: '*Total:* $14.50\n\n' },
  { key: 'paymentMethod', label: 'Forma de pago', example: 'Efectivo' },
  { key: 'orderLinkLine', label: 'Linea con URL de la orden', example: '\nVer tu orden: https://sitio.com/o/123' },
  { key: 'references', label: 'Referencias', example: 'Frente al parque central' },
  { key: 'locationLine', label: 'Linea de ubicacion', example: 'Ubicacion: https://maps.google.com/...\n\n' },
  { key: 'total', label: 'Total', example: '14.50' },
  { key: 'storeSubtotal', label: 'Subtotal tienda', example: '12.00' },
  { key: 'commissionAmount', label: 'Monto comisión', example: '2.50' }
]
