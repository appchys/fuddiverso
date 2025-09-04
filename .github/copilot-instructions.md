Cosas a tener en cuenta:
- La aplicación se usará mayormente en dispositivos móviles.
- Evita los errores TypeScript al desplegar en Vercel.
- Siempre háblame en español.
- Evita el uso de emojis, usa bootstrap icons.
- Evita crear alertas para el usuario, usa modales o notificaciones.
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




Nuevas implementaciones a realizar:
1. En Dashboard, en pedidos de hoy, abrir un modal de detalles del pedido al hacer click en cualquier parte de la fila del pedido. El modal debe tener un botón para cerrar.

2. En Dashboard, en pedidos de hoy, agregar un botón en cada fila del pedido para marcar el pedido como entregado. Al hacer click en el botón, debe cambiar el estado del pedido a "entregado" y actualizar la vista.

3. En Dashboard, en pedidos de hoy, agregar un botón en cada fila del pedido para indicar que fue pagado con transferencia. Al hacer click en el botón, debe cambiar el estado del pago a "pagado" y actualizar la vista.

4. En Dashboard, en historial de pedidos, quiero que los pedidos estén agrupados por fecha y ésta esté colapsada por defecto. Al hacer click en la fecha, debe expandirse para mostrar los pedidos de ese día.