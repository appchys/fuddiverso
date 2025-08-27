// Script de debug para Firebase
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, collection, addDoc } = require('firebase/firestore');

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAAAFDJ_utlimCezUR-_i8Y2yUare9yZ1k",
  authDomain: "multitienda-69778.firebaseapp.com",
  projectId: "multitienda-69778",
  storageBucket: "multitienda-69778.firebasestorage.app",
  messagingSenderId: "939925630795",
  appId: "1:939925630795:web:713aca499392bfa36482ce"
};

async function debugFirebase() {
  try {
    console.log('🔧 Inicializando Firebase...');
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    
    console.log('✅ Firebase inicializado correctamente');
    console.log('📋 Configuración:', {
      projectId: app.options.projectId,
      authDomain: app.options.authDomain,
      storageBucket: app.options.storageBucket
    });
    
    // Intentar una operación simple
    console.log('\n🧪 Probando operación de escritura...');
    
    const testData = {
      message: 'Test desde Node.js',
      timestamp: new Date().toISOString(),
      randomId: Math.random().toString(36).substr(2, 9)
    };
    
    const docRef = await addDoc(collection(db, 'debug_test'), testData);
    console.log('✅ Documento creado exitosamente con ID:', docRef.id);
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('📝 Detalles del error:');
    console.error('  - Código:', error.code);
    console.error('  - Mensaje:', error.message);
    console.error('  - Stack:', error.stack);
    
    if (error.code === 'permission-denied') {
      console.log('\n💡 SOLUCIÓN: Este error indica que las reglas de seguridad de Firestore no permiten la escritura.');
      console.log('   Ve a Firebase Console > Firestore Database > Reglas');
      console.log('   Y configura las reglas para modo de prueba temporal:');
      console.log('   rules_version = \'2\';');
      console.log('   service cloud.firestore {');
      console.log('     match /databases/{database}/documents {');
      console.log('       match /{document=**} {');
      console.log('         allow read, write: if true;');
      console.log('       }');
      console.log('     }');
      console.log('   }');
    }
  }
}

debugFirebase();
