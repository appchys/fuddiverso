'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { getUserReferrals, getAllUserCredits } from '@/lib/database'

export interface WalletBalance {
  referralCredits: number
  manualBalance: number
}

export interface ReferralStats {
  totalClicks: number
  totalSales: number
  totalCredits: number
}

export interface ClientRecommendationsData {
  userId: string
  referrals: any[]
  referralStats: ReferralStats
  walletBalance: WalletBalance
  timestamp: number
}

// Memoria compartida a nivel de módulo (persiste entre aperturas de sidebar y cambios de componentes)
let globalMemoryCache: ClientRecommendationsData | null = null
let activeFetchPromise: Promise<ClientRecommendationsData | null> | null = null

// Helper para sessionStorage
const CACHE_TTL_MS = 60 * 1000 // 1 minuto de frescura estricta; después se actualiza en segundo plano (SWR)

function getSessionCache(userId: string): ClientRecommendationsData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(`fuddi_client_recs_${userId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Convertir fechas serializadas a Date
    if (parsed && Array.isArray(parsed.referrals)) {
      parsed.referrals.forEach((r: any) => {
        if (r.lastSaleAt) r.lastSaleAt = new Date(r.lastSaleAt)
      })
    }
    return parsed
  } catch {
    return null
  }
}

function setSessionCache(data: ClientRecommendationsData) {
  if (typeof window === 'undefined' || !data.userId) return
  try {
    window.sessionStorage.setItem(`fuddi_client_recs_${data.userId}`, JSON.stringify(data))
  } catch {
    // Quota exceeded o modo incógnito restringido
  }
}

/**
 * Función central de obtención y enriquecimiento de recomendaciones
 */
async function fetchRecommendationsFromFirestore(user: any): Promise<ClientRecommendationsData | null> {
  if (!user?.id) return null

  const hasPhone = Boolean(user.celular && user.celular !== user.id)

  const [referralsById, referralsByPhone, creditsById, creditsByPhone] = await Promise.all([
    getUserReferrals(user.id),
    hasPhone ? getUserReferrals(user.celular!) : Promise.resolve([]),
    getAllUserCredits(user.id),
    hasPhone ? getAllUserCredits(user.celular!) : Promise.resolve([])
  ])

  // Unificar links sin duplicar por ID
  const combinedReferrals: any[] = [...referralsById]
  referralsByPhone.forEach(ref => {
    if (!combinedReferrals.some(r => r.id === ref.id)) {
      combinedReferrals.push(ref)
    }
  })

  // Unificar créditos
  const combinedCredits: any[] = [...creditsById]
  creditsByPhone.forEach(credit => {
    if (combinedCredits.some(c => c.id === credit.id)) return
    const index = combinedCredits.findIndex(c => c.businessId === credit.businessId)
    if (index === -1) {
      combinedCredits.push(credit)
    } else {
      combinedCredits[index].availableCredits = (combinedCredits[index].availableCredits || 0) + (credit.availableCredits || 0)
      combinedCredits[index].balance = (combinedCredits[index].balance || 0) + (credit.balance || 0)
    }
  })

  // Extraer las fechas exactas de venta por cada código de recomendación
  const lastSaleByCode = new Map<string, Date>()
  const salesCountByCode = new Map<string, number>()

  combinedCredits.forEach(credit => {
    (credit.referrals || []).forEach((r: any) => {
      const code = r.referralCode
      if (code) {
        salesCountByCode.set(code, (salesCountByCode.get(code) || 0) + 1)
        const rawDate = r.completedAt || r.createdAt
        const d = rawDate?.toDate ? rawDate.toDate() : rawDate ? new Date(rawDate) : null
        if (d && !isNaN(d.getTime())) {
          const existing = lastSaleByCode.get(code)
          if (!existing || d > existing) {
            lastSaleByCode.set(code, d)
          }
        }
      }
    })
  })

  // Enriquecer cada referral con ventas y fecha de última venta
  combinedReferrals.forEach(ref => {
    const code = ref.code
    const creditSaleDate = code ? lastSaleByCode.get(code) : null
    const docSaleDate = ref.lastConversionAt?.toDate
      ? ref.lastConversionAt.toDate()
      : ref.lastConversionAt
        ? new Date(ref.lastConversionAt)
        : null

    const recentSaleDate = creditSaleDate || docSaleDate || null
    const creditSales = code ? salesCountByCode.get(code) || 0 : 0
    const totalConversions = Math.max(ref.conversions || 0, creditSales)

    ref.conversions = totalConversions
    ref.lastSaleAt = recentSaleDate
    ref.hasSales = totalConversions > 0 || Boolean(recentSaleDate)
  })

  // ORDENAMIENTO PRIORITARIO:
  // 1. Las que generaron ventas primero
  // 2. Entre las que generaron ventas: la que tuvo la venta MÁS RECIENTE primero
  // 3. Por total de ventas (conversiones)
  // 4. Por clics y fecha de creación del link
  combinedReferrals.sort((a, b) => {
    const aHasSales = a.hasSales ? 1 : 0
    const bHasSales = b.hasSales ? 1 : 0

    // 1. Ventas primero
    if (bHasSales !== aHasSales) {
      return bHasSales - aHasSales
    }

    // 2. Si ambas tienen ventas, la venta más reciente primero
    if (aHasSales && bHasSales) {
      const timeA = a.lastSaleAt instanceof Date ? a.lastSaleAt.getTime() : 0
      const timeB = b.lastSaleAt instanceof Date ? b.lastSaleAt.getTime() : 0
      if (timeB !== timeA) {
        return timeB - timeA
      }
      const convDiff = (b.conversions || 0) - (a.conversions || 0)
      if (convDiff !== 0) return convDiff
    }

    // 3. Clics
    const clicksDiff = (b.clicks || 0) - (a.clicks || 0)
    if (clicksDiff !== 0) return clicksDiff

    // 4. Fecha de creación
    const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt ? new Date(a.createdAt) : new Date(0)
    const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt ? new Date(b.createdAt) : new Date(0)
    return dateB.getTime() - dateA.getTime()
  })

  const referralCredits = combinedCredits.reduce((sum, c) => sum + (c.availableCredits || 0), 0)
  const manualBalance = combinedCredits.reduce((sum, c) => sum + (c.balance || 0), 0)

  const walletBalance: WalletBalance = { referralCredits, manualBalance }
  const referralStats: ReferralStats = {
    totalClicks: combinedReferrals.reduce((sum, r) => sum + (r.clicks || 0), 0),
    totalSales: combinedReferrals.reduce((sum, r) => sum + (r.conversions || 0), 0),
    totalCredits: referralCredits + manualBalance
  }

  const result: ClientRecommendationsData = {
    userId: user.id,
    referrals: combinedReferrals,
    referralStats,
    walletBalance,
    timestamp: Date.now()
  }

  globalMemoryCache = result
  setSessionCache(result)
  return result
}

export function useClientRecommendations(user: any) {
  const [referrals, setReferrals] = useState<any[]>(() => {
    if (globalMemoryCache && user?.id && globalMemoryCache.userId === user.id) {
      return globalMemoryCache.referrals
    }
    return []
  })

  const [walletBalance, setWalletBalance] = useState<WalletBalance>(() => {
    if (globalMemoryCache && user?.id && globalMemoryCache.userId === user.id) {
      return globalMemoryCache.walletBalance
    }
    return { referralCredits: 0, manualBalance: 0 }
  })

  const [referralStats, setReferralStats] = useState<ReferralStats>(() => {
    if (globalMemoryCache && user?.id && globalMemoryCache.userId === user.id) {
      return globalMemoryCache.referralStats
    }
    return { totalClicks: 0, totalSales: 0, totalCredits: 0 }
  })

  const [loading, setLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Sincronizar con caché si el usuario cambia
  useEffect(() => {
    if (!user?.id) {
      setReferrals([])
      setWalletBalance({ referralCredits: 0, manualBalance: 0 })
      setReferralStats({ totalClicks: 0, totalSales: 0, totalCredits: 0 })
      return
    }

    if (globalMemoryCache && globalMemoryCache.userId === user.id) {
      setReferrals(globalMemoryCache.referrals)
      setWalletBalance(globalMemoryCache.walletBalance)
      setReferralStats(globalMemoryCache.referralStats)
      return
    }

    const sessionData = getSessionCache(user.id)
    if (sessionData) {
      globalMemoryCache = sessionData
      setReferrals(sessionData.referrals)
      setWalletBalance(sessionData.walletBalance)
      setReferralStats(sessionData.referralStats)
    }
  }, [user?.id])

  /**
   * Carga las recomendaciones aplicando Stale-While-Revalidate (SWR)
   */
  const loadRecommendations = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!user?.id) return

    const force = options?.forceRefresh ?? false
    const now = Date.now()

    // 1. Si tenemos datos en memoria y no es forzado
    const currentCache = globalMemoryCache?.userId === user.id ? globalMemoryCache : getSessionCache(user.id)

    if (currentCache && !force) {
      // Si la caché está viva en memoria, la aplicamos de inmediato (0ms delay)
      setReferrals(currentCache.referrals)
      setWalletBalance(currentCache.walletBalance)
      setReferralStats(currentCache.referralStats)

      // Si la caché tiene menos de 1 minuto, no hace falta re-consultar la red
      if (now - currentCache.timestamp < CACHE_TTL_MS) {
        return
      }
      // Si está más vieja, se revalida en background sin mostrar spinner bloqueante
    } else {
      // No hay caché o es forzado: mostrar loading sólo si no tenemos datos en pantalla
      if (referrals.length === 0) {
        setLoading(true)
      } else {
        setIsRefreshing(true)
      }
    }

    // Evitar peticiones concurrentes duplicadas
    if (!activeFetchPromise) {
      activeFetchPromise = fetchRecommendationsFromFirestore(user).finally(() => {
        activeFetchPromise = null
      })
    }

    try {
      const data = await activeFetchPromise
      if (data && isMountedRef.current) {
        setReferrals(data.referrals)
        setWalletBalance(data.walletBalance)
        setReferralStats(data.referralStats)
      }
    } catch (error) {
      console.error('Error cargando recomendaciones optimizadas:', error)
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [user, referrals.length])

  /**
   * Prefetch no bloqueante para cuando el usuario hace hover/touch o el navegador está ocioso
   */
  const prefetchRecommendations = useCallback(() => {
    if (!user?.id) return
    const now = Date.now()
    if (globalMemoryCache && globalMemoryCache.userId === user.id && now - globalMemoryCache.timestamp < CACHE_TTL_MS) {
      return
    }

    if (!activeFetchPromise) {
      activeFetchPromise = fetchRecommendationsFromFirestore(user).finally(() => {
        activeFetchPromise = null
      })
    }

    activeFetchPromise.then(data => {
      if (data && isMountedRef.current) {
        setReferrals(data.referrals)
        setWalletBalance(data.walletBalance)
        setReferralStats(data.referralStats)
      }
    }).catch(err => {
      console.error('Error en prefetch de recomendaciones:', err)
    })
  }, [user])

  const refreshRecommendations = useCallback(() => {
    return loadRecommendations({ forceRefresh: true })
  }, [loadRecommendations])

  return {
    referrals,
    walletBalance,
    referralStats,
    loading,
    isRefreshing,
    loadRecommendations,
    prefetchRecommendations,
    refreshRecommendations
  }
}
