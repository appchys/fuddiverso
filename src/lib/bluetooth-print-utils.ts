import { PrintableOrder } from '@/types/order'
import { Timestamp } from 'firebase/firestore'
import logoUrl from '@/assets/logo.png'

// Common Bluetooth Printer UUIDs
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb'

// ─── Persistent Bluetooth Connection Manager (Singleton) ────────────────────
// Mantiene la conexión BLE abierta entre impresiones para evitar el diálogo
// de sincronización en cada impresión.

interface PrinterConnection {
    device: BluetoothDevice;
    server: BluetoothRemoteGATTServer;
    characteristic: BluetoothRemoteGATTCharacteristic;
}

let _connection: PrinterConnection | null = null;
let _reconnecting = false;

/**
 * Intenta reconectar a un dispositivo previamente emparejado sin mostrar el diálogo.
 * Usa navigator.bluetooth.getDevices() que recuerda los dispositivos ya autorizados.
 */
async function _tryAutoReconnect(): Promise<PrinterConnection | null> {
    if (_reconnecting) return null;
    _reconnecting = true;

    try {
        // getDevices() devuelve dispositivos que el usuario ya autorizó previamente
        if (!navigator.bluetooth?.getDevices) {
            console.warn('[BT Manager] getDevices() no soportado en este navegador');
            return null;
        }

        const devices = await navigator.bluetooth.getDevices();
        
        for (const device of devices) {
            try {
                // Verificar si el dispositivo tiene GATT disponible
                if (!device.gatt) continue;

                console.log(`[BT Manager] Intentando reconectar a: ${device.name || device.id}`);
                
                // Crear un AbortController con timeout para evitar esperas infinitas
                const abortController = new AbortController();
                const timeoutId = setTimeout(() => abortController.abort(), 8000);

                // Escuchar el evento advertisment para detectar que el dispositivo está disponible
                // y luego conectar
                try {
                    await device.watchAdvertisements({ signal: abortController.signal });
                    
                    // Esperar un momento para detectar el advertisement
                    await new Promise<void>((resolve, reject) => {
                        const onAdEvent = () => {
                            device.removeEventListener('advertisementreceived', onAdEvent);
                            resolve();
                        };
                        device.addEventListener('advertisementreceived', onAdEvent);
                        
                        // También intentar conectar directamente después de un breve delay
                        setTimeout(() => {
                            device.removeEventListener('advertisementreceived', onAdEvent);
                            resolve();
                        }, 2000);

                        abortController.signal.addEventListener('abort', () => {
                            device.removeEventListener('advertisementreceived', onAdEvent);
                            reject(new Error('Timeout'));
                        });
                    });
                } catch {
                    // watchAdvertisements puede no estar soportado, intentar conexión directa
                }

                clearTimeout(timeoutId);

                const server = await device.gatt.connect();
                const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
                const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

                const conn: PrinterConnection = { device, server, characteristic };
                _connection = conn;
                _setupDisconnectListener(device);

                console.log(`[BT Manager] Reconexión exitosa a: ${device.name || device.id}`);
                return conn;
            } catch (err) {
                console.warn(`[BT Manager] No se pudo reconectar a ${device.name || device.id}:`, err);
                continue;
            }
        }

        return null;
    } catch (err) {
        console.warn('[BT Manager] Error en auto-reconexión:', err);
        return null;
    } finally {
        _reconnecting = false;
    }
}

/**
 * Escucha desconexiones del dispositivo para limpiar la referencia.
 */
function _setupDisconnectListener(device: BluetoothDevice) {
    const onDisconnect = () => {
        console.log(`[BT Manager] Dispositivo desconectado: ${device.name || device.id}`);
        // Limpiamos la conexión pero conservamos la referencia del device
        // para poder reconectar automáticamente después.
        if (_connection?.device === device) {
            _connection = null;
        }
        device.removeEventListener('gattserverdisconnected', onDisconnect);
    };
    device.addEventListener('gattserverdisconnected', onDisconnect);
}

/**
 * Obtiene una conexión activa a la impresora Bluetooth.
 * Prioridad: conexión existente > auto-reconexión > diálogo del navegador.
 */
