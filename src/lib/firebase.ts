// firebase.ts
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import {
  getAuth,
  initializeAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserPopupRedirectResolver,
  type Auth
} from "firebase/auth";
import { getStorage } from "firebase/storage";
import { clearAuthSessionBackup } from "./authSessionGuard";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAAAFDJ_utlimCezUR-_i8Y2yUare9yZ1k",
  authDomain: "multitienda-69778.firebaseapp.com",
  projectId: "multitienda-69778",
  storageBucket: "multitienda-69778.firebasestorage.app",
  messagingSenderId: "939925630795",
  appId: "1:939925630795:web:713aca499392bfa36482ce"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore con caché persistente en navegador (IndexedDB)
// y la opción ignoreUndefinedProperties
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: typeof window !== 'undefined'
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : undefined
});

// Initialize Firebase Authentication
// En el navegador definimos la persistencia al crear la instancia (en lugar de
// llamar setPersistence de forma asíncrona), evitando que la sesión migre entre
// IndexedDB y localStorage en cada carga. localStorage va primero porque es el
// formato que authSessionGuard respalda/restaura.
function createAuth(): Auth {
  if (typeof window === 'undefined') return getAuth(app);
  try {
    return initializeAuth(app, {
      persistence: [browserLocalPersistence, indexedDBLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver
    });
  } catch {
    // Ya inicializado (p.ej. HMR en desarrollo)
    return getAuth(app);
  }
}

const auth = createAuth();

// Cualquier cierre de sesión explícito (signOut(auth) o auth.signOut()) debe
// eliminar el respaldo de sesión para que no se restaure automáticamente.
if (typeof window !== 'undefined') {
  const originalSignOut = auth.signOut.bind(auth);
  auth.signOut = async () => {
    clearAuthSessionBackup();
    return originalSignOut();
  };
}

// Initialize Firebase Storage
const storage = getStorage(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();

export {
  app,
  db,
  auth,
  storage,
  googleProvider
};
