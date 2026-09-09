# tasksv2.md - BPT Jersey Academy Platform, segunda version

Estados: `pendiente` -> `en-progreso` -> `revision` -> `aprobada` -> `desplegada`; `bloqueada` cuando
requiere una decision o un dato externo que todavia no existe.

Cada tarea con impacto en codigo pasa el mismo ciclo de autocritica Nivel 3 que `tasks.md`:
seguridad, pruebas relevantes, evidencia y rendimiento cuando corresponda.

## Que es este documento y que no es

Este ledger cubre **unicamente** los bugs y las funciones nuevas levantados por el operador el
2026-09-09. `tasks.md` sigue siendo la fuente de verdad de todo lo anterior, incluidas las filas que
siguen abiertas alli (T010, T011, T125, T126, T127). Nada de lo que hay aqui las sustituye ni las
cierra.

Las filas se numeran `T001V2` en adelante. El sufijo `V2` es lo que mantiene los IDs unicos a lo
largo de los dos ledgers: `T001V2` no es `T001`, y ningun ID de este archivo puede confundirse con
uno de `tasks.md` aunque compartan el numero.

## Regla de honestidad de este ledger

Dos requisitos del operador resultaron estar ya construidos al auditar el codigo antes de escribir
estas filas. No se convierten en tareas de construccion, sino de verificacion, y la fila lo dice:
inventar trabajo ya hecho seria mentir sobre el estado del proyecto. Son T005V2 (el texto del waiver)
y T020V2 (el centro de entrenamiento en la base de miembros).

## Decisiones de producto tomadas por el operador el 2026-09-09

| # | Decision | Consecuencia directa |
| - | -------- | -------------------- |
| D1 | El menor tiene cuenta propia con alcance recortado | Ve su progreso y sus proximas clases, reserva y marca asistencia. No ve pagos, waiver ni datos de terceros. El representante legal sigue siendo titular de suscripcion, waiver y responsabilidad, y puede revocar el acceso. Entra en la DPIA de T011 como tratamiento nuevo. |
| D2 | Cancelar con menos de 12 h reutiliza el fee de inasistencia existente | No se crea un cargo nuevo: se emite la misma **propuesta** de penalizacion de T111 (GBP 15, Town) que un administrador aprueba o descarta. Nunca hay cobro automatico. |
| D3 | La primera clase se reserva con cuenta creada, antes de la aprobacion | El solicitante se registra, reserva su clase gratis y eso dispara la notificacion al admin. Queda en estado pendiente: ve su reserva, pero no puede reservar una segunda clase hasta ser aprobado. |
| D4 | v2 cubre solo lo nuevo | `tasks.md` y `Lista/` conservan la verdad de todo lo anterior. |

---

## V2-A - Bugs de interfaz del formulario de inscripcion

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T001V2 | Permitir vaciar por completo Nombre y Email en el formulario de inscripcion | - | pendiente | Causa localizada antes de abrir la fila: en `apps/web/src/app/enrol/page.tsx:378-385` el efecto de prellenado lleva `form.email.length` y `form.fullName.length` en su propio array de dependencias. Al borrar el ultimo caracter la longitud pasa a 0, el efecto se vuelve a ejecutar y reescribe el valor de la sesion. El arreglo es prellenar una sola vez -guarda de "ya sembrado" o dependencia solo de la sesion-, no ensanchar la condicion. Cierra con una prueba que borre el campo entero y afirme que sigue vacio tras el re-render. |
| T002V2 | Convertir el formulario en un asistente por pasos de 1 a 3 campos con barra de progreso | T001V2 | pendiente | El formulario actual presenta todos los campos de una vez (`apps/web/src/app/enrol/page.tsx`). Pasa a pasos de 3 campos como maximo, con barra de progreso y estado accesible en cada paso. La validacion se ejecuta por paso, no solo al enviar. Se conserva el estado ya escrito al retroceder. |
| T003V2 | Impedir el zoom automatico de iOS al enfocar un campo | T002V2 | pendiente | En iOS Safari el navegador hace zoom cuando el campo enfocado tiene un tamano de fuente menor de 16 px. La correccion es tipografica y de viewport, no `maximum-scale=1`, que rompe el zoom por gesto y con el la accesibilidad. Cierra con evidencia en un dispositivo o emulacion movil real. |

