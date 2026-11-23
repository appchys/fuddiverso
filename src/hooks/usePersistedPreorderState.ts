'use client'

import { useEffect, useRef } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { WhatsAppPreorderDraftItem } from '@/components/LiveCheckoutsPanel'

/**
 * Estado crudo de la preorden que se va completando desde los íconos
 * (productos, horario, entrega, pago). Se guarda en el documento
 * `businesses/{bizId}/whatsappPending/{docId}` bajo el campo `preorderState`
 * para que persista entre la tarjeta, la vista de chat, recargas y otros
 * dispositivos hasta que la conversación se confirme o se archive.
 */
export interface PersistedPreorderState {
  items: WhatsAppPreorderDraftItem[]
  timingType: '' | 'immediate' | 'scheduled'
  scheduledDate: string
  scheduledTime: string
  deliveryType: '' | 'delivery' | 'pickup'
  selectedLocationId: string | null
  customLocationInput: string
  paymentMethod: '' | 'cash' | 'transfer' | 'mixed'
  cashAmountInput: string
  transferAmountInput: string
  updatedAtMillis?: number
}

export function getTodayDateKey(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function buildBasePreorderState(_detectedLocationLink?: string | null): PersistedPreorderState {
  return {
    items: [],
    timingType: '',
    scheduledDate: getTodayDateKey(),
    scheduledTime: '',
    deliveryType: '',
    selectedLocationId: null,
    customLocationInput: '',
    paymentMethod: '',
    cashAmountInput: '',
    transferAmountInput: '',
  }
}

function normalizeState(
  raw: Partial<PersistedPreorderState> | null | undefined,
  base: PersistedPreorderState
): PersistedPreorderState {
  if (!raw) return base
  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    timingType: raw.timingType || '',
    scheduledDate: raw.scheduledDate || base.scheduledDate,
    scheduledTime: raw.scheduledTime || '',
    deliveryType: raw.deliveryType || '',
    selectedLocationId: raw.selectedLocationId || null,
    customLocationInput: typeof raw.customLocationInput === 'string' ? raw.customLocationInput : base.customLocationInput,
    paymentMethod: raw.paymentMethod || '',
    cashAmountInput: raw.cashAmountInput || '',
    transferAmountInput: raw.transferAmountInput || '',
  }
}

function serializeState(state: PersistedPreorderState): string {
  const { updatedAtMillis: _ignored, ...rest } = state
  return JSON.stringify(rest)
}

/** Elimina `undefined` (Firestore no lo acepta) */
function toFirestoreValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

interface UsePersistedPreorderStateParams {
  businessId?: string
  docId?: string
  remoteState?: Partial<PersistedPreorderState> | null
  localState: PersistedPreorderState
  baseState: PersistedPreorderState
  applyState: (state: PersistedPreorderState) => void
  debounceMs?: number
}

/**
 * Sincroniza bidireccionalmente el estado local de la preorden con Firestore.
 * - Remoto → local: cuando otro componente/dispositivo escribe (o al confirmarse/archivarse se limpia).
 * - Local → remoto: con debounce; si el estado vuelve a estar vacío se guarda `null`.
 */
export function usePersistedPreorderState({
  businessId,
  docId,
  remoteState,
  localState,
  baseState,
  applyState,
  debounceMs = 500,
}: UsePersistedPreorderStateParams) {
  const baseKey = serializeState(baseState)
  const lastSyncedKeyRef = useRef<string>(baseKey)
  const pendingWriteRef = useRef<(() => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyRef = useRef(applyState)
  applyRef.current = applyState

  const remoteNormalized = normalizeState(remoteState, baseState)
  const remoteKey = serializeState(remoteNormalized)
  const localKey = serializeState(localState)

  // Remoto → local
  useEffect(() => {
    if (remoteKey === lastSyncedKeyRef.current) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingWriteRef.current = null
    lastSyncedKeyRef.current = remoteKey
    applyRef.current(JSON.parse(remoteKey) as PersistedPreorderState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteKey])

  // Local → remoto (debounce)
  useEffect(() => {
    if (!businessId || !docId) return
    if (localKey === lastSyncedKeyRef.current) return

    const write = () => {
      pendingWriteRef.current = null
      timerRef.current = null
      lastSyncedKeyRef.current = localKey
      const isEmpty = localKey === baseKey
      updateDoc(doc(db, 'businesses', businessId, 'whatsappPending', docId), {
        preorderState: isEmpty
          ? null
          : toFirestoreValue({ ...(JSON.parse(localKey) as PersistedPreorderState), updatedAtMillis: Date.now() }),
      }).catch((err) => {
        console.warn('[usePersistedPreorderState] Error guardando preorden:', err)
      })
    }

    pendingWriteRef.current = write
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(write, debounceMs)
  }, [businessId, docId, localKey, baseKey, debounceMs])

  // Al desmontar, guardar inmediatamente cualquier cambio pendiente
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      pendingWriteRef.current?.()
    }
  }, [])
}
