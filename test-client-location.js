/**
 * Script de prueba para verificar que createClientLocation funciona
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Configura Firebase
const serviceAccount = require('./multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json');
initializeApp({
  credential: cert(serviceAccount)
});

// Simular la función createClientLocation
async function testCreateClientLocation() {
  try {
    console.log('🧪 Probando createClientLocation...');
    
    // Crear ubicación de prueba
    const testLocationData = {
      id_cliente: 'test-client-123',
      latlong: '-2.1894, -79.8890',
      referencia: 'Casa azul con portón blanco, diagonal al parque central',
      tarifa: '2.50',
      sector: 'Centro de Guayaquil'
    };
    
    console.log('📍 Creando ubicación con datos:', testLocationData);
    
    // Simular la creación (usando Firebase directamente)
    const db = getFirestore();
    const { addDoc, collection, serverTimestamp } = require('firebase-admin/firestore');
    
    const cleanedData = {
      id_cliente: testLocationData.id_cliente,
      latlong: testLocationData.latlong,
      referencia: testLocationData.referencia,
      tarifa: testLocationData.tarifa,
      sector: testLocationData.sector || 'Sin especificar',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, 'ubicaciones'), cleanedData);
    console.log('✅ Ubicación creada con ID:', docRef.id);
    
    // Verificar que se guardó correctamente
    const doc = await docRef.get();
    const data = doc.data();
    
    console.log('📄 Datos guardados:');
    console.log('- ID Cliente:', data.id_cliente);
    console.log('- Coordenadas:', data.latlong);
    console.log('- Referencia:', data.referencia);
    console.log('- Tarifa:', data.tarifa);
    console.log('- Sector:', data.sector);
    console.log('- Creado:', data.createdAt);
    console.log('- Actualizado:', data.updatedAt);
    
    console.log('🎉 Prueba completada exitosamente');
    
    return docRef.id;
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error);
    throw error;
  }
}

// Función para obtener ubicaciones de un cliente
async function testGetClientLocations(clientId) {
  try {
    console.log('🔍 Probando getClientLocations para cliente:', clientId);
    
    const db = getFirestore();
    const { getDocs, query, collection, where } = require('firebase-admin/firestore');
    
    const q = query(
      collection(db, 'ubicaciones'),
      where('id_cliente', '==', clientId)
    );

    const querySnapshot = await getDocs(q);
    const locations = [];

    querySnapshot.forEach((doc) => {
      const locationData = doc.data();
      locations.push({
        id: doc.id,
        id_cliente: locationData.id_cliente || '',
        referencia: locationData.referencia || '',
        sector: locationData.sector || '',
        tarifa: locationData.tarifa || '',
        latlong: locationData.latlong || ''
      });
    });

    console.log(`✅ Encontradas ${locations.length} ubicaciones para el cliente`);
    
    locations.forEach((location, index) => {
      console.log(`📍 Ubicación ${index + 1}:`);
      console.log(`   - ID: ${location.id}`);
      console.log(`   - Referencia: ${location.referencia}`);
      console.log(`   - Coordenadas: ${location.latlong}`);
      console.log(`   - Tarifa: $${location.tarifa}`);
      console.log(`   - Sector: ${location.sector}`);
      console.log('');
    });
    
    return locations;
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

async function runTests() {
  try {
    // Crear ubicación de prueba
    const locationId = await testCreateClientLocation();
    
    // Buscar ubicaciones del cliente de prueba
    await testGetClientLocations('test-client-123');
    
    console.log('🎉 Todas las pruebas completadas exitosamente');
    
  } catch (error) {
    console.error('❌ Error en las pruebas:', error);
  }
}

runTests().then(() => process.exit(0));
