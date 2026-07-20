import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { updateOrderStatus, getDeliveriesByStatus } from '@/lib/database';

// Función de auto-asignación de delivery (misma lógica que en dashboard)
const autoAssignDeliveryForOrder = async (order: any, defaultDeliveryId?: string): Promise<string | undefined> => {
  try {
    const deliveries = await getDeliveriesByStatus('activo');
    let assignedDeliveryId: string | undefined = undefined;

    if (defaultDeliveryId) {
      const defaultDelivery = deliveries.find(d => d.id === defaultDeliveryId);
      if (defaultDelivery) {
        assignedDeliveryId = defaultDelivery.id;
      }
    }

    if (!assignedDeliveryId && deliveries.length > 0) {
      assignedDeliveryId = deliveries[0].id;
    }

    return assignedDeliveryId;
  } catch (error) {
    console.error('Error en autoAssignDeliveryForOrder:', error);
    return undefined;
  }
};

// Función principal para procesar la actualización del estado de la orden (reutilizada por GET y POST)
async function processOrderStatusUpdate(action: string, orderId: string, token: string) {
  // Validar y decodificar token
  let decodedToken: string;
  try {
    decodedToken = Buffer.from(token, 'base64').toString('utf-8');
  } catch (error) {
    return { success: false, error: 'Token inválido', statusCode: 400 };
  }

  // Verificar formato del token: "orderId|action"
  const [tokenOrderId, tokenAction] = decodedToken.split('|');
  if (tokenOrderId !== orderId || (tokenAction !== action && tokenAction !== 'confirm' && tokenAction !== 'discard')) {
    return { success: false, error: 'Token no válido para esta acción', statusCode: 403 };
  }

  // Obtener la orden actual
  const orderRef = doc(db, 'orders', orderId);
  const orderDoc = await getDoc(orderRef);
  
  if (!orderDoc.exists()) {
    return { success: false, error: 'Orden no encontrada', statusCode: 404 };
  }

  const order = orderDoc.data();

  // Si la orden ya no está en pendiente/borrador
  if (order.status !== 'pending' && order.status !== 'borrador') {
    // Si la orden ya fue confirmada previamente y la acción es confirm, retornar respuesta amigable
    if (action === 'confirm' && ['confirmed', 'preparing', 'ready', 'on_way', 'delivered'].includes(order.status)) {
      return {
        success: true,
        message: 'Esta orden ya fue confirmada previamente',
        orderId,
        newStatus: order.status,
        alreadyConfirmed: true
      };
    }
    return {
      success: false,
      error: `Esta orden ya no está pendiente (estado actual: ${order.status})`,
      statusCode: 400
    };
  }

  let newStatus: string;
  let reason: string | undefined;

  // Determinar el nuevo estado según la acción
  if (action === 'confirm') {
    const isScheduled = order.timing?.type === 'scheduled';
    newStatus = isScheduled ? 'confirmed' : 'preparing';
  } else if (action === 'discard') {
    newStatus = 'cancelled';
    reason = 'Cancelado desde email de notificación';
  } else {
    return { success: false, error: 'Acción no válida', statusCode: 400 };
  }

  // Lógica de auto-asignación de delivery
  let assignmentUpdate: any = {};
  const isDelivery = order.delivery?.type === 'delivery';
  const hasNoDeliveryAssigned = !order.delivery?.assignedDelivery;
  const isScheduled = order.timing?.type === 'scheduled';

  if (isDelivery && hasNoDeliveryAssigned && action === 'confirm' && !isScheduled) {
    try {
      const businessRef = doc(db, 'businesses', order.businessId);
      const businessDoc = await getDoc(businessRef);
      const business = businessDoc.data();
      
      const assignedId = await autoAssignDeliveryForOrder(order, business?.defaultDeliveryId);
      if (assignedId) {
        assignmentUpdate['delivery.assignedDelivery'] = assignedId;
      }
    } catch (error) {
      console.error('Error auto-asignando delivery:', error);
    }
  }

  // Actualizar el estado de la orden registrando que vino de correo electrónico
  await updateOrderStatus(orderId, newStatus as any, reason, 'email');

  // Aplicar actualizaciones de delivery si es necesario
  if (Object.keys(assignmentUpdate).length > 0) {
    await updateDoc(orderRef, assignmentUpdate);
  }

  return {
    success: true,
    message: `Orden ${newStatus === 'cancelled' ? 'cancelada' : 'confirmada'} exitosamente`,
    orderId,
    newStatus
  };
}

export async function POST(request: NextRequest) {
  try {
    const { action, orderId, token } = await request.json();

    if (!action || !orderId || !token) {
      return NextResponse.json(
        { error: 'Parámetros inválidos' },
        { status: 400 }
      );
    }

    const result = await processOrderStatusUpdate(action, orderId, token);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode || 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      orderId: result.orderId,
      newStatus: result.newStatus,
      redirectUrl: `https://fuddi.shop/business/dashboard`
    });

  } catch (error) {
    console.error('Error en POST /api/order/status:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

// Soporte para GET cuando se hace clic directo desde el correo electrónico
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const orderId = searchParams.get('orderId');
  const token = searchParams.get('token');

  if (!action || !orderId || !token) {
    return NextResponse.redirect(
      'https://fuddi.shop/business/dashboard?error=missing_params'
    );
  }

  try {
    const result = await processOrderStatusUpdate(action, orderId, token);

    if (result.success) {
      return NextResponse.redirect(
        `https://fuddi.shop/business/dashboard?success=${result.newStatus}&orderId=${orderId}`
      );
    } else {
      return NextResponse.redirect(
        `https://fuddi.shop/business/dashboard?error=${encodeURIComponent(result.error || 'Error')}`
      );
    }
  } catch (error) {
    console.error('Error en GET /api/order/status:', error);
    return NextResponse.redirect(
      'https://fuddi.shop/business/dashboard?error=server_error'
    );
  }
}
