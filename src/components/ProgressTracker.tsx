'use client'

import { QRCode, UserQRProgress } from '@/types'
import { claimReward } from '@/lib/database'
import { useState, useMemo, useEffect } from 'react'

interface ProgressTrackerProps {
  qrCodes: QRCode[]
  progress: UserQRProgress | null
  userId: string
  onRewardClaimed: () => void
}

export default function ProgressTracker({
  qrCodes,
  progress,
  userId,
  onRewardClaimed
}: ProgressTrackerProps) {
  const [claiming, setClaiming] = useState(false)
  const [claimMessage, setClaimMessage] = useState('')
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set())

  const scannedCount = progress?.scannedCodes.length || 0
  const totalCodes = 5
  const progressPercentage = (scannedCount / totalCodes) * 100

  // Agrupar códigos QR por campaña
  const groupedQRCodes = useMemo(() => {
    const groups: { [key: string]: QRCode[] } = {}
    
    qrCodes.forEach(qr => {
      const campaign = qr.campaign || 'Sin campaña'
      if (!groups[campaign]) {
        groups[campaign] = []
      }
      groups[campaign].push(qr)
    })
    
    // Ordenar códigos dentro de cada campaña por nombre
    Object.keys(groups).forEach(campaign => {
      groups[campaign].sort((a, b) => a.name.localeCompare(b.name))
    })
    
    return groups
  }, [qrCodes])

  // Ordenar campañas alfabéticamente
  const sortedCampaigns = useMemo(() => {
    return Object.keys(groupedQRCodes).sort()
  }, [groupedQRCodes])

  // Inicializar todas las campañas como expandidas cuando hay datos
  useEffect(() => {
    if (sortedCampaigns.length > 0) {
      setExpandedCampaigns(new Set(sortedCampaigns))
    }
  }, [sortedCampaigns])

  // Función para manejar expansión de campañas
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
    const campaignCodes = groupedQRCodes[campaign] || []
    const scannedInCampaign = campaignCodes.filter(qr => progress?.scannedCodes.includes(qr.id)).length
    return { scannedInCampaign, totalCodes: campaignCodes.length }
  }

  const handleClaimReward = async () => {
    if (!progress?.businessId) return

    setClaiming(true)
    setClaimMessage('')

    try {
      const result = await claimReward(userId, progress.businessId)
      setClaimMessage(result.message)

      if (result.success) {
        setTimeout(() => {
          onRewardClaimed()
        }, 2000)
      }
    } catch (error) {
      setClaimMessage('Error al reclamar la recompensa')
    } finally {
      setClaiming(false)
    }
  }

  // Función para determinar si un color es claro u oscuro
  const isLightColor = (hexColor: string): boolean => {
    // Convertir hex a RGB
    const hex = hexColor.replace('#', '')
    const r = parseInt(hex.substr(0, 2), 16)
    const g = parseInt(hex.substr(2, 2), 16)
    const b = parseInt(hex.substr(4, 2), 16)

    // Calcular luminosidad usando la fórmula estándar
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    return luminance > 0.5
  }

  return (
    <div className="space-y-6">

      {/* Lista de códigos agrupados por campaña */}
      <div className="bg-white rounded-lg shadow-md p-6">

        <div className="space-y-4">
          {sortedCampaigns.map((campaign) => {
            const stats = getCampaignStats(campaign)
            const isExpanded = expandedCampaigns.has(campaign)
            const campaignCodes = groupedQRCodes[campaign] || []

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
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="text-lg font-bold text-red-600">{stats.scannedInCampaign}/{stats.totalCodes}</div>
                    </div>
                  </div>
                </button>

                {/* Contenido de campaña */}
                {isExpanded && (
                  <div className="border-t border-gray-200 p-4">
                    <div className="overflow-x-auto scrollbar-hide">
                      <div className="flex gap-4 pb-2" style={{ minWidth: 'max-content' }}>
                        {campaignCodes.map((qrCode) => {
                          const isScanned = progress?.scannedCodes.includes(qrCode.id)
                          const textColor = isScanned && qrCode.color && isLightColor(qrCode.color) ? 'text-gray-800' : 'text-white'

                          return (
                            <div
                              key={qrCode.id}
                              className={`relative flex flex-col items-center p-4 rounded-xl border-2 transition-all flex-shrink-0 w-32 ${isScanned
                                ? 'shadow-md'
                                : 'bg-gray-50 border-gray-200 opacity-75'
                                }`}
                              style={isScanned && qrCode.color ? { backgroundColor: qrCode.color, borderColor: qrCode.color } : {}}
                            >
                              {/* Imagen */}
                              <div className={`w-16 h-16 mb-3 rounded-full overflow-hidden border-4 ${isScanned ? 'border-green-100' : 'border-gray-200'
                                }`}>
                                {qrCode.image ? (
                                  <img
                                    src={qrCode.image}
                                    alt={qrCode.name}
                                    className={`w-full h-full object-cover ${!isScanned ? 'grayscale' : ''}`}
                                  />
                                ) : (
                                  <div className={`w-full h-full flex items-center justify-center bg-gray-100 ${!isScanned ? 'grayscale' : ''}`}>
                                    <i className="bi bi-qr-code text-lg text-gray-400"></i>
                                  </div>
                                )}
                              </div>

                              {/* Info */}
                              <h4 className={`font-bold text-center text-xs mb-2 line-clamp-2 leading-tight ${isScanned ? textColor : 'text-gray-800'}`}>
                                {qrCode.name}
                              </h4>
                              {qrCode.prize && (
                                <p className={`text-center text-xs mb-2 line-clamp-2 ${isScanned ? textColor : 'text-gray-500'}`}>
                                  {qrCode.prize}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

          </div>
  )
}
