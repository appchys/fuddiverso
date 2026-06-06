import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
])

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'URL requerida' }, { status: 400 })
  }

  let imageUrl: URL
  try {
    imageUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: 'URL invalida' }, { status: 400 })
  }

  if (!ALLOWED_HOSTS.has(imageUrl.hostname)) {
    return NextResponse.json({ error: 'Host no permitido' }, { status: 400 })
  }

  const response = await fetch(imageUrl.toString(), {
    cache: 'no-store',
  })

  if (!response.ok) {
    return NextResponse.json({ error: 'No se pudo cargar la imagen' }, { status: response.status })
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'El recurso no es una imagen' }, { status: 400 })
  }

  const body = await response.arrayBuffer()

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
