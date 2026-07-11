"use client";

import { useState, useEffect, useCallback } from "react";
import { signInBusinessWithEmailOrPhone, signInWithGoogle, handleGoogleRedirectResult } from "@/lib/database";
import { useRouter } from "next/navigation";
import { useBusinessAuth } from "@/contexts/BusinessAuthContext";
import Link from "next/link";

export default function BusinessLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingRedirect, setCheckingRedirect] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const { login, isAuthenticated, authLoading } = useBusinessAuth();

  const verifyAndLogin = useCallback(async (user: { email?: string | null; uid: string; displayName?: string | null }) => {
    if (!user.email) {
      throw new Error("Email no disponible para iniciar sesion.");
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT: La conexion es muy lenta. Tu sesion se guardara y se reintentara automaticamente.")), 15000)
    );

    try {
      const { getUserBusinessAccess } = await import("@/lib/database");

      const businessAccess = await Promise.race([
        getUserBusinessAccess(user.email, user.uid),
        timeoutPromise
      ]) as Awaited<ReturnType<typeof getUserBusinessAccess>>;

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
        throw new Error("No se encontro un negocio accesible.");
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

      localStorage.removeItem("pendingAuth");
    } catch (error: any) {
      if (error.message?.includes("TIMEOUT")) {
        localStorage.setItem("pendingAuth", JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          timestamp: Date.now()
        }));
      }
      throw error;
    }
  }, [login, router]);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/business/dashboard");
    }
  }, [isAuthenticated, router]);

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
        } else if (!redirectResult.hasAccess) {
          router.replace("/business/register?google=true");
        }
      } catch (err) {
        console.error("Error en redirect de Google:", err);
      } finally {
        if (isMounted) setCheckingRedirect(false);
      }
    })();
    return () => { isMounted = false; };
  }, [login, router]);

  const handlePasswordSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await signInBusinessWithEmailOrPhone(identifier, password);
      if (!result?.user) {
        throw new Error("No se pudo obtener el usuario.");
      }
      await verifyAndLogin(result.user);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error al iniciar sesion. Intenta de nuevo.";
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");

    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await signInWithGoogle();
        if (result?.user) {
          await verifyAndLogin(result.user);
          return;
        } else {
          throw new Error("No se pudo obtener el usuario de Google.");
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Error al iniciar sesion con Google. Intenta de nuevo.";

        if (attempt === maxRetries - 1 || !errorMessage.includes("TIMEOUT")) {
          setError(errorMessage);
          break;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        setError(`Conexion lenta detectada. Reintentando (${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    setLoading(false);
  };

  if (checkingRedirect || authLoading) {
    return (
      <div className="min-h-screen bg-[#aa1918] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-white">Verificando autenticacion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#aa1918] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center px-4">
        <span className="text-5xl font-black tracking-tighter text-white font-sans block mb-2">Fuddi</span>
        <h2 className="text-lg font-black uppercase tracking-widest text-white/80">Acceso a Negocios</h2>
        <p className="mt-2 text-xs text-white/70">
          Inicia sesión con Google o con tu correo/celular y contraseña.
        </p>

        {error && (
          <div
            className="mt-4 bg-white/10 border border-white/20 text-white px-4 py-3 rounded-2xl backdrop-blur-sm text-xs font-semibold"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <form onSubmit={handlePasswordSignIn} className="mt-8 w-full max-w-xs mx-auto space-y-4">
          <div className="text-left">
            <label htmlFor="business-identifier" className="block text-[9px] font-black uppercase tracking-widest text-white/75 mb-2 ml-1">
              Correo o celular
            </label>
            <input
              id="business-identifier"
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-gray-900 placeholder:text-gray-300 shadow-sm focus:border-white focus:outline-none focus:ring-4 focus:ring-white/10 transition-all font-bold text-sm"
              placeholder="correo@negocio.com o 09XXXXXXXX"
              autoComplete="username"
              required
            />
          </div>

          <div className="text-left">
            <label htmlFor="business-password" className="block text-[9px] font-black uppercase tracking-widest text-white/75 mb-2 ml-1">
              Contraseña
            </label>
            <input
              id="business-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-gray-900 placeholder:text-gray-300 shadow-sm focus:border-white focus:outline-none focus:ring-4 focus:ring-white/10 transition-all font-bold text-sm"
              placeholder="Tu contraseña"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center px-6 py-4 rounded-2xl shadow-xl bg-black hover:bg-neutral-900 text-xs font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 mt-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            ) : (
              "Iniciar sesión"
            )}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 max-w-xs mx-auto">
          <div className="h-px flex-1 bg-white/25"></div>
          <span className="text-xs font-semibold uppercase tracking-wide text-white/70">o</span>
          <div className="h-px flex-1 bg-white/25"></div>
        </div>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full max-w-xs mx-auto inline-flex items-center justify-center px-5 py-4 border border-white/10 rounded-2xl shadow-sm bg-white/5 hover:bg-white/10 text-xs font-black uppercase tracking-widest text-white active:scale-95 transition-all duration-300 gap-3 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
          aria-describedby={error ? "error-message" : undefined}
        >
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {loading ? "Conectando..." : "Continuar con Google"}
        </button>

        <div className="mt-8 text-center text-sm">
          <Link
            href="/"
            className="text-white/80 hover:text-white font-medium transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
