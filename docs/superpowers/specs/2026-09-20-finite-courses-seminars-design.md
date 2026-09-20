# Cursos y seminarios con sesiones finitas: especificación

Fecha: 2026-09-20.
Estado: aprobada por el operador en conversación después de su publicación en `ccc9209`.
El plan de implementación se encuentra en
[2026-09-20-finite-courses-seminars.md](../plans/2026-09-20-finite-courses-seminars.md).
Ese plan propone para revisión un ajuste de URL/renderizado público debido a la
exportación estática actual; los apartados 8/10 de esta especificación se conservan
como referencia de lo aprobado hasta aceptar expresamente ese ajuste.
Alcance: especificación, sin cambios de aplicación ni despliegue.

## 1. Objetivo y resultado observable

BPT podrá vender cursos y seminarios con un pago único por participante y un número
cerrado de sesiones semanales. Un curso de seis semanas, los sábados de 15:00 a 16:00,
generará seis sesiones en el calendario existente, con el mismo horario local de Jersey.
El coach usará su interfaz habitual para consultar participantes y registrar asistencia.
La inscripción aprobada habilitará esas sesiones sin exigir una membresía ordinaria.

La oficina podrá preparar el curso, publicarlo, revisar transferencias, aprobar
participantes, gestionar bajas y consultar la lista de espera. La portada lo promocionará
automáticamente tras su publicación. Los avisos se consultarán dentro de la plataforma.

## 2. Decisiones expresas del operador

| Tema | Decisión acordada |
| --- | --- |
| Público | Miembros y personas nuevas, sin exigir suscripción habitual activa. |
| Menores | El padre, madre o tutor tramita la inscripción desde su cuenta. |
| Plaza inicial | Reserva durante 24 horas para enviar referencia y justificante. |
| Justificante enviado | Conserva la plaza hasta la decisión administrativa. |
| Correcciones | Conservan la plaza durante otras 24 horas para volver a enviar. |
| Rechazo | Motivo visible para el solicitante y liberación de la plaza. |
| Acceso | La aprobación inscribe en las sesiones del curso sin reservas semanales adicionales. |
| Calendario | Interfaz de coach normal; sesiones normales repetidas semanalmente hasta completar el número asignado. |
| Incorporación tardía | Permitida mientras haya plazas y sesiones futuras; precio completo y fechas restantes visibles antes de pagar. |
| Baja | La solicita el participante o tutor; administración decide y registra cualquier devolución manual. |
| Instructor | Coach existente o nombre de invitado. Escribir un nombre no concede acceso. |
| Publicación | Guardar borrador y publicar mediante una acción explícita. |
| Curso completo | Lista de espera sin pago, por orden de solicitud. |
| Oferta de plaza | 24 horas para enviar el justificante, antes de ofrecerla al siguiente. |
| Comunicaciones | Exclusivamente dentro de la plataforma, sin correos. |
| Organización | Módulo propio Courses & Seminars integrado con las piezas existentes. |
| Familia | Solicitud, transferencia, referencia y justificante separados por participante. |
| Coach asignado | Consulta participantes y registra asistencia; sin pagos ni justificantes. |

La última aclaración sustituye la propuesta inicial de un calendario específico y de
selección arbitraria de múltiples fechas: la creación inicial será semanal y finita.
Un seminario de una sola sesión se representa con número de sesiones igual a uno.
La reprogramación posterior de una sesión sí estará disponible para administración.

## 3. Base existente y límites de reutilización

Inspección del repositorio en la línea de trabajo que contiene `acaba83`:

- `apps/functions/src/schedule/weekly-session-service.ts` modela series sin fecha final
  y materializa ventanas. El curso debe tener un límite explícito; activar simplemente
  `repeatWeekly` produciría sesiones adicionales no vendidas.
- `booking-transaction-service.ts` y `advanced-booking-service.ts` requieren membresía.
  Sus autorizaciones no sirven sin cambios para participantes que solo compran un curso.
