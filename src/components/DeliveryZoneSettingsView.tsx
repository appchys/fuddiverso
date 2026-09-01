'use client'

import React, { useState, useEffect } from 'react'
import { Business, CoverageZone, BusinessDeliveryZoneSettings, BusinessZoneFeeConfig } from '@/types'
import { getCoverageZones, getCoverageZonesByGroup, updateBusiness } from '@/lib/database'

interface DeliveryZoneSettingsViewProps {
  business: Business
  onBusinessFieldChange?: (field: keyof Business, value: any) => void
  onDirectUpdate?: (field: keyof Business, value: any) => Promise<void>
}

export default function DeliveryZoneSettingsView({
  business,
  onBusinessFieldChange,
  onDirectUpdate
}: DeliveryZoneSettingsViewProps) {
  const [zones, setZones] = useState<CoverageZone[]>([])
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Estado del formulario de configuración de zonas
  const [useCustomFees, setUseCustomFees] = useState<boolean>(
    business.deliveryZoneSettings?.useCustomFees ?? false
  )

  const [zoneConfigs, setZoneConfigs] = useState<Record<string, BusinessZoneFeeConfig>>(() => {
    return business.deliveryZoneSettings?.zones || {}
  })

  // Cargar zonas de cobertura correspondientes a la ciudad/grupo de la tienda
  useEffect(() => {
    const loadZones = async () => {
      setLoading(true)
      try {
        let loadedZones: CoverageZone[] = []
        if (business.groupId) {
          loadedZones = await getCoverageZonesByGroup(business.groupId)
        }
        
        // Si no hay por grupo o no tiene groupId, cargar todas las globales
        if (loadedZones.length === 0) {
          const allZones = await getCoverageZones()
          loadedZones = allZones.filter(z => !z.businessId && z.isActive)
        } else {
          loadedZones = loadedZones.filter(z => z.isActive)
        }

        setZones(loadedZones)

        // Inicializar configuraciones para zonas que aún no estén en el objeto
        setZoneConfigs(prev => {
          const next = { ...prev }
          loadedZones.forEach(zone => {
            if (!next[zone.id]) {
              next[zone.id] = {
                zoneId: zone.id,
                enabled: true,
                customFee: zone.deliveryFee
              }
            }
          })
          return next
        })
      } catch (err) {
        console.error('Error cargando zonas de cobertura:', err)
        setErrorMessage('No se pudieron cargar las zonas de entrega.')
      } finally {
        setLoading(false)
      }
    }

    loadZones()
  }, [business.groupId])

  // Sincronizar si cambia el negocio
  useEffect(() => {
    if (business.deliveryZoneSettings) {
      setUseCustomFees(business.deliveryZoneSettings.useCustomFees ?? false)
      if (business.deliveryZoneSettings.zones) {
        setZoneConfigs(prev => ({
          ...prev,
          ...business.deliveryZoneSettings?.zones
        }))
      }
    }
  }, [business.deliveryZoneSettings])

  // Manejar cambio de switch de habilitar zona
  const handleToggleZone = (zoneId: string, enabled: boolean) => {
    setZoneConfigs(prev => {
      const current = prev[zoneId] || { zoneId, enabled: true }
      return {
        ...prev,
        [zoneId]: {
          ...current,
          enabled
        }
      }
    })
    setSaveSuccess(false)
  }

  // Manejar cambio de tarifa personalizada
  const handleFeeChange = (zoneId: string, feeValue: string, defaultFee: number) => {
    const num = parseFloat(feeValue)
    setZoneConfigs(prev => {
      const current = prev[zoneId] || { zoneId, enabled: true }
      return {
        ...prev,
        [zoneId]: {
          ...current,
          customFee: isNaN(num) ? defaultFee : Math.max(0, num)
        }
      }
    })
    setSaveSuccess(false)
  }

  // Restablecer tarifa de una zona a la estándar
  const handleResetToDefaultFee = (zoneId: string, defaultFee: number) => {
    setZoneConfigs(prev => {
      const current = prev[zoneId] || { zoneId, enabled: true }
      return {
        ...prev,
        [zoneId]: {
          ...current,
          customFee: defaultFee
        }
      }
    })
    setSaveSuccess(false)
  }

  // Guardar configuración completa en Firestore
  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage(null)
    setSaveSuccess(false)

    try {
      const newSettings: BusinessDeliveryZoneSettings = {
        useCustomFees: business.deliveryZoneSettings?.useCustomFees ?? (business.deliveryServiceType === 'self'),
        zones: zoneConfigs
      }

      if (onDirectUpdate) {
        await onDirectUpdate('deliveryZoneSettings', newSettings)
      } else if (business.id) {
        await updateBusiness(business.id, {
          deliveryZoneSettings: newSettings
        })
      }

      if (onBusinessFieldChange) {
        onBusinessFieldChange('deliveryZoneSettings', newSettings)
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err: any) {
      console.error('Error guardando configuración de zonas:', err)
      setErrorMessage(err.message || 'Error al guardar la configuración.')
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-gray-500 gap-3">
        <div className="w-8 h-8 border-3 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-medium">Cargando zonas de cobertura...</p>
      </div>
    )
  }

  const isSelfDelivery = (business.deliveryServiceType ?? 'fuddi') === 'self'

  return (
    <div className="space-y-6">
      {/* Banner Informativo sobre el Modo de Entrega */}
      <div className={`border rounded-2xl p-5 ${
        isSelfDelivery 
          ? 'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200/80' 
          : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200/80'
      }`}>
        <div className="flex items-start gap-3.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm text-white ${
            isSelfDelivery ? 'bg-orange-500' : 'bg-blue-600'
          }`}>
            <i className={`bi ${isSelfDelivery ? 'bi-person-badge text-xl' : 'bi-scooter text-xl'}`}></i>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-black text-gray-900 text-sm">
                {isSelfDelivery ? 'Modo: Envíos Propios (Autogestión)' : 'Modo: Delivery Fuddi'}
              </h4>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isSelfDelivery 
                  ? 'bg-orange-100 text-orange-800 border border-orange-200' 
                  : 'bg-blue-100 text-blue-800 border border-blue-200'
              }`}>
                Configurado por Administración
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              {isSelfDelivery
                ? 'Tu tienda gestiona sus propios envíos. Aquí puedes definir la tarifa en dólares que cobrarás a tus clientes por cada sector y desactivar los sectores donde no entregues.'
                : 'La administración de la plataforma gestiona la logística con repartidores de la red Fuddi. Puedes ajustar tus tarifas sugeridas por sector que se aplicarán según las políticas acordadas.'}
            </p>
          </div>
        </div>
      </div>

      {/* Listado de Zonas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h4 className="font-black text-gray-900 text-sm tracking-tight flex items-center gap-2">
              <span>Zonas de entrega</span>
              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {zones.length}
              </span>
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Define tu tarifa de envío y activa o desactiva la entrega para cada sector.
            </p>
          </div>
        </div>

        {zones.length === 0 ? (
          <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-6">
            <i className="bi bi-map text-3xl text-gray-300 mb-2"></i>
            <p className="text-sm font-bold text-gray-700">No hay zonas de cobertura registradas</p>
            <p className="text-xs text-gray-400 mt-1">El administrador aún no ha configurado zonas para tu ciudad.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {zones.map((zone) => {
              const config = zoneConfigs[zone.id] || {
                zoneId: zone.id,
                enabled: true,
                customFee: zone.deliveryFee
              }

              const isEnabled = config.enabled !== false
              const currentFee = typeof config.customFee === 'number' ? config.customFee : zone.deliveryFee
              const isCustomized = currentFee !== zone.deliveryFee

              return (
                <div
                  key={zone.id}
                  className={`border rounded-2xl p-4 transition-all duration-200 ${
                    !isEnabled
                      ? 'bg-gray-50/70 border-gray-200 opacity-75'
                      : 'bg-white border-gray-200 shadow-sm hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Info de la zona */}
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                        !isEnabled
                          ? 'bg-rose-100 text-rose-600'
                          : 'bg-gray-900 text-white'
                      }`}>
                        <i className={`bi ${!isEnabled ? 'bi-slash-circle' : 'bi-geo-alt-fill'}`}></i>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="font-black text-gray-900 text-base leading-snug">
                            {zone.name}
                          </h5>
                          {!isEnabled && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-100 text-rose-700">
                              Sin cobertura
                            </span>
                          )}
                          {isCustomized && isEnabled && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                              Tarifa personalizada
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                          <span>
                            Tarifa base Fuddi: <strong className="text-gray-700 font-bold">${zone.deliveryFee?.toFixed(2) || '0.00'}</strong>
                          </span>
                          {zone.feeMode === 'distance' && (
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                              Cálculo por distancia
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Controles de Cobertura y Tarifa */}
                    <div className="flex items-center gap-3 flex-wrap self-end md:self-center">
                      {/* Switch Cobertura */}
                      <button
                        type="button"
                        onClick={() => handleToggleZone(zone.id, !isEnabled)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                          isEnabled
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        <i className={`bi ${isEnabled ? 'bi-check-circle-fill text-emerald-600' : 'bi-x-circle-fill text-rose-600'}`}></i>
                        <span>{isEnabled ? 'Entregas activas' : 'Sector desactivado'}</span>
                      </button>

                      {/* Input de Tarifa Personalizada */}
                      {isEnabled && (
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-black text-xs">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.25"
                              value={currentFee}
                              onChange={(e) => handleFeeChange(zone.id, e.target.value, zone.deliveryFee)}
                              className="w-24 pl-7 pr-2 py-2 bg-white border border-gray-300 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 rounded-xl text-sm font-black text-gray-900 outline-none transition-all shadow-sm"
                              placeholder="0.00"
                            />
                          </div>

                          {currentFee !== zone.deliveryFee && (
                            <button
                              type="button"
                              onClick={() => handleResetToDefaultFee(zone.id, zone.deliveryFee)}
                              title="Restablecer a la tarifa estándar de Fuddi"
                              className="p-2 text-xs font-semibold text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                              <i className="bi bi-arrow-counterclockwise text-sm"></i>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Alertas y Botón de Guardar */}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-2">
          <i className="bi bi-exclamation-triangle-fill text-red-500"></i>
          <span>{errorMessage}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <i className="bi bi-check-circle-fill text-emerald-500 text-base"></i>
          <span>¡Tarifas de envío guardadas exitosamente!</span>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="w-full sm:w-auto px-6 py-3 bg-gray-900 hover:bg-black text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Guardando...</span>
            </>
          ) : (
            <>
              <i className="bi bi-check2"></i>
              <span>Guardar Tarifas de Envío</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