## V2-B - Reserva de la primera clase

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T004V2 | Unificar "Ask for a place" y "Book a free class" en el mismo formulario | T002V2 | pendiente | Bug confirmado: "Book a free class" apunta a `href="#contact"` en `apps/web/src/app/page.tsx:54` y `:230` -un ancla a su propia seccion, por eso no hace nada visible-, mientras "Ask for a place" va a `/enrol` (`page.tsx:227`). Los tres botones pasan a un unico destino: el formulario por pasos que reserva una clase gratis. Actualizar tambien `apps/web/src/lib/client-auth.tsx:195` y las pruebas de `test-harness.test.tsx` que hoy afirman el ancla. |
| T005V2 | Verificar que el waiver mostrado es el documento oficial, byte a byte | - | pendiente | **Auditado antes de abrir la fila: el texto ya coincide.** `packages/domain/src/consents/enrolment-waiver-terms.ts` contiene las diez clausulas del PDF oficial `Varios/Brazilian Power Team Jersey Waiver and Release of Liability.pdf`, con los mismos encabezados y con los bullets de higiene. La fila no construye el texto: comprueba mecanicamente que sigue coincidiendo. Cierra con una prueba que extraiga el texto del PDF y lo compare con `enrolmentWaiverTerms`, de modo que una divergencia futura falle en CI en vez de descubrirse en produccion. Si aparece divergencia, se acuna version nueva segun la regla ya escrita en la cabecera de ese archivo. |
| T006V2 | Reservar la primera clase antes de la aprobacion y notificar al administrador | T004V2 | pendiente | Aplica D3. El solicitante crea cuenta, reserva la clase gratis y la reserva dispara el aviso al administrador. Mientras esta pendiente ve su reserva y no puede reservar una segunda clase. Invierte el orden actual, en el que la aprobacion precede a cualquier reserva. Requiere un estado de cuenta "pendiente con reserva" en reglas y en los callables, no solo en la interfaz: la restriccion se aplica en el servidor. |
| T007V2 | Cancelacion gratuita hasta 12 h antes; despues, propuesta de fee de inasistencia | - | pendiente | Aplica D2. Colision que hay que resolver con cuidado: hoy existe **un solo corte de una hora** en `packages/domain/src/schedule/schedule-contracts.ts:813` que gobierna a la vez el cierre de reservas, el cierre de cancelaciones y la cancelacion automatica por quorum (`:984`). Las 12 h son un tercer concepto distinto -cancelacion sin coste- y deben anadirse como corte propio, sin mover el corte de reservas ni el de quorum, que la cancelacion por quorum tambien usa. Cancelar dentro de las 12 h emite la propuesta de penalizacion de T111, revisable por un administrador. |

## V2-C - Interfaz de miembros ya aceptados

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T008V2 | Permitir al representante marcar la asistencia de sus hijos al llevarlos a la practica | - | pendiente | Desde el area de familia (`apps/web/src/app/account/family/page.tsx`) el representante marca la llegada de cada hijo. La autorizacion se comprueba en el servidor contra la relacion tutor-menor, no en el cliente. Convive con el marcaje del staff de T014V2 sin duplicar asistencia. |
| T009V2 | Dar cuenta propia al menor, con correo o telefono aportado por el representante y alcance recortado | T008V2 | pendiente | Aplica D1. El representante anade un correo o un telefono al hijo; el menor inicia sesion y ve su progreso, sus proximas clases, reserva y marca asistencia. Nunca ve pagos, waiver, datos de otros miembros ni la ficha del representante. El representante conserva la titularidad economica y legal y puede revocar el acceso en cualquier momento. **Es tratamiento de datos de menores nuevo:** no cierra sin actualizar la DPIA y el registro de retencion de T011 y sin reglas de Firestore que nieguen por defecto todo lo que quede fuera del alcance recortado. |