- `attendance-transaction-service.ts` consulta el alumno canónico y la reserva confirmada.
  Se conservará esa relación para reutilizar la asistencia habitual.
- `members/enrolment-payment-proof.ts` ofrece carga autenticada de PNG/JPEG, tamaño
  máximo de 2 MiB y almacenamiento privado R2. Su lista actual de roles y el vínculo a
  solicitudes de alta general requieren un adaptador propio para cursos.
- `settings/paymentInstructions` es la fuente de instrucciones bancarias de la academia.
  Los cursos no tendrán una copia editable independiente de la cuenta bancaria.
- `notifications/admin-notification-service.ts` cubre avisos administrativos de
  membresías. El módulo necesita avisos de curso para solicitantes y tutores; no se
  asume que esa bandeja ya existe para todos los usuarios.
- `apps/web/src/app/page.tsx`, los calendarios actuales y sus shells aportan navegación
  y componentes. Se conservarán PRODUCT.md, DESIGN.md y las restricciones del coach.

## 4. Creación, publicación y sesiones

Formulario administrativo en `/admin/courses`, con:

- Tipo curso o seminario, título, descripción y lista de técnicas/objetivos.
- Coach de plantilla seleccionado por ID o nombre de instructor invitado.
- Sede existente, edad mínima y edad máxima opcional.
- Precio único positivo en GBP por participante, almacenado en peniques enteros.
- Aforo positivo entero y condiciones de cancelación visibles antes del pago.
- Fecha inicial, hora de inicio, hora de fin y número entero positivo de sesiones.

Las fechas se calculan en `Europe/Jersey`, conservando la hora local cuando cambie el
horario de verano. La primera versión admite sesiones que terminan el mismo día.
El formulario muestra las fechas exactas, duración y precio antes de publicar.
La edad se evalúa en la primera sesión futura a la que pueda incorporarse el participante;
la aprobación la vuelve a comprobar si el calendario o la fecha de incorporación cambian.
La información necesaria del participante se obtiene de su perfil canónico o del alta
específica del participante; no se crea un perfil personal al administrador por administrar.

Estados del curso: borrador, publicado, finalizado y cancelado. La ocupación
completa es una condición de disponibilidad, no un nuevo estado editorial.
Solo un curso publicado con sesiones futuras admite nuevas inscripciones o lista de espera.

Las sesiones se almacenan como sesiones del calendario habitual, vinculadas mediante
`courseId` y un ordinal estable. El vínculo con el curso será exclusivo: no se les aplicará
simultáneamente la serie semanal abierta de las clases ordinarias. Una corrección de fecha
conserva el ID de sesión y sus reservas; repetir la publicación no duplica sesiones.

La publicación se completa únicamente cuando todas las sesiones y la proyección pública
están preparadas. Una preparación parcial conserva el curso como borrador y permite
reanudar la misma operación. El trabajo grande se pagina internamente y muestra progreso,
sin depender de una única transacción con todas las sesiones ni crear series infinitas.
Las lecturas del calendario también comprueban la publicación del curso: las sesiones
preparadas de un borrador no se filtran a calendarios de usuarios o coaches. Se usan
lotes de hasta 100 documentos por trabajo, conservando progreso y revisión esperada.

La oficina podrá reprogramar una sesión y dejar un motivo. Cambiar el número de sesiones
vendidas después de publicar exige una nueva edición; cancelar una sesión conserva su
historial y no genera automáticamente una sustituta. El cambio se comunica dentro de la
plataforma y permite solicitar la baja según las condiciones mostradas al comprar.

El aforo no se puede reducir por debajo de las plazas comprometidas. El precio nuevo
solo afecta a solicitudes futuras; cada solicitud conserva el importe que aceptó.

## 5. Inscripción y transferencia

Flujo: ficha pública → cuenta → participante → resumen y condiciones → reserva de plaza
→ datos bancarios y referencia → justificante → revisión administrativa → inscripción activa.

