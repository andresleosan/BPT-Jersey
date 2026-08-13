# Rediseño del panel administrativo y tienda

## Estado

Diseño aprobado por el operador el 2026-08-11. Esta especificacion reemplaza el
alcance de UI del plan anterior. La funcionalidad de solicitudes administrativas
se conserva como capacidad separada y no se mezcla con la nueva estructura del
panel.

## Objetivo

Construir un panel administrativo simple, modular y mantenible que replique las
cuatro operaciones principales observadas en Regyfit, conserve la aprobacion de
nuevos administradores y agregue la gestion de una tienda virtual propia.

La nueva aplicacion sera la fuente operativa principal. Regyfit se usara como
referencia visual y como fuente temporal de migracion mediante los informes PDF
existentes.

## Decisiones aprobadas

- Se usa la opcion A: monolito modular dentro del proyecto Next.js/Firebase actual.
- El codigo actual del panel se aparca en su rama separada y no se reutiliza como
  estructura de UI.
- El panel tendra cinco secciones visibles:
  - `Add New Members`.
  - `Search Members`.
  - `Groups / Teams`.
  - `Create / Manage`.
  - `Store`.
- `Create / Manage` tendra dos pestanas:
  - `Human Resources`.
  - `Admin Access Requests`.
- No se incluye MFA en esta version.
- No existe un rol de negocio `owner`; todos los administradores tienen la misma
  autoridad.
- No se almacenan ni muestran contrasenas.
- La tienda no tendra pagos online en la primera version.
- Los clientes deben iniciar sesion para comprar.
- La entrega permite recogida en la academia o envio a domicilio con tarifa fija.
- El cliente vera sus propios pedidos y el administrador vera todos.
- La confirmacion del pedido sera una pantalla con numero de pedido; no se envia
  email en esta version.

## Estructura funcional

### 1. Add New Members

Primera version:

- Crear un miembro.
- Asignar numero de miembro o dejarlo sin numero.
- Nombre completo.
- Email.
- Fecha de nacimiento.
- Genero.
- Movil.
- VAT.
- Frecuencia.
- Estado de pago.
- Centro de entrenamiento.
- Guardar y mostrar confirmacion.

Segunda fase:

- Configuracion del formulario de registro publico.
- Documentos y contratos.
- GDPR y documentos de aceptacion.

### 2. Search Members

El formulario replica los filtros observados:

- Membership number.
- Name.
- Email.
- ID Card number.
- VAT number.
- Mobile number.
- Frequency.
- Payment / status.
- Gender.
- Training center.
- Order by.

La pantalla incluye tabla paginada, ordenamiento y acciones seguras para abrir o
editar un miembro. Los resultados no exponen datos que el rol no pueda consultar.

#### Informes PDF

Se generan desde la misma consulta canonica, sin crear bases separadas:

- Total.
- Active.
- Con numero de miembro.
- Sin numero de miembro.
- Inactive.
- Regularizados.
- Activos regularizados.
- Suspensos.

Las condiciones son derivadas:

- `total`: todos los miembros.
- `active`, `inactive`, `suspended`: estado de membresia.
- `with number`, `no number`: presencia del numero de miembro.
- `regularized`: estado de pago regularizado.
- `active regularized`: estado activo y pago regularizado.

### 3. Groups / Teams

Primera version:

- Crear grupo o equipo.
- Editar nombre y abreviatura.
- Ver miembros asignados.
- Anadir y retirar miembros.
- Buscar y paginar grupos.
- Eliminar con confirmacion.

### 4. Create / Manage

#### Human Resources

El formulario gestiona registros de personal:

- Titulo.
- Cargo.
- Nombre.
- Email.
- Telefono.
- Estado de la cuenta.

La cuenta se crea o invita usando Firebase Auth. La aplicacion nunca persiste ni
muestra contrasenas. La recuperacion de acceso usa el mecanismo de Auth.

#### Admin Access Requests

La pestaña muestra solicitudes creadas desde el flujo de login administrativo:

- Nombre y email del solicitante.
- Fecha de solicitud.
- Estado `pending`, `approved` o `rejected`.
- Acciones `Approve` y `Reject`.
- Confirmacion antes de decidir.
- Actualizacion de la tabla sin recarga completa.

La decision se realiza en backend. La aprobacion asigna el acceso administrativo y
el usuario debe cerrar sesion y volver a iniciar sesion para recibirlo. El rechazo
permite reintentar desde el flujo de login despues del cooldown definido por el
backend. El solicitante solo ve su propio estado.

### 5. Store

#### Catalogo publico

La seccion de compra sera accesible desde `Home` y mostrara:

- Productos.
- Fotos.
- Descripcion.
- Precio.
- Talla y color cuando existan.
- Disponibilidad por variante.
- Carrito.
- Checkout para clientes autenticados.

#### Gestion administrativa

Cada producto tendra:

- Nombre.
- Descripcion.
- Fotos.
- Precio.
- Estado activo/inactivo.
- Variantes por talla y color.
- Stock por variante.

La gestion de pedidos incluye:

- Lista y detalle.
- Cliente y lineas del pedido.
- Recogida o envio.
- Tarifa fija de envio configurable.
- Estados `New`, `Payment pending`, `Preparing`, `Delivered` y `Cancelled`.
- Cambio de estado desde el panel.

No se integrara una pasarela de pago en esta fase.

## Modelo de datos

### Member

Existira un registro canonico por persona. Los informes son proyecciones y nunca
se importan como colecciones independientes.

Campos principales:

