import { collection, addDoc, getDocs } from 'firebase/firestore'
import { db } from './firebase'

export async function testFirebaseConnection() {
  try {
    // Test 1: Verificar configuración
    // Test 2: Probar lectura simple
    const testCollection = collection(db, 'connection_test')
    const snapshot = await getDocs(testCollection)
    // Test 3: Intentar escribir un documento simple
    const testDoc = await addDoc(testCollection, {
      message: 'Firebase connection test',
      timestamp: new Date().toISOString(),
      testId: Math.random().toString(36).substr(2, 9)
    })
    return { 
      success: true, 
      docId: testDoc.id,
      documentsFound: snapshot.size,
      message: 'Firebase connection is working correctly!',
      config: {
        projectId: db.app.options.projectId,
        storageBucket: db.app.options.storageBucket
      }
    }
    
  } catch (error) {
    console.error('❌ Firebase test failed:', error)
    
    const errorInfo = {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      code: (error as any)?.code || 'unknown',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    }
    
    return { 
      success: false, 
      error: errorInfo,
      fullError: String(error),
      config: {
        projectId: db.app.options.projectId,
        storageBucket: db.app.options.storageBucket
      }
    }
  }
}
