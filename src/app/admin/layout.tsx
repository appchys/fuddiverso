'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </Suspense>
  )
}

function AdminLoginForm({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === 'admin123') {
      localStorage.setItem('adminAuth', 'authenticated')
      onLoginSuccess()
    } else {
      setError('Contraseña incorrecta')
    }
  }

  return (
    <div className="min-h-screen bg-[#111] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#1A1A1A] rounded-3xl border border-white/5 p-8 shadow-2xl text-white">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/40 mb-4">
            <i className="bi bi-rocket-takeoff-fill text-2xl text-white animate-pulse"></i>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-center">Fuddi Admin</h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-bold">Ingreso Autorizado</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
              Contraseña de Administrador
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder="••••••••"
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-blue-500 focus:bg-white/10 transition-all placeholder-gray-600 text-white"
              required
            />
          </div>

          {error && (
            <p className="text-xs font-bold text-red-400 flex items-center gap-1.5 animate-bounce">
              <i className="bi bi-exclamation-triangle-fill"></i>
              {error}
            </p>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 py-3.5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border border-white/5 active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white py-3.5 rounded-2xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-blue-950/50 transition-all active:scale-95"
            >
              Ingresar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AdminLayoutContent({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const navLinks = [
    { href: '/admin/dashboard', label: 'Dashboard', icon: 'bi-grid-1x2-fill' },
    { href: '/admin/dashboard?tab=transfers', label: 'Revisar Transferencias', icon: 'bi-bank' },
    { href: '/admin/settlements', label: 'Liquidaciones', icon: 'bi-cash-coin' },
    { href: '/admin/deliveries', label: 'Deliveries', icon: 'bi-scooter' },
    { href: '/admin/coverage-groups', label: 'Grupos de Cobertura', icon: 'bi-tags-fill' },
    { href: '/admin/coverage-zones', label: 'Zonas de Cobertura', icon: 'bi-geo-alt-fill' },
  ]

  useEffect(() => {
    document.title = 'Panel de administración - Fuddi'
  }, [])

  useEffect(() => {
    // Verificar si el administrador principal ya está autenticado en localStorage
    const checkAdminAuth = () => {
      const adminAuth = localStorage.getItem('adminAuth')
      if (adminAuth === 'authenticated') {
        setIsAuthenticated(true)
      }
      setLoading(false)
    }

    checkAdminAuth()
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('adminAuth')
    setIsAuthenticated(false)
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <AdminLoginForm onLoginSuccess={() => setIsAuthenticated(true)} />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Botón Hamburger (Móvil) */}
      <div className="md:hidden bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <h1 className="text-lg font-black text-gray-900 tracking-tighter">fuddi.shop</h1>
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="w-10 h-10 flex items-center justify-center text-gray-600 active:bg-gray-100 rounded-xl transition-colors"
        >
          <i className="bi bi-list text-2xl"></i>
        </button>
      </div>

      {/* Sidebar Overlay (Móvil) */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] md:hidden animate-in fade-in duration-300"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-[70] w-72 bg-[#1A1A1A] text-white shadow-2xl transition-transform duration-300 ease-in-out transform
        md:relative md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col p-6">
          {/* Logo */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                <i className="bi bi-rocket-takeoff-fill text-xl text-white"></i>
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight leading-none">fuddi.shop</h1>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">Admin Panel</p>
              </div>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden text-gray-400 hover:text-white"
            >
              <i className="bi bi-x-lg text-xl"></i>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-2">
            {navLinks.map((link) => {
              const currentPath = pathname ?? ''
              const currentTab = searchParams?.get('tab')
              const isActive = link.href.includes('?')
                ? `${currentPath}?tab=${currentTab || ''}` === link.href
                : currentPath === link.href && !currentTab
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => {
                    if (isSidebarOpen) setIsSidebarOpen(false)
                  }}
                  className={`
                    flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200
                    ${isActive
                      ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-600/20 translate-x-1'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }
                  `}
                >
                  <i className={`bi ${link.icon} text-lg ${isActive ? 'text-white' : 'text-gray-500'}`}></i>
                  <span>{link.label}</span>
                </Link>
              )
            })}
          </nav>

          {/* Footer Sidebar */}
          <div className="pt-6 mt-6 border-t border-white/10">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all duration-200"
            >
              <i className="bi bi-box-arrow-left text-lg"></i>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
