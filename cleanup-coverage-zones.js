/**
 * Script para limpiar y corregir datos de zonas de cobertura
 * Este script puede ejecutarse para corregir documentos con fechas malformadas
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// Configura tu Firebase Admin SDK
const serviceAccount = require('./multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function cleanupCoverageZones() {
  try {
    console.log('🧹 Iniciando limpieza de zonas de cobertura...');
    
    // Obtener todas las zonas de cobertura
    const snapshot = await db.collection('coverageZones').get();
    
    if (snapshot.empty) {
      console.log('✅ No se encontraron zonas de cobertura para limpiar');
      return;
    }

    let fixedCount = 0;
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      let needsUpdate = false;
      const updateData = {};
      
      // Verificar y corregir createdAt
      if (!data.createdAt || typeof data.createdAt === 'string' || typeof data.createdAt === 'number') {
        updateData.createdAt = Timestamp.now();
        needsUpdate = true;
        console.log(`📅 Corrigiendo createdAt para documento ${doc.id}`);
      }
      
      // Verificar y corregir updatedAt
      if (!data.updatedAt || typeof data.updatedAt === 'string' || typeof data.updatedAt === 'number') {
        updateData.updatedAt = Timestamp.now();
        needsUpdate = true;
        console.log(`📅 Corrigiendo updatedAt para documento ${doc.id}`);
      }
      
      // Verificar campos requeridos
      if (!data.name) {
        updateData.name = `Zona ${doc.id.substring(0, 8)}`;
        needsUpdate = true;
        console.log(`📝 Agregando nombre para documento ${doc.id}`);
      }
      
      if (typeof data.deliveryFee !== 'number') {
        updateData.deliveryFee = 0;
        needsUpdate = true;
        console.log(`💰 Corrigiendo deliveryFee para documento ${doc.id}`);
      }
      
      if (typeof data.isActive !== 'boolean') {
        updateData.isActive = true;
        needsUpdate = true;
        console.log(`🔄 Corrigiendo isActive para documento ${doc.id}`);
      }
      
      if (!Array.isArray(data.polygon)) {
        updateData.polygon = [];
        needsUpdate = true;
        console.log(`📍 Corrigiendo polygon para documento ${doc.id}`);
      }
      
      // Actualizar documento si es necesario
      if (needsUpdate) {
        await doc.ref.update(updateData);
        fixedCount++;
        console.log(`✅ Documento ${doc.id} actualizado`);
      }
    }
    
    console.log(`🎉 Limpieza completada. ${fixedCount} documentos fueron corregidos.`);
    
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
  }
}

// Función para eliminar todas las zonas de cobertura si es necesario
async function deleteAllCoverageZones() {
  try {
    console.log('🗑️ Eliminando todas las zonas de cobertura...');
    
    const snapshot = await db.collection('coverageZones').get();
    
    if (snapshot.empty) {
      console.log('✅ No hay zonas de cobertura para eliminar');
      return;
    }
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`🎉 ${snapshot.size} zonas de cobertura eliminadas exitosamente`);
    
  } catch (error) {
    console.error('❌ Error eliminando zonas de cobertura:', error);
  }
}

// Ejecutar según el argumento de línea de comandos
const action = process.argv[2];

if (action === 'clean') {
  cleanupCoverageZones().then(() => process.exit(0));
} else if (action === 'delete-all') {
  console.log('⚠️  ¿Estás seguro de que quieres eliminar TODAS las zonas de cobertura?');
  console.log('⚠️  Ejecuta: node cleanup-coverage-zones.js delete-all-confirm');
} else if (action === 'delete-all-confirm') {
  deleteAllCoverageZones().then(() => process.exit(0));
} else {
  console.log('📖 Uso:');
  console.log('  node cleanup-coverage-zones.js clean          - Limpiar y corregir datos');
  console.log('  node cleanup-coverage-zones.js delete-all     - Eliminar todas las zonas');
  console.log('');
  console.log('🔧 Ejecutando limpieza por defecto...');
  cleanupCoverageZones().then(() => process.exit(0));
}
