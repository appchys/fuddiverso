import { ensureAdminDb } from '@/lib/firebase-admin'
import type { ChatAudioTranscription } from '@/types'

const MAX_AUDIO_BYTES = 12 * 1024 * 1024 // 12 MB

interface DownloadedAudio {
  buffer: Buffer
  mimeType: string
  fileExtension: string
}

function normalizeAudioMimeAndExt(rawContentType: string, audioUrl: string): {
  mimeType: string
  fileExtension: string
} {
  const cleanMime = (rawContentType || '').split(';')[0].trim().toLowerCase()

  if (cleanMime === 'audio/ogg' || cleanMime === 'application/ogg' || cleanMime === 'audio/opus') {
    return { mimeType: 'audio/ogg', fileExtension: 'ogg' }
  }
  if (cleanMime === 'audio/mpeg' || cleanMime === 'audio/mp3') {
    return { mimeType: 'audio/mpeg', fileExtension: 'mp3' }
  }
  if (cleanMime === 'audio/mp4' || cleanMime === 'audio/m4a' || cleanMime === 'audio/x-m4a') {
    return { mimeType: 'audio/mp4', fileExtension: 'm4a' }
  }
  if (cleanMime === 'audio/wav' || cleanMime === 'audio/x-wav' || cleanMime === 'audio/wave') {
    return { mimeType: 'audio/wav', fileExtension: 'wav' }
  }
  if (cleanMime === 'audio/webm') {
    return { mimeType: 'audio/webm', fileExtension: 'webm' }
  }
  if (cleanMime === 'audio/aac') {
    return { mimeType: 'audio/aac', fileExtension: 'aac' }
  }
  if (cleanMime === 'audio/amr') {
    return { mimeType: 'audio/amr', fileExtension: 'amr' }
  }
  if (cleanMime.startsWith('audio/')) {
    const ext = cleanMime.split('/')[1] || 'ogg'
    return { mimeType: cleanMime, fileExtension: ext }
  }

  // Fallback por extensión en la URL
  const urlLower = audioUrl.toLowerCase()
  if (urlLower.includes('.m4a') || urlLower.includes('.mp4')) {
    return { mimeType: 'audio/mp4', fileExtension: 'm4a' }
  }
  if (urlLower.includes('.mp3')) {
    return { mimeType: 'audio/mpeg', fileExtension: 'mp3' }
  }
  if (urlLower.includes('.wav')) {
    return { mimeType: 'audio/wav', fileExtension: 'wav' }
  }
  if (urlLower.includes('.webm')) {
    return { mimeType: 'audio/webm', fileExtension: 'webm' }
  }
  return { mimeType: 'audio/ogg', fileExtension: 'ogg' }
}

async function downloadAudioBuffer(audioUrl: string): Promise<DownloadedAudio | null> {
  if (!/^https?:\/\//i.test(audioUrl)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const res = await fetch(audioUrl, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return null

    const contentLength = Number(res.headers.get('content-length') || 0)
    if (contentLength > MAX_AUDIO_BYTES) return null

    const arrayBuf = await res.arrayBuffer()
    if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_AUDIO_BYTES) return null

    const { mimeType, fileExtension } = normalizeAudioMimeAndExt(
      res.headers.get('content-type') || '',
      audioUrl
    )

    return {
      buffer: Buffer.from(arrayBuf),
      mimeType,
      fileExtension,
    }
  } catch (err) {
    console.warn('[Audio Transcriber] Error descargando audio:', err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function transcribeWithGroq(audio: DownloadedAudio): Promise<ChatAudioTranscription | null> {
  const apiKey = (process.env.GROQ_API_KEY || '').trim()
  if (!apiKey) return null

  const candidateModels = Array.from(
    new Set(
      [
        (process.env.GROQ_WHISPER_MODEL || '').trim(),
        'whisper-large-v3-turbo',
        'whisper-large-v3',
      ].filter(Boolean)
    )
  )

  for (const model of candidateModels) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const formData = new FormData()
      const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType })
      formData.append('file', blob, `audio.${audio.fileExtension}`)
      formData.append('model', model)
      formData.append('language', 'es')
      formData.append('response_format', 'json')
      formData.append('temperature', '0')

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404 || res.status === 429 || res.status === 503) continue
        console.warn(`[Audio Transcriber] Groq HTTP ${res.status} (${model}):`, data?.error?.message)
        break
      }

      const text = String(data?.text || '').trim()
      if (!text) continue

      return {
        text,
        language: 'es',
        provider: 'groq',
        model,
        transcribedAtMillis: Date.now(),
      }
    } catch (err) {
      console.warn(`[Audio Transcriber] Error con Groq (${model}):`, err)
    } finally {
      clearTimeout(timer)
    }
  }

  return null
}

