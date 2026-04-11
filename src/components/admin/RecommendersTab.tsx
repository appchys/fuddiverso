'use client'

import { useState } from 'react'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import { getAllClientsGlobal, addWalletBalance, getUserReferrals, getOrdersByReferralCode } from '@/lib/database'
import { Business } from '@/types'

interface RecommendersTabProps {
  customers: any[]
  globalClients: any[]
  recommenders: any[]
  businesses: Business[]
}

export default function RecommendersTab({
  customers,
  globalClients,
  recommenders,
  businesses
}: RecommendersTabProps) {
  // WALLET CREDIT FORM STATE
  const [walletForm, setWalletForm] = useState({ phone: '', amount: '', concept: '' })
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletMessage, setWalletMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleCreditWallet = async () => {
    setWalletMessage(null)
    const { phone, amount, concept } = walletForm

    if (!phone.trim()) return setWalletMessage({ type: 'error', text: 'Ingresa un número de celular.' })
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return setWalletMessage({ type: 'error', text: 'Ingresa un monto válido mayor a 0.' })
    if (!concept.trim()) return setWalletMessage({ type: 'error', text: 'Ingresa un concepto.' })

    const normalizedPhone = normalizeEcuadorianPhone(phone.trim())

    setWalletLoading(true)
    try {
      // Buscar el cliente para obtener su ID real
      const allClients = await getAllClientsGlobal()
      const client = allClients.find(
        c => normalizeEcuadorianPhone(c.celular || '') === normalizedPhone
      )

      const userId = client?.id || normalizedPhone // fallback: usar el teléfono normalizado como userId

      // Usar el primer negocio disponible o 'global' si no hay negocios
      const businessId = businesses[0]?.id || 'global'

      await addWalletBalance(
        userId,
        businessId,
        Number(amount),
        concept.trim(),
        'admin' // createdBy
      )

      setWalletMessage({
        type: 'success',
        text: `✅ Se acreditaron $${Number(amount).toFixed(2)} a ${client?.nombres || normalizedPhone} correctamente.`
      })
      setWalletForm({ phone: '', amount: '', concept: '' })
    } catch (err) {
      console.error('Error crediting wallet:', err)
      setWalletMessage({ type: 'error', text: 'Ocurrió un error al acreditar el saldo.' })
    } finally {
      setWalletLoading(false)
    }
  }

  // Buscar nombre del cliente al vuelo si está escribiendo un celular
  const normalizedWalletPhone = walletForm.phone ? normalizeEcuadorianPhone(walletForm.phone.trim()) : '';
  const foundClientName = normalizedWalletPhone ? (
    globalClients.find(c => c.celular && normalizeEcuadorianPhone(c.celular) === normalizedWalletPhone)?.nombres ||
    customers.find(c => c.phone && normalizeEcuadorianPhone(c.phone) === normalizedWalletPhone)?.name
  ) : null;

  // LINKS MODAL STATE
  const [linksModal, setLinksModal] = useState<{ open: boolean; userName: string; userPhone: string }>({ open: false, userName: '', userPhone: '' })
  const [userLinks, setUserLinks] = useState<any[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [expandedLink, setExpandedLink] = useState<string | null>(null)
  const [linkSales, setLinkSales] = useState<any[]>([])
  const [salesLoading, setSalesLoading] = useState(false)

  const handleViewLinks = async (phone: string, name: string) => {
    setLinksModal({ open: true, userName: name, userPhone: phone })
    setLinksLoading(true)
    setUserLinks([])
    setExpandedLink(null)
    setLinkSales([])
    try {
      const links = await getUserReferrals(phone)
      setUserLinks(links || [])
    } catch (err) {
      console.error('Error fetching user links:', err)
    } finally {
      setLinksLoading(false)
    }
  }

  const handleToggleLinkSales = async (linkId: string, code: string) => {
    if (expandedLink === linkId) {
      setExpandedLink(null)
      setLinkSales([])
      return
    }
    setExpandedLink(linkId)
    setSalesLoading(true)
    setLinkSales([])
    try {
      const orders = await getOrdersByReferralCode(code)
      setLinkSales(orders)
    } catch (err) {
      console.error('Error fetching link sales:', err)
    } finally {
      setSalesLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ACREDITAR SALDO */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <i className="bi bi-wallet2 text-lg"></i>
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Acreditar Saldo</h3>
            <p className="text-xs text-gray-500">Acredita saldo manualmente a la billetera de un usuario</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
              Celular del usuario
            </label>
            <input
              type="tel"
              placeholder="0990000000 o +593 99 000 0000"
              value={walletForm.phone}
              onChange={e => setWalletForm(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {walletForm.phone.trim() !== '' && (
              <div className="mt-1 text-[11px] font-semibold">
                {foundClientName ? (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <i className="bi bi-person-check-fill"></i> {foundClientName}
                  </span>
                ) : (
                  <span className="text-amber-600/70 flex items-center gap-1">
                    <i className="bi bi-info-circle"></i> Usuario no registrado
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
              Monto ($)
            </label>
            <input
              type="number"
              placeholder="0.00"
              min="0.01"
              step="0.01"
              value={walletForm.amount}
              onChange={e => setWalletForm(prev => ({ ...prev, amount: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
              Concepto
            </label>
            <input
              type="text"
              placeholder="Ej: Devolución entrega fallida"
              value={walletForm.concept}
              onChange={e => setWalletForm(prev => ({ ...prev, concept: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {walletMessage && (
          <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${walletMessage.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
            {walletMessage.text}
          </div>
        )}

        <button
          onClick={handleCreditWallet}
          disabled={walletLoading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {walletLoading ? (
            <>
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
              Acreditando...
            </>
          ) : (
            <>
              <i className="bi bi-plus-circle"></i>
              Acreditar Saldo
            </>
          )}
        </button>
      </div>

      {/* TOP RECOMENDADORES */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 sm:p-6 border-b border-gray-100">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Top Recomendadores</h3>
          <p className="text-xs sm:text-sm text-gray-500">Usuarios que más comparten y generan ventas</p>
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usuario</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Links Creados</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Clicks</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center font-bold text-red-600">Ventas (Conv)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Créditos</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recommenders.map((r) => (
                <tr key={r.phone} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-full overflow-hidden border border-gray-200 flex items-center justify-center flex-shrink-0">
                        {r.image ? (
                          <img
                            src={r.image}
                            alt={r.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name)}&background=random`
                            }}
                          />
                        ) : (
                          <i className="bi bi-person text-xl text-gray-400"></i>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900">{r.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                    <button
                      onClick={() => handleViewLinks(r.phone, r.name)}
                      className="text-blue-600 hover:text-blue-800 font-semibold hover:underline cursor-pointer"
                    >
                      {r.linksCount}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">{r.clicks}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">
                      {r.conversions} ventas
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="text-sm font-bold text-gray-900">Acumulado: ${r.totalCredits.toFixed(2)}</div>
                    <div className="text-xs text-emerald-600">Disponibles ${r.credits.toFixed(2)}</div>
                  </td>
                </tr>
              ))}
              {recommenders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    No hay datos de recomendaciones registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden divide-y divide-gray-100">
          {recommenders.length > 0 ? recommenders.map((r) => (
            <div key={r.phone} className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full overflow-hidden border border-gray-200 flex items-center justify-center flex-shrink-0">
                  {r.image ? (
                    <img
                      src={r.image}
                      alt={r.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(r.name)}&background=random`
                      }}
                    />
                  ) : (
                    <i className="bi bi-person text-xl text-gray-400"></i>
                  )}
                </div>
                <span className="text-sm font-bold text-gray-900">{r.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <div className="text-xs text-gray-500 uppercase">Links</div>
                  <button
                    onClick={() => handleViewLinks(r.phone, r.name)}
                    className="font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer w-full"
                  >
                    {r.linksCount}
                  </button>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <div className="text-xs text-gray-500 uppercase">Clicks</div>
                  <div className="font-semibold text-gray-900">{r.clicks}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-2 text-center">
                  <div className="text-xs text-red-600 uppercase font-semibold">Ventas</div>
                  <div className="font-bold text-red-800">{r.conversions}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-2 text-center">
                  <div className="text-xs text-emerald-600 uppercase font-semibold">Crédito</div>
                  <div className="font-bold text-gray-900 text-xs">Acum: ${r.totalCredits.toFixed(2)}</div>
                  <div className="text-xs text-emerald-600">Disp: ${r.credits.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )) : (
            <div className="px-6 py-10 text-center text-gray-500 text-sm">
              No hay datos de recomendaciones registrados aún.
            </div>
          )}
        </div>
      </div>

      {/* LINKS MODAL */}
      {linksModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setLinksModal({ open: false, userName: '', userPhone: '' })}></div>
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col z-10">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Links de {linksModal.userName}</h3>
                <p className="text-xs text-gray-500">{linksModal.userPhone}</p>
              </div>
              <button
                onClick={() => setLinksModal({ open: false, userName: '', userPhone: '' })}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-5">
              {linksLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  <span className="ml-3 text-sm text-gray-500">Cargando links...</span>
                </div>
              ) : userLinks.length > 0 ? (
                <div className="space-y-3">
                  {userLinks.map((link) => (
                    <div key={link.id} className="border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors">
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {link.productImage && (
                                <img
                                  src={link.productImage}
                                  alt=""
                                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                                />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900 truncate">{link.productName || 'Producto'}</p>
                                <p className="text-xs text-gray-500 truncate">{link.businessName || ''}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                              <span className="inline-flex items-center gap-1">
                                <i className="bi bi-code-slash"></i>
                                <code className="bg-gray-100 px-1.5 py-0.5 rounded">{link.code}</code>
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1 text-xs flex-shrink-0">
                            <div className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-semibold">
                              {link.clicks || 0} clicks
                            </div>
                            <button
                              onClick={() => handleToggleLinkSales(link.id, link.code)}
                              className="bg-red-50 text-red-700 px-2.5 py-1 rounded-full font-semibold hover:bg-red-100 transition-colors cursor-pointer flex items-center gap-1"
                            >
                              {link.conversions || 0} ventas
                              <i className={`bi bi-chevron-${expandedLink === link.id ? 'up' : 'down'} text-[10px]`}></i>
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          Creado: {link.createdAt ? new Date(link.createdAt.toDate ? link.createdAt.toDate() : link.createdAt).toLocaleDateString('es-ES') : 'N/A'}
                        </p>
                      </div>

                      {/* Expanded Sales */}
                      {expandedLink === link.id && (
                        <div className="border-t border-gray-100 bg-gray-50 p-4">
                          <h4 className="text-xs font-bold text-gray-700 uppercase mb-3">Ventas generadas</h4>
                          {salesLoading && expandedLink === link.id ? (
                            <div className="flex items-center justify-center py-6">
                              <div className="animate-spin h-4 w-4 border-2 border-red-600 border-t-transparent rounded-full"></div>
                              <span className="ml-2 text-xs text-gray-500">Cargando ventas...</span>
                            </div>
                          ) : linkSales.length > 0 ? (
                            <div className="space-y-2">
                              {linkSales.map((order) => (
                                <div key={order.id} className="bg-white rounded-lg border border-gray-200 p-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        {order.customer?.imagen && (
                                          <img
                                            src={order.customer.imagen}
                                            alt=""
                                            className="w-8 h-8 rounded-full object-cover"
                                          />
                                        )}
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium text-gray-900 truncate">
                                            {order.customer?.nombres || order.customer?.name || 'Cliente'}
                                          </p>
                                          <p className="text-xs text-gray-500 truncate">
                                            {order.customer?.celular || order.customer?.phone || ''}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-3">
                                      <p className="text-sm font-bold text-gray-900">${order.total?.toFixed(2)}</p>
                                      <p className="text-xs text-gray-500">
                                        {order.createdAt ? new Date(order.createdAt.toDate ? order.createdAt.toDate() : order.createdAt).toLocaleDateString('es-ES') : 'N/A'}
                                      </p>
                                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                        order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                                        order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                        'bg-yellow-100 text-yellow-700'
                                      }`}>
                                        {order.status === 'delivered' ? 'Entregada' :
                                         order.status === 'cancelled' ? 'Cancelada' :
                                         order.status || 'Pendiente'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-center text-xs text-gray-500 py-4">
                              No hay ventas registradas para este link.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10">
                  <i className="bi bi-link-45deg text-4xl text-gray-300 mb-3 block"></i>
                  <p className="text-sm text-gray-500">Este usuario no ha creado ningún link aún.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
