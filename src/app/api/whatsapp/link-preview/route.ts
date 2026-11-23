import { NextRequest, NextResponse } from 'next/server'
import { fetchLinkPreviewMetadata } from '@/lib/link-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rawUrl = req.nextUrl.searchParams.get('url')?.trim() || ''
    if (!rawUrl) {
      return NextResponse.json({ preview: null }, { status: 400 })
    }
    const preview = await fetchLinkPreviewMetadata(rawUrl)
    return NextResponse.json({ preview })
  } catch {
    return NextResponse.json({ preview: null }, { status: 200 })
  }
}
