'use client'

import { useState, useEffect } from 'react'
import { Users, CheckCircle2, AlertCircle, RefreshCw, ExternalLink, ShieldCheck, UserCheck } from 'lucide-react'

interface ContactsStatus {
  configured: boolean
  missingConfig?: string[]
  connected: boolean
  connectedEmail?: string | null
  updatedAt?: any
}

export function GoogleContactsSettings() {
  const [status, setStatus] = useState<ContactsStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    success: boolean
    total?: number
    syncedCount?: number
    failedCount?: number
    message?: string
    errors?: string[]
  } | null>(null)

  const fetchStatus = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/google-contacts/status')
      const data = await res.json()
      setStatus(data)
    } catch (error) {
      console.error('Error al obtener estado de Google Contacts:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()

    // Manejar parámetros en la URL si regresa del callback de OAuth
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const contactsParam = urlParams.get('contacts')
      const msgParam = urlParams.get('message')

      if (contactsParam === 'connected') {
        setSyncResult({
          success: true,
          message: '¡Google Contacts se ha conectado exitosamente con la cuenta central!'
        })
      } else if (contactsParam === 'error') {
        setSyncResult({
          success: false,
          message: msgParam || 'Ocurrió un error al vincular la cuenta de Google Contacts.'
        })
      }
    }
  }, [])

  const handleConnect = () => {
    window.location.href = '/api/google-contacts/connect'
  }

  const handleSyncAll = async () => {
    if (!confirm('¿Deseas sincronizar todos los clientes de la base de datos a tu cuenta de Google Contacts?')) {
      return
    }

    try {
      setSyncingAll(true)
      setSyncResult(null)
      const res = await fetch('/api/google-contacts/sync-all', {
        method: 'POST'
      })
      const data = await res.json()

      if (res.ok && data.success) {
        setSyncResult({
          success: true,
          total: data.total,
          syncedCount: data.syncedCount,
          failedCount: data.failedCount,
          errors: data.errors,
          message: `Sincronización completada: ${data.syncedCount} de ${data.total} clientes agregados a Google Contacts.`
        })
      } else {
        setSyncResult({
          success: false,
          message: data.message || data.error || 'Error al ejecutar la sincronización masiva.'
        })
      }
    } catch (error: any) {
      setSyncResult({
        success: false,
        message: error.message || 'Error de conexión al sincronizar.'
      })
    } finally {
      setSyncingAll(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all hover:shadow-md">
      {/* Header del Card */}
      <div className="p-6 bg-gradient-to-r from-blue-50/50 via-indigo-50/30 to-purple-50/50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-gray-900 tracking-tight leading-tight text-lg">
                Google Contacts
              </h3>
              <p className="font-medium text-gray-500 leading-relaxed text-xs">
                Sincronización automática de nuevos clientes a tu agenda de Google
              </p>
            </div>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white/80 rounded-lg transition-all"
            title="Recargar estado"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Cuerpo del Card */}
      <div className="p-6 space-y-5">
        {/* Mensaje de Resultado / Alertas */}
        {syncResult && (
          <div
            className={`p-4 rounded-xl text-sm flex items-start gap-3 border ${
              syncResult.success
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {syncResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-semibold text-xs leading-relaxed">{syncResult.message}</p>
              {syncResult.errors && syncResult.errors.length > 0 && (
                <ul className="text-[11px] list-disc list-inside text-rose-700 space-y-0.5 opacity-90 mt-1">
                  {syncResult.errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-xs font-medium">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Consultando estado de sincronización...</span>
          </div>
        ) : status?.connected ? (
          /* Estado Conectado */
          <div className="space-y-5">
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold shadow-sm">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Conectado
                    </span>
                  </div>
                  <p className="font-bold text-gray-800 text-sm mt-0.5">
                    {status.connectedEmail || 'munchys.ec@gmail.com'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleConnect}
                className="text-xs font-bold text-gray-500 hover:text-gray-800 underline decoration-gray-300 transition-all"
              >
                Reconectar
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 text-slate-700 font-bold">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <span>Sincronización Automática Activa</span>
              </div>
              <p className="text-gray-500 leading-relaxed text-[11px]">
                Cada nuevo cliente registrado mediante compras, reservas o pedidos manuales se guardará de forma automática en la lista de contactos de Google de la cuenta central.
              </p>
            </div>

            {/* Acciones */}
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSyncAll}
                disabled={syncingAll}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all duration-200 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncingAll ? 'animate-spin' : ''}`} />
                {syncingAll ? 'Sincronizando clientes...' : 'Sincronizar clientes existentes'}
              </button>

              <a
                href="https://contacts.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 font-bold text-xs rounded-xl transition-all duration-200"
              >
                <span>Ver contactos en Google</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ) : (
          /* Estado Desconectado o Faltante de Configuración */
          <div className="space-y-4">
            <p className="font-medium text-gray-600 text-xs leading-relaxed">
              Vincula la cuenta de Google central (<strong className="text-gray-900 font-bold">munchys.ec@gmail.com</strong>) para respaldar y guardar automáticamente los teléfonos y nombres de tus clientes como contactos de Google.
            </p>

            {status?.configured === false && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>Configuración pendiente en el servidor</span>
                </p>
                <p className="text-[11px] mt-1 text-amber-700 leading-relaxed">
                  Asegúrate de definir las variables de entorno necesarias en <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono">.env.local</code>:
                </p>
                <ul className="list-disc list-inside text-[11px] mt-1 space-y-0.5 font-mono text-amber-900">
                  {status.missingConfig?.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={handleConnect}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs tracking-tight rounded-xl shadow-md transition-all duration-200 transform active:scale-98"
              >
                <Users className="w-4 h-4" />
                <span>Conectar Google Contacts</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
