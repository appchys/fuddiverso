'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export default function AdminLayoutClient({
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
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)

  const navLinks = [
    { href: '/admin', label: 'Negocios', icon: 'bi-shop' },
    { href: '/admin/dashboard', label: 'Métricas y Dashboard', icon: 'bi-bar-chart-fill' },
    { href: '/admin/deliveries', label: 'Deliveries', icon: 'bi-scooter' },
    { href: '/admin/stores', label: 'Config. Repartos Tiendas', icon: 'bi-sliders' },
    { href: '/admin/credits', label: 'Gestión de Saldo', icon: 'bi-wallet2' },
    { href: '/admin/clients', label: 'Clientes por Referencia', icon: 'bi-people-fill' },
    { href: '/admin/confirmations', label: 'Origen Confirmaciones', icon: 'bi-check-all' },
    { href: '/admin/coverage-groups', label: 'Grupos de Cobertura', icon: 'bi-tags-fill' },
    { href: '/admin/coverage-zones', label: 'Zonas de Cobertura', icon: 'bi-geo-alt-fill' },
    { href: '/admin/logs', label: 'Logs del Sistema', icon: 'bi-journal-text' },
  ]

  // Rutas secundarias para el menú "Más" en celular
  const secondaryLinks = [
    { href: '/admin/stores', label: 'Config. Repartos', desc: 'Tarifas, check-in y empaque', icon: 'bi-sliders' },
    { href: '/admin/credits', label: 'Gestión de Saldo', desc: 'Billetera y comisiones', icon: 'bi-wallet2' },
    { href: '/admin/clients', label: 'Clientes por Referencia', desc: 'Directorio y contactos', icon: 'bi-people-fill' },
    { href: '/admin/confirmations', label: 'Confirmaciones WhatsApp', desc: 'Orígenes y mensajes', icon: 'bi-check-all' },
    { href: '/admin/coverage-groups', label: 'Grupos de Cobertura', desc: 'Ciudades y zonas agrupadas', icon: 'bi-tags-fill' },
    { href: '/admin/coverage-zones', label: 'Zonas de Cobertura', desc: 'Polígonos y tarifas por zona', icon: 'bi-geo-alt-fill' },
    { href: '/admin/logs', label: 'Logs del Sistema', desc: 'Registro de eventos técnicos', icon: 'bi-journal-text' },
  ]

  const isSecondaryActive = secondaryLinks.some(link => pathname === link.href)

  useEffect(() => {
    document.title = 'Admin - Fuddi.shop'
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
      {/* Barra Superior Móvil */}
      <header className="md:hidden bg-white/95 backdrop-blur-md border-b border-gray-200/80 px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-tr from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center shadow-sm">
            <i className="bi bi-rocket-takeoff-fill text-sm text-white"></i>
          </div>
          <div>
            <h1 className="text-base font-black text-gray-900 tracking-tight leading-none">fuddi.shop</h1>
            <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">Panel Admin</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsMoreMenuOpen(true)}
            className="w-9 h-9 flex items-center justify-center text-gray-600 active:bg-gray-100 rounded-xl transition-colors"
            title="Más opciones"
          >
            <i className="bi bi-grid-fill text-lg"></i>
          </button>
          <button
            onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center text-red-500 hover:text-red-600 active:bg-red-50 rounded-xl transition-colors"
            title="Cerrar sesión"
          >
            <i className="bi bi-box-arrow-right text-lg"></i>
          </button>
        </div>
      </header>

      {/* Sidebar Overlay (Móvil) */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[60] md:hidden animate-in fade-in duration-200"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar de Escritorio */}
      <aside className={`
        fixed inset-y-0 left-0 z-[70] w-72 bg-[#1A1A1A] text-white shadow-2xl transition-transform duration-300 ease-in-out transform
        md:relative md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col p-6">
          {/* Logo */}
          <div className="flex items-center justify-between mb-8">
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
          <nav className="flex-1 space-y-1.5 overflow-y-auto pr-1">
            {navLinks.map((link) => {
              const currentPath = pathname ?? ''
              const currentTab = searchParams?.get('tab')
              const isActive = link.href === '/admin'
                ? currentPath === '/admin'
                : link.href.includes('?')
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
                    flex items-center gap-3 px-3.5 py-3 rounded-2xl text-xs font-bold transition-all duration-200
                    ${isActive
                      ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-600/20 translate-x-1'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }
                  `}
                >
                  <i className={`bi ${link.icon} text-base ${isActive ? 'text-white' : 'text-gray-500'}`}></i>
                  <span>{link.label}</span>
                </Link>
              )
            })}
          </nav>

          {/* Footer Sidebar */}
          <div className="pt-4 mt-4 border-t border-white/10">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-xs font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all duration-200"
            >
              <i className="bi bi-box-arrow-left text-base"></i>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-gray-50 pb-28 md:pb-8">
        <div className="max-w-7xl mx-auto p-3.5 md:p-8">
          {children}
        </div>
      </main>

      {/* Bottom Sheet Móvil: Más Opciones */}
      {isMoreMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setIsMoreMenuOpen(false)}
          ></div>
          <div className="relative bg-white rounded-t-3xl p-5 shadow-2xl max-h-[85vh] overflow-y-auto z-10 animate-in slide-in-from-bottom duration-300">
            <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-4"></div>
            
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight">Menú de Herramientas</h3>
                <p className="text-xs text-gray-500 font-medium">Accesos rápidos de administración</p>
              </div>
              <button
                onClick={() => setIsMoreMenuOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"
              >
                <i className="bi bi-x-lg text-xs"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {secondaryLinks.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMoreMenuOpen(false)}
                    className={`flex items-center gap-3.5 p-3 rounded-2xl border transition-all active:scale-[0.98] ${
                      isActive
                        ? 'bg-blue-50/80 border-blue-200 text-blue-900'
                        : 'bg-gray-50/60 border-gray-100 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base shrink-0 ${
                      isActive ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-100'
                    }`}>
                      <i className={`bi ${item.icon}`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900">{item.label}</p>
                      <p className="text-[11px] text-gray-400 font-medium truncate">{item.desc}</p>
                    </div>
                    <i className="bi bi-chevron-right text-xs text-gray-300"></i>
                  </Link>
                )
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 text-xs font-bold border border-red-100 active:scale-95 transition-all"
              >
                <i className="bi bi-box-arrow-left"></i>
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Navegación Inferior (Móvil) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200/80 px-2 py-2 flex items-center justify-around md:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[max(8px,env(safe-area-inset-bottom))]">
        <Link
          href="/admin"
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all active:scale-90 ${
            pathname === '/admin'
              ? 'text-blue-600 font-black'
              : 'text-gray-400 hover:text-gray-600 font-medium'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all ${
            pathname === '/admin' ? 'bg-blue-50 text-blue-600 scale-105' : ''
          }`}>
            <i className="bi bi-shop"></i>
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Negocios</span>
        </Link>

        <Link
          href="/admin/dashboard"
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all active:scale-90 ${
            pathname === '/admin/dashboard'
              ? 'text-blue-600 font-black'
              : 'text-gray-400 hover:text-gray-600 font-medium'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all ${
            pathname === '/admin/dashboard' ? 'bg-blue-50 text-blue-600 scale-105' : ''
          }`}>
            <i className="bi bi-bar-chart-fill"></i>
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Métricas</span>
        </Link>

        <Link
          href="/admin/deliveries"
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all active:scale-90 ${
            pathname === '/admin/deliveries'
              ? 'text-blue-600 font-black'
              : 'text-gray-400 hover:text-gray-600 font-medium'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all ${
            pathname === '/admin/deliveries' ? 'bg-blue-50 text-blue-600 scale-105' : ''
          }`}>
            <i className="bi bi-scooter"></i>
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Deliveries</span>
        </Link>

        <button
          onClick={() => setIsMoreMenuOpen(true)}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all active:scale-90 ${
            isMoreMenuOpen || isSecondaryActive
              ? 'text-blue-600 font-black'
              : 'text-gray-400 hover:text-gray-600 font-medium'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all ${
            isMoreMenuOpen || isSecondaryActive ? 'bg-blue-50 text-blue-600 scale-105' : ''
          }`}>
            <i className="bi bi-grid-fill"></i>
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Más</span>
        </button>
      </nav>
    </div>
  )
}