Para una persona nueva se reutilizan el acceso y los servicios de identidad existentes.
Se crea o vincula un único alumno canónico, sin duplicarlo por cada curso y sin exigir
una suscripción ordinaria. Un tutor solo puede actuar por menores vinculados a su familia.
El adolescente puede consultar su calendario autorizado, pero la solicitud y el pago
siguen a cargo del tutor. Los roles de staff existentes se preservan; comprar un curso
no transforma un coach, administrador u owner en un rol distinto.

Cada solicitud identifica solicitante, participante, academia y curso. El servidor calcula
importe, moneda, plazo y elegibilidad; el navegador no puede fijarlos. Al reservar se
genera una referencia de solicitud sin datos personales, y el solicitante puede indicar
la referencia efectivamente usada en su transferencia para facilitar la conciliación.
Se guardan el precio, las condiciones aceptadas y la revisión del curso en ese momento.

Se muestran el importe completo, el destinatario bancario, la referencia y las fechas
futuras antes de pedir el justificante. Una cuenta bancaria no configurada impide iniciar
el pago y produce un mensaje accionable para administración.

Enviar un justificante no demuestra que el banco haya recibido fondos: owner o
administrador revisa y confirma el pago mediante Approve. La acción registra su decisión
y activa la inscripción de forma idempotente, sin casillas de verificación redundantes.
Los botones de aprobación no dependen de que Auth tenga `displayName`; se usan los datos
del participante y su identidad canónica. Los nombres admiten caracteres imprimibles,
con límites de longitud, y se muestran como texto seguro.

## 6. Estados, aforo y lista de espera

La inscripción y el dinero se registran separadamente: una solicitud rechazada no significa
que un pago se haya devuelto. Los estados funcionales son:

| Estado | Ocupa plaza | Acciones principales |
| --- | --- | --- |
| Reserva pendiente de justificante | Sí, hasta el vencimiento | Enviar o cancelar |
| Pendiente de revisión | Sí | Aprobar, pedir corrección, rechazar |
| Corrección solicitada | Sí, durante 24 horas | Reenviar o cancelar |
| Aprobada | Sí | Asistir, comunicar ausencia, pedir baja |
| Baja solicitada | Sí | Administración confirma o deniega con motivo |
| Caducada, rechazada o cancelada | No | Consultar motivo, nueva solicitud si procede |
| Lista de espera | No | Consultar posición, abandonar |
| Plaza ofrecida | Sí, durante 24 horas | Enviar justificante o declinar |

Las 24 horas comienzan en la reserva, petición de corrección u oferta registrada por
el servidor, no al abrir la pantalla. Se muestra fecha y hora absolutas junto al tiempo
restante. El usuario acepta al entrar en la lista que debe consultar la plataforma.

Invariante de aforo: plazas aprobadas más reservas vigentes y solicitudes en revisión
no superan la capacidad del curso. Un participante solo tiene una solicitud vigente o
inscripción activa por curso. Refrescar, abrir dos pestañas o repetir una petición no
reserva otra plaza ni registra otro pago.

La comprobación de capacidad y la asignación se hacen en transacción. Cuando exista
lista de espera, un nuevo visitante no puede adelantarse aprovechando una plaza recién
liberada: el mismo servicio la asigna al candidato elegible más antiguo. Empates se
resuelven por un identificador estable. Una oferta vencida se cierra; volver a apuntarse
coloca al participante al final de la lista.

Un proceso periódico, con consultas indexadas por vencimiento, libera reservas y crea
ofertas. Las operaciones de usuario vuelven a comprobar los plazos para que un retraso
del proceso no permita usar una reserva caducada. Los avisos y ofertas se generan una
sola vez por evento, aunque el proceso se reintente.

Una captura enviada después de caducar la reserva se admite como incidencia de pago,
sin quitarle la plaza a otra persona. Administración puede conciliar y, si queda una
plaza, aprobar por la vía habitual; en caso contrario registra la resolución/devolución.
La pantalla no invita a pagar de nuevo para corregir este caso.