- `membershipNumber`: opcional y unico cuando existe.
- `fullName`.
- `email`.
- `idCardNumber`.
- `vatNumber`.
- `birthDate`.
- `mobileNumber`.
- `frequency`.
- `paymentStatus`.
- `gender`.
- `trainingCenter`.
- `membershipStatus`.
- `inactiveAt` cuando corresponda.
- Metadatos de origen, importacion y auditoria.

Los campos de origen se normalizan sin perder el valor original cuando una
conversion pueda ser ambigua.

### Group

- `name`.
- `abbreviation`.
- Referencias de miembros.
- Fechas y actor de creacion/actualizacion.

### Human resource

- Titulo y cargo.
- Nombre, email y telefono.
- Referencia de identidad Firebase cuando exista.
- Estado de cuenta.
- Fechas y actor de creacion/actualizacion.

### Store product y variant

- Producto base con nombre, descripcion, fotos, precio y estado.
- Variante con talla, color y stock disponible.
- Identificador estable para no duplicar inventario.

### Order

- Cliente autenticado.
- Lineas con producto, variante, cantidad y precio congelado.
- Metodo de entrega.
- Tarifa de envio aplicada.
- Estado del pedido.
- Total calculado en backend.
- Fechas y auditoria de cambios.

## Migracion e importacion

### PDF inicial

El administrador podra subir varios PDF juntos. El proceso sera provisional:

1. Recibe los archivos y valida tipo, tamano y formato.
2. Identifica el informe por su titulo y columnas.
3. Extrae los registros sin escribir directamente en la base canonica.
4. Deduplica por `membershipNumber`.
5. Si no existe numero, usa nombre normalizado y fecha de nacimiento como
   coincidencia candidata.
6. Clasifica altas, actualizaciones, duplicados y conflictos.
7. Muestra una vista previa con errores y advertencias.
8. Guarda solo despues de una confirmacion explicita.
9. Registra un resumen de importacion sin copiar datos sensibles a logs.

Los informes con estados se combinan sobre el mismo miembro. Una contradiccion de
estado no se resuelve silenciosamente: queda como conflicto para revision.

### Excel y CSV

Se agregara despues de la migracion PDF:

- Importacion con plantilla versionada.
- Vista previa y validacion antes de guardar.
- Exportacion de miembros y pedidos.
- Exportacion de errores de filas para correccion.

La copia/restauracion completa de base de datos no se expone como descarga libre
desde el navegador en la primera version. Sera una operacion protegida y separada
de la importacion funcional.

## Seguridad

- Login normal de Firebase Auth para administradores.
- Claims y academia verificados en backend.
- No MFA en esta version, por decision del operador.
- El navegador no puede conceder roles ni aprobar solicitudes.
- Todas las mutaciones sensibles pasan por Functions.
- Todos los administradores aprobados tienen autoridad equivalente.
- No se muestra la IP de usuarios.
- No se almacenan contrasenas.
- Los clientes solo pueden consultar sus propios pedidos y perfil.
- Las solicitudes de acceso son privadas para el backend y los administradores
  autorizados.
- Las importaciones no escriben hasta una confirmacion posterior a la vista previa.
- Se auditan aprobaciones, rechazos, importaciones, cambios de inventario y
  cambios de estado de pedidos.
- Rate limiting para solicitudes de acceso y operaciones de importacion.

El riesgo aceptado por no usar MFA es que una cuenta administrativa comprometida no
tiene una segunda barrera. La mitigacion es autorizacion backend, sesion segura,
auditoria y recuperacion de cuenta.

## Fases de entrega

### Fase 1: panel y miembros

- Estructura nueva del panel.
- `Add New Members` principal.
- `Search Members` con filtros.
- Modelo canonico de miembros.
- Importacion PDF con vista previa.
- Ocho informes PDF.

### Fase 2: grupos y acceso administrativo

- `Groups / Teams`.
- `Human Resources` seguro.
- Pestana `Admin Access Requests`.
- Aprobacion, rechazo, reintento y auditoria.

### Fase 3: tienda

- Catalogo publico.
- Productos, variantes y stock.
- Carrito autenticado.
- Pedidos y estados.
- Recogida y envio con tarifa fija.
- Vista de pedidos para cliente y administrador.

### Fase 4: datos avanzados

- Importacion/exportacion Excel y CSV.
- Backup completo protegido.
- Documentos y GDPR.
- Email transaccional, si se define proveedor y presupuesto.
- Pagos online, si se aprueba un proveedor.

## Fuera de alcance inicial

- MFA.
- Pago online.
- Email automatico de pedidos.
- Registro publico configurable.
- Documentos/GDPR avanzados.
- Restauracion libre de base de datos desde navegador.
- Un rol de negocio `owner`.
- Reutilizar la UI antigua como dependencia.

## Criterio de aceptacion

El rediseño estara listo cuando:

- El panel muestre solo las cinco secciones aprobadas.
- Los cuatro modulos de Regyfit funcionen con sus filtros y acciones definidas.
- Los PDF puedan importarse juntos con vista previa, deduplicacion y confirmacion.
- Los ocho informes PDF se generen desde la base canonica.
- Los administradores puedan aceptar o rechazar solicitudes desde la pestaña
  correspondiente.
- Los clientes puedan comprar autenticados, usar carrito y crear pedidos sin pago
  online.
- El administrador pueda gestionar productos, stock y estados de pedidos.
- Los clientes solo vean sus propios pedidos.
- Las pruebas funcionales, de seguridad y responsive pasen con evidencia real.