## V2-D - Landing publica

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T010V2 | Actualizar la seccion de instructores | T021V2 | pendiente | Hoy `apps/web/src/content/academy.ts:154-168` lista a Miro, Eddie, Topo y Charlie. Se conservan Miro y Charlie; entran Amone Mouton, Catalina Bruma y Connor Hoopes. Bloqueada de hecho hasta T021V2: cada entrada del contenido exige `credential`, y las credenciales de los tres nuevos no las tenemos. No se inventan cinturones ni grados. |
| T011V2 | Publicar las dos direcciones de los centros de entrenamiento | T021V2 | pendiente | Hoy el contenido tiene **una sola** direccion (`academy.ts:48-53`, Town Office, Office 9, 13 Library Place, St Helier, JE2 3RR), consumida como objeto unico en `apps/web/src/app/page.tsx`. "BPT West / Strive" solo existe como etiqueta de tarifa (`academy.ts:144`), sin domicilio. Requiere convertir `location` en una lista de dos centros y actualizar el bloque `<address>` de la landing. Falta el domicilio de West, que aporta T021V2. |

## V2-E - Interfaz de administracion y entrenadores

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T012V2 | Reparar la cola de aprobacion de nuevos miembros | - | en-progreso | **La fila mas urgente del ledger: hoy no se puede dar de alta a nadie.** **Diagnosticado en produccion el 2026-09-09; la causa no era ninguna de las cuatro que la fila listaba.** Los registros de Cloud Run dicen `Callable request verification passed` y acto seguido **HTTP 403** en `getEnrolmentRequestDetail`, y el mismo 403 aparece en `listMembers`, `getMemberDetail` y `lookupMemberIdentity`, mientras `listEnrolmentRequests` responde 200 en la misma sesion. Lo que separa a unas de otras es la puerta: las que fallan pasan por `requireCanonicalMemberDirectoryActor` (`apps/functions/src/members/canonical-actor.ts:81`), que ademas del claim exige un documento de personal aprovisionado en `academies/{academyId}/users/{uid}`; las que funcionan solo miran el claim del token. En produccion hay dos cuentas administrativas: la de `owner`, con su documento completo -verificado contra el propio esquema, pasa la puerta-, y la de `administrator`, **con claims validos y sin documento ninguno**. Por eso la cola se pinta y ninguna fila se abre. Los tres botones no estan inertes: "Read the full request" recibe el 403, "Approve and enrol" esta `disabled` a proposito hasta que el detalle cargue (`requests/page.tsx:309-312`), y "Send back to applicant" si funciona -usa la puerta del claim- pero exige escribir la nota antes. Descartados con evidencia: secretos (los tres estan enlazados en version 2 y las funciones estan `ACTIVE`), App Check (su ausencia da 401, visible en los registros del 2026-09-07), claims (satisfacen la puerta que devuelve 200) y reglas de Firestore (el Admin SDK no las evalua). **Brecha estructural:** el unico escritor de ese documento es `provisionAdminRole` (`apps/functions/src/auth/admin-provisioning.ts:506`), que `index.ts` reexporta como funcion suelta y no como `onCall`, asi que no esta desplegada: hoy no existe camino en produccion para aprovisionar a un administrador. Hecho el 2026-09-09: el cliente ya no colapsa el 403 en una sola frase ciega (`enrolment-client.ts`, `officeFailure`) y hay pruebas que fijan la asimetria de las dos puertas. Falta la escritura en produccion, que es outward-facing y espera confirmacion del operador. No se cierra con un mensaje de error mas bonito: se cierra aprobando a un solicitante de verdad. |
| T013V2 | Poner las sesiones del dia como primer bloque del panel de administracion | T012V2 | pendiente | El panel (`apps/web/src/app/admin/overview-page.tsx`) ya tiene "Today's classes"; la fila lo eleva a primer bloque y expone las sesiones que quedan por delante en el dia con su hora de inicio. |
| T014V2 | Priorizar el boton de asistencia 15 minutos antes de cada sesion | T013V2 | pendiente | A falta de 15 minutos para el inicio, el panel asciende un boton de asistencia. Marcar se hace seleccionando de la lista de reservados quien esta y quien no, en una sola pantalla, sin buscar miembro por miembro. |
| T015V2 | Contador de 20 minutos: quien no marca asistencia pierde la clase automaticamente | T014V2 | pendiente | Quien no marco antes del inicio entra en un contador; a los 20 minutos del comienzo sin marcaje, pierde la clase automaticamente. **Open mat queda excluido por completo.** El vencimiento lo decide el servidor por hora de sesion, no un temporizador del navegador, que se pierde al cerrar la pestana. Interactua con T007V2: hay que decidir explicitamente si esta perdida automatica emite o no propuesta de fee, y dejarlo escrito en la fila antes de implementarla. |
| T016V2 | Mostrar el calendario semanal al estilo Regyfit | T013V2 | pendiente | Vista semanal completa en el panel, no solo el dia en curso. |
| T017V2 | Ver la siguiente clase con los confirmados y avisar de condiciones medicas | T013V2 | pendiente | Lista de quien ya confirmo para la siguiente sesion y, para quien participe ese dia, aviso con el **nombre de la condicion y el miembro**. Dato de salud: solo lo ve el personal autorizado, cada lectura queda auditada y el aviso no se filtra a vistas agregadas ni a exportaciones. Se apoya en los datos de salud ya existentes; no cierra sin revisar su gate de acceso. |

