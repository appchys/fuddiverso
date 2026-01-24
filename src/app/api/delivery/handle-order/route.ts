import { updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const token = searchParams.get('token');

    if (!action || !token) {
      return NextResponse.json({ error: 'Parámetros faltantes' }, { status: 400 });
    }

    // Decodificar token
    let orderId, actionType;
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      [orderId, actionType] = decoded.split('|');
    } catch (e) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 400 });
    }

    if (actionType !== action) {
      return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
    }

    // Actualizar estado
    const newStatus = action === 'confirm' ? 'preparing' : 'cancelled';
    await updateDoc(doc(db, 'orders', orderId), {
      status: newStatus,
      updatedAt: new Date()
    });

    // HTML con redirección
    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Procesando orden...</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
          }
          .container {
            text-align: center;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          h1 {
            color: #2E7D32;
            margin: 0 0 16px 0;
          }
          p {
            color: #666;
            margin: 8px 0;
          }
          .icon {
            font-size: 48px;
            margin-bottom: 16px;
          }
          .button {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            margin-top: 20px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">${action === 'confirm' ? '✅' : '❌'}</div>
          <h1>${action === 'confirm' ? '¡Pedido Confirmado!' : '¡Pedido Descartado!'}</h1>
          <p>Tu acción ha sido procesada exitosamente.</p>
          <p>Redirigiendo al dashboard en 3 segundos...</p>
          <a href="https://fuddi.shop/delivery/dashboard" class="button">Ir al Dashboard</a>
        </div>
        <script>
          setTimeout(() => {
            window.location.href = 'https://fuddi.shop/delivery/dashboard';
          }, 3000);
        </script>
      </body>
      </html>
    `;

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Error procesando la acción' }, { status: 500 });
  }
}