async function _getConnection(): Promise<PrinterConnection> {
    // 1. Reutilizar la conexión existente si sigue activa
    if (_connection && _connection.server.connected) {
        try {
            // Verificar que la characterística sigue válida
            // intentando acceder a sus propiedades
            if (_connection.characteristic.service) {
                console.log('[BT Manager] Reutilizando conexión existente');
                return _connection;
            }
        } catch {
            // La conexión está corrupta, limpiar
            _connection = null;
        }
    }

    // 2. Intentar reconectar automáticamente (sin diálogo)
    const autoConn = await _tryAutoReconnect();
    if (autoConn) {
        return autoConn;
    }

    // 3. Último recurso: mostrar el diálogo de sincronización
    console.log('[BT Manager] Solicitando dispositivo al usuario (diálogo)...');
    const device = await navigator.bluetooth.requestDevice({
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

    const conn: PrinterConnection = { device, server, characteristic };
    _connection = conn;
    _setupDisconnectListener(device);

    console.log(`[BT Manager] Conexión nueva establecida con: ${device.name || device.id}`);
    return conn;
}

/**
 * Desconecta manualmente la impresora Bluetooth.
 * Útil para liberar el recurso o cambiar de impresora.
 */
export function disconnectBluetoothPrinter() {
    if (_connection) {
        const deviceName = _connection.device.name || _connection.device.id;
        if (_connection.server.connected) {
            _connection.server.disconnect();
        }
        _connection = null;
        console.log(`[BT Manager] Desconectado manualmente de: ${deviceName}`);
    }
}

/**
 * Retorna el estado actual de la conexión Bluetooth.
 */
export function getBluetoothPrinterStatus(): {
    connected: boolean;
    deviceName: string | null;
} {
    if (_connection && _connection.server.connected) {
        return {
            connected: true,
            deviceName: _connection.device.name || _connection.device.id
        };
    }
    return { connected: false, deviceName: null };
}

// ─── Fin del Manager ────────────────────────────────────────────────────────

function getPrintableImageUrl(url: string): string {
    if (!url || !/^https?:\/\//i.test(url)) return url;

    try {
        const { hostname } = new URL(url);
        if (hostname === 'firebasestorage.googleapis.com' || hostname === 'storage.googleapis.com') {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            return `${origin}/api/image-proxy?url=${encodeURIComponent(url)}`;
        }
    } catch {
        return url;
    }

    return url;
}

export interface BluetoothPrintOptions {
    order: PrintableOrder
    businessName: string
    businessLogo?: string
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

/**
 * Converts an image URL to ESC/POS GS v 0 bitmask commands
 */
async function getImageCommands(url: string, maxWidth: number = 384): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = getPrintableImageUrl(url);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject('No se pudo obtener el contexto del canvas');

            // Resize to fit maxWidth (usually 384 for 58mm printers)
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
                height = Math.floor(height * (maxWidth / width));
                width = maxWidth;
            }
            
            // ESC/POS requires width to be a multiple of 8
            width = Math.floor(width / 8) * 8;
            
            canvas.width = width;
            canvas.height = height;
            
            // Fill with white background (important for transparent PNGs)
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;
            const bitData: number[] = [];
            
            // Convert to monochrome (1 bit per pixel)
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x += 8) {
                    let byte = 0;
                    for (let bit = 0; bit < 8; bit++) {
                        const i = ((y * width) + (x + bit)) * 4;
                        // Grayscale conversion: 0.299R + 0.587G + 0.114B
                        const brightness = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
                        // If it's dark enough, set the bit (black)
                        // Using a threshold of 180 for better clarity on thermal paper
                        if (brightness < 180) {
                            byte |= (1 << (7 - bit));
                        }
                    }
                    bitData.push(byte);
                }
            }
            
            const xL = (width / 8) % 256;
            const xH = Math.floor((width / 8) / 256);
            const yL = height % 256;
            const yH = Math.floor(height / 256);
            
            const commands = [
                0x1D, 0x76, 0x30, 0x00, // GS v 0 0
                xL, xH, yL, yH,
                ...bitData
            ];
            resolve(commands);
        };
        img.onerror = (err) => reject(`Error cargando imagen: ${err}`);
    });
}

/**
 * Converts an image URL to ESC/POS bitmask commands applying a CIRCULAR MASK.
 * The result is a square canvas where pixels outside the inscribed circle are white.
 */