## V2-F - Pagos, suscripciones y centro

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T018V2 | Bloquear la reserva a quien no se le cobro la mensualidad | - | pendiente | **Hallazgo de la auditoria previa:** la regla ya esta escrita y no la usa nadie. `evaluateBookingEligibility` (`packages/domain/src/schedule/schedule-contracts.ts:911-953`) ya rechaza a quien no esta `active` o `trial` -es decir, ya cubre `overdue`-, pero una busqueda en `apps/` no encuentra **ni una sola llamada** a esa funcion. La regla existe en el dominio y no se aplica en ningun callable. La fila tiene dos mitades: cablear la funcion en la ruta real de reserva, y garantizar que un cobro fallido transiciona de verdad la membresia a `overdue`. Sin la segunda mitad, la primera no bloquea a nadie. |
| T019V2 | Etiquetar cada pago con el centro al que pertenece y elegir centro de retirada del merchandising | - | pendiente | Cada pago lleva en su referencia si es de Town o de West. En la compra de merchandising el comprador elige donde retirarla, y esa eleccion es la que etiqueta el pago. Verificado que no existe hoy: no hay concepto de retirada ni de centro en `packages/domain/src/shop`. Es construccion nueva, no ajuste. |
| T020V2 | Confirmar que la base de miembros muestra el centro donde entrena cada miembro | - | pendiente | **Auditado antes de abrir la fila: ya existe.** La columna "Training center" esta definida en `apps/web/src/app/admin/members/page.tsx:37-41` y `trainingCenter` es campo persistido con valores Town/West en `apps/functions/src/profiles/profile-service.ts`. La fila se reduce a comprobar con datos reales que la columna se puebla para todos los miembros y no queda vacia en los importados; si se puebla, se cierra como verificada sin escribir codigo. |

## V2-G - Datos que faltan del operador

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T021V2 | Recoger los datos que solo el operador tiene | - | bloqueada | Bloquea T010V2 y T011V2 y no puede resolverse desde el codigo. Faltan: (a) el domicilio completo del segundo centro, BPT West / Strive, con codigo postal; (b) la credencial o grado de Amone Mouton, Catalina Bruma y Connor Hoopes, uno por instructor; (c) confirmacion explicita de si Eduardo "Eddie" Afonso y Andrew "Topo" Toporis se retiran de la landing o solo dejan de aparecer en ese bloque. Ninguno de los tres se rellena por suposicion. |

---

## Preguntas abiertas que el operador aun no ha resuelto

Estas no bloquean el arranque, pero si el cierre de la fila que las cita.

1. **T015V2 y T007V2.** La perdida automatica de la clase a los 20 minutos, żemite propuesta de fee de
   inasistencia igual que una cancelacion tardia, o solo libera la plaza? Son dos politicas
   distintas y la fila no puede cerrarse sin elegir una.
2. **T007V2.** El fee de inasistencia existente es de GBP 15 y esta limitado a Town por la decision 2
   del BRIEF. żLa cancelacion tardia en West tambien genera propuesta, y por el mismo importe?
3. **T019V2.** żLa etiqueta de centro en un pago de suscripcion sale del centro habitual del miembro
   (campo `trainingCenter`, que ya existe) o se elige en cada cobro?
4. **T009V2.** żHay edad minima para que un menor tenga cuenta propia, o cualquier menor inscrito
   puede tenerla si el representante aporta el contacto?
