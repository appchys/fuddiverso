import type { PrintableOrder } from '@/types/order'
import { Timestamp } from 'firebase/firestore'
import logoUrl from '@/assets/logo.png'

export interface PrintOrderOptions {
  order: PrintableOrder
  businessName: string
  businessLogo?: string
  groupItemsByProduct?: boolean
}

export async function printOrder({ order, businessName, businessLogo, groupItemsByProduct = true }: PrintOrderOptions) {
  return new Promise((resolve, reject) => {
    try {
      // Crear un elemento HTML temporal para la impresión
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('No se pudo abrir la ventana de impresión. Por favor, desbloquea las ventanas emergentes para este sitio.');
      }

      // Formatear Fecha y Hora de creación
      const createdAtDate = order.createdAt instanceof Timestamp ? order.createdAt.toDate() : new Date(order.createdAt);

      // Calcular subtotal
      const subtotal = order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0);
      
      // Forma de pago
      const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : 
                          order.payment?.method === 'transfer' ? 'Transferencia' : 
                          order.payment?.method === 'mixed' ? 'Pago Mixto' : 
                          'Sin especificar';

      // Valor pendiente de cobrar
      let pendingAmount = 0;
      if (order.payment?.method === 'cash') {
          pendingAmount = order.total;
      } else if (order.payment?.method === 'mixed') {
          pendingAmount = (order.payment as any)?.cashAmount || 0;
      }

      // Agrupar productos
      const groupedProducts = new Map<string, { hasRealVariant: boolean; items: any[] }>();
      order.items?.forEach(item => {
          const productName = item.product?.name || item.name || 'Producto';
          const variantName = item.variant || item.name || productName;
          const hasRealVariant = Boolean(
              item.variant ||
              (item.product?.name && variantName !== productName)
          );
          
          const existingGroup = groupedProducts.get(productName) || { hasRealVariant: false, items: [] };
          if (hasRealVariant) existingGroup.hasRealVariant = true;
          existingGroup.items.push(item);
          groupedProducts.set(productName, existingGroup);
      });

      // Crear el contenido HTML para la impresión
      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Ticket ${order.id}</title>
          <meta charset="utf-8">
          <style>
            @page { margin: 0; }
            body { 
              font-family: 'Courier New', Courier, monospace; 
              width: 72mm; 
              margin: 0 auto; 
              padding: 5mm;
              font-size: 13px;
              line-height: 1.2;
              color: #000;
              background: #fff;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .text-bold { font-weight: bold; }
            .text-large { font-size: 1.5em; }
            .text-xl { font-size: 1.8em; }
            
            .header { margin-bottom: 5mm; }
            .business-name { font-size: 1.4em; font-weight: bold; text-transform: uppercase; margin-bottom: 2mm; }
            
            .info-row { display: flex; justify-content: space-between; margin-bottom: 1mm; }
            .divider { border-top: 1px dashed #000; margin: 3mm 0; }
            
            .items-table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
            .items-table th { text-align: left; border-bottom: 1px dashed #000; padding-bottom: 1mm; }
            .items-table td { vertical-align: top; padding: 1mm 0; }
            
            .totals-container { margin-top: 3mm; }
            .total-line { display: flex; justify-content: flex-end; gap: 5mm; margin-bottom: 1mm; }
            
            .notes-box {
              border: 1px dashed #000;
              padding: 3mm;
              margin: 5mm 0;
              text-transform: uppercase;
              font-weight: bold;
              text-align: center;
              font-size: 1.4em;
            }
            
            .footer { margin-top: 5mm; }
            .logo-fuddi { width: 24mm; margin: 2mm auto; display: block; filter: grayscale(1); }
          </style>
        </head>
        <body>
          <div class="header text-center">
            ${businessLogo ? `<img src="${businessLogo}" alt="Logo" style="width: 20mm; height: 20mm; object-fit: cover; border-radius: 50%; margin-bottom: 2mm;">` : ''}
            <div class="business-name">${businessName}</div>
          </div>

          <div class="info-section">
            <div class="text-right">
              ${order.timing?.type === 'scheduled' ? `
                <div class="text-bold">PROGRAMADO</div>
                <div class="text-large text-bold">
                  ${(() => {
                    let schedDate: Date;
                    if (order.timing?.scheduledDate) {
                        if (order.timing.scheduledDate instanceof Timestamp) {
                            schedDate = order.timing.scheduledDate.toDate();
                        } else if (typeof order.timing.scheduledDate === 'object' && 'seconds' in order.timing.scheduledDate) {
                            schedDate = new Date((order.timing.scheduledDate as any).seconds * 1000);
                        } else {
                            schedDate = new Date(order.timing.scheduledDate as any);
                        }
                    } else {
                        schedDate = createdAtDate;
                    }
                    const dateStr = schedDate.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
                    const timeStr = order.timing?.scheduledTime || schedDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
                    return `${dateStr} - ${timeStr}`;
                  })()}
                </div>
              ` : `
                <div class="text-bold">INMEDIATO</div>
                <div class="text-xl text-bold">
                  ${order.timing?.scheduledTime || createdAtDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}
                </div>
              `}
            </div>

            ${order.customer?.name ? `
              <div class="text-xl text-bold" style="text-transform: uppercase; margin-top: 3mm;">
                ${order.customer.name}
              </div>
            ` : ''}

            <div style="margin-top: 2mm;">
              ${order.delivery?.type === 'delivery' ? `
                <div class="text-bold">DOMICILIO</div>
                <div>${order.delivery.references || ''}</div>
              ` : `
                <div class="text-bold">RETIRO EN TIENDA</div>
              `}
            </div>
          </div>

          <div class="divider"></div>

          <div class="items-section">
            <table class="items-table">
              <thead>
                <tr>
                  <th style="width: 10mm;">Cant</th>
                  <th>Producto</th>
                </tr>
              </thead>
              <tbody>
                ${Array.from(groupedProducts.entries()).map(([productName, group]) => {
                  if (!group.hasRealVariant || !groupItemsByProduct) {
                    return group.items.map(item => `
                      <tr>
                        <td>${item.quantity}</td>
                        <td>${item.variant || item.name || productName}</td>
                      </tr>
                    `).join('');
                  } else {
                    return `
                      <tr>
                        <td colspan="2" class="text-bold">${productName}</td>
                      </tr>
                      ${group.items.map(item => `
                        <tr>
                          <td style="padding-left: 2mm;">${item.quantity}</td>
                          <td>${item.variant || item.name}</td>
                        </tr>
                      `).join('')}
                    `;
                  }
                }).join('')}
              </tbody>
            </table>
          </div>

          <div class="divider"></div>

          <div class="totals-container">
            <div class="total-line">
              <span>Subtotal:</span>
              <span class="text-bold">$${subtotal.toFixed(2)}</span>
            </div>
            ${order.delivery?.type === 'delivery' ? `
              <div class="total-line">
                <span>Envio:</span>
                <span class="text-bold">$${(order.delivery?.deliveryCost || 0).toFixed(2)}</span>
              </div>
            ` : ''}
            <div class="total-line text-large">
              <span>TOTAL:</span>
              <span class="text-bold">$${order.total.toFixed(2)}</span>
            </div>
          </div>

          <div style="margin-top: 3mm;">
            Pago: <span class="text-bold">${paymentMethod}</span>
          </div>

          ${pendingAmount > 0 ? `
            <div class="text-right" style="margin-top: 2mm;">
              <div class="text-bold">PENDIENTE DE COBRO</div>
              <div class="text-xl text-bold">$${pendingAmount.toFixed(2)}</div>
            </div>
          ` : ''}

          ${(order.notas && order.notas.trim() !== '') ? `
            <div class="notes-box">
              ${order.notas}
            </div>
          ` : ''}

          <div class="footer text-center">
            <div class="divider"></div>
            <img src="${(logoUrl as any).src || logoUrl}" class="logo-fuddi" alt="Fuddi">
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
                setTimeout(function() {
                  window.close();
                }, 500);
              }, 500);
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