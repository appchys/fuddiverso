"use client";

import { use, useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useBusinessAuth } from "@/contexts/BusinessAuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface MagicLoginPageProps {
  params: Promise<{ token: string }>;
}

export default function MagicLoginPage({ params }: MagicLoginPageProps) {
  const { token } = use(params);
  const router = useRouter();
  const { login } = useBusinessAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let active = true;

    async function performMagicLogin() {
      try {
        const response = await fetch("/api/business/magic-login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.error || "No se pudo validar el enlace de acceso rápido.");
        }

        if (!active) return;

        // Iniciar sesión con el Custom Token en Firebase Auth
        const userCredential = await signInWithCustomToken(auth, data.customToken);
        const firebaseUser = userCredential.user;

        // Establecer la sesión local en el contexto de negocio
        login(
          {
            uid: data.uid,
            email: data.email,
            displayName: data.displayName || firebaseUser.displayName || null,
          },
          data.businessId,
          data.uid
        );

        setStatus("success");
        // Delay visual sutil para notar el estado de éxito antes de redirigir
        setTimeout(() => {
          router.replace("/business/dashboard");
        }, 1000);
      } catch (err: any) {
        console.error("Error en login rápido:", err);
        if (active) {
          setStatus("error");
          setErrorMsg(err.message || "Error al autenticar. Por favor verifica tu enlace.");
        }
      }
    }

    performMagicLogin();

    return () => {
      active = false;
    };
  }, [token, login, router]);

  return (
    <div className="min-h-screen bg-[#aa1918] bg-gradient-to-br from-[#aa1918] to-[#6d100f] flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="w-full max-w-md text-center">
        {/* Marca Fuddi */}
        <span className="text-6xl font-black tracking-tighter text-white block mb-2 select-none drop-shadow-md animate-pulse">
          Fuddi
        </span>
        <h2 className="text-sm font-black uppercase tracking-widest text-white/80 mb-8">
          Acceso Instantáneo
        </h2>

        {/* Tarjeta de Vidrio (Glassmorphism) */}
        <div className="bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl backdrop-blur-xl transition-all duration-500 relative overflow-hidden">
          {status === "loading" && (
            <div className="flex flex-col items-center py-6 space-y-6">
              {/* Spinner animado con brillos */}
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-white/10 border-t-white animate-spin"></div>
                <div className="absolute inset-0 w-16 h-16 rounded-full border border-white/30 animate-ping opacity-25"></div>
              </div>
              <div className="space-y-2">
                <p className="text-white font-extrabold text-lg tracking-tight">
                  Verificando credenciales...
                </p>
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wider animate-pulse">
                  Conectando de forma segura
                </p>
              </div>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center py-6 space-y-6">
              <div className="w-16 h-16 bg-green-500/20 border border-green-500/30 rounded-full flex items-center justify-center shadow-lg shadow-green-500/10">
                <i className="bi bi-shield-check text-green-400 text-3xl"></i>
              </div>
              <div className="space-y-2">
                <p className="text-white font-extrabold text-xl tracking-tight">
                  ¡Acceso Concedido!
                </p>
                <p className="text-green-300/80 text-xs font-semibold uppercase tracking-widest">
                  Redireccionando al panel
                </p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center py-4 space-y-6">
              <div className="w-16 h-16 bg-red-500/20 border border-red-500/30 rounded-full flex items-center justify-center shadow-lg shadow-red-500/10">
                <i className="bi bi-shield-lock text-red-400 text-3xl"></i>
              </div>
              <div className="space-y-3">
                <p className="text-white font-extrabold text-lg tracking-tight">
                  Enlace de Acceso Inválido
                </p>
                <p className="text-white/70 text-xs leading-relaxed max-w-xs mx-auto">
                  {errorMsg}
                </p>
              </div>

              <div className="w-full pt-4">
                <Link
                  href="/business/login"
                  className="w-full inline-flex items-center justify-center px-6 py-3.5 border border-white/10 rounded-2xl shadow-xl bg-black hover:bg-neutral-900 text-xs font-black uppercase tracking-widest text-white active:scale-95 transition-all duration-300"
                >
                  Ir al inicio de sesión
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-xs text-white/50 font-semibold tracking-wider select-none">
          FUDDI PLATFORM &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
