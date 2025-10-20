import type { PrintableOrder } from '@/types/order'
import { Timestamp } from 'firebase/firestore'

declare global {
  interface Navigator {
    serial: Serial;
  }

  interface Serial {
    requestPort(): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
  }
  
  interface SerialPort {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    writable: WritableStream;
  }
}

export interface PrintOrderOptions {
  order: PrintableOrder
  businessName: string
  businessLogo?: string
}

export async function printOrder({ order, businessName, businessLogo }: PrintOrderOptions) {
  try {
    // Import dinámico del bundle ESM en tiempo de ejecución (solo en cliente)
  // Importar el nuevo paquete
  const { default: ThermalPrinter } = await import('@point-of-sale/receipt-printer-encoder')
  
  // Crear instancia del impresor
  const printer = new ThermalPrinter({
    language: 'esc-pos',
    width: 42,
    characterTable: ['CP437']
  })

    // Inicializar y centrar
    printer.initialize()
    printer.align('center')
    printer.bold(true)

    // Logo si existe: por simplicidad imprimimos la URL/placeholder (render de imágenes requiere ImageData)
    if (businessLogo) {
      try {
        // Imprimir una línea indicando que hay logo (evita manejo complejo de ImageData en el browser)
        printer.text('[LOGO]')
        printer.newline()
      } catch (e) {
        console.error('Error loading logo (ignored):', e)
      }
    }

    // Nombre del negocio
    printer.size(2, 2)
    printer.text(businessName)
    printer.newline()
    printer.size(1, 1)
    printer.bold(false)
    printer.align('left')
    printer.newline()

    // Tipo de envío y ubicación
    printer.bold(true)
    printer.text(order.delivery?.type === 'delivery' ? 'DELIVERY' : 'RETIRO EN TIENDA')
    printer.newline()
    printer.bold(false)

    if (order.delivery?.type === 'delivery' && order.delivery.references) {
      printer.text('Ubicación de entrega:')
      printer.newline()
      printer.text(order.delivery.references)
      printer.newline()
    }

    printer.newline()

    // Fecha y hora de entrega
    const timestamp = order.timing?.scheduledDate || order.createdAt
    const orderDateTime = timestamp instanceof Timestamp ? timestamp.toDate() : new Date(timestamp)
    
    printer.text('Fecha y hora de entrega:')
    printer.newline()
    printer.text(orderDateTime.toLocaleString('es-EC', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }))
    printer.newline()

    // Detalle del pedido
    printer.bold(true)
    printer.text('DETALLE DEL PEDIDO')
    printer.newline()
    printer.bold(false)

    // Productos
    order.items?.forEach((item: { quantity: number; variant?: string; name?: string; product?: { name: string } }) => {
      printer.text(`${item.quantity} x ${item.variant || item.name || item.product?.name || 'Producto'}`)
      printer.newline()
    })

    printer.newline()

    // Subtotal y envío
    const subtotal = order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0)
    
    // Subtotal y envío
    printer.text('Subtotal:')
    printer.text(` $${subtotal.toFixed(2)}`)
    printer.newline()

    if (order.delivery?.type === 'delivery') {
      printer.text('Envío:')
      printer.text(` $${(order.delivery?.deliveryCost || 0).toFixed(2)}`)
      printer.newline()
    }

    // Total
    printer.bold(true)
    printer.text('Total:')
    printer.text(` $${order.total.toFixed(2)}`)
    printer.newline()
    printer.bold(false)
    printer.newline()

    // Forma de pago
    const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : 
                         order.payment?.method === 'transfer' ? 'Transferencia' : 
                         order.payment?.method === 'mixed' ? 'Pago Mixto' : 
                         'Sin especificar'

    printer.text('Forma de pago:')
    printer.newline()
    printer.bold(true)
    printer.text(paymentMethod)
    printer.newline()
    printer.bold(false)
    printer.cut()

    // Obtener los datos codificados
    const result = printer.encode()

    // Enviar a la impresora usando la Web Serial API
    try {
      // Verificar si el navegador soporta Serial API
      if (!navigator.serial) {
        throw new Error('Este navegador no soporta la API Serial. Por favor usa Chrome, Edge u Opera.')
      }
      
      // Solicitar puerto serie
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 9600 })

      // Crear writer
      const writer = port.writable.getWriter()

      // Enviar datos
      await writer.write(result)

      // Liberar writer
      writer.releaseLock()

      // Cerrar puerto
      await port.close()

      return true
    } catch (error) {
      console.error('Error printing:', error)
      throw new Error('Error al imprimir. Verifica que la impresora esté conectada.')
    }
  } catch (error) {
    console.error('Error preparing print:', error)
    throw error
  }
}