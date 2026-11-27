import { NextRequest, NextResponse } from 'next/server'
import {
  DEFAULT_GLOBAL_AI_RULES,
  getAiDailyUsageSummary,
  getAvailableAiProviders,
  getGlobalAiAgentConfig,
  saveGlobalAiAgentConfig,
} from '@/lib/ai-chat-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAdminAuthorized(req: NextRequest): boolean {
  const adminHeader = (req.headers.get('x-fuddi-admin') || '').trim()
  return adminHeader === 'authenticated'
}

export async function GET(req: NextRequest) {
  try {
    if (!isAdminAuthorized(req)) {
      return NextResponse.json(
        { error: 'Se requiere sesión de Administrador (/admin)' },
        { status: 401 }
      )
    }

    const [config, usageSummary] = await Promise.all([
      getGlobalAiAgentConfig(true),
      getAiDailyUsageSummary(),
    ])
    const availableProviders = getAvailableAiProviders()

    return NextResponse.json({
      ok: true,
      config,
      defaultBaseRules: DEFAULT_GLOBAL_AI_RULES,
      availableProviders,
      usageSummary,
    })
  } catch (err: any) {
    console.error('[API GET /api/ai-agent/global-config] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error cargando configuración global del agente de IA' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isAdminAuthorized(req)) {
      return NextResponse.json(
        { error: 'Se requiere sesión de Administrador (/admin)' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const payload = body?.config && typeof body.config === 'object' ? body.config : body
    const saved = await saveGlobalAiAgentConfig({
      baseRules: typeof payload?.baseRules === 'string' ? payload.baseRules : undefined,
      extraGlobalInstructions:
        typeof payload?.extraGlobalInstructions === 'string'
          ? payload.extraGlobalInstructions
          : undefined,
    })
    const availableProviders = getAvailableAiProviders()

    return NextResponse.json({
      ok: true,
      config: saved,
      defaultBaseRules: DEFAULT_GLOBAL_AI_RULES,
      availableProviders,
    })
  } catch (err: any) {
    console.error('[API POST /api/ai-agent/global-config] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error guardando configuración global del agente de IA' },
      { status: 500 }
    )
  }
}
