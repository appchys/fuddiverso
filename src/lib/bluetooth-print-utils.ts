import { PrintableOrder } from '@/types/order'
import { Timestamp } from 'firebase/firestore'

// Common Bluetooth Printer UUIDs
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'

export interface BluetoothPrintOptions {
    order: PrintableOrder
    businessName: string
    groupItemsByProduct?: boolean
}

/**
 * ESC/POS Commands
 */
const ESC_POS = {
    INIT: [0x1B, 0x40],
    ALIGN_LEFT: [0x1B, 0x61, 0x00],
    ALIGN_CENTER: [0x1B, 0x61, 0x01],
    ALIGN_RIGHT: [0x1B, 0x61, 0x02],
    TEXT_NORMAL: [0x1D, 0x21, 0x00],
    TEXT_DOUBLE_HEIGHT: [0x1D, 0x21, 0x01],
    TEXT_DOUBLE_WIDTH: [0x1D, 0x21, 0x10],
    TEXT_DOUBLE_SIZE: [0x1D, 0x21, 0x11],
    TEXT_BOLD_ON: [0x1B, 0x45, 0x01],
    TEXT_BOLD_OFF: [0x1B, 0x45, 0x00],
    PAPER_CUT: [0x1D, 0x56, 0x41, 0x03],
    FEED_LINE: [0x0A],
}

