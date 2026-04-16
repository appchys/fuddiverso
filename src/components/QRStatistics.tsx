'use client'

import { useState, useEffect } from 'react'
import { QRCode } from '@/types'
import {
  getQRScanStatistics,
  getTopQRScanners,
  getQRStatisticsDetail
} from '@/lib/database'

interface QRScannerStats {
  userId: string
  userName?: string
  scannedCount: number
  scannedCodes: string[]
  completed: boolean
  lastScanned?: any
}

interface QRStatisticsProps {
  businessId: string
  qrCodes: QRCode[]
  initialTab?: 'overview' | 'scans' | 'users'
}

export default function QRStatistics({ businessId, qrCodes, initialTab = 'overview' }: QRStatisticsProps) {
  const [loading, setLoading] = useState(true)
  const [scanStats, setScanStats] = useState<{ [key: string]: number }>({})
  const [topScanners, setTopScanners] = useState<QRScannerStats[]>([])
  const [detailStats, setDetailStats] = useState({
    totalUsers: 0,
    totalScans: 0,
    averageScansPerUser: 0,
    usersCompleted: 0,
    completionRate: 0
  })
  const [activeTab, setActiveTab] = useState<'overview' | 'scans' | 'users'>(initialTab)
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set(['Sin campaña']))

  useEffect(() => {
    loadStatistics()
  }, [businessId])

  const loadStatistics = async () => {
    try {
      setLoading(true)
      const [scans, scanners, details] = await Promise.all([
        getQRScanStatistics(businessId),
        getTopQRScanners(businessId, 10),
        getQRStatisticsDetail(businessId)
      ])

      setScanStats(scans)
      setTopScanners(scanners)
      setDetailStats(details)
    } catch (error) {
      console.error('Error loading QR statistics:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-center py-12">
          <i className="bi bi-arrow-repeat animate-spin text-2xl text-red-600 mr-3"></i>
          <p className="text-gray-600">Cargando estadísticas...</p>
        </div>
      </div>
    )
  }

  // Obtener información del código QR por ID
  const getQRCodeName = (codeId: string) => {
    const code = qrCodes.find((q) => q.id === codeId)
    return code?.name || 'Código desconocido'
  }

  // Obtener color del código QR
  const getQRCodeColor = (codeId: string) => {
    const code = qrCodes.find((q) => q.id === codeId)
    return code?.color || '#f3f4f6'
  }

  // Agrupar códigos QR por campaña para estadísticas
  const groupedQRStats = qrCodes.reduce((groups, code) => {
    const campaign = code.campaign || 'Sin campaña'
    if (!groups[campaign]) {
      groups[campaign] = []
    }
    groups[campaign].push(code)
    return groups
  }, {} as { [key: string]: QRCode[] })

  // Ordenar campañas alfabéticamente
  const sortedCampaigns = Object.keys(groupedQRStats).sort()

  // Funciones para manejar expansión de campañas
  const toggleCampaignExpansion = (campaign: string) => {
    const newExpanded = new Set(expandedCampaigns)
    if (newExpanded.has(campaign)) {
      newExpanded.delete(campaign)
    } else {
      newExpanded.add(campaign)
    }
    setExpandedCampaigns(newExpanded)
  }

  // Calcular estadísticas por campaña
  const getCampaignStats = (campaign: string) => {
    const campaignCodes = groupedQRStats[campaign] || []
    const totalScans = campaignCodes.reduce((sum, code) => sum + (scanStats[code.id] || 0), 0)
    const activeCodes = campaignCodes.filter(code => code.isActive).length
    return { totalScans, activeCodes, totalCodes: campaignCodes.length }
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm border-b">
        <div className="flex flex-wrap">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'text-red-600 border-red-600'
                : 'text-gray-600 border-transparent hover:text-gray-800'
            }`}
          >
            <i className="bi bi-graph-up me-2"></i>
            Resumen General
          </button>
          <button
            onClick={() => setActiveTab('scans')}
            className={`flex-1 px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'scans'
                ? 'text-red-600 border-red-600'
                : 'text-gray-600 border-transparent hover:text-gray-800'
            }`}
          >
            <i className="bi bi-qr-code me-2"></i>
            Escaneos por QR
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'text-red-600 border-red-600'
                : 'text-gray-600 border-transparent hover:text-gray-800'
            }`}
          >
            <i className="bi bi-people me-2"></i>
            Top Usuarios
          </button>
        </div>
      </div>

      {/* Tab: Resumen General */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total de Usuarios */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 shadow-sm border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-900">Total Usuarios</span>
              <i className="bi bi-people-fill text-2xl text-blue-600"></i>
            </div>
            <p className="text-3xl font-bold text-blue-900">{detailStats.totalUsers}</p>
            <p className="text-xs text-blue-700 mt-2">
              Participantes en la campaña
            </p>
          </div>

          {/* Total de Escaneos */}
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 shadow-sm border border-green-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-green-900">Total Escaneos</span>
              <i className="bi bi-qr-code text-2xl text-green-600"></i>
            </div>
            <p className="text-3xl font-bold text-green-900">{detailStats.totalScans}</p>
            <p className="text-xs text-green-700 mt-2">
              Escaneos realizados
            </p>
          </div>

          {/* Promedio de Escaneos */}
          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-6 shadow-sm border border-yellow-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-yellow-900">Promedio</span>
              <i className="bi bi-graph-up text-2xl text-yellow-600"></i>
            </div>
            <p className="text-3xl font-bold text-yellow-900">
              {detailStats.averageScansPerUser.toFixed(2)}
            </p>
            <p className="text-xs text-yellow-700 mt-2">
              Escaneos por usuario
            </p>
          </div>

          {/* Usuarios Completados */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 shadow-sm border border-purple-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-purple-900">Completados</span>
              <i className="bi bi-check-circle-fill text-2xl text-purple-600"></i>
            </div>
            <p className="text-3xl font-bold text-purple-900">{detailStats.usersCompleted}</p>
            <p className="text-xs text-purple-700 mt-2">
              Colección completada
            </p>
          </div>

          {/* Tasa de Completación */}
          <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-6 shadow-sm border border-red-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-red-900">Completación</span>
              <i className="bi bi-percent text-2xl text-red-600"></i>
            </div>
            <p className="text-3xl font-bold text-red-900">
              {detailStats.completionRate.toFixed(1)}%
            </p>
            <p className="text-xs text-red-700 mt-2">
              De usuarios con colección completa
            </p>
          </div>
        </div>
      )}

      {/* Tab: Escaneos por QR */}
      {activeTab === 'scans' && (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6 border-b">
            <h3 className="text-lg font-bold text-gray-800 flex items-center">
              <i className="bi bi-qr-code me-2 text-red-600"></i>
              Cantidad de Escaneos por Código QR
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Escaneos agrupados por campaña
            </p>
          </div>

          {qrCodes.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <i className="bi bi-inbox text-4xl text-gray-300 mb-3"></i>
              <p>No hay códigos QR creados aún</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedCampaigns.map((campaign) => {
                const stats = getCampaignStats(campaign)
                const isExpanded = expandedCampaigns.has(campaign)
                const campaignCodes = groupedQRStats[campaign] || []
                const maxScans = Math.max(...campaignCodes.map(q => scanStats[q.id] || 0), 1)

                return (
                  <div key={campaign} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* Header de campaña */}
                    <button
                      onClick={() => toggleCampaignExpansion(campaign)}
                      className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded flex items-center justify-center transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                          <i className="bi bi-chevron-right text-gray-600 text-sm"></i>
                        </div>
                        <div className="text-left">
                          <h4 className="font-bold text-gray-900">{campaign}</h4>
                          <p className="text-sm text-gray-500">
                            {stats.totalCodes} códigos ({stats.activeCodes} activos) - {stats.totalScans} escaneos totales
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-red-600">{stats.totalScans}</span>
                        {campaign !== 'Sin campaña' && (
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                            Campaña
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Contenido de campaña */}
                    {isExpanded && (
                      <div className="border-t border-gray-200">
                        {campaignCodes.map((code) => {
                          const scanCount = scanStats[code.id] || 0
                          const percentage = (scanCount / maxScans) * 100

                          return (
                            <div key={code.id} className="p-4 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                  <div
                                    className="w-4 h-4 rounded-full"
                                    style={{ backgroundColor: code.color || '#f3f4f6' }}
                                  ></div>
                                  <span className="font-medium text-gray-800">{code.name}</span>
                                  {!code.isActive && (
                                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">
                                      Inactivo
                                    </span>
                                  )}
                                </div>
                                <span className="font-bold text-lg text-red-600">{scanCount}</span>
                              </div>

                              {/* Barra de progreso */}
                              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-red-500 to-red-600 h-full transition-all duration-300"
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>

                              {/* Información adicional */}
                              <div className="text-xs text-gray-500 mt-2">
                                {scanCount === 0
                                  ? 'Sin escaneos'
                                  : `${percentage.toFixed(0)}% del máximo de esta campaña`}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Top Usuarios */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6 border-b">
            <h3 className="text-lg font-bold text-gray-800 flex items-center">
              <i className="bi bi-trophy me-2 text-yellow-600"></i>
              Usuarios con Más Escaneos
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Top 10 de usuarios que más códigos QR han escaneado
            </p>
          </div>

          {topScanners.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <i className="bi bi-inbox text-4xl text-gray-300 mb-3"></i>
              <p>No hay datos de escaneos aún</p>
            </div>
          ) : (
            <div className="divide-y">
              {topScanners.map((scanner, index) => (
                <div
                  key={`${scanner.userId}-${index}`}
                  className="p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                      {/* Medalla/Número */}
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0
                            ? 'bg-yellow-100 text-yellow-700'
                            : index === 1
                            ? 'bg-gray-300 text-gray-700'
                            : index === 2
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                      </div>

                      {/* Información del usuario */}
                      <div>
                        <p className="font-medium text-gray-800">
                          {scanner.userName || 'Usuario desconocido'}
                        </p>
                        <p className="text-xs text-gray-600">
                          {scanner.userId}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                          {scanner.completed && (
                            <>
                              <i className="bi bi-check-circle text-green-600"></i>
                              <span>Colección completada</span>
                            </>
                          )}
                          {scanner.lastScanned && (
                            <span className="flex items-center gap-1">
                              •{' '}
                              {new Date(
                                scanner.lastScanned.toMillis?.() ||
                                scanner.lastScanned
                              ).toLocaleDateString('es-EC')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Contador de escaneos */}
                    <div className="text-right">
                      <div className="text-2xl font-bold text-red-600">
                        {scanner.scannedCount}
                      </div>
                      <div className="text-xs text-gray-500">
                        de {qrCodes.length} códigos
                      </div>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div className="mb-3 w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        scanner.completed
                          ? 'bg-gradient-to-r from-green-500 to-green-600'
                          : 'bg-gradient-to-r from-blue-500 to-blue-600'
                      }`}
                      style={{
                        width: `${(scanner.scannedCount / qrCodes.length) * 100}%`
                      }}
                    ></div>
                  </div>

                  {/* Códigos escaneados */}
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-700 mb-2">Códigos escaneados:</p>
                    <div className="flex flex-wrap gap-2">
                      {qrCodes.map((code) => {
                        const isScanned = scanner.scannedCodes?.includes(code.id)
                        return (
                          <div
                            key={code.id}
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              isScanned
                                ? 'bg-green-100 text-green-700 border border-green-300'
                                : 'bg-gray-100 text-gray-500 border border-gray-300'
                            }`}
                          >
                            {isScanned && <i className="bi bi-check-circle"></i>}
                            <span>{code.name || 'Código'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Botón para refrescar */}
      <div className="flex justify-center">
        <button
          onClick={loadStatistics}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
        >
          <i className="bi bi-arrow-clockwise"></i>
          Refrescar Estadísticas
        </button>
      </div>
    </div>
  )
}
