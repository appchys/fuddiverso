import { collection, addDoc, getDocs } from 'firebase/firestore'
import { db } from './firebase'

export async function testFirebaseConnection() {
  try {
    console.log('🔄 Testing Firebase connection...')
    
    // Test 1: Verificar configuración
    console.log('🔧 Firebase config:')
    console.log('  Project ID:', db.app.options.projectId)
    console.log('  API Key:', db.app.options.apiKey?.substring(0, 10) + '...')
    console.log('  Auth Domain:', db.app.options.authDomain)
    console.log('  Storage Bucket:', db.app.options.storageBucket)
    
    // Test 2: Probar lectura simple
    console.log('📖 Testing Firestore read access...')
    const testCollection = collection(db, 'connection_test')
    const snapshot = await getDocs(testCollection)
    console.log(`✅ Read successful. Found ${snapshot.size} documents in test collection`)
    
    // Test 3: Intentar escribir un documento simple
    console.log('✍️ Testing Firestore write access...')
    const testDoc = await addDoc(testCollection, {
      message: 'Firebase connection test',
      timestamp: new Date().toISOString(),
      testId: Math.random().toString(36).substr(2, 9)
    })
    
    console.log('✅ Write successful! Test doc ID:', testDoc.id)
    
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