Las solicitudes con justificante no caducan automáticamente mientras administración las
revisa. Si ya no queda ninguna sesión futura, dejan de ser aprobables y se muestran como
incidencias que requieren resolución económica. No se crean nuevas ofertas para ese curso.

## 7. Calendario, asistencia y bajas

La compra concede acceso específico al curso, independiente de las cuotas, sedes y límites
semanales de la membresía ordinaria. No concede acceso a otros cursos ni a clases normales.
Las sesiones del curso no consumen el cupo semanal ordinario ni generan facturas PAYG.
Las operaciones ordinarias de reserva o cancelación no pueden modificar una plaza de
curso saltándose su inscripción; la ausencia se gestiona como ausencia de esa sesión.

La aprobación inscribe en todas las sesiones futuras que todavía no hayan comenzado.
Las sesiones pasadas siguen visibles como historial del curso, pero no se crean reservas
ni faltas retrospectivas para un participante incorporado tarde.

El calendario combina sesiones normales y sesiones del curso en la vista ya utilizada.
El coach ve el nombre del curso y “Session 2 of 6”, abre la lista de participantes y
registra asistencia con los controles existentes. El backend comprueba asignación vigente
a la sesión o curso; el nombre libre de un invitado no actúa como autorización.

Las reservas incorporan un origen explícito: membresía ordinaria o inscripción de curso.
El origen de curso exige una inscripción aprobada de ese alumno en ese mismo curso. Se
adapta el contrato compartido de reserva, lecturas, aforo, asistencia y auditoría; nunca
se inventa una membresía para satisfacer el contrato anterior.

Para evitar cientos de escrituras en Approve, la inscripción activa es la autoridad y
las reservas de sesiones se materializan por lotes reanudables con IDs deterministas.
Mientras se completa la proyección, calendario y roster obtienen la inscripción activa
y pueden asegurar la reserva necesaria de manera idempotente. No se muestra acceso antes
de aprobar ni se pierde acceso por un fallo parcial de la proyección.

Comunicar una ausencia afecta solo a esa sesión y no libera la plaza del curso. El
participante no necesita reservarla otra vez. La baja confirmada revoca inmediatamente
el acceso a sesiones futuras y libera la plaza, aunque queden proyecciones por actualizar.
La asistencia pasada permanece intacta. Las asistencias de curso se distinguen por origen
y no se incorporan automáticamente a requisitos de graduación de clases ordinarias.

La cancelación del curso detiene inscripciones y ofertas, cancela sus sesiones futuras,
conserva el historial y abre la revisión de los pagos recibidos. Las devoluciones son
manuales: importe, motivo, estado y referencia quedan registrados; no se ejecutan
transferencias bancarias desde BPT ni se marca una devolución como realizada al solicitarla.

## 8. Interfaces, promoción y avisos

Lectura de diseño: ampliación de la web y producto BPT para familias, alumnos y oficina,
con el lenguaje visual claro y práctico de la academia. Se conservan púrpura BPT,
Barlow Condensed, Source Sans 3 y los componentes de cada superficie de DESIGN.md.
El marco visual existente mantiene variación 6, movimiento 3 y densidad 5; la barra
promocional es la excepción de movimiento solicitada explícitamente por el operador.

| Superficie | Comportamiento |
| --- | --- |
| Portada | Una barra de cursos publicados con sesiones futuras, título, próxima fecha y enlace. Los completos indican lista de espera. |
| `/courses` | Catálogo público con precio, sede, edad y próxima sesión; sin datos de participantes. |
| `/courses/[courseId]` | Descripción, técnicas, instructor, calendario, condiciones y acción de inscripción o lista de espera. |
| `/account/courses` | Solicitudes, plazos, correcciones, ofertas, cursos aprobados y bajas del usuario o menor seleccionado. |
| `/admin/courses` | Cursos, sesiones, solicitudes, participantes, lista de espera e incidencias de pago. |
| Calendario y coach actuales | Sesiones del curso y asistencia dentro de sus controles habituales. |

