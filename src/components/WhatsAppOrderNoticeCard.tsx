'use client'

import React, { useState } from 'react'

export interface WhatsAppOrderNoticeCardProps {
  order: any
  timeLabel?: string
  defaultExpanded?: boolean
  collapsible?: boolean
  className?: string
  onAssignDelivery?: (order: any) => void
  onPrintOrder?: (order: any) => void
  onEditOrder?: (order: any) => void
}

function getOrderStatusLabel(status?: string): string {
  switch (String(status || '').toLowerCase()) {
    case 'borrador': return 'Borrador'
    case 'pending': return 'Pendiente'
    case 'confirmed': return 'Confirmado'
    case 'preparing': return 'Preparando'
    case 'ready': return 'Listo'
    case 'on_way': return 'En camino'
    case 'delivered': return 'Entregado'
    default: return 'Pedido creado'
  }
}

function resolveOrderTimeLabel(order: any): string {
  const raw = order?.createdAt ?? order?.timestamp
  if (!raw) return ''
  let date: Date | null = null
  if (raw instanceof Date) {
    date = raw
  } else if (typeof raw?.toDate === 'function') {
    date = raw.toDate()
  } else if (typeof raw?.seconds === 'number') {
    date = new Date(raw.seconds * 1000)
  } else if (typeof raw === 'number' || typeof raw === 'string') {
    date = new Date(raw)
  }
  if (!date || Number.isNaN(date.getTime())) return ''
  let hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const period = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12 || 12
  return `${hours}:${minutes} ${period}`
}

export function WhatsAppOrderNoticeCard({
  order,
  timeLabel,
  defaultExpanded = false,
  collapsible = true,
  className = '',
  onAssignDelivery,
  onPrintOrder,
  onEditOrder,
}: WhatsAppOrderNoticeCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (!order) return null

  const items = Array.isArray(order.items) ? order.items : []
  const isPickupOrder = order.delivery?.type === 'pickup'
  const hasDeliveryAssigned = Boolean(order.delivery?.assignedDelivery)
  const displayTime = timeLabel ?? resolveOrderTimeLabel(order)
  const canManageOrder = Boolean(
    !order._fallbackSummary && (onEditOrder || onAssignDelivery || onPrintOrder)
  )
  const showActions = canManageOrder && (collapsible ? isExpanded : true)

  return (
    <div
      onClick={
        collapsible && canManageOrder
          ? () => setIsExpanded((prev) => !prev)
          : undefined
      }
      title={
        collapsible && canManageOrder
          ? (isExpanded ? 'Clic para contraer opciones' : 'Clic para ver opciones del pedido')
          : undefined
      }
      className={`w-full bg-[#FFF4D2] border border-[#EFE0B0] rounded-xl px-3.5 py-2 text-xs text-amber-950 shadow-2xs space-y-1.5 ${
        collapsible && canManageOrder ? 'cursor-pointer hover:bg-[#FDECC0] transition-colors' : ''
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-black text-amber-950 inline-flex items-center gap-1.5">
          <i className="bi bi-bag-check-fill text-amber-700"></i>
          Pedido creado
        </span>
        <div className="inline-flex items-center gap-1.5">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/80 text-amber-900 border border-[#E8D59C]">
            {getOrderStatusLabel(order.status)}
          </span>
          {collapsible && canManageOrder && (
            <i
              className={`bi bi-chevron-down text-[11px] text-amber-800/80 transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
            ></i>
          )}
        </div>
      </div>

      {items.length > 0 ? (
        <div className="space-y-0.5 text-[11px] text-amber-950/90">
          {items.map((it: any, i: number) => (
            <p key={i} className="leading-snug">
              <span className="font-bold">{it.quantity || 1}x</span>{' '}
              {it.productName || it.name || 'Producto'}
              {(it.variant || it.variantName) ? ` (${it.variant || it.variantName})` : ''}
            </p>
          ))}
        </div>
      ) : order._fallbackSummary ? (
        <p className="text-[11px] text-amber-950/90 leading-snug">{order._fallbackSummary}</p>
      ) : null}

      {order.delivery && (
        <p className="text-[11px] text-amber-900/80 flex items-center gap-1">
          <i className={`bi ${isPickupOrder ? 'bi-shop' : 'bi-geo-alt-fill'} shrink-0 text-amber-700`}></i>
          <span className="truncate">
            {isPickupOrder
              ? 'Recoger en tienda'
              : (order.delivery.references || order.delivery.address || 'Delivery')}
          </span>
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#EAD9A4]">
        {typeof order.total === 'number' ? (
          <span className="font-black text-amber-950 text-xs">
            Total: ${order.total.toFixed(2)}
          </span>
        ) : (
          <span></span>
        )}
        {displayTime && (
          <span className="text-[10px] text-amber-900/70 inline-flex items-center gap-1 ml-auto">
            {displayTime}
          </span>
        )}
      </div>

      {showActions && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="pt-2 border-t border-[#EAD9A4] flex flex-wrap items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {!isPickupOrder && onAssignDelivery && (
            <button
              type="button"
              onClick={() => onAssignDelivery(order)}
              className="flex-1 min-w-[110px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 hover:bg-white border border-[#E5D095] text-amber-950 text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
            >
              <i className={`bi bi-scooter ${hasDeliveryAssigned ? 'text-emerald-600' : 'text-amber-700'}`}></i>
              <span className="truncate">
                {hasDeliveryAssigned
                  ? (String(order.delivery?.assignedDeliveryData?.nombres || '').trim() || 'Delivery asignado')
                  : 'Asignar delivery'}
              </span>
            </button>
          )}
          {onPrintOrder && (
            <button
              type="button"
              onClick={() => onPrintOrder(order)}
              className="flex-1 min-w-[90px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 hover:bg-white border border-[#E5D095] text-amber-950 text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
            >
              <i className="bi bi-printer-fill text-slate-700"></i>
              <span>Imprimir</span>
            </button>
          )}
          {onEditOrder && (
            <button
              type="button"
              onClick={() => onEditOrder(order)}
              className="flex-1 min-w-[90px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 hover:bg-white border border-[#E5D095] text-amber-950 text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
            >
              <i className="bi bi-pencil-square text-amber-700"></i>
              <span>Editar</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
