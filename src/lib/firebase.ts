// firebase.ts
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,   // ← importante: usamos esta en lugar de getFirestore
} from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  setPersistence,
  browserLocalPersistence
} from "firebase/auth";
import { getStorage } from "firebase/storage";

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

// Initialize Firestore con la opción ignoreUndefinedProperties
// Esto hace que Firestore ignore automáticamente cualquier campo undefined
// en lugar de tirar error
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

// Initialize Firebase Authentication
const auth = getAuth(app);

// Ensure auth persists across reloads (browser only)
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // Non-fatal: fall back to default persistence if this fails
  });
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
