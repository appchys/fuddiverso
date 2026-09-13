'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class CheckoutErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('❌ [CheckoutErrorBoundary] Error capturado en Checkout:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[360px] p-6 flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-gray-100 shadow-sm my-4">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4 text-2xl">
            <i className="bi bi-exclamation-triangle"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Algo no salió como esperábamos
          </h3>
          <p className="text-sm text-gray-500 max-w-sm mb-6 leading-relaxed">
            Ocurrió un problema inesperado al cargar la pantalla del pedido. Tus productos siguen seguros en tu carrito.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <button
              type="button"
              onClick={this.handleReset}
              className="w-full py-3 px-4 bg-gray-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-colors shadow-sm"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload()
                }
              }}
              className="w-full py-3 px-4 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200 transition-colors"
            >
              Recargar página
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
