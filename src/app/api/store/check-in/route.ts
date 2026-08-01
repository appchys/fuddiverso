import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminDb } from '@/lib/firebase-admin'

export async function GET(request: NextRequest) {
  return handleCheckIn(request)
}

export async function POST(request: NextRequest) {
  return handleCheckIn(request)
}

async function handleCheckIn(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  let businessId = searchParams.get('businessId')
  let action = searchParams.get('action') // 'open' | 'close'
  let date = searchParams.get('date') // YYYY-MM-DD
  let token = searchParams.get('token')

  // Support JSON payload in POST if searchParams are missing
  if (request.method === 'POST' && (!businessId || !action)) {
    try {
      const body = await request.json()
      businessId = businessId || body.businessId
      action = action || body.action
      date = date || body.date
      token = token || body.token
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (!businessId || !action || !date || !token) {
    return renderErrorHtml('Parámetros incompletos', 'La solicitud no contiene todos los parámetros necesarios.')
  }

  if (action !== 'open' && action !== 'close') {
    return renderErrorHtml('Acción no válida', 'La acción especificada no es válida.')
  }

  // Token validation
  const expectedTokenPayload = `${businessId}:${date}:${action}`
  const decodedToken = Buffer.from(token, 'base64url').toString('utf-8')
  if (decodedToken !== expectedTokenPayload && token !== Buffer.from(expectedTokenPayload).toString('base64')) {
    return renderErrorHtml('Enlace no válido o expirado', 'El enlace de confirmación utilizado no es válido.')
  }

  const adminDb = ensureAdminDb()
  if (!adminDb) {
    return renderErrorHtml('Error de servidor', 'No se pudo conectar a la base de datos.')
  }

  try {
    const businessRef = adminDb.collection('businesses').doc(businessId)
    const docSnap = await businessRef.get()

    if (!docSnap.exists) {
      return renderErrorHtml('Negocio no encontrado', 'El negocio especificado no existe en el sistema.')
    }

    const businessData = docSnap.data()
    const storeName = businessData?.name || 'Tu Tienda'

    const targetStatus = action === 'open' ? 'open' : 'closed'

    // Actualizar estado de check-in en el negocio
    const updatePayload: Record<string, any> = {
      dailyCheckInState: {
        date,
        status: targetStatus,
        respondedAt: new Date().toISOString()
      },
      updatedAt: new Date()
    }

    // Si abrieron manualmente la tienda vía check-in, limpiar cualquier manualStoreStatus que la mantuviera cerrada
    if (targetStatus === 'open' && businessData?.manualStoreStatus === 'closed') {
      updatePayload.manualStoreStatus = null
      updatePayload.manualStatusExpiry = null
    }

    await businessRef.update(updatePayload)

    return renderSuccessHtml(storeName, targetStatus, date)
  } catch (error) {
    console.error('Error al procesar check-in diario:', error)
    return renderErrorHtml('Error al actualizar', 'Ocurrió un inconveniente al registrar la confirmación de la tienda.')
  }
}

function renderSuccessHtml(storeName: string, status: 'open' | 'closed', date: string) {
  const isOpen = status === 'open'

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Check-in Diario | ${storeName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; }
  </style>
</head>
<body class="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6 animate-fadeIn">
    
    <!-- Header Icon -->
    <div class="inline-flex items-center justify-center w-20 h-20 rounded-3xl ${
      isOpen 
        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-500/10' 
        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-lg shadow-rose-500/10'
    } mx-auto transition-transform transform hover:scale-105 duration-300">
      <i class="bi ${isOpen ? 'bi-shop-window' : 'bi-door-closed-fill'} text-4xl"></i>
    </div>

    <!-- Title & Description -->
    <div>
      <span class="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
        isOpen ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
      } mb-3">
        Check-in Diario • ${date}
      </span>
      <h1 class="text-3xl font-black text-white tracking-tight leading-tight">${storeName}</h1>
      <p class="text-slate-400 text-sm mt-2 leading-relaxed">
        ${
          isOpen
            ? '¡Confirmación recibida con éxito! Tu tienda ha sido habilitada y estará **Abierta** para recibir pedidos.'
            : 'Tu tienda se mantendrá **Cerrada** por el día de hoy según tu confirmación.'
        }
      </p>
    </div>

    <!-- Status Card -->
    <div class="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 flex items-center justify-between text-left">
      <div>
        <p class="text-xs text-slate-400 font-semibold uppercase tracking-wider">Estado Actual</p>
        <p class="text-lg font-bold text-white mt-0.5 flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}"></span>
          ${isOpen ? 'Abierto para Clientes' : 'Cerrado por Hoy'}
        </p>
      </div>
      <div class="text-right">
        <i class="bi ${isOpen ? 'bi-check-circle-fill text-emerald-400' : 'bi-x-circle-fill text-rose-400'} text-2xl"></i>
      </div>
    </div>

    <!-- Action Info -->
    <p class="text-xs text-slate-500">
      Puedes modificar el estado en cualquier momento desde tu panel de administración.
    </p>

    <!-- App Button -->
    <div class="pt-2">
      <a href="/business/dashboard" class="inline-flex items-center justify-center gap-2 w-full py-3.5 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/25 transition-all transform active:scale-95 text-sm">
        <i class="bi bi-speedometer2"></i>
        Ir al Panel de Negocio
      </a>
    </div>

  </div>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}

function renderErrorHtml(title: string, message: string) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error Check-in</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;900&display=swap" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-slate-900 via-rose-950 to-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
    <div class="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-lg mx-auto">
      <i class="bi bi-exclamation-triangle-fill text-4xl"></i>
    </div>
    <div>
      <h1 class="text-2xl font-black text-white tracking-tight">${title}</h1>
      <p class="text-slate-400 text-sm mt-2 leading-relaxed">${message}</p>
    </div>
    <div class="pt-2">
      <a href="/business/dashboard" class="inline-flex items-center justify-center gap-2 w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl border border-slate-700 transition-all text-sm">
        Volver al Panel
      </a>
    </div>
  </div>
</body>
</html>`

  return new Response(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}
