# Cupos por edad e invitaciones desde Waitlist

Fecha: 2026-10-05. Estado: especificación aprobada, implementada y activada en producción.

## Objetivo y decisiones aprobadas

El propietario podrá limitar las reservas de edades concretas en una clase. Por ejemplo,
6 años: 3 plazas y 8 años: 5 plazas. Las edades no configuradas siguen las reglas actuales.
Sin límites configurados, la clase funciona exactamente como antes.

Desde la Waitlist de una sesión, el propietario podrá crear una sesión posterior y avisar
en la interfaz de miembros a quienes estaban esperando. Cada destinatario decide si
confirma o rechaza el día y la hora. La nueva sesión también admite reservas de otros
miembros elegibles. Las plazas se asignan al confirmar, sin reservarlas por recibir el aviso.

El usuario aprobó este comportamiento y añadió expresamente: conservar lo que funciona;
la funcionalidad debe ser aditiva. Ninguna reserva nace del envío de una invitación.

## Enfoque y compatibilidad

Se amplían los contratos y formularios actuales con un campo opcional de cupos. Se añade
un registro independiente para las invitaciones a otra sesión y se reutiliza la operación
de reserva existente para aceptarlas.

Alternativas consideradas:

- Reutilizar la oferta actual de Waitlist para otra sesión mezclaría dos comportamientos:
  esa oferta tiene una plaza retenida y caducidad; la nueva invitación no retiene plazas.
- Crear otro motor de reservas duplicaría comprobaciones de membresía, aforo y pagos.
- El enfoque elegido conserva las ofertas actuales y centraliza la confirmación en el
  motor existente, con la nueva comprobación de cupo por edad.

Los documentos anteriores sin el campo nuevo equivalen a una lista vacía. Una actualización
que omite el campo conserva su valor; una lista vacía explícita elimina los cupos por edad.
No habrá migración masiva ni reescritura de reservas, asistencias o miembros históricos.
Los lectores con validación estricta deben admitir los campos nuevos antes de activarlos.

No se cambian autenticación, App Check, separación por academia, roles, finanzas,
membresías, asistencia, progreso, límites semanales ni permisos de tutores. Las exenciones
de acceso ya existentes siguen funcionando; no permiten superar un cupo físico nuevo.
El nuevo editor de cupos y la acción de crear desde Waitlist son del owner. Los demás
roles conservan sus acciones actuales; editar otro dato no puede borrar cupos existentes.

## Cupos y contadores

La sesión y su configuración recurrente admiten `ageCapacities`, una lista opcional de
pares `{ age, capacity }`. La edad es un entero entre 0 y 120 y no puede repetirse.
Cada cupo es un entero positivo y no supera el aforo total configurado. La suma de cupos
no tiene que coincidir con el aforo: son máximos, no plazas apartadas de otras edades.
Eliminar una fila restaura el comportamiento habitual de esa edad.

La edad se calcula con la fecha de nacimiento canónica para el día local de la sesión en
Europe/Jersey. Se conserva el acceso por edad del tipo de clase: añadir un cupo no autoriza
edades que no podían reservar. En sesiones con cupos, una fecha de nacimiento desconocida
impide determinar la disponibilidad y requiere corregir el perfil; no se trata como edad adulta.
Las sesiones sin cupos conservan el tratamiento actual de esos perfiles.

El aforo general y el cupo correspondiente se comprueban juntos en la transacción de reserva.
Se reutiliza la coordinación de capacidad existente para impedir que dos solicitudes ocupen
la última plaza. Las reservas activas y las ofertas vigentes que ya retienen plaza cuentan
con los mismos criterios del sistema actual. La invitación nueva no cuenta como ocupación.
Cancelar libera la plaza según la operación actual; un reintento no duplica una reserva.

Los recuentos se derivan de las reservas y retenciones persistidas, con la identidad canónica
del estudiante, y no de un contador optimista del navegador. El calendario, el formulario,
la inscripción de oficina, los grupos autorizados y la aceptación de ofertas deben usar
la misma regla. La disponibilidad pendiente o fallida se muestra como desconocida, nunca cero.

