"use client";

import { useState, useEffect, useCallback } from "react";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/lib/database"; // Asumiendo que movés getUserBusinessAccess aquí
import { useRouter } from "next/navigation";
import { useBusinessAuth } from "@/contexts/BusinessAuthContext";
import Link from "next/link";

export default function BusinessLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingRedirect, setCheckingRedirect] = useState(true);
  const router = useRouter();
  const { login, isAuthenticated, authLoading } = useBusinessAuth();

  // Función compartida para verificar acceso y login
  const verifyAndLogin = useCallback(async (user: { email?: string | null; uid: string; displayName?: string | null }) => {
    if (!user.email) {
      throw new Error("Email no disponible de Google.");
    }
    const { getUserBusinessAccess } = await import("@/lib/database");
    const businessAccess = await getUserBusinessAccess(user.email, user.uid);

    if (!businessAccess.hasAccess) {
      router.replace("/business/register?google=true");
      return;
    }

    let businessId = null;
    if (businessAccess.ownedBusinesses.length > 0) {
      businessId = businessAccess.ownedBusinesses[0].id;
    } else if (businessAccess.adminBusinesses.length > 0) {
      businessId = businessAccess.adminBusinesses[0].id;
    }

    if (!businessId) {
      throw new Error("No se encontró un negocio accesible.");
    }

    login(
      {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || null
      },
      businessId,
      user.uid
    );
    // NO redirigir aquí; el useEffect lo maneja
  }, [login, router]);

  // Redirigir si ya está autenticado
  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/business/dashboard");
    }
  }, [isAuthenticated, router]);

  // Manejo de Google redirect
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const redirectResult = await handleGoogleRedirectResult();
        if (!isMounted || !redirectResult?.user) return;

        if (redirectResult.hasAccess && redirectResult.businessId) {
          login(
            { uid: redirectResult.user.uid, email: redirectResult.user.email, displayName: redirectResult.user.displayName },
            redirectResult.businessId,
            redirectResult.user.uid
          );
          // Redirigir via useEffect de isAuthenticated
        } else if (!redirectResult.hasAccess) {
          router.replace("/business/register?google=true");
        }
      } catch (err) {
        console.error('Error en redirect de Google:', err); // Para debug
      } finally {
        if (isMounted) setCheckingRedirect(false);
      }
    })();
    return () => { isMounted = false; };
  }, [login, router]);

  // Login con Google (popup)
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await signInWithGoogle();
      if (result?.user) {
        await verifyAndLogin(result.user); // Usar función compartida
      } else {
        throw new Error("No se pudo obtener el usuario de Google.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error al iniciar sesión con Google. Intenta de nuevo.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (checkingRedirect || authLoading) {
    return (
      <div className="min-h-screen bg-[#aa1918] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-white">Verificando autenticación...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#aa1918] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h2 className="text-3xl font-extrabold text-white">Acceso a Negocios</h2>
        <p className="mt-2 text-sm text-white/90">
          Inicia sesión con tu cuenta de Google para acceder al panel de control de tu negocio.
        </p>

        {error && (
          <div
            className="mt-4 bg-white/10 border border-white/20 text-white px-4 py-3 rounded backdrop-blur-sm"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <div className="mt-8">
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full max-w-xs mx-auto inline-flex items-center justify-center px-6 py-3 border border-white/20 rounded-lg shadow-sm bg-white/10 text-base font-medium text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors backdrop-blur-sm"
            aria-describedby={error ? "error-message" : undefined}
          >
            <svg className="w-6 h-6 mr-3" viewBox="0 0 24 24" aria-hidden="true">
              {/* Tu SVG de Google */}
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {loading ? 'Conectando...' : 'Continuar con Google'}
          </button>
        </div>

        <div className="mt-8 text-center text-sm">
          <Link
            href="/"
            className="text-white/80 hover:text-white font-medium transition-colors"
          >
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}