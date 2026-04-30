import type { PrintableOrder } from '@/types/order'
import { Timestamp } from 'firebase/firestore'

export interface PrintOrderOptions {
  order: PrintableOrder
  businessName: string
  businessLogo?: string
}

export async function printOrder({ order, businessName, businessLogo }: PrintOrderOptions) {
  return new Promise((resolve, reject) => {
    try {
      // Crear un elemento HTML temporal para la impresión
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('No se pudo abrir la ventana de impresión. Por favor, desbloquea las ventanas emergentes para este sitio.');
      }

      // Formatear la fecha
      const timestamp = order.timing?.scheduledDate || order.createdAt;
      const orderDateTime = timestamp instanceof Timestamp ? timestamp.toDate() : new Date(timestamp);
      const formattedDate = orderDateTime.toLocaleString('es-EC', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      // Calcular subtotal
      const subtotal = order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0);
      
      // Forma de pago
      const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : 
                          order.payment?.method === 'transfer' ? 'Transferencia' : 
                          order.payment?.method === 'mixed' ? 'Pago Mixto' : 
                          'Sin especificar';

      // Crear el contenido HTML para la impresión
      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Comprobante de Pedido</title>
          <meta charset="utf-8">
          <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;700&display=swap" rel="stylesheet">
          <style>
            @page { margin: 0; }
            body { 
              font-family: 'Quicksand', sans-serif; 
              width: 80mm; 
              margin: 0 auto; 
              padding: 10px;
              font-size: 14px;
              line-height: 1.4;
              color: #333;
            }
            .header { text-align: center; margin-bottom: 10px; }
            .business-name { font-size: 20px; font-weight: bold; margin: 10px 0; color: #000; }
            .section { margin: 15px 0; }
            .section-title { font-weight: bold; border-bottom: 2px solid #eee; margin-bottom: 8px; padding-bottom: 3px; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
            .items { width: 100%; border-collapse: collapse; margin: 10px 0; }
            .items th { text-align: left; border-bottom: 1px solid #eee; padding-bottom: 5px; font-size: 12px; }
            .items td { padding: 6px 0; border-bottom: 1px solid #f9f9f9; }
            .total { font-weight: bold; font-size: 18px; margin-top: 10px; color: #000; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .divider { border-top: 1px dashed #ddd; margin: 15px 0; }
            .notes-container {
              background-color: #fdf2f2; 
              padding: 12px; 
              border: 1px dashed #f87171; 
              border-radius: 10px;
              margin: 15px 0;
            }
          </style>
        </head>
        <body>
          <div class="header">
            ${businessLogo ? `<img src="${businessLogo}" alt="Logo" style="max-width: 100%; max-height: 80px;">` : ''}
            <div class="business-name">${businessName}</div>
            <div>${order.delivery?.type === 'delivery' ? 'DELIVERY' : 'RETIRO EN TIENDA'}</div>
          </div>

          <div class="section">
            <div class="section-title">Información del Pedido</div>
            <div>Fecha: ${formattedDate}</div>
            ${order.delivery?.type === 'delivery' && order.delivery.references ? `
              <div>Dirección: ${order.delivery.references}</div>
            ` : ''}
          </div>

          <div class="section">
            <div class="section-title">Detalle del Pedido</div>
            <table class="items">
              <thead>
                <tr>
                  <th>Cant.</th>
                  <th>Producto</th>
                </tr>
              </thead>
              <tbody>
                ${order.items?.map(item => `
                  <tr>
                    <td>${item.quantity} x</td>
                    <td>${item.variant || item.name || item.product?.name || 'Producto'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="divider"></div>

          <div class="section">
            <div>Subtotal: $${subtotal.toFixed(2)}</div>
            ${order.delivery?.type === 'delivery' ? `
              <div>Envío: $${(order.delivery?.deliveryCost || 0).toFixed(2)}</div>
            ` : ''}
            <div class="total">Total: $${order.total.toFixed(2)}</div>
          </div>

          <div class="section">
            <div>Forma de pago: <strong>${paymentMethod}</strong></div>
          </div>

          ${(order.notas && order.notas.trim() !== '') ? `
            <div class="divider"></div>
            <div class="notes-container">
              <div style="font-weight: bold; font-size: 14px; text-transform: uppercase; margin-bottom: 5px; color: #b91c1c;">
                <i class="bi bi-chat-heart"></i> Mensaje / Notas:
              </div>
              <div style="font-size: 16px; line-height: 1.5; color: #000;">${order.notas}</div>
            </div>
          ` : ''}

          <div class="section text-center">
            <div>¡Gracias por su compra!</div>
            <div>${new Date().getFullYear()} - ${businessName}</div>
          </div>

          <script>
            // Cerrar la ventana después de imprimir
            window.onload = function() {
              setTimeout(function() {
                window.print();
                setTimeout(function() {
                  window.close();
                }, 100);
              }, 200);
            };
          </script>
        </body>
        </html>
      `;

      // Escribir el contenido en la nueva ventana
      printWindow.document.open();
      printWindow.document.write(printContent);
      printWindow.document.close();
      
      // Resolver la promesa cuando se cierre la ventana
      printWindow.addEventListener('afterprint', () => {
        printWindow.close();
        resolve(true);
      });

    } catch (error) {
      console.error('Error al generar el comprobante:', error);
      reject(new Error('Error al generar el comprobante de impresión'));
    }
  });
}