async function getCircularImageCommands(url: string, size: number = 120): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = getPrintableImageUrl(url);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject('No se pudo obtener el contexto del canvas');

            // ESC/POS requires width to be a multiple of 8
            const width = Math.floor(size / 8) * 8;
            const height = width; // Keep it square so the circle is symmetric

            canvas.width = width;
            canvas.height = height;

            // 1. Fill with white background
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);

            // 2. Apply circular clip path
            const cx = width / 2;
            const cy = height / 2;
            const radius = Math.min(cx, cy) - 1; // -1 for a thin white border
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            // 3. Draw image inside the clipped circle (cover-style)
            const imgAspect = img.width / img.height;
            let drawW = width;
            let drawH = height;
            let drawX = 0;
            let drawY = 0;
            if (imgAspect > 1) {
                drawW = height * imgAspect;
                drawX = -(drawW - width) / 2;
            } else {
                drawH = width / imgAspect;
                drawY = -(drawH - height) / 2;
            }
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
            ctx.restore();

            // 4. Draw a thin circular border
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.stroke();

            // 5. Convert to monochrome ESC/POS bitmap
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;
            const bitData: number[] = [];

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x += 8) {
                    let byte = 0;
                    for (let bit = 0; bit < 8; bit++) {
                        const i = ((y * width) + (x + bit)) * 4;
                        const brightness = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
                        if (brightness < 180) {
                            byte |= (1 << (7 - bit));
                        }
                    }
                    bitData.push(byte);
                }
            }

            const xL = (width / 8) % 256;
            const xH = Math.floor((width / 8) / 256);
            const yL = height % 256;
            const yH = Math.floor(height / 256);

            const commands = [
                0x1D, 0x76, 0x30, 0x00,
                xL, xH, yL, yH,
                ...bitData
            ];
            resolve(commands);
        };
        img.onerror = (err) => reject(`Error cargando logo de tienda: ${err}`);
    });
}

