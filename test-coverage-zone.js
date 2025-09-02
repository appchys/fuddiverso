/**
 * Script de prueba para crear una zona de cobertura de ejemplo
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// Configura tu Firebase Admin SDK
const serviceAccount = require('./multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function createTestZone() {
  try {
    console.log('🧪 Creando zona de cobertura de prueba...');
    
    const testZone = {
      name: 'Zona Centro - Prueba',
      businessId: null,
      polygon: [
        { lat: -2.1709979, lng: -79.9224426 },
        { lat: -2.1800000, lng: -79.9224426 },
        { lat: -2.1800000, lng: -79.9300000 },
        { lat: -2.1709979, lng: -79.9300000 }
      ],
      deliveryFee: 2.50,
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    
    const docRef = await db.collection('coverageZones').add(testZone);
    console.log(`✅ Zona de prueba creada con ID: ${docRef.id}`);
    
    // Verificar que se puede leer correctamente
    const doc = await docRef.get();
    const data = doc.data();
    
    console.log('📄 Datos guardados:');
    console.log('- Nombre:', data.name);
    console.log('- Tarifa:', data.deliveryFee);
    console.log('- Activa:', data.isActive);
    console.log('- Polígono puntos:', data.polygon.length);
    console.log('- Creado:', data.createdAt.toDate());
    console.log('- Actualizado:', data.updatedAt.toDate());
    
    console.log('🎉 Prueba completada exitosamente');
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error);
  }
}

createTestZone().then(() => process.exit(0));