Las rutas de compra/seguimiento de cursos requieren cuenta, no membresía ordinaria.
Su autorización no debe heredar accidentalmente el bloqueo del área de socios. Se añade
un enlace al catálogo en las interfaces existentes, con el seguimiento personal donde
corresponda; no se crea un segundo panel de coach.

La barra usa desplazamiento CSS de velocidad uniforme, pausa visible, pausa al interactuar
y versión estática para `prefers-reduced-motion`. Los duplicados visuales del bucle no
duplican enlaces accesibles ni anuncios. Habrá enlaces estáticos al catálogo y el contenido
principal se podrá leer sin seguir texto en movimiento. La barra no se superpone al contenido.

En móvil los formularios se apilan, los objetivos táctiles tienen al menos 44 px, el foco
es visible y los mensajes aparecen junto al campo o acción. Cargas iniciales usan espacios
reservados; un refresco conserva los datos ya visibles. Errores distinguen justificante
inválido, reserva vencida, curso completo, permiso insuficiente y servicio no disponible.
Las acciones explican cómo recuperarse sin perder la referencia del pago.

Los avisos internos enlazan a la solicitud, oferta o sesión concreta. Los de menores se
dirigen al tutor que gestiona la inscripción. No se incorporan emails, SMS, WhatsApp ni push.

## 9. Seguridad y privacidad

| Actor | Alcance de cursos |
| --- | --- |
| Público | Proyección pública de cursos publicados y sus fechas. |
| Solicitante adulto | Sus solicitudes, pagos y justificantes; sus inscripciones. |
| Tutor | Solicitudes e inscripciones de menores vinculados a su familia. |
| Adolescente autorizado | Su calendario y datos deportivos permitidos; no tramita pagos. |
| Coach asignado | Sus sesiones, roster mínimo y asistencia; ningún justificante ni flujo financiero. |
| Owner y administrador activos | Gestión completa del módulo dentro de su academia, sin suscripción personal. |

Cada operación protegida verifica identidad, academia, estado activo, rol y relación con
el recurso en servidor. App Check se conserva en los flujos protegidos existentes y se
aplica a los nuevos; no sustituye las comprobaciones de autorización. Las colecciones
privadas no se abren a lectura/escritura directa desde el cliente. La publicación expone
una proyección mínima, nunca documentos de solicitudes completos.

Los justificantes se limitan a PNG/JPEG de hasta 2 MiB y 20 megapíxeles, con
validación del contenido real. El procesamiento decodifica y reexporta una imagen segura,
elimina metadatos y aplica límites de recursos. No se aceptan HTML, SVG, ejecutables ni
URLs aportadas por el usuario para que el servidor las descargue. Se almacenan en R2
privado con claves generadas por el servidor y vínculo a academia, solicitud y propietario.
Su lectura requiere autorización y acceso temporal; quedan fuera de CDN, cachés compartidas,
URLs públicas y registros de aplicación. La captura se descarga solo al abrir el detalle.

Se proponen límites de 10 reservas nuevas por hora y cuenta solicitante, 20 cargas
por hora y 10 envíos por solicitud y hora. Los reintentos con la misma clave de
idempotencia devuelven su resultado sin consumir otra reserva. Estos límites de
autoservicio no imponen cuotas de creación de cursos al administrador. Se mantiene
el límite de una inscripción vigente por participante/curso. Descripciones y
técnicas se representan como texto y listas estructuradas; no se admite HTML arbitrario.
Las rutas de retorno tras login se limitan al mismo sitio.

Approve verifica versión, estado, importe aceptado, justificante, capacidad e identidad.
La aprobación y el registro económico forman una decisión idempotente, con auditoría de
actor, fecha y solicitud. Cambios simultáneos devuelven el estado vigente y permiten
continuar sin duplicar inscripciones. Se detectan referencias/justificantes reutilizados
entre solicitudes para revisión humana, sin afirmar que la imagen prueba un pago auténtico.

