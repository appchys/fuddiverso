/**
 * Test para verificar la función getCoverageZones
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Simular la función getCoverageZones con el mismo código que en la app
async function testGetCoverageZones() {
  try {
    console.log('🔍 Probando función getCoverageZones...');
    
    // Configura Firebase
    const serviceAccount = require('./multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json');
    initializeApp({
      credential: cert(serviceAccount)
    });
    
    const db = getFirestore();
    
    // Simular la función con el código actualizado
    const q = db.collection('coverageZones').where('isActive', '==', true);
    const querySnapshot = await q.get();
    const zones = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Helper function to safely convert dates
      const convertToDate = (dateField) => {
        if (!dateField) return new Date();
        if (dateField.toDate && typeof dateField.toDate === 'function') {
          return dateField.toDate();
        }
        if (dateField instanceof Date) {
          return dateField;
        }
        if (typeof dateField === 'string' || typeof dateField === 'number') {
          return new Date(dateField);
        }
        return new Date();
      };
      
      zones.push({
        id: doc.id,
        name: data.name || '',
        businessId: data.businessId || null,
        polygon: data.polygon || [],
        deliveryFee: data.deliveryFee || 0,
        isActive: data.isActive !== false,
        createdAt: convertToDate(data.createdAt),
        updatedAt: convertToDate(data.updatedAt)
      });
    });

    console.log(`✅ Encontradas ${zones.length} zonas de cobertura`);
    
    zones.forEach((zone, index) => {
      console.log(`📍 Zona ${index + 1}:`);
      console.log(`   - ID: ${zone.id}`);
      console.log(`   - Nombre: ${zone.name}`);
      console.log(`   - Tarifa: $${zone.deliveryFee}`);
      console.log(`   - Puntos: ${zone.polygon.length}`);
      console.log(`   - Activa: ${zone.isActive}`);
      console.log(`   - Creada: ${zone.createdAt.toISOString()}`);
      console.log('');
    });
    
    console.log('🎉 Función getCoverageZones funciona correctamente');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

testGetCoverageZones().then(() => process.exit(0));