export async function printOrderBluetooth({ order, businessName, groupItemsByProduct = true }: BluetoothPrintOptions) {
    let device: BluetoothDevice | null = null;
    try {
        // 1. Request Device
        device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [PRINTER_SERVICE_UUID] },
                { namePrefix: 'MPT' },
                { namePrefix: 'Bluetooth' }
            ],
            optionalServices: [PRINTER_SERVICE_UUID]
        });

        const server = await device.gatt?.connect();
        if (!server) throw new Error('No se pudo conectar al servidor GATT');

        const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

        // 2. Prepare Data
        const commands: number[] = [];
        
        // Helper to add text
        const addText = (text: string) => {
            // Mapping for Spanish characters to CP437 (common in thermal printers)
            const map: { [key: string]: number } = {
                'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
                'ñ': 0xA4, 'Ñ': 0xA5, '¿': 0xA8, '¡': 0xAD,
                'Á': 0x41, 'É': 0x45, 'Í': 0x49, 'Ó': 0x4F, 'Ú': 0x55 // Fallback to non-accented for uppercase
            };
            
            const bytes = new Uint8Array(text.length);
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                bytes[i] = map[char] || char.charCodeAt(0);
            }
            commands.push(...Array.from(bytes));
        };

        const addLine = (text: string = '') => {
            addText(text);
            commands.push(...ESC_POS.FEED_LINE);
        };

        // Format Timing and Print Info
        const createdAtDate = order.createdAt instanceof Timestamp ? order.createdAt.toDate() : new Date(order.createdAt);
        const formattedCreated = createdAtDate.toLocaleString('es-EC', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        // Start Commands
        commands.push(...ESC_POS.INIT);
        
        // Header
        commands.push(...ESC_POS.ALIGN_CENTER);
        commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_BOLD_ON);
        addLine(businessName.toUpperCase());
        commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
        addLine(order.delivery?.type === 'delivery' ? '--- DELIVERY ---' : '--- RETIRO ---');
        addLine();

        // Info
        commands.push(...ESC_POS.ALIGN_LEFT);
        
        if (order.timing?.type === 'scheduled') {
            let schedDate: Date;
            
            // Intentar convertir scheduledDate (puede ser Timestamp, objeto con seconds, o string)
            if (order.timing.scheduledDate) {
                if (order.timing.scheduledDate instanceof Timestamp) {
                    schedDate = order.timing.scheduledDate.toDate();
                } else if (typeof order.timing.scheduledDate === 'object' && 'seconds' in order.timing.scheduledDate) {
                    // Timestamp de Firebase como objeto plano
                    schedDate = new Date((order.timing.scheduledDate as any).seconds * 1000);
                } else if (typeof order.timing.scheduledDate === 'string') {
                    schedDate = new Date(order.timing.scheduledDate);
                } else {
                    schedDate = new Date(order.timing.scheduledDate);
                }
            } else {
                // Fallback a createdAt
                schedDate = order.createdAt instanceof Timestamp ? order.createdAt.toDate() : new Date(order.createdAt);
            }
            
            const dateStr = schedDate.toLocaleDateString('es-EC', { day: 'numeric', month: 'long' });
            const timeStr = order.timing.scheduledTime || schedDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
            
            commands.push(...ESC_POS.ALIGN_RIGHT);
            addLine(`PROGRAMADO`);
            addLine(`${dateStr} - ${timeStr}`);
            commands.push(...ESC_POS.ALIGN_LEFT);
            addLine();
        } else {
            addLine(`Pedido: INMEDIATO`);
            addLine(`Fecha:  ${formattedCreated}`);
        }
        if (order.customer?.name) {
            commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
            addLine(order.customer.name.toUpperCase());
            commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
        }
        if (order.delivery?.type === 'delivery' && order.delivery.references) {
            // Word wrap para dirección - dividir por palabras
            const addressText = order.delivery.references;
            const maxCharsPerLine = 28; // Aproximado para dirección normal
            const words = addressText.split(' ');
            let firstLine = true;
            let currentLine = '';
            
            words.forEach(word => {
                if (currentLine.length === 0) {
                    currentLine = word;
                } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
                    currentLine += ' ' + word;
                } else {
                    addLine(firstLine ? currentLine : `    ${currentLine}`);
                    currentLine = word;
                    firstLine = false;
                }
            });
            
            if (currentLine.length > 0) {
                addLine(firstLine ? currentLine : `    ${currentLine}`);
            }
        }
        addLine('.'.repeat(32));

        // Items - Agrupados por producto
        commands.push(...ESC_POS.TEXT_BOLD_ON);
        addLine('Cant. Producto');
        commands.push(...ESC_POS.TEXT_BOLD_OFF);
        
        // Agrupar productos como en WhatsAppUtils
        const groupedProducts = new Map<string, { hasRealVariant: boolean; lines: string[] }>();
        
        order.items?.forEach(item => {
            const productName = item.product?.name || item.name || 'Producto';
            const variantName = item.variant || item.name || productName;
            const hasRealVariant = Boolean(
                item.variant ||
                (item.product?.name && variantName !== productName)
            );
            
            const existingGroup = groupedProducts.get(productName) || { hasRealVariant: false, lines: [] };
            
            if (hasRealVariant) {
                existingGroup.hasRealVariant = true;
                existingGroup.lines.push(`${(item.quantity || 1).toString().padEnd(4)}${variantName}`);
            } else {
                existingGroup.lines.push(`${(item.quantity || 1).toString().padEnd(4)}${productName}`);
            }
            
            groupedProducts.set(productName, existingGroup);
        });
        
        // Imprimir productos agrupados
        Array.from(groupedProducts.entries()).forEach(([productName, group]) => {
            if (!group.hasRealVariant || !groupItemsByProduct) {
                // Sin variantes (o agrupación desactivada) - imprimir líneas directamente
                group.lines.forEach(line => {
                    let name = line.substring(4); // Quitar cantidad
                    // Cortar nombre si es muy largo
                    const maxNameLength = 28;
                    if (name.length > maxNameLength) {
                        name = name.substring(0, maxNameLength);
                    }
                    addLine(`${line.substring(0, 4)}${name}`);
                });
            } else {
                // Con variantes y agrupación activa - primero el nombre del producto, luego las variantes
                let displayProductName = productName;
                const maxNameLength = 32; // Sin cantidad, puede usar más espacio
                if (displayProductName.length > maxNameLength) {
                    displayProductName = displayProductName.substring(0, maxNameLength);
                }
                commands.push(...ESC_POS.TEXT_BOLD_ON);
                addLine(displayProductName);
                commands.push(...ESC_POS.TEXT_BOLD_OFF);
                
                group.lines.forEach(line => {
                    let name = line.substring(4); // Quitar cantidad
                    const maxNameLength = 28;
                    if (name.length > maxNameLength) {
                        name = name.substring(0, maxNameLength);
                    }
                    addLine(`${line.substring(0, 4)}${name}`);
                });
            }
        });
        addLine('.'.repeat(32));

        // Totals
        const subtotal = order.total - (order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0);
        addLine(`Subtotal:      $${subtotal.toFixed(2).padStart(8)}`);
        if (order.delivery?.type === 'delivery') {
            addLine(`Envio:         $${(order.delivery?.deliveryCost || 0).toFixed(2).padStart(8)}`);
        }
        commands.push(...ESC_POS.TEXT_BOLD_ON);
        addLine(`TOTAL:         $${order.total.toFixed(2).padStart(8)}`);
        commands.push(...ESC_POS.TEXT_BOLD_OFF);
        
        const paymentMethod = order.payment?.method === 'cash' ? 'Efectivo' : 
                            order.payment?.method === 'transfer' ? 'Transferencia' : 
                            order.payment?.method === 'mixed' ? 'Pago Mixto' : 
                            'Sin especificar';
        addLine(`Pago: ${paymentMethod}`);
        
        // Valor pendiente de cobrar
        let pendingAmount = 0;
        if (order.payment?.method === 'cash') {
            pendingAmount = order.total;
        } else if (order.payment?.method === 'mixed') {
            pendingAmount = (order.payment as any)?.cashAmount || 0;
        }
        // Si es transferencia, pendingAmount = 0
        
        if (pendingAmount > 0) {
            addLine(`Pendiente de cobro`);
            commands.push(...ESC_POS.ALIGN_RIGHT, ...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
            addLine(`$${pendingAmount.toFixed(2)}`);
            commands.push(...ESC_POS.ALIGN_LEFT, ...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
        }
        
        if (order.notas && order.notas.trim() !== '') {
            addLine();
            addLine('.'.repeat(32));
            commands.push(...ESC_POS.ALIGN_CENTER);
            commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
            
            // Word wrap para notas - dividir por palabras
            const noteText = order.notas.toUpperCase();
            const maxCharsPerLine = 18; // Aproximado para texto grande centrado
            const words = noteText.split(' ');
            let currentLine = '';
            
            words.forEach(word => {
                if (currentLine.length === 0) {
                    currentLine = word;
                } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
                    currentLine += ' ' + word;
                } else {
                    addLine(currentLine);
                    currentLine = word;
                }
            });
            
            if (currentLine.length > 0) {
                addLine(currentLine);
            }
            
            commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
            addLine(); // Espacio extra después de notas
        }
        
        addLine();
        addLine(); // Extra space for tearing

        // 3. Send in Chunks
        const data = new Uint8Array(commands);
        const chunkSize = 20; // Safe for most BLE devices
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            await characteristic.writeValue(chunk);
        }

        console.log('Impression Bluetooth completada');
        return true;
    } catch (error) {
        console.error('Error en printOrderBluetooth:', error);
        throw error;
    } finally {
        if (device && device.gatt?.connected) {
            device.gatt.disconnect();
        }
    }
}