Al editar una sesión no se permite introducir o reducir un cupo por debajo de la ocupación
correspondiente, incluidas retenciones vigentes. Un cambio de fecha obliga a recalcular edades.
La validación y el guardado comparten la coordinación con reservas concurrentes. Si no es
posible conservar todas las reservas existentes, se rechaza la edición con una explicación;
no se cancela a nadie automáticamente.

Los límites se copian con la sesión y se propagan a las recurrencias mediante los mecanismos
actuales de edición de una fecha o de las siguientes. Se preservan excepciones y reservas.
Las sesiones antiguas sin cupos no reciben límites al materializarse.

## Entrada y permanencia en Waitlist

Cuando el aforo general o el cupo de la edad esté completo, el miembro elegible puede usar
`Join waitlist`. Se indica si está lleno el cupo de su edad. La entrada requiere una acción
explícita y conserva el identificador de la sesión original. Las restricciones actuales de
acceso y disponibilidad de Waitlist siguen aplicándose.

El nuevo límite de una edad no envía a otras edades a Waitlist. Cuando se llena el aforo
general, se mantiene la posibilidad de entrar en espera que ya existe para los demás.

Las entradas pendientes siguen visibles para crear una clase posterior aunque haya pasado
la fecha original. Se añade acceso paginado a estas esperas, conservando los límites de lectura
y sin ampliar ilimitadamente la consulta actual de sesiones futuras. Las acciones sobre la
sesión original siguen respetando su estado y los plazos de reserva existentes.

## Crear siguiente clase

Cada sesión de origen presenta `Create next class` al owner. El formulario reutiliza el editor
actual y precarga tipo, sede, instructores, duración, reglas y cupos. El propietario elige una
fecha posterior a la original y futura. La creación desde Waitlist produce una sesión concreta;
no activa por defecto una serie semanal ni envía avisos por cada futura recurrencia.

Antes de guardar se muestra la sesión de origen y el número de destinatarios. Crear una clase
por el flujo ordinario no avisa a listas ajenas. La relación con la espera procede de esta acción.

El guardado registra una operación identificable, la sesión creada y los destinatarios pendientes
de la lista original, sin duplicar estudiantes. La operación es idempotente: reintentar conserva
la misma sesión y las mismas invitaciones. Si la publicación de invitaciones necesita lotes,
se guarda su avance y la interfaz permite reanudarlo sin recrear la clase. No se presenta como
completo un envío parcial. No se añaden tareas programadas ni envíos externos para este flujo.

Un miembro que ya obtuvo plaza en la sesión original, se retiró de su lista o aceptó una clase
alternativa deja de ser destinatario pendiente. Las entradas ofrecidas pero aún no resueltas
pueden recibir la invitación; la aceptación debe liberar cualquier retención original.

## Invitación, respuesta e historial

Cada invitación guarda academia, estudiante, entrada y sesión de origen, sesión nueva,
operación de creación, owner, fechas automáticas y estado. Estados: pendiente, aceptada,
rechazada o cerrada. La reserva confirmada queda enlazada cuando existe.

La cuenta del miembro presenta un aviso independiente de los avisos de inscripción existentes,
que actualmente tienen una acción fija de elegir plan. Muestra clase, sede, fecha y hora reales,
y permite confirmar o rechazar. Los tutores actúan solo por el hijo autorizado. Leer o cerrar
visualmente un aviso no crea reservas ni cancela la espera.

Aceptar valida de nuevo sesión, plazos, cupos, membresía, pagos y reglas actuales. La reserva,
la aceptación y la resolución de la espera original se coordinan de forma atómica. Un doble
clic o reintento devuelve la misma confirmación. Si ya existe una reserva válida para esa misma
sesión, se enlaza sin crear otra. Resolver la espera cierra sus otras invitaciones pendientes.
Una aceptación concurrente de la oferta original y de la alternativa no puede resolver dos veces
la misma entrada ni crear dos reservas por esa espera.

Rechazar registra la respuesta y mantiene la espera original. Si la nueva clase se llena,
la confirmación explica que ya no quedan plazas y mantiene la espera; no se añade otra lista
automáticamente. Las invitaciones se cierran al cancelarse la sesión o vencer su plazo de reserva,
sin necesidad de una tarea programada para impedir su uso. La espera original permanece pendiente.
Cancelar después una reserva aceptada sigue las reglas actuales y no reabre automáticamente
la espera resuelta.