export async function printOrderBluetooth({ order, businessName, businessLogo, groupItemsByProduct = true }: BluetoothPrintOptions) {
    try {
        // 1. Obtener conexión persistente (sin diálogo si ya está conectado)
        const { characteristic } = await _getConnection();

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
        
        // Header — logo circular de la tienda (si existe)
        commands.push(...ESC_POS.ALIGN_CENTER);
        if (businessLogo) {
            try {
                const bizLogoCommands = await getCircularImageCommands(businessLogo, 120);
                commands.push(...bizLogoCommands);
                commands.push(...ESC_POS.FEED_LINE);
            } catch (e) {
                console.warn('No se pudo cargar el logo de la tienda:', e);
            }
        }
        commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
        addLine(businessName.toUpperCase());
        commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
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
            commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
            addLine(dateStr);
            commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
            addLine(timeStr);
            commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
            commands.push(...ESC_POS.ALIGN_LEFT);
            addLine();
        } else {
            // Para pedidos inmediatos, usar la hora programada si existe
            const timeStr = order.timing?.scheduledTime || 
                           createdAtDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
            
            commands.push(...ESC_POS.ALIGN_RIGHT);
            addLine(`INMEDIATO`);
            commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
            addLine(timeStr);
            commands.push(...ESC_POS.TEXT_NORMAL, ...ESC_POS.TEXT_BOLD_OFF);
            commands.push(...ESC_POS.ALIGN_LEFT);
            addLine();
        }
        if (order.customer?.name) {
            commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);
            
            // Word wrap para nombre del cliente - dividir por palabras
            const nameText = order.customer.name.toUpperCase();
            const maxCharsPerLine = 12; // Aproximado para texto con doble tamaño
            const words = nameText.split(' ');
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
        } else if (order.delivery?.type === 'pickup') {
            // Mostrar mensaje para retiro en tienda con formato normal como dirección
            addLine('RETIRO EN TIENDA');
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
        
        // Helper to wrap text for Bluetooth printing
        const wrapText = (text: string, maxWidth: number): string[] => {
            const words = text.split(/\s+/);
            const lines: string[] = [];
            let currentLine = '';

            for (const word of words) {
                if (!word) continue;
                if (word.length > maxWidth) {
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = '';
                    }
                    let remaining = word;
                    while (remaining.length > maxWidth) {
                        lines.push(remaining.substring(0, maxWidth));
                        remaining = remaining.substring(maxWidth);
                    }
                    currentLine = remaining;
                } else {
                    if (currentLine.length === 0) {
                        currentLine = word;
                    } else if (currentLine.length + 1 + word.length <= maxWidth) {
                        currentLine += ' ' + word;
                    } else {
                        lines.push(currentLine);
                        currentLine = word;
                    }
                }
            }
            if (currentLine) {
                lines.push(currentLine);
            }
            return lines;
        };

        // Imprimir productos agrupados
        Array.from(groupedProducts.entries()).forEach(([productName, group]) => {
            if (!group.hasRealVariant || !groupItemsByProduct) {
                // Sin variantes (o agrupación desactivada) - imprimir líneas directamente
                group.lines.forEach(line => {
                    const qtyPrefix = line.substring(0, 4);
                    const name = line.substring(4); // Quitar cantidad
                    const wrappedNames = wrapText(name, 28);
                    wrappedNames.forEach((wrappedName, idx) => {
                        if (idx === 0) {
                            addLine(`${qtyPrefix}${wrappedName}`);
                        } else {
                            addLine(`    ${wrappedName}`);
                        }
                    });
                });
            } else {
                // Con variantes y agrupación activa - primero el nombre del producto, luego las variantes
                const wrappedProductNames = wrapText(productName, 32);
                commands.push(...ESC_POS.TEXT_BOLD_ON);
                wrappedProductNames.forEach(wrappedName => {
                    addLine(wrappedName);
                });
                commands.push(...ESC_POS.TEXT_BOLD_OFF);
                
                group.lines.forEach(line => {
                    const qtyPrefix = line.substring(0, 4);
                    const name = line.substring(4); // Quitar cantidad
                    const wrappedNames = wrapText(name, 28);
                    wrappedNames.forEach((wrappedName, idx) => {
                        if (idx === 0) {
                            addLine(`${qtyPrefix}${wrappedName}`);
                        } else {
                            addLine(`    ${wrappedName}`);
                        }
                    });
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

        try {
            addLine();
            const fuddiLogoCommands = await getImageCommands((logoUrl as any).src || logoUrl, 120);
            commands.push(...ESC_POS.ALIGN_CENTER);
            commands.push(...fuddiLogoCommands);
            commands.push(...ESC_POS.FEED_LINE);
            commands.push(...ESC_POS.ALIGN_LEFT);
        } catch (e) {
            console.warn('No se pudo cargar el logo para la impresion:', e);
        }
        
        if (order.notaImageUrl) {
            try {
                addLine();
                addLine('.'.repeat(32));
                commands.push(...ESC_POS.ALIGN_CENTER);
                const noteImageCommands = await getImageCommands(order.notaImageUrl, 384);
                commands.push(...noteImageCommands);
                commands.push(...ESC_POS.FEED_LINE);
                commands.push(...ESC_POS.ALIGN_LEFT);
            } catch (e) {
                console.warn('No se pudo cargar la imagen de la nota para la impresion:', e);
            }
        }

        if (order.notas && order.notas.trim() !== '') {
            addLine();
            addLine('.'.repeat(32));
            commands.push(...ESC_POS.ALIGN_CENTER);
            commands.push(...ESC_POS.TEXT_DOUBLE_HEIGHT, ...ESC_POS.TEXT_DOUBLE_WIDTH, ...ESC_POS.TEXT_BOLD_ON);

            const noteText = order.notas.toUpperCase();
            const maxCharsPerLine = 18;
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
            addLine();
        }

        addLine(); // Extra space for tearing

        // Espacio extra para evitar corte en impresora
        addLine();
        addLine();
        addLine();

        // 3. Send in Chunks
        const data = new Uint8Array(commands);
        const chunkSize = 20; // Safe for most BLE devices
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            await characteristic.writeValue(chunk);
        }

        console.log('[BT Manager] Impresión Bluetooth completada');
        return true;
    } catch (error) {
        console.error('[BT Manager] Error en printOrderBluetooth:', error);
        // Si falló durante la impresión, invalidar la conexión cacheada
        // para que el siguiente intento reconecte o muestre el diálogo
        _connection = null;
        throw error;
    }
    // NOTA: Ya NO desconectamos en el finally.
    // La conexión queda abierta para la siguiente impresión.
}