async function transcribeWithGemini(audio: DownloadedAudio): Promise<ChatAudioTranscription | null> {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim()
  if (!apiKey) return null

  const base64 = audio.buffer.toString('base64')
  const candidateModels = Array.from(
    new Set(
      [
        (process.env.GEMINI_MODEL || '').trim(),
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
        'gemini-flash-latest',
      ].filter(Boolean)
    )
  )

  const prompt = [
    'Transcribe fielmente este mensaje de voz en español (Ecuador/Latinoamérica).',
    'Devuelve ÚNICAMENTE el texto transcrito exacto, limpio y con puntuación natural.',
    'No agregues encabezados, comillas, notas ni comentarios.',
    'Si el audio no contiene habla inteligible o solo es silencio/ruido, responde exactamente: [Audio sin habla clara]',
  ].join('\n')

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 22_000)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: audio.mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404 || res.status === 429 || res.status === 503) continue
        console.warn(`[Audio Transcriber] Gemini HTTP ${res.status} (${model}):`, data?.error?.message)
        break
      }

      const rawText = (data?.candidates?.[0]?.content?.parts || [])
        .map((p: any) => String(p?.text || ''))
        .join('')
        .trim()

      if (!rawText) continue

      const cleanText = rawText.replace(/^["'«]+|["'»]+$/g, '').trim()
      if (!cleanText) continue

      return {
        text: cleanText,
        language: 'es',
        provider: 'gemini',
        model,
        transcribedAtMillis: Date.now(),
      }
    } catch (err) {
      console.warn(`[Audio Transcriber] Error con Gemini (${model}):`, err)
    } finally {
      clearTimeout(timer)
    }
  }

  return null
}

/**
 * Transcribe un audio desde su URL usando Groq Whisper (preferido por velocidad/cuota)
 * con respaldo automático en Google Gemini.
 */
export async function transcribeAudioFromUrl(audioUrl: string): Promise<ChatAudioTranscription | null> {
  const cleanUrl = String(audioUrl || '').trim()
  if (!cleanUrl) return null

  const audio = await downloadAudioBuffer(cleanUrl)
  if (!audio) return null

  const groqResult = await transcribeWithGroq(audio)
  if (groqResult) return groqResult

  const geminiResult = await transcribeWithGemini(audio)
  if (geminiResult) return geminiResult

  return null
}

/**
 * Transcribe un audio perteneciente a una conversación en `businesses/{businessId}/whatsappPending/{docId}`
 * y guarda el resultado en el mensaje correspondiente dentro de `chatHistory`.
 */
export async function processChatAudioTranscriptionForBusiness(params: {
  businessId: string
  docId: string
  audioUrl: string
  messageId?: string
  force?: boolean
}): Promise<{ transcription: ChatAudioTranscription; cached?: boolean } | null> {
  const { businessId, docId, audioUrl, messageId, force } = params
  const cleanUrl = String(audioUrl || '').trim()
  if (!businessId || !docId || !cleanUrl) return null

  const db = ensureAdminDb()
  const convRef = db
    ? db.collection('businesses').doc(businessId).collection('whatsappPending').doc(docId)
    : null

  // Verificar si ya existe una transcripción guardada (salvo que force === true)
  if (convRef && !force) {
    try {
      const snap = await convRef.get()
      if (snap.exists) {
        const data = snap.data() || {}
        const prevHistory: any[] = Array.isArray(data.chatHistory) ? data.chatHistory : []
        const existingEntry = prevHistory.find(
          (e) =>
            (messageId && (e?.id === messageId || e?.waMsgId === messageId)) ||
            (e?.mediaUrl && String(e.mediaUrl).trim() === cleanUrl)
        )
        if (existingEntry?.audioTranscription?.text) {
          return {
            transcription: existingEntry.audioTranscription as ChatAudioTranscription,
            cached: true,
          }
        }
      }
    } catch {
      // Continuar con transcripción normal si falla la lectura previa
    }
  }

  const transcription = await transcribeAudioFromUrl(cleanUrl)
  if (!transcription) return null

  if (convRef) {
    try {
      // Volver a leer justo antes de escribir para no pisar mensajes nuevos llegados durante la transcripción
      const freshSnap = await convRef.get()
      if (freshSnap.exists) {
        const freshData = freshSnap.data() || {}
        const prevHistory: any[] = Array.isArray(freshData.chatHistory) ? freshData.chatHistory : []
        let matched = false
        const updatedHistory = prevHistory.map((entry) => {
          const isMatch =
            (messageId && (entry?.id === messageId || entry?.waMsgId === messageId)) ||
            (entry?.mediaUrl && String(entry.mediaUrl).trim() === cleanUrl)
          if (isMatch) {
            matched = true
            return {
              ...entry,
              audioTranscription: transcription,
            }
          }
          return entry
        })

        if (matched) {
          await convRef.set({ chatHistory: updatedHistory }, { merge: true })
        }
      }
    } catch (err) {
      console.warn('[Audio Transcriber] Error guardando transcripción en Firestore:', err)
    }
  }

  return { transcription }
}
