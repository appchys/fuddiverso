'use client'

import { useState, useEffect } from 'react'
import {
  ConnectivityState,
  getConnectivityState,
  subscribeConnectivity,
  probeConnectivity
} from '@/lib/connectivity'

export function useConnectionStatus(): ConnectivityState & {
  checkNow: () => Promise<boolean>
} {
  const [status, setStatus] = useState<ConnectivityState>(getConnectivityState)

  useEffect(() => {
    const unsubscribe = subscribeConnectivity(setStatus)
    return () => unsubscribe()
  }, [])

  return {
    ...status,
    checkNow: probeConnectivity
  }
}