La primera versión no introduce un nuevo plazo automático de borrado de evidencia
financiera ni activa propuestas de retención pendientes del repositorio. Los justificantes
se clasifican como evidencia de pago y se incluyen en los procesos de acceso, exportación
y eliminación autorizada existentes; el borrado no se desencadena al rechazar una solicitud.
Los archivos sin solicitud confirmada se limpian a las 48 horas con comprobación de
referencias para no borrar cargas que están terminando. Las incidencias de pago conservan
su evidencia. Los cambios de política de retención se gestionan por separado.

Estas medidas definen controles concretos de seguridad; no constituyen una promesa de
ausencia absoluta de vulnerabilidades ni una certificación de cumplimiento legal.

## 10. Rendimiento y consistencia

- Catálogo y barra usan una proyección pública pequeña y cacheable, con invalidación al
  publicar, editar, cancelar o finalizar. La disponibilidad presentada es orientativa;
  reservar siempre consulta la capacidad real en servidor.
- El contenido público se entrega renderizado desde servidor mediante el despliegue
  existente. No carga Firebase Auth, administración, justificantes o listas de asistentes
  solo para mostrar la barra; la autenticación se inicia al entrar en el flujo privado.
- Una animación CSS de transform basta para la barra. No se añaden librerías de animación
  ni actualizaciones de estado React por fotograma.
- Las colas se paginan en grupos de 30 y se filtran en servidor. Los comprobantes y el
  detalle de cada solicitud se cargan al abrirlos, no junto a toda la lista.
- Calendario consulta solo el intervalo visible y combina sus resultados con los cursos
  autorizados. No descarga todas las sesiones históricas ni todas las inscripciones.
- Los avisos se actualizan al entrar, al recuperar el foco y después de una acción
  relevante, agrupando peticiones repetidas. No se añade polling a cada shell.
- Expiraciones y proyecciones se ejecutan en lotes acotados y reanudables con índices;
  nunca mediante barridos completos desde una petición interactiva.
- Datos privados y enlaces de comprobantes usan respuestas sin caché compartida. Las
  credenciales y objetos privados quedan fuera de componentes públicos y bundles cliente.

Objetivos de aceptación de rendimiento: LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1 en el
percentil 75 de visitas representativas. Son objetivos, no mediciones ya obtenidas.
Se comparará también la carga del calendario habitual antes y después para detectar
regresiones. Las mediciones instrumentadas se realizarán cuando el operador las autorice,
respetando la excepción de verificación de este repositorio.

## 11. Unidades y datos del módulo

Se mantiene el monolito modular: contratos en `packages/domain`, operaciones autorizadas
en Firebase Functions, registros en Firestore y evidencias privadas en R2. Next.js presenta
las superficies públicas, de usuario y administración; el coach conserva su pantalla.

| Unidad | Responsabilidad y contrato conceptual |
| --- | --- |
| Catálogo de cursos | Guardar borrador, validar calendario y publicar una revisión coherente. |
| Calendario finito | Producir N sesiones estables, reprogramar y cancelar sin perder historial. |
| Inscripciones y capacidad | Reservar, caducar, corregir, aprobar, dar de baja y preservar el aforo. |
| Evidencia y pago | Vincular captura y referencia; registrar confirmaciones y devoluciones manuales. |
| Cola de espera | Asignar por orden una plaza libre y gestionar su oferta de 24 horas. |
| Acceso y asistencia | Resolver inscripción activa, proyectar reservas y reutilizar roster/asistencia. |
| Avisos internos | Emitir un aviso por evento para los destinatarios autorizados. |
| Publicación web | Exponer únicamente información comercial y fechas, con caché independiente. |

