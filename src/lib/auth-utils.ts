// Función para limpiar usuarios de prueba en Firebase Auth
// Solo usar en desarrollo/testing

import { auth } from './firebase';
import { deleteUser, signInWithEmailAndPassword } from 'firebase/auth';

export async function deleteTestUser(email: string, password: string) {
  try {
    // Primero iniciar sesión con el usuario
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Luego eliminar el usuario
    await deleteUser(user);
    return { success: true, message: 'Usuario eliminado' };
    
  } catch (error: any) {
    console.error('❌ Error al eliminar usuario:', error);
    
    if (error.code === 'auth/user-not-found') {
      return { success: false, message: 'Usuario no encontrado' };
    } else if (error.code === 'auth/wrong-password') {
      return { success: false, message: 'Contraseña incorrecta' };
    } else if (error.code === 'auth/too-many-requests') {
      return { success: false, message: 'Demasiadas solicitudes. Espera un momento.' };
    }
    
    return { success: false, message: error.message };
  }
}

// Función para verificar si un email ya está registrado
export async function checkEmailExists(email: string) {
  try {
    // Intentar crear un usuario temporal para verificar si el email existe
    // (Esta no es la forma más elegante, pero Firebase no tiene una API directa para esto)
    return false; // Por ahora retornamos false
    
  } catch (error) {
    console.error('Error verificando email:', error);
    return false;
  }
}