La invitación usa los datos actuales de la sesión. Si cambian fecha, hora o sede desde que se abrió
el aviso, confirmar exige mostrar los nuevos datos antes de reservar. La respuesta registra la
versión aceptada. No habrá reservas con condiciones distintas de las mostradas al miembro.

El owner puede ver clase original, clase creada y respuestas. Se registran actor y fecha en
creación, edición de cupos y respuestas; no se solicitan fechas manuales. El miembro solo puede
leer su información y la de los estudiantes por los que ya tiene autorización.

## Interfaz y diseño

Se conserva `DESIGN.md`: tipografías y tokens existentes, panel administrativo de esquinas rectas,
cuenta de miembro con sus radios actuales, acciones moradas y lenguaje visible en inglés británico.
El registro de impeccable es producto. Las reglas de marketing de design-taste-frontend no se
aplican a estas pantallas administrativas.

En el formulario, `Age-specific limits` es opcional y se sitúa junto al aforo. Cada fila muestra
edad, plazas máximas y eliminar. En escritorio se alinean los controles; bajo 48rem se apilan,
con etiquetas visibles, campos de 16px o más y acciones de al menos 44px. No se añade una tarjeta
por edad. La Waitlist conserva la agrupación y añade claramente la acción por sesión de origen.

Los estados de carga, vacío, error, guardado parcial, sesión cancelada y cupo agotado son explícitos.
Se mantiene foco visible, navegación por teclado, avisos de estado accesibles y movimiento reducido.
No se introducen bibliotecas visuales ni cambios globales del shell para este trabajo.

## Superficies técnicas afectadas

- Dominio: `schedule-contracts.ts`, cálculo de disponibilidad del calendario y contratos propios
  para cupos e invitaciones. Mantener separados los contratos actuales de oferta de una plaza.
- Functions: `schedule-service.ts`, `weekly-session-service.ts`, sus callables, y comprobaciones
  compartidas en `booking-transaction-service.ts` y `advanced-booking-service.ts`.
- Administración: `session-panel.tsx`, sus clientes y estilos, `admin/waitlists/page.tsx`,
  `admin-waitlist-groups.ts` y cliente de Waitlist.
- Miembros: disponibilidad del calendario, `session-card.tsx`, `account/waitlist/page.tsx`
  y un componente específico de invitaciones en `account/page.tsx`.
- Persistencia nueva: operaciones e invitaciones con lecturas autorizadas y paginadas mediante
  callables, sin abrir acceso directo del cliente a documentos internos.

Los cursos finitos, seminarios con inscripción propia y clases privadas mantienen sus flujos
especializados. Este cambio añade cupos e invitaciones a las clases ordinarias que usan Waitlist;
no sustituye la lista de cursos ni el proceso de contratación de clases privadas.

## Revisión, límites y publicación

Revisar por inspección: documentos sin campos nuevos; edades sin límite; concurrencia de última
plaza; cancelaciones; edición con reservas; copias y recurrencias; grupos autorizados; oferta
tradicional; reintentos; rechazo; clase llena o cancelada; tutores; academia y permisos.

La preferencia vigente del proyecto prohíbe añadir o ejecutar suites sin petición explícita.
Esta especificación no interpreta la petición de compatibilidad como autorización de pruebas.
No se afirmará ausencia de regresiones sin evidencia suficiente; se informará del alcance real
de la revisión. Solo se compila lo necesario para un despliegue autorizado.

La implementación se entregará en `main` local y `origin/main`, conservando archivos ajenos.
La publicación en producción es una operación separada. Antes de activar campos nuevos debe
haber soporte en todos sus lectores y en cada ruta de reserva afectada, incluido cualquier
consumidor recurrente existente. La web que expone los nuevos controles se publica después.
Una reversión visual puede ocultar la creación y gestión, pero no retirar las comprobaciones
del servidor mientras existan sesiones con cupos. No se autoriza un despliegue en este documento.
