export interface LinkPreviewData {
  url: string
  matchedText: string
  title: string
  description: string
  image: string | null
  siteName: string
}

const URL_EXTRACT_REGEX = /https?:\/\/[^\s<>()]+/i

export function extractFirstUrlFromText(text?: string | null): string | null {
  if (!text) return null
  const match = String(text).match(URL_EXTRACT_REGEX)
  if (!match?.[0]) return null
  return match[0].replace(/[.,;!?)]+$/, '')
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch {
        return _
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10))
      } catch {
        return _
      }
    })
}

function isSafePublicUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function getMetaContent(html: string, keys: string[]): string {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || []
  for (const key of keys) {
    const lowerKey = key.toLowerCase()
    for (const tag of metaTags) {
      const propMatch = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const propVal = (propMatch?.[1] || propMatch?.[2] || propMatch?.[3] || '').trim().toLowerCase()
      if (propVal !== lowerKey) continue
      const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
      const contentVal = contentMatch?.[1] ?? contentMatch?.[2]
      if (contentVal && contentVal.trim()) {
        return decodeHtmlEntities(contentVal.trim())
      }
    }
  }
  return ''
}

function getTitleTag(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match?.[1]) return ''
  return decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim())
}

export async function fetchLinkPreviewMetadata(rawUrl: string): Promise<LinkPreviewData | null> {
  const parsedUrl = isSafePublicUrl(rawUrl)
  if (!parsedUrl) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5500)

  try {
    const res = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'WhatsApp/2.24.1.78 A',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-EC,es;q=0.9,en;q=0.8',
      },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null
    }

    const html = (await res.text()).slice(0, 120_000)
    const title =
      getMetaContent(html, ['og:title', 'twitter:title']) ||
      getTitleTag(html) ||
      parsedUrl.hostname
    const description = getMetaContent(html, [
      'og:description',
      'twitter:description',
      'whatsapp:description',
      'description',
    ])
    const rawImage = getMetaContent(html, ['og:image', 'twitter:image'])
    const siteName =
      getMetaContent(html, ['og:site_name']) || parsedUrl.hostname.replace(/^www\./i, '')
    const canonical = getMetaContent(html, ['og:url']) || res.url || parsedUrl.toString()

    let resolvedImage: string | null = null
    if (rawImage) {
      try {
        const imgUrl = new URL(rawImage, parsedUrl.toString())
        if (imgUrl.protocol === 'http:' || imgUrl.protocol === 'https:') {
          resolvedImage = imgUrl.toString()
        }
      } catch {
        resolvedImage = null
      }
    }

    if (!title && !description && !resolvedImage) return null

    return {
      url: canonical,
      matchedText: rawUrl,
      title,
      description,
      image: resolvedImage,
      siteName,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchLinkPreviewJpegThumbnail(
  imageUrl?: string | null,
  maxWidth = 320
): Promise<Buffer | undefined> {
  if (!imageUrl) return undefined
  const parsed = isSafePublicUrl(imageUrl)
  if (!parsed) return undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'WhatsApp/2.24.1.78 A' },
    })
    if (!res.ok) return undefined
    const arrayBuf = await res.arrayBuffer()
    const rawBuffer = Buffer.from(arrayBuf)
    if (rawBuffer.length === 0) return undefined

    try {
      const sharpMod = await import('sharp')
      const sharpFn = (sharpMod as any).default || sharpMod
      const jpegBuffer = await sharpFn(rawBuffer)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality: maxWidth > 400 ? 82 : 74, mozjpeg: true })
        .toBuffer()
      return jpegBuffer
    } catch {
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if ((ct.includes('jpeg') || ct.includes('jpg')) && rawBuffer.length <= 250_000) {
        return rawBuffer
      }
      return undefined
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
