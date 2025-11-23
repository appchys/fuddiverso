/**
 * Script de prueba para Cloud Functions
 * Simula la creación de una orden para probar el envío de emails
 * 
 * Uso: node test-email.js
 */

const admin = require('firebase-admin');

// Inicializar Firebase Admin
const serviceAccountPath = '../multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json';
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'multitienda-69778'
});

const db = admin.firestore();

async function testOrderEmail() {
  try {
    console.log('🧪 Creando orden de prueba...\n');

    // Crear una orden de prueba
    const testOrder = {
      businessId: '0FeNtdYThoTRMPJ6qaS7', // Reemplaza con tu businessId real
      customer: {
        id: 'client_123',
        name: 'Juan Pérez',
        phone: '0912345678'
      },
      items: [
        {
          name: 'Wantancitos BBQ',
          price: 5.50,
          quantity: 2,
          variant: '30 wantancitos'
        },
        {
          name: 'Bebida',
          price: 2.00,
          quantity: 1,
          variant: 'Coca Cola'
        }
      ],
      delivery: {
        type: 'delivery',
        references: 'Calle Principal 123, Apto 4B',
        latlong: '-0.3566,78.5249',
        deliveryCost: 2.50
      },
      timing: {
        type: 'immediate'
      },
      payment: {
        method: 'cash',
        paymentStatus: 'pending'
      },
      subtotal: 13.00,
      total: 15.50,
      status: 'pending',
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    // Agregar documento a Firestore
    const docRef = await db.collection('orders').add(testOrder);
    console.log(`✅ Orden creada con ID: ${docRef.id}`);
    console.log('\n📧 La función sendOrderEmail debería dispararse automáticamente.');
    console.log('📝 Revisa los logs: firebase functions:log\n');

    // Mostrar detalles de la orden
    console.log('Detalles de la orden de prueba:');
    console.log(JSON.stringify(testOrder, null, 2));

    console.log('\n⏳ Esperando 5 segundos antes de salir...\n');
    setTimeout(() => {
      process.exit(0);
    }, 5000);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testOrderEmail();
