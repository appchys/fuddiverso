Cosas a tener en cuenta:
- La aplicación se usará mayormente en dispositivos móviles.
- Evita los errores TypeScript al desplegar en Vercel.
- **CRÍTICO**: Siempre envuelve `useSearchParams()` en un boundary de Suspense para evitar errores de build en Vercel. Este error causa que falle el deployment: "useSearchParams() should be wrapped in a suspense boundary". NUNCA uses useSearchParams() directamente sin Suspense.
- **PATRÓN OBLIGATORIO** para useSearchParams():
  ```tsx
  import { Suspense } from 'react'
  
  function SearchComponent() {
    const searchParams = useSearchParams()
    // tu código aquí
  }
  
  export default function Page() {
    return (
      <Suspense fallback={<div>Cargando...</div>}>
        <SearchComponent />
      </Suspense>
    )
  }
  ```
- Siempre háblame en español.
- Evita el uso de emojis, usa bootstrap icons.
- Evita crear alertas para el usuario, usa modales o notificaciones.
- Estamos en Ecuador, la zona horaria es UTC-5.
- La moneda es USD, usa el símbolo $.
- La app es para muchos negocios de comida, no para uno solo. 
- Pretendo que haya un módulo para delivery.

- Creé manualmente 2 colecciones en firebase y creo que no las comprendes bien, las explico:

  clients: colección que contiene los datos de los clientes, cada documento tiene el id del cliente y los siguientes campos, se llaman así tal cual:
    - celular
    - fecha_de_registro
    - id
    - nombres

  ubicaciones: colección que contiene las ubicaciones de los clientes, cada documento tiene el id del cliente y los siguientes campos, se llaman así tal cual:
    - id
    - id_cliente
    - latlong
    - referencia
    - sector (este campo existe pero no lo uso, lo dejo para que lo tengas en cuenta)
    - tarifa

En checkout y en registro de ordenes manuales y en otras partes de la app, se usa la colección clients para obtener los datos del cliente, y la colección ubicaciones para obtener la ubicación del cliente refereciada por el campo id_cliente que es igual al id del cliente.


Necesito revisar el código de checkout y registro de ordenes manuales, ya que las órdenes creadas desde el checkout no tienen la misma estructura en firebase que las manuales.

Te comparto como es la estructura de una orden manual para que la uses de referencia:


  businessId
"0FeNtdYThoTRMPJ6qaS7"
(cadena)


createdAt
4 de septiembre de 2025, 3:36:49 p.m. UTC-5
(marca de tiempo)


createdByAdmin
true
(booleano)



customer
(mapa)


name
"Pedro Sánchez"
(cadena)


phone
"0990815097"
(cadena)



delivery
(mapa)


assignedDelivery
"SskWkBmgVtI2j9WJdUDZ"
(cadena)


deliveryCost
1
(número)


latlong
"-1.865759, -79.977809"
(cadena)


references
"Daule, Vicente Rocafuerte"
(cadena)


type
"delivery"
(cadena)



items
(array)



0
(mapa)


name
"Wantancitos y Tequeños - 15 wantancitos + 9 tequeños "
(cadena)


price
5.5
(número)


productId
"p6xNQZL0gnxbMXxOffhE"
(cadena)


quantity
1
(número)


variant
"15 wantancitos + 9 tequeños "
(cadena)



payment
(mapa)


method
"cash"
(cadena)


paymentStatus
"pending"
(cadena)


selectedBank
""
(cadena)


status
"ready"
(cadena)


subtotal
5.5
(número)



timing
(mapa)


scheduledDate
"2025-09-04"
(cadena)


scheduledTime
"16:06"
(cadena)


type
"immediate"
(cadena)


total
6.5
(número)


updatedAt
4 de septiembre de 2025, 5:47:27 p.m. UTC-5
(marca de tiempo)


Tambien quiero cambiar en la pestaña Pedidos de hoy, dentro hay un título que dice Pedidos de hoy (x), quiero que en su lugar esté la suma de los totales de las órdenes que se muestran en la lista.