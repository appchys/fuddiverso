import { NextRequest, NextResponse } from 'next/server'
import { sendDailyCheckInSummaryReport } from '@/lib/checkin-notifications'

export async function GET(request: NextRequest) {
  return handleSummaryCron(request)
}

export async function POST(request: NextRequest) {
  return handleSummaryCron(request)
}

async function handleSummaryCron(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const dateStr = searchParams.get('date') || undefined

  try {
    const result = await sendDailyCheckInSummaryReport(dateStr)
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Resumen diario de Check-in enviado a Admin',
        summary: result.summaryText
      })
    } else {
      return NextResponse.json({
        success: false,
        error: 'No se pudo enviar el resumen diario de Check-in'
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Error en API Cron Check-in Summary:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Error desconocido'
    }, { status: 500 })
  }
}
