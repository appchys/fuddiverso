import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { updateOrderStatus, getDeliveriesByStatus } from '@/lib/database';

// Función de auto-asignación de delivery (misma lógica que en dashboard)
const autoAssignDeliveryForOrder = async (order: any, defaultDeliveryId?: string): Promise<string | undefined> => {
  try {
    const deliveries = await getDeliveriesByStatus('activo');
    let assignedDeliveryId: string | undefined = undefined;

    // Si hay un delivery por defecto configurado, verificar si está activo
    if (defaultDeliveryId) {
      const defaultDelivery = deliveries.find(d => d.id === defaultDeliveryId);
      if (defaultDelivery) {
        assignedDeliveryId = defaultDelivery.id;
      }
    }

    // Si no hay delivery asignado, buscar el primero disponible
    if (!assignedDeliveryId && deliveries.length > 0) {
      assignedDeliveryId = deliveries[0].id;
    }

    return assignedDeliveryId;
  } catch (error) {
    console.error('Error en autoAssignDeliveryForOrder:', error);
    return undefined;
  }
};

export async function POST(request: NextRequest) {
  try {
    const { action, orderId, token } = await request.json();

    // Validar parámetros requeridos
    if (!action || !orderId || !token) {
      return NextResponse.json(
        { error: 'Parámetros inválidos' },
        { status: 400 }
      );
    }

    // Validar y decodificar token
    let decodedToken: string;
    try {
      decodedToken = Buffer.from(token, 'base64').toString('utf-8');
    } catch (error) {
      return NextResponse.json(
        { error: 'Token inválido' },
        { status: 400 }
      );
    }

    // Verificar formato del token: "orderId|action"
    const [tokenOrderId, tokenAction] = decodedToken.split('|');
    if (tokenOrderId !== orderId || (tokenAction !== action && tokenAction !== 'confirm' && tokenAction !== 'discard')) {
      return NextResponse.json(
        { error: 'Token no válido para esta acción' },
        { status: 403 }
      );
    }

    // Obtener la orden actual
    const orderRef = doc(db, 'orders', orderId);
    const orderDoc = await getDoc(orderRef);
    
    if (!orderDoc.exists()) {
      return NextResponse.json(
        { error: 'Orden no encontrada' },
        { status: 404 }
      );
    }

    const order = orderDoc.data();

    // Verificar que la orden esté en estado pendiente para estas acciones
    if (order.status !== 'pending') {
      return NextResponse.json(
        { error: 'Esta orden ya no está en estado pendiente' },
        { status: 400 }
      );
    }

    let newStatus: string;
    let reason: string | undefined;

    // Determinar el nuevo estado según la acción
    if (action === 'confirm') {
      // Lógica igual que en el dashboard
      const isScheduled = order.timing?.type === 'scheduled';
      newStatus = isScheduled ? 'confirmed' : 'preparing';
    } else if (action === 'discard') {
      newStatus = 'cancelled';
      reason = 'Cancelado desde email de notificación';
    } else {
      return NextResponse.json(
        { error: 'Acción no válida' },
        { status: 400 }
      );
    }

    // Lógica de auto-asignación de delivery (igual que handleStatusChange)
    let assignmentUpdate: any = {};
    const isDelivery = order.delivery?.type === 'delivery';
    const hasNoDeliveryAssigned = !order.delivery?.assignedDelivery;
    const isScheduled = order.timing?.type === 'scheduled';

    if (isDelivery && hasNoDeliveryAssigned && action === 'confirm' && !isScheduled) {
      try {
        // Obtener businessId para el defaultDeliveryId
        const businessRef = doc(db, 'businesses', order.businessId);
        const businessDoc = await getDoc(businessRef);
        const business = businessDoc.data();
        
        const assignedId = await autoAssignDeliveryForOrder(order, business?.defaultDeliveryId);
        if (assignedId) {
          assignmentUpdate['delivery.assignedDelivery'] = assignedId;
        }
      } catch (error) {
        console.error('Error auto-asignando delivery:', error);
        // Continuar aunque falle la asignación
      }
    }

    // Actualizar el estado de la orden
    await updateOrderStatus(orderId, newStatus as any, reason);

    // Aplicar actualizaciones de delivery si es necesario
    if (Object.keys(assignmentUpdate).length > 0) {
      await updateDoc(orderRef, assignmentUpdate);
    }

    // Respuesta exitosa
    return NextResponse.json({
      success: true,
      message: `Orden ${newStatus === 'cancelled' ? 'cancelada' : 'confirmada'} exitosamente`,
      orderId,
      newStatus,
      redirectUrl: `https://fuddi.shop/business/dashboard`
    });

  } catch (error) {
    console.error('Error en /api/order/status:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

// También soportar GET para redirección directa desde email
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
    // Procesar la misma lógica que POST
    const response = await POST(request);
    const result = await response.json();

    if (result.success) {
      // Redirigir al dashboard con mensaje de éxito
      return NextResponse.redirect(
        `https://fuddi.shop/business/dashboard?success=${result.newStatus}&orderId=${orderId}`
      );
    } else {
      // Redirigir con error
      return NextResponse.redirect(
        `https://fuddi.shop/business/dashboard?error=${encodeURIComponent(result.error)}`
      );
    }
  } catch (error) {
    return NextResponse.redirect(
      'https://fuddi.shop/business/dashboard?error=server_error'
    );
  }
}