Registros nuevos: cursos, solicitudes/inscripciones, entradas/ofertas de espera, evidencias
de pago y avisos de curso, todos bajo la academia. Se reutilizan alumnos, familias,
sesiones, reservas, asistencia y auditoría. Los registros financieros de curso se integran
como una fuente diferenciada en la contabilidad manual existente, sin activar ciclos de
membresía ni crear dos pagos por una misma aprobación. El plan detallará contratos y
archivos exactos tras la aprobación de esta especificación.

## 12. Criterios de aceptación y revisión

1. Se publican exactamente seis sesiones para seis sábados, también al cruzar el cambio
   de hora. No aparece una séptima y el coach usa su pantalla normal.
2. Un adulto nuevo y un menor gestionado por tutor pueden inscribirse sin membresía
   ordinaria; aprobar les da acceso solo al curso comprado.
3. Dos hermanos producen dos solicitudes, pagos y justificantes independientes.
4. Dos solicitudes simultáneas no consumen la última plaza dos veces. No se adelantan
   a la lista de espera y una reserva caducada no vuelve a activarse desde el navegador.
5. Reintentar publicación, carga, envío, aprobación o un trabajo de proyección no duplica
   sesiones, pagos, reservas ni avisos.
6. Rechazar, corregir, caducar y dar de baja conservan su motivo e historial. Un pago
   enviado tarde tiene una vía de resolución sin exigir otra transferencia.
7. La incorporación tardía muestra precio completo y solo genera asistencia/reservas
   futuras. Una ausencia individual no libera la plaza del curso.
8. Un coach ajeno, otro tutor o una cuenta de otra academia no accede a la solicitud ni
   a sus ficheros, aunque conozca sus identificadores. El coach asignado no ve finanzas.
9. Cancelar o reprogramar actualiza los calendarios y avisos internos; nunca envía correo.
10. La barra se pausa por control visible, admite teclado y movimiento reducido. Los
    datos privados no aparecen en respuestas públicas ni en cachés compartidas.
11. Fallos parciales conservan un estado recuperable: borrador al publicar incompleto,
    inscripción como autoridad al proyectar reservas y revisión económica tras el final.
12. Las clases ordinarias conservan sus límites, autorizaciones y funcionamiento actuales.

Estos son escenarios para revisión del diseño e implementación, no pruebas ejecutadas.
Por instrucción del operador, no se añaden ni ejecutan suites automatizadas, navegador,
cobertura, lint global o comprobaciones globales de tipos sin petición explícita. La
verificación ordinaria será inspección de código y estado Git; solo se compilará lo
necesario para un despliegue que haya sido autorizado. El informe de entrega distinguirá
entre revisión, compilación, publicación y comportamiento realmente observado.

## 13. Exclusiones de la primera versión

Interfaz o calendario nuevos para coaches; sesiones recurrentes infinitas de curso;
inscripción por sesión suelta; carrito familiar; cuotas periódicas; descuentos y cupones;
pasarela bancaria automática; devoluciones automáticas; email, SMS, WhatsApp y push;
alta automática de invitados como staff; renovación de membresías como efecto de comprar
un curso; cambios globales de identidad visual o infraestructura del VPS.

## 14. Referencias de diseño y revisión

- `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` y `apps/web/AGENTS.md` del repositorio.
- ADR-003 para almacenamiento privado; ADR-008 para distinguir políticas de retención
  propuestas de controles realmente implantados; ADR-014 y ADR-015 para calendario.
- [OWASP: carga de archivos](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html):
  tipos permitidos, validación real, límites, almacenamiento separado y autorización.
- [W3C: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html):
  controles para contenido en movimiento automático.
- [Web Vitals](https://web.dev/articles/vitals): objetivos LCP, INP y CLS y evaluación
  mediante percentiles de experiencia real.

La revisión del operador de este documento precede al plan de implementación de
`superpowers:writing-plans`. Aprobar la especificación autoriza preparar ese plan;
la implementación y su despliegue no forman parte de esta entrega documental.
