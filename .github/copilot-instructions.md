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
5 de septiembre de 2025, 1:16:59 p.m. UTC-5
(marca de tiempo)


createdByAdmin
true
(booleano)



customer
(mapa)


name
"Meury Herederos"
(cadena)


phone
"0986454274"
(cadena)



delivery
(mapa)


deliveryCost
0
(número)


latlong
""
(cadena)


references
""
(cadena)


type
"pickup"
(cadena)



items
(array)



0
(mapa)


name
"Wantancitos BBQ - 30 wantancitos "
(cadena)


price
5.5
(número)


productId
"RJdtOLmoYvLORpmzJysL"
(cadena)


quantity
1
(número)


variant
"30 wantancitos "
(cadena)



1
(mapa)


name
"Wantancitos BBQ - 100 wantancitos"
(cadena)


price
18
(número)


productId
"RJdtOLmoYvLORpmzJysL"
(cadena)


quantity
1
(número)


variant
"100 wantancitos"
(cadena)



payment
(mapa)


method
"transfer"
(cadena)


paymentStatus
"pending"
(cadena)


selectedBank
""
(cadena)


status
"delivered"
(cadena)


subtotal
23.5
(número)



timing
(mapa)



scheduledDate
(mapa)


nanoseconds
0
(número)


seconds
1757169000
(número)


scheduledTime
"09:30"
(cadena)


type
"scheduled"
(cadena)


total
23.5
(número)


updatedAt
6 de septiembre de 2025, 1:21:55 p.m. UTC-5
(marca de tiempo)