5. **T012V2.** El diagnostico del 2026-09-09 dejo la causa localizada y la reparacion pendiente de
   una decision que no es tecnica: la cuenta de `administrator` de produccion tiene claims pero no
   documento de personal aprovisionado. Se le escribe ese documento -y con ello poder de escritura
   sobre el directorio canonico de miembros- o el operador prefiere aprobar desde la cuenta de
   `owner`, que si esta aprovisionada y funciona hoy? Es una escritura en produccion y no se hace
   sin que el operador lo diga.
6. **T012V2.** `provisionAdminRole` no esta desplegada como callable, asi que no hay forma de
   aprovisionar a un administrador desde produccion. Se despliega -fila propia, porque toca la
   superficie de autorizacion- o se acepta que el aprovisionamiento sea siempre una operacion de
   consola?

## Orden de ejecucion recomendado

1. **T012V2 primero, sin discusion.** Mientras la cola de aprobacion no funcione, no entra ningun
   miembro nuevo al sistema, y casi todo lo demas de este ledger describe lo que pasa despues de
   esa aprobacion.
2. **T001V2, T002V2, T003V2, T004V2**: la puerta de entrada publica. Barato, visible y sin dependencias.
3. **T006V2 y T007V2**: cambian el orden del alta y la politica de cancelacion. Tocan reglas y
   callables, no solo interfaz.
4. **T018V2**: cierra la brecha entre una regla escrita y una regla aplicada.
5. **T013V2 a T017V2**: el panel de administracion, ya con altas funcionando.
6. **T008V2 y T009V2**: el bloque de familias y menores, que arrastra revision de DPIA.
7. **T010V2, T011V2, T019V2, T020V2**: cierre, en cuanto T021V2 aporte los datos.

## Ciclo de resolucion fila por fila

Instalado el 2026-09-09 con el mismo instalador que el resto de skills del repo: `grill-me` y
`grilling` de `mattpocock/skills` (MIT), registradas en `skills-lock.json`. `grill-me` solo lo
invoca el operador escribiendo `/grill-me`; `grilling` puede invocarse durante el trabajo.

`grilling` entrevista por **rondas**: pregunta de golpe todo lo que ya se puede decidir, con una
recomendacion por pregunta, y espera la respuesta antes de la siguiente ronda. Encaja exactamente
con el problema de este ledger, que es que hay decisiones sueltas mezcladas con trabajo mecanico.

Ciclo por fila:

1. **Interrogar.** `/grill-me` sobre la fila. Sirve para cerrar sus decisiones abiertas antes de
   escribir nada, no para repasar lo que ya esta decidido.
2. **Registrar.** La respuesta entra en la fila de `tasksv2.md`, con fecha. Una decision que solo
   vive en el chat no existe.
3. **Implementar y probar**, con el ciclo de autocritica Nivel 3 de siempre.
4. **Sincronizar.** Estado y evidencia a `tasksv2.md` y despues a `Listav2/Listav2.data.js`, en el
   mismo cambio logico. `qa/unit/listav2-ledger-sync.test.ts` falla si uno de los dos se queda
   atras.
5. **Marcar.** Cada requisito que quede resuelto se marca en `RESOLUTION_REQUIREMENTS` poniendo su
   segundo argumento a `true`. Las casillas del tablero son de solo lectura a proposito: una marca
   es una afirmacion sobre el proyecto, asi que se hace en el repositorio, donde tiene autor, fecha
   y diff, y no desde la pagina, donde viviria en un solo navegador. Solo se marca lo que se puede
   demostrar; lo que se averiguo va en `RESOLUTION_NOTES`, que no es marcable porque un hecho no se
   completa.

**Las cinco filas que hay que interrogar antes de tocarlas**, porque su decision cambia lo que se
construye: T006V2 y T007V2 (orden del alta y politica de cancelacion), T009V2 (alcance de la cuenta
del menor y DPIA), T015V2 (que pasa al perder la clase por el contador) y T019V2 (de donde sale la
etiqueta de centro). Las demas ya tienen la causa localizada y se pueden empezar de frente.

T021V2 es la excepcion: no se resuelve interrogando, porque lo que falta son datos que solo tiene el
operador. Ninguna cantidad de preguntas produce el domicilio de West.

## Regla de continuidad

`tasksv2.md` es la fuente unica de verdad del estado de estas filas. Se actualiza **antes** de
tocar codigo y al terminar cada avance; despues, en el mismo cambio logico, se sincroniza
`Listav2/Listav2.js`. Los dos archivos suben juntos.
