"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { signInWithGoogle, handleGoogleRedirectResult, getBusinessByOwner } from "@/lib/database";
import { useRouter } from "next/navigation";
import { useBusinessAuth } from "@/contexts/BusinessAuthContext";
import Link from "next/link";

export default function BusinessLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingRedirect, setCheckingRedirect] = useState(true);
  const router = useRouter();
  const { login, isAuthenticated } = useBusinessAuth();

  // Redirigir si ya está autenticado
  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/business/dashboard");
    }
  }, [isAuthenticated, router]);

  // Manejo de resultado de Google redirect
  useEffect(() => {
    let isMounted = true;
    (async () => {
      setCheckingRedirect(true);
      try {
        const redirectResult = await handleGoogleRedirectResult();
        if (!isMounted) return;
        if (redirectResult?.user) {
          if (redirectResult.hasAccess) {
            // Usuario tiene acceso (propietario o administrador)
            if (redirectResult.businessId) {
              login({
                uid: redirectResult.user.uid,
                email: redirectResult.user.email,
                displayName: redirectResult.user.displayName
              }, redirectResult.businessId, redirectResult.user.uid);
            }
            router.replace("/business/dashboard");
          } else {
            // Usuario no tiene acceso, enviar a registro
            router.replace("/business/register?google=true");
          }
        }
      } catch (err) {
        // No hacer nada
      } finally {
        if (isMounted) setCheckingRedirect(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [router]);

  // Login con email/contraseña
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Verificar acceso del usuario (propietario o administrador)
      const { getUserBusinessAccess } = await import("@/lib/database");
      const businessAccess = await getUserBusinessAccess(
        userCredential.user.email || '', 
        userCredential.user.uid
      );
      
      if (businessAccess.hasAccess) {
        // Usuario tiene acceso, configurar localStorage y redirigir
        let businessId = null;
        if (businessAccess.ownedBusinesses.length > 0) {
          businessId = businessAccess.ownedBusinesses[0].id;
        } else if (businessAccess.adminBusinesses.length > 0) {
          businessId = businessAccess.adminBusinesses[0].id;
        }
        
        if (businessId) {
          login({
            uid: userCredential.user.uid,
            email: userCredential.user.email,
            displayName: userCredential.user.displayName
          }, businessId, userCredential.user.uid);
        }
        router.replace("/business/dashboard");
      } else {
        // Usuario no tiene acceso a ninguna tienda
        setError("No tienes acceso a ninguna tienda. Contacta al administrador o crea una nueva tienda.");
      }
    } catch (error: any) {
      let errorMessage = "Error al iniciar sesión. Verifica tus credenciales.";
      if (error.code === "auth/operation-not-allowed") {
        errorMessage = "La autenticación con email no está habilitada. Contacta al administrador.";
      } else if (error.code === "auth/user-not-found") {
        errorMessage = "No existe una cuenta con este email. ¿Necesitas registrarte?";
      } else if (error.code === "auth/wrong-password") {
        errorMessage = "Contraseña incorrecta. Inténtalo de nuevo.";
      } else if (error.code === "auth/invalid-email") {
        errorMessage = "El formato del email no es válido.";
      } else if (error.code === "auth/user-disabled") {
        errorMessage = "Esta cuenta ha sido deshabilitada.";
      } else if (error.code === "auth/too-many-requests") {
        errorMessage = "Demasiados intentos fallidos. Espera un momento antes de intentar de nuevo.";
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Login con Google
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithGoogle();
      if (result && result.user) {
        // Verificar acceso completo del usuario (propietario o administrador)
        const { getUserBusinessAccess } = await import("@/lib/database");
        const businessAccess = await getUserBusinessAccess(
          result.user.email || '', 
          result.user.uid
        );
        
        if (businessAccess.hasAccess) {
          // Usuario tiene acceso (propietario o administrador)
          let businessId = null;
          if (businessAccess.ownedBusinesses.length > 0) {
            businessId = businessAccess.ownedBusinesses[0].id;
          } else if (businessAccess.adminBusinesses.length > 0) {
            businessId = businessAccess.adminBusinesses[0].id;
          }
          
          if (businessId) {
            login({
              uid: result.user.uid,
              email: result.user.email,
              displayName: result.user.displayName
            }, businessId, result.user.uid);
          }
          router.replace("/business/dashboard");
        } else {
          // Usuario no tiene acceso, enviar a registro
          router.replace("/business/register?google=true");
        }
      } else {
        setError("No se pudo obtener el usuario de Google.");
      }
    } catch (error: any) {
      setError(error.message || "Error al iniciar sesión con Google");
    } finally {
      setLoading(false);
    }
  };

  if (checkingRedirect) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verificando autenticación...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Iniciar Sesión - Negocio
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          ¿No tienes cuenta?{' '}
          <Link href="/business/register" className="font-medium text-orange-600 hover:text-orange-500">
            Regístrate aquí
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Correo electrónico
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-orange-500 focus:border-orange-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-orange-500 focus:border-orange-500 sm:text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                <a href="#" className="font-medium text-orange-600 hover:text-orange-500">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">O continúa con</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full inline-flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading ? 'Conectando...' : 'Continuar con Google'}
              </button>
            </div>
          </div>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">O</span>
              </div>
            </div>

            <div className="mt-6">
              <Link
                href="/"
                className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
              >
                Volver al inicio
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}