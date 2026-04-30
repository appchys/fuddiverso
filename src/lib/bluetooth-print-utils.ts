import { PrintableOrder } from '@/types/order'
import { Timestamp } from 'firebase/firestore'

// Common Bluetooth Printer UUIDs
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'

export interface BluetoothPrintOptions {
    order: PrintableOrder
    businessName: string
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
    TEXT_BOLD_ON: [0x1B, 0x45, 0x01],
    TEXT_BOLD_OFF: [0x1B, 0x45, 0x00],
    PAPER_CUT: [0x1D, 0x56, 0x41, 0x03],
    FEED_LINE: [0x0A],
}

export async function printOrderBluetooth({ order, businessName }: BluetoothPrintOptions) {
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

        // Format Date
        const timestamp = order.timing?.scheduledDate || order.createdAt;
        const orderDateTime = timestamp instanceof Timestamp ? timestamp.toDate() : new Date(timestamp);
        const formattedDate = orderDateTime.toLocaleString('es-EC', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
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
        addLine(`Fecha: ${formattedDate}`);
        if (order.customer?.name) addLine(`Cliente: ${order.customer.name}`);
        if (order.customer?.phone) addLine(`Telf: ${order.customer.phone}`);
        if (order.delivery?.type === 'delivery' && order.delivery.references) {
            addLine(`Dir: ${order.delivery.references}`);
        }
        addLine('-'.repeat(32));

        // Items
        commands.push(...ESC_POS.TEXT_BOLD_ON);
        addLine('Cant. Producto');
        commands.push(...ESC_POS.TEXT_BOLD_OFF);
        
        order.items?.forEach(item => {
            const qty = (item.quantity || 1).toString().padEnd(4);
            const name = item.variant || item.name || item.product?.name || 'Prod';
            // We split name if too long for 58mm (approx 32 chars)
            addLine(`${qty} ${name}`);
            if (item.notes) {
                addLine(`   * ${item.notes}`);
            }
        });
        addLine('-'.repeat(32));

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
        addLine();
        
        commands.push(...ESC_POS.ALIGN_CENTER);
        addLine('Gracias por su compra!');
        addLine();
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
