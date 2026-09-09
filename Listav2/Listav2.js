/**
 * Listav2.js - GENERADO por Listav2/build.mjs. No lo edites a mano.
 *
 * Es la concatenacion de `Listav2.data.js` (las filas) y `Listav2.engine.js` (el render).
 * Edita esos dos y vuelve a ensamblar; cualquier cambio hecho aqui se pierde.
 *
 * Fuente unica de verdad de las filas: `tasksv2.md`.
 */

/**
 * Listav2 - datos del tablero de la segunda version.
 *
 * Este archivo contiene SOLO los datos. El motor de render vive en la segunda mitad de
 * `Listav2.js`, copiado del de `Lista/Lista.js` para que los dos tableros se comporten igual.
 *
 * Fuente unica de verdad: `tasksv2.md`. Se actualiza alli primero y aqui despues, en el mismo
 * cambio logico. Este tablero cubre unicamente el trabajo nuevo del 2026-09-09; todo lo anterior
 * sigue en `Lista/`.
 */

const VALID_STATUSES = [
  "aprobada",
  "revision",
  "en-progreso",
  "pendiente",
  "bloqueada",
  "cancelada",
];

const IMPLEMENTATION_STATUS_LABELS = {
  "no-iniciada": "Sin implementación registrada",
  parcial: "Implementación parcial",
  implementada: "Implementación realizada",
  verificada: "Implementación verificada",
};

const IMPLEMENTATION_STATUS_CLASSES = {
  "no-iniciada": "implementation-not-started",
  parcial: "implementation-partial",
  implementada: "implementation-implemented",
  verificada: "implementation-verified",
};

/**
 * Un requisito es una accion que alguien puede terminar. `done` lo marca quien hace el trabajo,
 * en este archivo, y viaja en el repositorio: no es una preferencia del navegador de nadie.
 *
 * Marcar algo aqui es una afirmacion sobre el proyecto, asi que solo se marca lo que se puede
 * demostrar. Lo que se comprobo, con su fecha, va en `RESOLUTION_NOTES`.
 */
function requirement(text, done = false) {
  return { text, done };
}

/**
 * Lo que se averiguo sobre la fila: hechos, no tareas. Vive aparte de la lista marcable porque un
 * hecho no se completa, y mezclarlo con las acciones haria imposible leer que falta de verdad.
 */
const RESOLUTION_NOTES = {
  T001V2:
    "Causa localizada el 2026-09-09 en `apps/web/src/app/enrol/page.tsx:378-385`: el efecto de prellenado lleva `form.email.length` y `form.fullName.length` en su propio array de dependencias, así que al borrar el último carácter la longitud pasa a 0, el efecto se vuelve a ejecutar y reescribe el valor de la sesión.",
  T003V2:
    "iOS Safari hace zoom al enfocar un campo cuyo tamaño de fuente es menor de 16 px. `maximum-scale=1` lo taparía, pero desactiva el zoom por gesto y rompe la accesibilidad, así que no es una opción.",
  T004V2:
    'Bug confirmado el 2026-09-09: "Book a free class" apunta a `href="#contact"` en `apps/web/src/app/page.tsx:54` y `:230`, un ancla a su propia sección, por eso no hace nada visible. "Ask for a place" sí va a `/enrol`.',
  T005V2:
    "Comprobado el 2026-09-09: el texto mostrado y el PDF oficial de `Varios/` coinciden. `packages/domain/src/consents/enrolment-waiver-terms.ts` tiene las diez cláusulas, los mismos encabezados y los bullets de higiene. No hay texto que escribir.",
  T006V2:
    'Decisión D3 del operador, 2026-09-09. Auditado el mismo día: reservar exige `studentId` y `membershipId`, y ninguno de los dos existe antes de la aprobación. `requireStudentScope` (`apps/functions/src/schedule/schedule-callables.ts:64-82`) rechaza a `shopper`, y el resolutor canónico busca al alumno en `academies/{id}/students` o en `relationships`, colecciones que solo escribe la ruta de aprobación. Entre `shopper` y `adultStudent`/`guardian` no hay estado intermedio: el claim salta de golpe. Invertir el orden no es mover una comprobación, es crear la identidad de alumno antes de aprobar o abrir una ruta de reserva propia para la clase de prueba. Interrogada y decidida el 2026-09-09: se crea un alumno provisional con membresía `trial` en el registro y la clase de prueba viaja por la ruta de reserva única, porque `evaluateBookingEligibility` ya acepta `trial` y así el aforo, el quórum, los cortes, la asistencia y el contador de T015V2 se aplican sin escribir nada. Se descartó la ruta propia para no crear un segundo camino que toda regla futura tendría que acordarse de cubrir. El provisional no aparece en la base de miembros hasta ser aprobado; al rechazar, su membresía pasa a `cancelled`; el límite de una clase es un cupo de la propia membresía; la reserva cuenta para el mínimo de cuatro; y el aviso al administrador es uno solo, al reservar.',
  T007V2:
    "Hoy un único corte de una hora gobierna a la vez el cierre de reservas, el de cancelaciones y la cancelación automática por quórum. Las 12 h son un tercer concepto y hay que añadirlas aparte: mover el corte de una hora rompería el quórum. Precisado el 2026-09-09: no es una constante, es el parámetro por defecto `cutoffMinutes = 60` de `isWithinBookingCutoff` (`schedule-contracts.ts:816`), y las tres llamadas pasan `60` a mano (`booking-transaction-service.ts:598` reservas, `:806` cancelación, `decideQuorumSweep` en `schedule-contracts.ts:1024`). Y el fee no está «limitado a Town» por costumbre: está clavado en el dominio. `noShowPenaltyLocationId = \"town\"` (`packages/domain/src/penalties/no-show-penalty-contracts.ts:14`) y `decideNoShowPenalty` devuelve `skipReason: \"otherSite\"` para cualquier otra sede. GBP 15 es `noShowPenaltyAmountMinor = 1_500`. La propuesta no la genera nada automático: es el callable `proposeNoShowPenalties({ sessionId })`, que un miembro del personal ejecuta sesión por sesión. Interrogada y decidida el 2026-09-09: West también genera propuesta y por los mismos GBP 15, así que el identificador de sede pasa de constante a política por sede, lo que enmienda la decisión 2 del BRIEF. La banda real es de 12 h a 1 h, no de 12 h a 0, porque esa misma decisión ya cierra la cancelación una hora antes. La propuesta nace al cancelar, no en el barrido, porque `proposeNoShowPenalties` está indexado por asistencia y una reserva cancelada no produce registro de asistencia. Vive en la misma colección `noShowPenalties` con un motivo propio, y se retira sola si la sesión se cancela después por quórum.",
  T009V2:
    'Decisión D1 del operador, 2026-09-09. Auditado el mismo día: hoy un menor no tiene cuenta de ninguna clase. `buildMinorStudent` (`apps/functions/src/families/family-service.ts:718-757`) nunca escribe `userId`, aunque el campo existe como opcional en `StudentProfile`, así que el enganche a una cuenta ya está previsto en el contrato. Los roles de cliente son solo `shopper`, `guardian` y `adultStudent`: haría falta uno nuevo. El único umbral de edad del dominio es 18, en línea dentro de `deriveParticipantType` (`packages/domain/src/profiles/profile-contracts.ts:300-319`); no hay 16 en ninguna parte. La DPIA es un borrador sin aprobar (`docs/operations/t011-dpia-draft.md`) y el calendario de retención (`t011-retention-residency-erasure-policy.md`, tabla en las líneas 99-112) advierte en su línea 7 de que ningún plazo está implementado: hoy el sistema no borra nada al vencer. Interrogada y decidida el 2026-09-09: D1 prevalece sobre la decisión 6 del BRIEF, que decía literalmente que los menores no tienen cuenta propia y que se enmienda allí con fecha. Suelo de edad en 12, la línea que la academia ya traza entre Kids y Teens; sube a 13 si la DPIA acaba apoyándose en consentimiento. Hallazgo que le quita una pata a D1: «correo o teléfono» hoy es solo correo. Los proveedores cableados son Google y correo/contraseña; de teléfono no hay nada. Y el proyecto no puede enviar un correo a un tercero, porque `ExternalDeliveryProvider` devuelve siempre `skipped` con `provider_unconfigured` y no lo invoca ningún callable; ninguna función crea usuarios de Auth. Por eso la cuenta la crea el representante y le entrega el acceso, y eso se declara en la DPIA. Revocar quita el claim, desengancha el `userId` y deshabilita la cuenta de Auth. Se construye ya, pero no se despliega hasta que la DPIA esté aprobada.',
  T010V2:
    "Hoy `apps/web/src/content/academy.ts:154-168` lista a Miro, Eddie, Topo y Charlie. Cada entrada exige `credential`, y no tenemos la de los tres instructores nuevos. No se inventan grados ni cinturones.",
  T011V2:
    "El contenido tiene un único objeto de localización, Town Office (`academy.ts:48-53`), consumido como objeto único en la landing. `BPT West / Strive` solo existe como etiqueta de tarifa (`academy.ts:144`), sin domicilio.",
  T012V2:
    'Diagnosticado en producción el 2026-09-09, y la causa no era ninguna de las cuatro que la fila listaba. Cloud Run registra «Callable request verification passed» y acto seguido HTTP 403 en `getEnrolmentRequestDetail`, `listMembers`, `getMemberDetail` y `lookupMemberIdentity`, mientras `listEnrolmentRequests` responde 200 en la misma sesión. Lo que las separa es la puerta: las que fallan exigen, además del claim, un documento de personal aprovisionado en `academies/{academyId}/users/{uid}`. En producción la cuenta de `owner` lo tiene y pasa; la de `administrator` tiene claims válidos y ningún documento, y por eso la cola se pinta y ninguna fila se abre. Los botones no están inertes: «Approve and enrol» está `disabled` a propósito hasta que cargue el detalle, y «Send back to applicant» funciona pero exige escribir la nota. El único escritor de ese documento, `provisionAdminRole`, no está desplegado como callable. Decidido por el operador el 2026-09-09 (D5): se aprueba desde la cuenta de `owner` y no se escribe nada en producción. Teclear el documento a mano lo haría válido para la puerta y no dejaría rastro de quién concedió ese poder, porque `provisionAdminRole` lo escribe en la misma transacción que toma el cerrojo de rol y emite `admin.role.granted`; y el esquema es un `z.strictObject` de catorce campos, con dos `Timestamp` reales, donde un campo de más o de menos deja el 403 intacto. La cuenta de `administrator` queda inservible para el directorio canónico a propósito, y esa limitación la levanta T022V2 (D6). CORREGIDO más tarde el mismo día: el diagnóstico estaba incompleto y la fila culpaba a quien no era. Probado en producción desde `owner`, el detalle sí abre, porque `enrolmentRequestDetail` pasa `requiresCanonicalReader: false` y se salta la comprobación de estado; pero aprobar falla igual, con `approval_write_failed`. La causa real es que el directorio canónico nunca se inicializó en producción, que es T025V2. Lo del documento de `administrator` sigue siendo cierto, pero aprovisionarlo no habría dado de alta a nadie.',
  T013V2:
    'El panel ya tiene un bloque "Today\'s classes" en `apps/web/src/app/admin/overview-page.tsx`; lo que falta es su posición y el detalle de las sesiones que quedan.',
  T015V2:
    'Open mat queda excluido por completo de esta regla. Hallazgo del 2026-09-09 que cambia lo que cuesta la fila: **esa afirmación era falsa, y quedó corregida el 2026-09-09**. Es cierto que `SessionRecord` (`packages/domain/src/schedule/schedule-contracts.ts:165`) no tiene tipo de sesión; el vocabulario `sessionTypes = ["class", "openMat"]` vive solo en el dominio de planes (`packages/domain/src/memberships/plan-contracts.ts:27`). Pero de ahí no se sigue que la exclusión no se pueda escribir: **ya se deriva y ya se usa**. La sesión lleva `programId`, `ProgramRecord` lleva `discipline`, `open-mat` está en el vocabulario de disciplinas, hay un programa semilla `open-mat`, y la ruta de reserva hace exactamente esa derivación en `booking-transaction-service.ts:680`. Excluir open mat no exige tipar la sesión ni migrar nada. Segundo hallazgo: **no existe ningún barrido programado**. Las dos únicas funciones `onSchedule` del proyecto limpian sesiones de importación de miembros, y hasta el barrido de quórum es el callable manual `reconcileSessionQuorum`. Tercero: la asistencia no es un campo de la reserva, es un registro aparte con su propio vocabulario (`attendanceStates`, `schedule-contracts.ts:1039`) frente a `bookingStatuses = ["requested", "confirmed", "cancelled"]` (`:752`), y `no_show` ya existe ahí. Decidido el 2026-09-09: la pérdida emite la misma propuesta que un no-show, en `noShowPenalties` y con su propio motivo, y nunca en open mat. El vencimiento lo decide una función programada, no una evaluación en lectura, porque al emitir propuesta la vía perezosa obligaría a escribir durante las lecturas y las cinco rutas transaccionales que leen sesiones para escribir no pasan por `ScheduleStore`. Open mat se excluye derivando del programa, sin añadir campo a la sesión, para no tener dos verdades que puedan divergir. El alcance de la función programada es solo el contador: el quórum es T024V2.',
  T017V2:
    "El aviso de condición médica es dato de salud: gobierna quién puede leerlo, no solo cómo se muestra.",
  T018V2:
    "Hallazgo del 2026-09-09: `evaluateBookingEligibility` (`packages/domain/src/schedule/schedule-contracts.ts:911-953`) ya rechaza a quien no está `active` ni `trial`, es decir ya cubre `overdue`. Pero una búsqueda en `apps/` no encuentra ni una sola invocación: la regla existe en el dominio y no se aplica en ningún callable, así que hoy no bloquea a nadie. Verificado por los dos lados el 2026-09-09: la segunda mitad está entera por construir. Lo único que transiciona una membresía a `overdue` es un administrador pulsando «Mark overdue» (`membership-callables.ts:563-565`); ni finance, ni payments, ni penalties llaman a `transitionMembership`. Y el `overdue` del panel financiero es otro concepto: un flag por factura calculado al vuelo (`financial-dashboard.ts:126`), no persistido.",
  T019V2:
    'Comprobado el 2026-09-09: no hay concepto de retirada ni de centro en `packages/domain/src/shop`. Es construcción nueva, no un ajuste. Ampliado el mismo día: el pedido tampoco tiene referencia de pago, porque no hay pago online -`shopPaymentMethodNote` dice que se cobra en la academia al retirar-, así que «etiquetar el pago» no es añadir un campo a algo que ya existe. Del lado de finanzas, `invoiceReference` no se genera: lo teclea la oficina en el formulario de facturación y solo se valida y se usa como clave de idempotencia. Y «centro» está dicho de ocho maneras distintas en el repositorio, con dos mayúsculas incompatibles: `locationIds = ["town", "west"]` en horarios frente a `siteValues`, `trainingCenters` y `upcomingBirthdayTrainingCenters` en `["Town", "West"]`, más literales en línea en familias y en el informe operativo, más el `trainingCenter` de texto libre de la importación de Regyfit. Ya hay una traducción a mano entre las dos (`booking-transaction-service.ts:679`). Etiquetar pagos por centro sin unificar antes ese vocabulario reparte el problema en vez de resolverlo. Interrogada el 2026-09-09, y la fila resulta ser dos problemas distintos: las suscripciones sí tienen `invoices` y `payments` persistidos, con `chargeKind`; el merchandising no, porque el pedido lleva `paymentStatus` dentro de sí y no genera ni factura ni pago. Decidido: la etiqueta de una suscripción sale del `trainingCenter` del miembro, también en los planes que cruzan sedes; el centro es campo propio de la factura y no un prefijo dentro de `invoiceReference`, que es la clave de idempotencia de la emisión; el merchandising lleva el centro de retirada en el propio pedido, sin inventar factura, que es fiel a que se cobra en la academia al retirar; y la unificación del vocabulario sale de la fila y pasa a ser T023V2.',
  T020V2:
    'Comprobado el 2026-09-09: la columna "Training center" ya existe en `apps/web/src/app/admin/members/page.tsx:37-41`, y `trainingCenter` es campo persistido con valores Town/West en `apps/functions/src/profiles/profile-service.ts`.',
  T021V2:
    "No se resuelve escribiendo código ni preguntando mejor: son datos que solo tiene el operador.",
  T023V2:
    'Sale de la ronda del 2026-09-09 y bloquea a T019V2. «Centro» está dicho de ocho maneras con dos mayúsculas incompatibles, y tres de las capitalizadas están escritas en Firestore: `trainingCenter` en estudiantes, en el directorio de miembros y en familias, más `classSites`/`openMatSites` en los planes, más el `trainingCenter` de texto libre de la importación de Regyfit, cuyos valores son arbitrarios y no se arreglan con un `toLowerCase()`. Decidido: no se migra. La fila construye una única conversión canónica en el dominio que sustituya las cinco ternarias escritas a mano y las dos comparaciones literales, y que falle a la vista ante un valor inesperado. Ese es el bug real: `booking-transaction-service.ts:679` hace `locationId === \'town\' ? \'Town\' : \'West\'`, de modo que un tercer valor caería en silencio en West. La migración completa queda expresamente fuera de alcance.',
  T025V2:
    'Causa raíz real del alta rota, encontrada el 2026-09-09 leyendo producción: la colección `academies/demo-academy/memberDirectoryStates` está vacía y el documento `current` que toda lectura y toda escritura del directorio exigen no existe. La lectura lo pide en `assertCanonicalReader` y lanza `unavailable`, que Firebase mapea a HTTP 400: es el 400 de `listMembers` que aparece en la consola desde una sesión de `owner`. La escritura lo exige además junto al documento de guarda `memberDirectoryRestoreGuards/{academyId}`, y por eso `approveEnrolmentRequest` muere con `approval_write_failed`. No es un problema de la cuenta sino de la academia: afecta igual a `owner` y a `administrator`, así que aprovisionar al administrador nunca habría bastado. Y hoy no hay ninguna vía para arreglarlo: el inicializador es de emulador por diseño en cuatro capas -constante `demo-bpt-jersey`, `z.literal` del mismo valor, `target: \'emulator\'` y el rechazo `store.projectId !== projectId`-, su ejecutor clava el mismo proyecto y `index.ts` no lo exporta a propósito; además exige dieciocho colecciones vacías, incluida `auditEvents`, que producción ya tiene. Dato que tranquiliza: un intento fallido deja la solicitud en `approval-failed`, que sigue siendo aprobable, así que no hay nada atascado.',
  T024V2:
    'Sale de la ronda del 2026-09-09, y no es una mejora: es el incumplimiento de una decisión aprobada. La decisión 3 del BRIEF promete que una tarea idempotente cancela la sesión que no reúne cuatro reservas una hora antes. Esa tarea no ocurre en producción: `reconcileSessionQuorum` es un callable de staff al que ningún cliente web llama, y el único runner en lote se declara en su cabecera como deliberadamente no programado, restringido al emulador demo por `assertQuorumSweepRunnerEnvironment` (`quorum-sweep-runner.ts:8-15`, `:74`). La regla pura `decideQuorumSweep` y el servicio transaccional idempotente ya existen y están probados: lo que falta es que algo los dispare.',
  T022V2:
    'Decisión D6 del operador, 2026-09-09, salida de la pregunta 6 del ledger. `provisionAdminRole` (`apps/functions/src/auth/admin-provisioning.ts:677`) es el único escritor del documento de personal que exige la puerta canónica, y `apps/functions/src/index.ts:11` la reexporta como función suelta: no está desplegada. Convertirla no es envolverla en `onCall`. El objetivo llega como segundo parámetro de la función, no en `request.data`, y `provisioningRequestSchema` es un `z.strictObject({ action })` (`:78`) que rechaza cualquier campo extra, así que hoy `uid`, `email` y `role` no caben en la petición: desplegarla es ensanchar el contrato de entrada de la superficie de autorización. Lo que ya trae hecho es la puerta del concedente, `requireAdminActor` más `requireOwner` (`:589-590`), de modo que solo `owner` concede y un `administrator` no puede ascender a nadie ni a sí mismo. Lo que le falta frente a la puerta hermana: `requireCanonicalMemberDirectoryActor` verifica App Check en el manejador (`canonical-actor.ts:83-85`) y esta no lo hace.',
};

/**
 * Que hace falta, en concreto, para cerrar cada fila abierta. El tablero "Qué falta para resolver"
 * se construye con esto. Una fila sin requisitos aqui aparece sin pasos, lo cual es una senal de
 * que falta pensarla, no de que este lista.
 */
const RESOLUTION_REQUIREMENTS = {
  T001V2: [
    requirement("Localizar en el código la causa exacta del re-relleno.", true),
    requirement(
      "Quitar la longitud de los campos del array de dependencias y sembrar el valor de la sesión una sola vez, con una guarda de «ya sembrado», en vez de ensanchar la condición actual.",
    ),
    requirement(
      "Prueba que borre cada campo entero y afirme que sigue vacío después del re-render, para los dos campos.",
    ),
  ],
  T002V2: [
    requirement(
      "Dividir el formulario en pasos de 3 campos como máximo, con barra de progreso y estado accesible anunciado en cada paso.",
    ),
    requirement("Validar por paso, no solo al enviar, y conservar lo ya escrito al retroceder."),
    requirement("Verificar el recorrido completo en un viewport móvil real."),
  ],
  T003V2: [
    requirement("Subir a 16 px el tamaño de fuente de los campos del formulario."),
    requirement("Evidencia en dispositivo o emulación móvil, no solo en escritorio."),
  ],
  T004V2: [
    requirement('Localizar por qué "Book a free class" no lleva a ninguna parte.', true),
    requirement(
      "Apuntar los tres botones al mismo destino: el formulario por pasos que reserva una clase gratis.",
    ),
    requirement("Actualizar también `apps/web/src/lib/client-auth.tsx:195`."),
    requirement(
      "Corregir las pruebas de `apps/web/src/test-harness.test.tsx` que hoy afirman el ancla como comportamiento correcto.",
    ),
  ],
  T005V2: [
    requirement("Comparar el texto mostrado con el PDF oficial de la academia.", true),
    requirement(
      "Prueba que extraiga el texto del PDF de `Varios/` y lo compare con `enrolmentWaiverTerms`, para que una divergencia futura falle en CI en vez de descubrirse en producción.",
    ),
  ],
  T006V2: [
    requirement(
      "Decidir la identidad con la que se reserva la primera clase: crea cuenta, reserva, y luego aprobación.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la identidad sale de un alumno provisional con membresía `trial` creado en el registro, y la clase de prueba viaja por la ruta de reserva única. `evaluateBookingEligibility` ya acepta `trial`, así que aforo, quórum, cortes, asistencia y el contador de T015V2 se aplican sin escribir nada. Se descartó la ruta propia para no crear un segundo camino que toda regla futura tendría que recordar.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: el alumno provisional no aparece en la base de miembros hasta ser aprobado. El directorio canónico y `listMembers` lo excluyen por estado.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: si la solicitud se rechaza, la membresía pasa a `cancelled`, alcanzable desde `trial`, para que la reserva y la asistencia pasadas no queden huérfanas. Devolver al solicitante no cancela nada.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: el límite de una sola clase es un cupo de la propia membresía, no una lectura del estado de la solicitud.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la reserva de prueba cuenta para el mínimo de cuatro, y el aviso al administrador es uno solo, en el momento de reservar.",
      true,
    ),
    requirement(
      "Crear el alumno provisional y su membresía `trial` en el registro, con su cupo de una reserva.",
    ),
    requirement(
      "Invertir el orden actual, en el que la aprobación precede a cualquier reserva.",
    ),
    requirement(
      "Aplicar la restricción en reglas y callables, no solo en la interfaz: una restricción solo de cliente no restringe nada.",
    ),
    requirement(
      "Excluir al provisional del directorio canónico y de `listMembers` hasta que se le apruebe.",
    ),
    requirement(
      "Transicionar la membresía a `cancelled` al rechazar la solicitud.",
    ),
    requirement(
      "Disparar el aviso al administrador en el momento de la reserva.",
    ),
  ],
  T007V2: [
    requirement(
      "Localizar el corte de cancelación vigente y con qué más comparte código.",
      true,
    ),
    requirement(
      "Decidir qué ocurre al cancelar tarde: se emite la propuesta de penalización de T111, que un administrador aprueba o descarta. Nunca cobro automático.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: West también genera propuesta, y por los mismos GBP 15. `noShowPenaltyLocationId` deja de ser constante y pasa a política por sede. Enmienda la decisión 2 del BRIEF.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la banda real de la cancelación tardía es de 12 h a 1 h, no de 12 h a 0, porque la cancelación ya cierra una hora antes. Dentro de la última hora no se puede cancelar, y quien no aparece cae por la vía del no-show.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la propuesta nace en el instante de cancelar, no en el barrido manual, y vive en la misma colección `noShowPenalties` con un motivo que la distingue.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: si la sesión se cancela después por quórum, la propuesta se retira automáticamente. Proponer un cobro por una clase que no ocurrió es indefendible.",
      true,
    ),
    requirement(
      "Añadir las 12 h como corte propio de cancelación sin coste, sin mover el corte de reservas ni el de quórum.",
    ),
    requirement(
      "Emitir la propuesta de penalización al cancelar dentro de la banda, con su motivo.",
    ),
    requirement(
      "Convertir el identificador de sede de la penalización en política por sede, y enmendar la decisión 2 del BRIEF.",
    ),
    requirement(
      "Retirar la propuesta cuando la sesión se cancele por quórum.",
    ),
  ],
  T008V2: [
    requirement(
      "Marcaje de la asistencia de cada hijo desde el área de familia (`apps/web/src/app/account/family/page.tsx`).",
    ),
    requirement("Comprobar la relación tutor-menor en el servidor, no en el cliente."),
    requirement(
      "Evitar la doble asistencia cuando el staff ya marcó a ese mismo menor en T014V2.",
    ),
  ],
  T009V2: [
    requirement(
      "Decidir el modelo de cuenta del menor: cuenta propia con alcance recortado.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: D1 prevalece sobre la decisión 6 del BRIEF, que decía que los menores no tienen cuenta propia y que se enmienda allí con fecha y motivo, sin borrarla.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: suelo de edad en 12, la misma línea que la academia ya traza entre Kids y Teens. Sube a 13 si la DPIA acaba apoyándose en consentimiento en vez de en contrato.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la cuenta la crea el representante con correo y contraseña y le entrega el acceso. No hay teléfono ni forma de enviar un correo a un tercero, y ninguna función crea usuarios de Auth.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: revocar quita el claim, desengancha el `userId` y deshabilita la cuenta de Auth, porque un token ya emitido sigue valiendo hasta caducar.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: se construye ya, pero no se despliega hasta que la DPIA esté aprobada y la retención deje de ser una promesa.",
      true,
    ),
    requirement(
      "Crear el rol de cliente que hoy no existe: los únicos son `shopper`, `guardian` y `adultStudent`, y enganchar la cuenta al `userId` que `StudentProfile` ya prevé y que `buildMinorStudent` nunca escribe.",
    ),
    requirement(
      "Permitir al representante crear la cuenta del menor con correo y contraseña, y entregarle el acceso.",
    ),
    requirement(
      "Alcance recortado: progreso, próximas clases, reservar y marcar asistencia. Nunca pagos, waiver, ficha del representante ni datos de otros miembros.",
    ),
    requirement(
      "Revocación que quita el claim, desengancha el `userId` y deshabilita la cuenta de Auth.",
    ),
    requirement(
      "Actualizar la DPIA y el registro de retención de T011, declarando que el representante conoce la contraseña del menor.",
    ),
    requirement(
      "Reglas de Firestore que nieguen por defecto todo lo que quede fuera del alcance recortado.",
    ),
    requirement(
      "No desplegar hasta que la DPIA esté aprobada.",
    ),
  ],
  T010V2: [
    requirement("Localizar dónde vive hoy la lista de instructores.", true),
    requirement(
      "Conservar a Miro y a Charlie y añadir a Amoné Mouton, Catalina Bruma y Connor Hoopes con su credencial. Bloqueado por T021V2.",
    ),
    requirement(
      "Confirmar con el operador si Eddie y Topo se retiran del todo o solo de este bloque.",
    ),
  ],
  T011V2: [
    requirement("Comprobar cuántas direcciones publica hoy el contenido.", true),
    requirement("Convertir `location` de objeto único a lista de dos centros."),
    requirement("Actualizar el bloque `<address>` de la landing, que consume ese objeto único."),
    requirement("Añadir el domicilio completo de BPT West / Strive. Bloqueado por T021V2."),
  ],
  T012V2: [
    requirement(
      "Comprobar si los callables de detalle, aprobación y devolución existen y están cableados.",
      true,
    ),
    requirement(
      'Diagnosticar en producción qué error devuelve realmente la callable detrás de "Unable to open this request.": HTTP 403, permission-denied, en la puerta del actor canónico.',
      true,
    ),
    requirement(
      "Descartar en orden: parámetro de entorno cerrado, App Check, claims del administrador y reglas de Firestore. Ninguna de las cuatro es la causa.",
      true,
    ),
    requirement(
      "Dejar de colapsar el 403 en una sola frase ciega: el cliente ya nombra la causa que un revisor puede accionar.",
      true,
    ),
    requirement(
      "Decidir si se aprovisiona el documento de personal de `administrator` o se aprueba desde `owner`. DECIDIDO POR EL OPERADOR EL 2026-09-09 (D5): se aprueba desde `owner`, que ya pasa la puerta, y no se escribe nada en producción. La cuenta de `administrator` queda inservible para el directorio canónico a propósito; esa limitación la levanta T022V2.",
      true,
    ),
    requirement(
      "Aprobar a un solicitante real de punta a punta desde la cuenta de `owner`. Es una acción en la sesión de producción del operador, no algo que el repositorio pueda hacer por él. No se cierra con un mensaje de error mejor.",
    ),
  ],
  T013V2: [
    requirement("Localizar el bloque de clases del día en el panel.", true),
    requirement("Elevarlo a primer bloque del panel de administración."),
    requirement("Exponer las sesiones que quedan por delante en el día, con su hora de inicio."),
  ],
  T014V2: [
    requirement("A falta de 15 minutos para el inicio, ascender el botón de asistencia."),
    requirement(
      "Marcar seleccionando de la lista de reservados quién está y quién no, en una sola pantalla, sin buscar miembro por miembro.",
    ),
  ],
  T015V2: [
    requirement(
      "Comprobar si la exclusión de open mat se puede expresar hoy. CORREGIDO EL 2026-09-09: la fila afirmaba que no, y sí se puede. La sesión lleva `programId`, `ProgramRecord` lleva `discipline`, y la ruta de reserva ya deriva open mat en `booking-transaction-service.ts:680`.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: el vencimiento lo decide una función programada, no una evaluación en lectura. Al emitir propuesta de fee, la vía perezosa obligaría a escribir durante las lecturas, y las cinco rutas transaccionales que leen sesiones para escribir no pasan por `ScheduleStore`.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la pérdida emite la misma propuesta que un no-show, en `noShowPenalties` y con su propio motivo. Sigue siendo propuesta revisable, nunca cobro.",
      true,
    ),
    requirement(
      "Añadir la función `onSchedule` que vence el contador. Es la primera del proyecto que toca el horario; su alcance es solo el contador, y programar el quórum es T024V2.",
    ),
    requirement(
      "Contador de 20 minutos desde el inicio de la clase: sin marcaje al vencer, se pierde la clase.",
    ),
    requirement(
      "El vencimiento lo decide el servidor por hora de sesión, no un temporizador de navegador que se pierde al cerrar la pestaña.",
    ),
    requirement(
      "Excluir open mat por completo, derivándolo del programa y sin añadir campo a la sesión: un tipo copiado se queda obsoleto si cambia la disciplina del programa.",
    ),
  ],
  T016V2: [
    requirement(
      "Vista semanal completa en el panel, no solo el día en curso, al estilo del calendario de Regyfit.",
    ),
  ],
  T017V2: [
    requirement("Listar quién ya confirmó para la siguiente sesión."),
    requirement(
      "Avisar con el nombre de la condición médica y el miembro, para quien participe ese día.",
    ),
    requirement(
      "Restringir el aviso a personal autorizado, auditar cada lectura y mantenerlo fuera de vistas agregadas y exportaciones.",
    ),
  ],
  T018V2: [
    requirement(
      "Comprobar si la regla de elegibilidad ya existe y si algún callable la invoca.",
      true,
    ),
    requirement("Cablear `evaluateBookingEligibility` en la ruta real de reserva."),
    requirement(
      "Garantizar que un cobro fallido transiciona de verdad la membresía a `overdue`. Sin esto, cablear la regla no bloquea a nadie.",
    ),
  ],
  T019V2: [
    requirement(
      "Comprobar si el dominio de tienda ya modela centro o retirada.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la etiqueta de una suscripción sale del `trainingCenter` del miembro, también en los planes que cruzan sedes, donde el centro es convención y no hecho.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: el centro es campo propio de la factura, no un prefijo dentro de `invoiceReference`, que es la clave de idempotencia de la emisión y la teclea la oficina.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: el merchandising lleva el centro de retirada en el propio pedido, sin inventar una factura. Hoy un pedido solo tiene `paymentStatus` dentro de sí y no genera ni factura ni pago.",
      true,
    ),
    requirement(
      "DECIDIDO EL 2026-09-09: la unificación del vocabulario sale de esta fila y pasa a ser T023V2, de la que esta depende.",
      true,
    ),
    requirement(
      "Añadir el centro como campo de la factura, con el identificador canónico de T023V2.",
    ),
    requirement(
      "Permitir elegir centro de retirada al comprar merchandising, y guardar esa elección en el pedido.",
    ),
  ],
  T020V2: [
    requirement("Comprobar si la base de miembros ya muestra el centro de entrenamiento.", true),
    requirement(
      "Comprobar con datos reales que la columna se puebla para todos los miembros y no queda vacía en los importados.",
    ),
  ],
  T022V2: [
    requirement(
      "Desplegar `provisionAdminRole` como callable: hoy `apps/functions/src/index.ts:11` la reexporta como función suelta y no como `onCall`, así que no existe en producción.",
    ),
    requirement(
      "Ensanchar el contrato de entrada para que el objetivo viaje en `request.data`: hoy llega como segundo parámetro y `provisioningRequestSchema` es un `z.strictObject({ action })` que rechaza `uid`, `email` y `role`.",
    ),
    requirement(
      "Verificar App Check en el manejador, como hace `requireCanonicalMemberDirectoryActor`: la puerta que concede el poder no puede ser más débil que la que protege ese poder.",
    ),
    requirement(
      "Pruebas de que solo `owner` concede y de que un `administrator` no puede ascender a nadie ni a sí mismo.",
    ),
    requirement(
      "Evidencia de que `admin.role.granted` queda escrito en la misma transacción que el documento de personal: es lo que un documento tecleado por consola no deja.",
    ),
    requirement(
      "Aprovisionar por esa vía la cuenta de `administrator` y comprobar que después abre una fila de la cola. Es la limitación que D5 dejó declarada en T012V2.",
    ),
  ],
  T025V2: [
    requirement(
      "Diagnosticar por qué falla el alta desde una cuenta que sí pasa la puerta canónica. HECHO EL 2026-09-09: falta el documento de estado del directorio, y con él fallan la lectura con 400 y la escritura con approval_write_failed.",
      true,
    ),
    requirement(
      "Comprobar en producción que la colección `memberDirectoryStates` está vacía y que el documento `current` no existe. HECHO EL 2026-09-09 por lectura directa.",
      true,
    ),
    requirement(
      "Comprobar si existe alguna vía para inicializar el directorio en producción. HECHO EL 2026-09-09: no existe. El inicializador es de emulador por diseño en cuatro capas y su ejecutor clava el proyecto demo.",
      true,
    ),
    requirement(
      "DECISIÓN PENDIENTE DEL OPERADOR: abrir una vía de inicialización válida para producción, y con qué precondición de vacuidad, o escribir los tres documentos a mano una sola vez. Es escritura en producción sobre el modelo de integridad del directorio.",
    ),
    requirement(
      "Crear el documento de estado `memberDirectoryStates/current` y el de guarda `memberDirectoryRestoreGuards/{academyId}` con su evento cero, en una sola transacción.",
    ),
    requirement(
      "Revisar la precondición de vacuidad: la actual exige dieciocho colecciones vacías, incluida `auditEvents`, que producción ya tiene, así que hoy bloquearía la inicialización aunque se le cambiara el proyecto.",
    ),
    requirement(
      "Aprobar a un solicitante real de punta a punta después de inicializar, que es lo que cierra también T012V2.",
    ),
  ],
  T023V2: [
    requirement(
      "Construir una única conversión canónica de centro en el dominio, que falle a la vista ante un valor inesperado en vez de elegir uno.",
    ),
    requirement(
      "Sustituir con ella las cinco ternarias escritas a mano y las dos comparaciones literales. La de `booking-transaction-service.ts:679` manda hoy en silencio a West cualquier valor que no sea `town`.",
    ),
    requirement(
      "Dejar expresamente fuera de alcance la migración de datos: tres representaciones capitalizadas están escritas en Firestore y el `trainingCenter` de Regyfit es texto libre con valores arbitrarios.",
    ),
  ],
  T024V2: [
    requirement(
      "Programar el barrido de quórum reutilizando la maquinaria `onSchedule` que introduce T015V2.",
    ),
    requirement(
      "No tocar la regla pura `decideQuorumSweep` ni el servicio transaccional idempotente: ya existen y están probados. Lo que falta es el disparador.",
    ),
    requirement(
      "Comprobar que la decisión 3 del BRIEF pasa a cumplirse de verdad, y retirar de allí la advertencia de que describe algo que no ocurre.",
    ),
  ],
  T021V2: [
    requirement("Domicilio completo del segundo centro, BPT West / Strive, con código postal."),
    requirement(
      "Credencial o grado de Amoné Mouton, Catalina Bruma y Connor Hoopes, uno por instructor.",
    ),
    requirement(
      "Confirmación de si Eddie y Topo se retiran de la landing o solo de la sección de instructores.",
    ),
  ],
};

/**
 * Tres filas nacen con implementación previa que la auditoría encontró en el código. Marcarlas como
 * "no iniciada" sería falso, así que se declara lo que realmente hay.
 */
const IMPLEMENTATION_OVERRIDES = {
  T005V2: {
    implementationStatus: "implementada",
    implementationEvidence:
      "El texto oficial ya está en enrolment-waiver-terms.ts con las diez cláusulas del PDF. Falta la prueba que impida que diverja en el futuro.",
  },
  T020V2: {
    implementationStatus: "implementada",
    implementationEvidence:
      "La columna Training center existe en el directorio y trainingCenter es campo persistido. Falta comprobar que se puebla con datos reales.",
  },
  T018V2: {
    implementationStatus: "parcial",
    implementationEvidence:
      "La regla existe escrita en el dominio y ningún callable la invoca, así que hoy no bloquea a nadie.",
  },
  T012V2: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Probado en producción desde owner el 2026-09-09: el detalle abre y aprobar sigue fallando con approval_write_failed. La causa real no es el documento de personal de administrator sino el directorio canónico que nunca se inicializó, que es T025V2. Esta fila no se puede cerrar antes que aquella.",
  },
};

function getImplementationDetails(item) {
  if (item.implementationStatus && item.implementationEvidence) {
    return {
      implementationStatus: item.implementationStatus,
      implementationEvidence: item.implementationEvidence,
    };
  }

  const override = IMPLEMENTATION_OVERRIDES[item.id];
  if (override) return { ...override };

  if (item.status === "aprobada") {
    return {
      implementationStatus: "verificada",
      implementationEvidence: "Tarea aprobada en tasksv2.md con evidencia registrada.",
    };
  }

  if (item.status === "revision") {
    return {
      implementationStatus: "verificada",
      implementationEvidence: "Implementación y pruebas documentadas; falta aprobación formal.",
    };
  }

  return {
    implementationStatus: "no-iniciada",
    implementationEvidence: "No hay evidencia de ejecución registrada.",
  };
}

function withImplementationDetails(item) {
  return { ...item, ...getImplementationDetails(item) };
}

function task(id, title, status, description, dependsOn = "-", evidence, references, kind = "funcion") {
  return {
    id,
    title,
    status,
    description,
    dependsOn,
    evidence,
    references,
    kind,
    resolutionRequirements: RESOLUTION_REQUIREMENTS[id] || [],
  };
}

function stage(id, track, title, description, status, items) {
  return { id, track, title, description, status, items };
}

const REF_TASKS = "tasksv2.md";

const bugFormItems = [
  task(
    "T001V2",
    "Permitir vaciar por completo Nombre y Email",
    "pendiente",
    "Los dos campos se vuelven a rellenar solos al intentar borrarlos.",
    "-",
    "Causa localizada: el efecto de prellenado lleva la longitud de los propios campos en sus dependencias, así que al llegar a cero se vuelve a disparar y reescribe el valor de la sesión.",
    [REF_TASKS, "apps/web/src/app/enrol/page.tsx:378-385"],
    "bug",
  ),
  task(
    "T002V2",
    "Convertir el formulario en un asistente por pasos con barra de progreso",
    "pendiente",
    "De 1 a 3 campos por paso, sencillo de usar en móvil.",
    "T001V2",
    "Hoy el formulario presenta todos los campos de una vez. La validación pasa a ser por paso y el estado ya escrito sobrevive al retroceder.",
    [REF_TASKS, "apps/web/src/app/enrol/page.tsx"],
    "funcion",
  ),
  task(
    "T003V2",
    "Impedir el zoom automático de iOS al enfocar un campo",
    "pendiente",
    "El navegador amplía la página al tocar una casilla.",
    "T002V2",
    "Se corrige con tipografía de 16 px, no desactivando el zoom por gesto, que rompería la accesibilidad.",
    [REF_TASKS],
    "bug",
  ),
];

const bookingItems = [
  task(
    "T004V2",
    'Unificar "Ask for a place" y "Book a free class" en el mismo formulario',
    "pendiente",
    "Hoy uno lleva al formulario y el otro no hace nada.",
    "T002V2",
    'Bug confirmado: "Book a free class" apunta a href="#contact", un ancla a su propia sección. Hay pruebas que afirman ese ancla como correcto y también hay que corregirlas.',
    [REF_TASKS, "apps/web/src/app/page.tsx:54", "apps/web/src/app/page.tsx:230"],
    "bug",
  ),
  task(
    "T005V2",
    "Verificar que el waiver mostrado es el documento oficial",
    "pendiente",
    "El texto debe ser el del PDF oficial de la academia.",
    "-",
    "Auditado: el texto ya coincide, con las diez cláusulas y los bullets de higiene. La fila no construye texto, ata una prueba para que una divergencia futura falle en CI.",
    [REF_TASKS, "packages/domain/src/consents/enrolment-waiver-terms.ts"],
    "verificacion",
  ),
  task(
    "T006V2",
    "Reservar la primera clase antes de la aprobación y notificar al administrador",
    "pendiente",
    "Reservar primero, aprobar después: hoy es al revés.",
    "T004V2",
    "Decisión D3. Crea cuenta, reserva, y la reserva dispara el aviso al admin. Mientras está pendiente no puede reservar una segunda clase, y esa restricción se aplica en el servidor.",
    [REF_TASKS],
    "funcion",
  ),
  task(
    "T007V2",
    "Cancelación gratuita hasta 12 h antes; después, propuesta de fee",
    "pendiente",
    "Cancelar tarde cuesta el fee de inasistencia.",
    "-",
    "Decisión D2. Colisión a resolver con cuidado: hoy un único corte de una hora gobierna reservas, cancelaciones y cancelación por quórum. Las 12 h son un corte nuevo y aparte.",
    [REF_TASKS, "packages/domain/src/schedule/schedule-contracts.ts:813"],
    "funcion",
  ),
];

const membersItems = [
  task(
    "T008V2",
    "Permitir al representante marcar la asistencia de sus hijos",
    "pendiente",
    "Marcar la llegada del hijo al llevarlo a la práctica.",
    "-",
    "La autorización se comprueba en el servidor contra la relación tutor-menor. Convive con el marcaje del staff sin duplicar asistencia.",
    [REF_TASKS, "apps/web/src/app/account/family/page.tsx"],
    "funcion",
  ),
  task(
    "T009V2",
    "Dar cuenta propia al menor, con alcance recortado",
    "pendiente",
    "El menor inicia sesión y ve su progreso; el representante sigue siendo el responsable.",
    "T008V2",
    "Decisión D1. Tratamiento de datos de menores nuevo: no cierra sin actualizar la DPIA y el registro de retención de T011 ni sin reglas que nieguen por defecto lo que quede fuera del alcance.",
    [REF_TASKS],
    "funcion",
  ),
];

const landingItems = [
  task(
    "T010V2",
    "Actualizar la sección de instructores",
    "pendiente",
    "Conservar a Miro y Charlie; entran Amoné, Catalina y Connor.",
    "T021V2",
    "Bloqueada de hecho por T021V2: el contenido exige una credencial por instructor y no tenemos la de los tres nuevos. No se inventan grados.",
    [REF_TASKS, "apps/web/src/content/academy.ts:154-168"],
    "funcion",
  ),
  task(
    "T011V2",
    "Publicar las dos direcciones de los centros de entrenamiento",
    "pendiente",
    "Hoy solo se publica una dirección.",
    "T021V2",
    "El contenido tiene un único objeto de localización con Town Office. West solo existe como etiqueta de tarifa, sin domicilio. Requiere convertirlo en lista de dos centros.",
    [REF_TASKS, "apps/web/src/content/academy.ts:48-53"],
    "funcion",
  ),
];

const adminItems = [
  task(
    "T012V2",
    "Reparar la cola de aprobación de nuevos miembros",
    "en-progreso",
    "Ningún botón acepta al nuevo miembro: hoy no se puede dar de alta a nadie.",
    "T025V2",
    "Diagnosticada el 2026-09-09: la cuenta de administrator tiene claims válidos y ningún documento de personal aprovisionado, así que la cola carga y toda callable detrás de la puerta canónica responde 403. Falta la escritura en producción, que espera al operador.",
    [REF_TASKS, "apps/web/src/app/admin/members/requests/page.tsx", "apps/web/src/lib/enrolment-client.ts"],
    "bug",
  ),
  task(
    "T013V2",
    "Poner las sesiones del día como primer bloque del panel",
    "pendiente",
    "Ver de un vistazo qué sesiones quedan hoy.",
    "T012V2",
    'El panel ya tiene "Today\'s classes"; la fila lo eleva a primer bloque y expone lo que queda por delante con su hora de inicio.',
    [REF_TASKS, "apps/web/src/app/admin/overview-page.tsx"],
    "funcion",
  ),
  task(
    "T014V2",
    "Priorizar el botón de asistencia 15 minutos antes de cada sesión",
    "pendiente",
    "Marcar quién llega, seleccionando de la lista de reservados.",
    "T013V2",
    "Una sola pantalla con los reservados para ver quién está y quién no, sin buscar miembro por miembro.",
    [REF_TASKS],
    "funcion",
  ),
  task(
    "T015V2",
    "Contador de 20 minutos: quien no marca, pierde la clase",
    "pendiente",
    "Open mat queda excluido por completo.",
    "T014V2",
    "El vencimiento lo decide el servidor por hora de sesión, no un temporizador de navegador que se pierde al cerrar la pestaña. Falta decidir si emite propuesta de fee.",
    [REF_TASKS],
    "funcion",
  ),
  task(
    "T016V2",
    "Mostrar el calendario semanal al estilo Regyfit",
    "pendiente",
    "Vista semanal completa, no solo el día en curso.",
    "T013V2",
    "Pendiente de construir.",
    [REF_TASKS],
    "funcion",
  ),
  task(
    "T017V2",
    "Ver la siguiente clase con confirmados y aviso de condición médica",
    "pendiente",
    "Con el nombre de la condición y del miembro.",
    "T013V2",
    "Dato de salud: solo personal autorizado, cada lectura auditada, y el aviso no se filtra a vistas agregadas ni a exportaciones.",
    [REF_TASKS],
    "funcion",
  ),
  task(
    "T022V2",
    "Desplegar `provisionAdminRole` como callable, con su revisión de autorización",
    "pendiente",
    "Hoy no existe ninguna vía en producción para aprovisionar a un administrador.",
    "-",
    "Aplica D6. Es el único escritor del documento que exige la puerta canónica, y hoy se reexporta como función suelta, no como `onCall`. No es envolverla: el objetivo llega como segundo parámetro y `provisioningRequestSchema` rechaza cualquier campo extra, así que desplegarla ensancha el contrato de entrada de la superficie de autorización. Ya trae `requireOwner`; le falta verificar App Check en el manejador, como sí hace la puerta hermana.",
    [
      REF_TASKS,
      "apps/functions/src/auth/admin-provisioning.ts:677",
      "apps/functions/src/index.ts:11",
    ],
    "funcion",
  ),
  task(
    "T024V2",
    "Programar el barrido de quórum, que hoy no se ejecuta nunca",
    "pendiente",
    "La decisión 3 del BRIEF promete una cancelación automática que no ocurre.",
    "T015V2",
    "La regla pura y el servicio transaccional idempotente ya existen y están probados; lo que falta es que algo los dispare. `reconcileSessionQuorum` es un callable de staff al que ningún cliente web llama, y el único runner en lote está restringido al emulador demo y declarado deliberadamente no programado. Reutiliza la maquinaria programada que introduce T015V2.",
    [REF_TASKS, "apps/functions/src/schedule/quorum-sweep-runner.ts:8-15"],
    "funcion",
  ),
  task(
    "T025V2",
    "Inicializar el directorio canónico de miembros en producción",
    "pendiente",
    "Nunca se inicializó, y sin su documento de estado no se puede dar de alta a nadie.",
    "-",
    "Causa raíz real del alta rota, verificada en producción el 2026-09-09: la colección memberDirectoryStates está vacía. La lectura del directorio devuelve 400 y la aprobación muere con approval_write_failed, para owner igual que para administrator, porque el documento que falta es de la academia y no de la cuenta. No hay vía para arreglarlo hoy: el inicializador es de emulador por diseño en cuatro capas y su ejecutor clava el proyecto demo.",
    [
      REF_TASKS,
      "apps/functions/src/members/canonical-member-directory-read-service.ts:302-343",
      "apps/functions/src/members/member-directory-empty-initializer.ts:18",
    ],
    "bug",
  ),
];

const paymentItems = [
  task(
    "T018V2",
    "Bloquear la reserva a quien no se le cobró la mensualidad",
    "pendiente",
    "Sin pago del mes, no se reserva.",
    "-",
    "Hallazgo de la auditoría: la regla ya está escrita en el dominio y ningún callable la invoca, así que hoy no bloquea a nadie. Además hay que garantizar que un cobro fallido transiciona la membresía a overdue.",
    [REF_TASKS, "packages/domain/src/schedule/schedule-contracts.ts:911-953"],
    "funcion",
  ),
  task(
    "T019V2",
    "Etiquetar cada pago con su centro y elegir dónde retirar el merchandising",
    "pendiente",
    "La referencia del pago dice si es de Town o de West.",
    "T023V2",
    "Son dos problemas distintos: las suscripciones sí tienen facturas y pagos persistidos, y el merchandising no, porque el pedido lleva su estado de pago dentro y no genera ninguno. Decidido el 2026-09-09: la etiqueta de una suscripción sale del `trainingCenter` del miembro; el centro es campo propio de la factura y no un prefijo dentro de `invoiceReference`, que es la clave de idempotencia de la emisión; y el merchandising lleva el centro de retirada en el propio pedido, sin inventar factura.",
    [REF_TASKS, "packages/domain/src/shop"],
    "funcion",
  ),
  task(
    "T020V2",
    "Confirmar que la base de miembros muestra el centro de entrenamiento",
    "pendiente",
    "Ver dónde entrena normalmente cada miembro.",
    "-",
    "Auditado: ya existe la columna y el campo persistido. Solo falta comprobar con datos reales que se puebla para todos, incluidos los importados.",
    [REF_TASKS, "apps/web/src/app/admin/members/page.tsx:37-41"],
    "verificacion",
  ),
  task(
    "T023V2",
    "Un único conversor canónico de centro, sin migrar datos",
    "pendiente",
    "Hoy «centro» se dice de ocho maneras, con dos mayúsculas incompatibles.",
    "-",
    "Bloquea a T019V2. Se construye una sola conversión en el dominio que sustituya las cinco ternarias a mano y las dos comparaciones literales, y que falle a la vista ante un valor inesperado: hoy `booking-transaction-service.ts:679` manda en silencio a West todo lo que no sea `town`. La migración de datos queda expresamente fuera de alcance, porque tres representaciones capitalizadas están escritas en Firestore y la de Regyfit es texto libre.",
    [REF_TASKS, "apps/functions/src/schedule/booking-transaction-service.ts:679"],
    "funcion",
  ),
];

const operatorDataItems = [
  task(
    "T021V2",
    "Recoger los datos que solo el operador tiene",
    "bloqueada",
    "Dirección de West y credenciales de los tres instructores nuevos.",
    "-",
    "Bloquea T010V2 y T011V2 y no puede resolverse desde el código. Ninguno de los datos se rellena por suposición.",
    [REF_TASKS],
    "decision",
  ),
];

const projectData = {
  cutoffDate: "2026-09-09",
  evidenceSyncDates: {
    T001V2: "2026-09-09",
    T002V2: "2026-09-09",
    T003V2: "2026-09-09",
    T004V2: "2026-09-09",
    T005V2: "2026-09-09",
    T006V2: "2026-09-09",
    T007V2: "2026-09-09",
    T008V2: "2026-09-09",
    T009V2: "2026-09-09",
    T010V2: "2026-09-09",
    T011V2: "2026-09-09",
    T012V2: "2026-09-09",
    T013V2: "2026-09-09",
    T014V2: "2026-09-09",
    T015V2: "2026-09-09",
    T016V2: "2026-09-09",
    T017V2: "2026-09-09",
    T018V2: "2026-09-09",
    T019V2: "2026-09-09",
    T020V2: "2026-09-09",
    T021V2: "2026-09-09",
    T022V2: "2026-09-09",
    T023V2: "2026-09-09",
    T024V2: "2026-09-09",
    T025V2: "2026-09-09",
  },
  stages: [
    stage(
      "bugs-formulario",
      "bugs",
      "V2-A · Bugs del formulario de inscripción",
      "Lo que hoy impide rellenar bien la solicitud desde un móvil.",
      "pendiente",
      bugFormItems,
    ),
    stage(
      "reserva",
      "reserva",
      "V2-B · Reserva de la primera clase",
      "Reservar primero y aprobar después, con la política de cancelación que lo acompaña.",
      "pendiente",
      bookingItems,
    ),
    stage(
      "miembros",
      "miembros",
      "V2-C · Interfaz de miembros ya aceptados",
      "Familias: asistencia de los hijos y cuenta propia del menor.",
      "pendiente",
      membersItems,
    ),
    stage(
      "landing",
      "landing",
      "V2-D · Landing pública",
      "Instructores y las dos direcciones. Bloqueada por datos que solo tiene el operador.",
      "bloqueada",
      landingItems,
    ),
    stage(
      "admin",
      "admin",
      "V2-E · Administración y entrenadores",
      "El panel del día, la asistencia y la cola de aprobación que hoy no funciona.",
      "pendiente",
      adminItems,
    ),
    stage(
      "pagos",
      "pagos",
      "V2-F · Pagos, suscripciones y centro",
      "Impagos que bloquean la reserva y trazabilidad de a qué centro pertenece cada pago.",
      "pendiente",
      paymentItems,
    ),
    stage(
      "datos",
      "datos",
      "V2-G · Datos que faltan del operador",
      "No se resuelve escribiendo código.",
      "bloqueada",
      operatorDataItems,
    ),
  ],
  maintenanceSteps: [
    "Interrogar la fila con /grill-me antes de escribir código cuando tenga decisiones abiertas. Las cinco que lo requerían -T006V2, T007V2, T009V2, T015V2 y T019V2- se interrogaron el 2026-09-09 en tres rondas, y sus decisiones están escritas en la fila.",
    "Actualizar primero tasksv2.md, que es la fuente única de verdad del estado y la evidencia de estas filas.",
    "Actualizar Listav2/Listav2.data.js después, en el mismo cambio lógico, sin copiar datos sensibles.",
    "Reensamblar con `node Listav2/build.mjs`: Listav2.js es generado a partir de Listav2.data.js y Listav2.engine.js, y editarlo a mano se pierde en el siguiente build.",
    "Marcar un requisito como resuelto se hace aquí, en RESOLUTION_REQUIREMENTS, poniendo su segundo argumento a true. No se marca desde la página: una marca es una afirmación sobre el proyecto y necesita autor, fecha y diff.",
    "Solo se marca lo que se puede demostrar. Lo que se averiguó, con su fecha, va en RESOLUTION_NOTES, que no es marcable porque un hecho no se completa.",
    "No tocar tasks.md ni Lista/: conservan la verdad de todo el trabajo anterior a esta segunda versión.",
    "Ajustar Listav2.html o Listav2.css solo cuando cambie la estructura o la presentación.",
    "Subir tasksv2.md y los archivos de Listav2 juntos en el mismo cambio lógico.",
  ],
};

// ---------------------------------------------------------------------------
// Motor de render (Listav2.engine.js)
// ---------------------------------------------------------------------------

/**
 * Listav2.engine.js - motor de render del tablero de la segunda version.
 *
 * Nacio como copia del motor de `Lista/Lista.js` para que los dos tableros se comporten igual, y
 * desde entonces diverge: aqui vive la lista de verificacion marcable del tablero de resolucion,
 * que la v1 no tiene. Ya no se regenera desde la v1; se edita a mano.
 *
 * `Listav2.js` es la concatenacion de `Listav2.data.js` y este archivo. No edites `Listav2.js`.
 */

function flattenItems(stages) {
  return stages.flatMap((currentStage) =>
    currentStage.items.map((item) => ({
      ...item,
      ...getImplementationDetails(item),
      stageId: currentStage.id,
      stageTitle: currentStage.title,
      track: currentStage.track,
    })),
  );
}

function countStatuses(items) {
  const counts = Object.fromEntries(VALID_STATUSES.map((status) => [status, 0]));
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
  }
  return counts;
}

/**
 * A cancelled row is a decision already taken, not pending work: it leaves both sides of the ratio
 * so the bar answers "how much of what we still intend to build is done". `countStatuses` keeps
 * counting every status, so the breakdown still shows how many rows were cancelled.
 */
function countedItems(items) {
  return items.filter((item) => item.status !== "cancelada");
}

function getStageProgress(currentStage) {
  const counted = countedItems(currentStage.items);
  const total = counted.length;
  const approved = counted.filter((item) => item.status === "aprobada").length;
  return {
    approved,
    approvedCount: approved,
    total,
    percentage: total === 0 ? 0 : Math.round((approved / total) * 100),
    statusCounts: countStatuses(currentStage.items),
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function itemMatches(item, filters = {}) {
  const query = normalizeText(filters.query ?? filters.text);
  const implementation = getImplementationDetails(item);
  const searchableText = normalizeText(
    [
      item.id,
      item.title,
      item.status,
      item.description,
      item.dependsOn,
      item.evidence,
      implementation.implementationStatus,
      IMPLEMENTATION_STATUS_LABELS[implementation.implementationStatus],
      implementation.implementationEvidence,
      ...(item.references ?? []),
      item.stageId,
      item.stageTitle,
    ].join(" "),
  );

  const matchesQuery = !query || searchableText.includes(query);
  const matchesStatus =
    !filters.status || filters.status === "all" || item.status === filters.status;
  const matchesStage =
    !filters.stage ||
    filters.stage === "all" ||
    item.stageId === filters.stage ||
    item.stageTitle === filters.stage;
  const matchesTrack = !filters.track || filters.track === "all" || item.track === filters.track;
  const matchesKind = !filters.kind || filters.kind === "all" || item.kind === filters.kind;

  return matchesQuery && matchesStatus && matchesStage && matchesTrack && matchesKind;
}

const STATUS_LABELS = {
  aprobada: "Aprobada",
  revision: "En revisión",
  "en-progreso": "En progreso",
  pendiente: "Pendiente",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

const STATUS_CLASSES = {
  aprobada: "status-approved",
  revision: "status-review",
  "en-progreso": "status-in-progress",
  pendiente: "status-pending",
  bloqueada: "status-blocked",
  cancelada: "status-cancelled",
};

const KIND_LABELS = {
  bug: "Bug",
  funcion: "Función nueva",
  verificacion: "Verificación",
  decision: "Decisión",
};

const TRACK_LABELS = {
  bugs: "Bugs del formulario",
  reserva: "Reserva de primera clase",
  miembros: "Miembros aceptados",
  landing: "Landing pública",
  admin: "Administración",
  pagos: "Pagos y centro",
  datos: "Datos del operador",
};

function filterItems(items, filters = {}) {
  return items.filter((item) => itemMatches(item, filters));
}

/**
 * En la v1 las anclas eran cuatro fases fijas. Aqui cada linea de trabajo es su propia ancla, asi
 * que el id de la etapa es el ancla, y `Listav2.html` declara un div por cada uno.
 */
function getPhaseAnchorId(currentStage) {
  const stageId = String(currentStage?.id ?? "");
  return stageId === "" ? null : stageId;
}

function getVisibleStages(stages, filters = {}) {
  return stages
    .map((currentStage) => {
      const visibleItems = currentStage.items.filter((item) =>
        itemMatches(
          {
            ...item,
            ...getImplementationDetails(item),
            stageId: currentStage.id,
            stageTitle: currentStage.title,
            track: currentStage.track,
          },
          filters,
        ),
      );

      return { ...currentStage, items: visibleItems.map(withImplementationDetails) };
    })
    .filter((currentStage) => currentStage.items.length > 0);
}

function getGlobalProgress(items) {
  const counted = countedItems(items);
  const approved = counted.filter((item) => item.status === "aprobada").length;
  return {
    approved,
    total: counted.length,
    percentage: counted.length === 0 ? 0 : Math.round((approved / counted.length) * 100),
  };
}

function createElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendLabeledValue(parent, label, value, className = "detail-value") {
  const container = createElement("div", undefined, "task-detail");
  container.append(
    createElement("span", label, "detail-label"),
    createElement("span", value || "-", className),
  );
  parent.append(container);
}

function createStatusBadge(status, className) {
  return createElement(
    "span",
    STATUS_LABELS[status] || status,
    `${className || "status-badge"} ${STATUS_CLASSES[status] || ""}`.trim(),
  );
}

function createProgressBar(progress, label) {
  const progressContainer = createElement("div", undefined, "phase-progress");
  const progressLabel = createElement("span", label, "phase-progress-label");
  const bar = createElement("div", undefined, "progress-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(progress.percentage));
  const fill = createElement("span", undefined, "progress-bar-fill");
  fill.style.width = `${progress.percentage}%`;
  bar.append(fill);
  progressContainer.append(progressLabel, bar);
  return progressContainer;
}

function bindSummaryCard(card, onActivate) {
  if (!card.dataset.bound) {
    card.dataset.bound = "true";
    card.addEventListener("click", onActivate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    });
  }
}

function renderSummary(summaryGrid, items, activeFilters, onStatusSelect, onTotalSelect) {
  const counts = countStatuses(items);
  const totalItems = flattenItems(projectData.stages);
  const progress = getGlobalProgress(totalItems);

  for (const card of summaryGrid.querySelectorAll('[data-render-target="status-cards"]')) {
    const status = card.dataset.status;
    card.replaceChildren();
    card.setAttribute("data-filter-status", status);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Filtrar por estado ${STATUS_LABELS[status] || status}`);
    card.setAttribute("aria-pressed", String(activeFilters.status === status));
    card.append(
      createElement("strong", String(counts[status] || 0)),
      createElement("span", STATUS_LABELS[status] || status),
    );
    bindSummaryCard(card, () => onStatusSelect(card.dataset.status));
  }

  const totalCard = summaryGrid.querySelector('[data-render-target="total-card"]');
  if (totalCard) {
    totalCard.replaceChildren(
      createElement("strong", String(totalItems.length)),
      createElement("span", "Total de tareas"),
    );
    totalCard.setAttribute("data-filter-status", "all");
    totalCard.setAttribute("role", "button");
    totalCard.setAttribute("tabindex", "0");
    totalCard.setAttribute("aria-label", `Mostrar todas las tareas (${totalItems.length})`);
    totalCard.setAttribute(
      "aria-pressed",
      String(!activeFilters.query && !activeFilters.status && !activeFilters.track),
    );
    bindSummaryCard(totalCard, onTotalSelect);
  }

  const globalProgress = summaryGrid.querySelector('[data-render-target="global-progress"]');
  if (globalProgress) {
    globalProgress.replaceChildren(
      createElement("strong", `${progress.percentage}%`),
      createElement("span", `${progress.approved} de ${progress.total} tareas completadas`),
      createProgressBar(progress, "Progreso global"),
    );
  }
}

function getResolutionRequirements(item) {
  return item.resolutionRequirements?.length
    ? item.resolutionRequirements
    : RESOLUTION_REQUIREMENTS[item.id] || [];
}

/**
 * ── Lista de verificacion del tablero de resolucion ────────────────────────────────────────────
 *
 * Las casillas son de SOLO LECTURA a proposito. No se marcan desde la pagina: se marcan en
 * `Listav2.data.js` conforme el trabajo se resuelve, y viajan en el repositorio.
 *
 * Por que no dejarlas marcar aqui: una marca es una afirmacion sobre el estado del proyecto. Si
 * cualquiera pudiera ponerla desde el navegador, viviria solo en ese navegador -invisible para el
 * resto, perdida al cambiar de equipo y sin nada que la respalde-. Marcada en el repositorio, la
 * afirmacion tiene autor, fecha y diff.
 */

function checklistProgress(item) {
  const requirements = getResolutionRequirements(item);
  return {
    done: requirements.filter((requirement) => requirement.done === true).length,
    total: requirements.length,
  };
}

function countChecklist(items) {
  let done = 0;
  let total = 0;
  for (const item of items) {
    const progress = checklistProgress(item);
    done += progress.done;
    total += progress.total;
  }
  return { done, total };
}

function renderResolutionBoard(resolutionList) {
  // A cancelled row has nothing left to resolve, so it does not belong on this board either.
  const unresolvedItems = flattenItems(projectData.stages).filter(
    (item) => item.status !== "aprobada" && item.status !== "cancelada",
  );
  resolutionList.replaceChildren();

  for (const item of unresolvedItems) {
    const entry = createElement("article", undefined, "resolution-item");
    entry.dataset.resolutionItem = item.id;

    const requirements = getResolutionRequirements(item);
    const progress = checklistProgress(item);
    // Todos los requisitos marcados no significa aprobada: significa que no queda trabajo
    // pendiente identificado y que la fila esta lista para revisarse en el ledger.
    const complete = progress.total > 0 && progress.done === progress.total;
    entry.classList.toggle("resolution-item-complete", complete);

    const heading = createElement("div", undefined, "resolution-item-header");
    const counter = createElement(
      "span",
      `${progress.done}/${progress.total}`,
      "resolution-item-progress",
    );
    counter.setAttribute(
      "aria-label",
      `${progress.done} de ${progress.total} requisitos resueltos en ${item.id}`,
    );
    heading.append(
      createElement("span", item.id, "task-id"),
      createElement("h3", item.title, "resolution-item-title"),
      counter,
      createStatusBadge(item.status, "resolution-item-status"),
    );

    const metadata = createElement("p", undefined, "resolution-item-meta");
    metadata.append(
      createElement("strong", "Dependencias: "),
      document.createTextNode(item.dependsOn),
    );

    entry.append(heading, metadata);

    const note = RESOLUTION_NOTES[item.id];
    if (note) {
      const noteElement = createElement("p", undefined, "resolution-item-note");
      noteElement.append(createElement("strong", "Lo que ya sabemos: "), document.createTextNode(note));
      entry.append(noteElement);
    }

    const list = createElement("ol", undefined, "resolution-requirements");
    for (const requirement of requirements) {
      const listItem = createElement("li", undefined, "resolution-requirement");
      listItem.classList.toggle("requirement-done", requirement.done === true);

      const box = createElement("span", requirement.done === true ? "X" : "", "requirement-box");
      box.setAttribute("role", "img");
      box.setAttribute(
        "aria-label",
        requirement.done === true ? "Resuelto:" : "Pendiente:",
      );

      listItem.append(box, createElement("span", requirement.text, "resolution-requirement-text"));
      list.append(listItem);
    }

    entry.append(list);
    resolutionList.append(entry);
  }

  const summary = document.querySelector("[data-checklist-summary]");
  if (summary) {
    const { done, total } = countChecklist(unresolvedItems);
    summary.textContent =
      total === 0
        ? "No hay requisitos registrados."
        : `${done} de ${total} requisitos resueltos en ${unresolvedItems.length} tareas.`;
  }
}
function renderTask(item) {
  const taskElement = createElement("article", undefined, "task");
  taskElement.dataset.taskId = item.id;

  const header = createElement("div", undefined, "task-header");
  header.append(
    createElement("span", item.id, "task-id"),
    createElement("h4", item.title, "task-title"),
  );

  const description = createElement("p", item.description, "task-description");
  const implementation = getImplementationDetails(item);
  const implementationClass =
    IMPLEMENTATION_STATUS_CLASSES[implementation.implementationStatus] || "";
  const checklist = createElement(
    "label",
    undefined,
    `task-checklist ${implementationClass}`.trim(),
  );
  const checkbox = createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `check-${item.id}`;
  checkbox.disabled = true;
  checkbox.checked =
    implementation.implementationStatus === "verificada" ||
    implementation.implementationStatus === "implementada";
  checkbox.setAttribute(
    "aria-label",
    `${IMPLEMENTATION_STATUS_LABELS[implementation.implementationStatus] || implementation.implementationStatus}: ${item.title}`,
  );
  checklist.append(
    checkbox,
    createElement(
      "span",
      IMPLEMENTATION_STATUS_LABELS[implementation.implementationStatus] ||
        implementation.implementationStatus,
      "checklist-label",
    ),
  );
  const details = createElement("div", undefined, "task-details");
  const detailGrid = createElement("div", undefined, "task-detail-grid");
  appendLabeledValue(detailGrid, "Dependencias", item.dependsOn);
  appendLabeledValue(detailGrid, "Tipo", KIND_LABELS[item.kind] || item.kind);

  const evidence = createElement("div", undefined, "task-detail");
  evidence.append(
    createElement("span", "Evidencia oficial", "detail-label"),
    createElement("span", item.evidence, "task-evidence"),
  );

  const implementationEvidence = createElement("div", undefined, "task-detail");
  implementationEvidence.append(
    createElement("span", "Ejecución detectada", "detail-label"),
    createElement("span", implementation.implementationEvidence, "task-evidence"),
  );

  const references = createElement("div", undefined, "task-detail");
  references.append(createElement("span", "Referencias", "detail-label"));
  const referenceList = createElement("div", undefined, "task-references");
  for (const reference of item.references || []) {
    referenceList.append(createElement("span", reference, "task-reference"));
  }
  references.append(referenceList);
  details.append(detailGrid, evidence, implementationEvidence, references);

  const backlogBadge = createStatusBadge(item.status, "task-status");
  backlogBadge.textContent = `Backlog: ${STATUS_LABELS[item.status] || item.status}`;
  taskElement.append(header, checklist, description, backlogBadge, details);
  return taskElement;
}

function renderPhase(currentStage, phaseId) {
  const phase = createElement("article", undefined, "phase");
  const taskListId = `${currentStage.id}-tasks`;
  phase.id = phaseId;
  phase.dataset.stageId = currentStage.id;
  phase.dataset.track = currentStage.track;

  const header = createElement("header", undefined, "phase-header");
  const titleGroup = createElement("div");
  titleGroup.append(
    createElement("span", TRACK_LABELS[currentStage.track] || currentStage.track, "phase-kicker"),
    createElement("h3", currentStage.title, "phase-title"),
    createElement("p", currentStage.description, "phase-description"),
  );

  const progress = getStageProgress(currentStage);
  const meta = createElement("div", undefined, "phase-meta");
  meta.append(
    createStatusBadge(currentStage.status, "phase-status"),
    createElement("span", `${progress.approved} de ${progress.total} tareas completadas`),
    createProgressBar(progress, `Progreso de ${currentStage.title}`),
  );

  const toggle = createElement("button", "Contraer", "phase-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", taskListId);

  const taskList = createElement("div", undefined, "phase-tasks");
  taskList.id = taskListId;
  for (const item of currentStage.items) taskList.append(renderTask(item));

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.textContent = expanded ? "Expandir" : "Contraer";
    taskList.hidden = expanded;
  });

  header.append(titleGroup, meta, toggle);
  phase.append(header, taskList);
  return phase;
}

function setVisiblePhasesExpanded(phaseList, expanded) {
  for (const phase of phaseList.querySelectorAll(".phase")) {
    const toggle = phase.querySelector(".phase-toggle");
    const taskList = phase.querySelector(".phase-tasks");
    if (!toggle || !taskList) continue;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Contraer" : "Expandir";
    taskList.hidden = !expanded;
  }
}

function renderMaintenance(maintenance) {
  if (!maintenance || maintenance.querySelector("[data-rendered-maintenance]")) return;
  const list = createElement("ul");
  list.dataset.renderedMaintenance = "true";
  for (const step of projectData.maintenanceSteps) list.append(createElement("li", step));
  maintenance.append(createElement("h3", "Checklist de actualización"), list);
}

function initializeFilters(statusFilter, trackFilter) {
  statusFilter.replaceChildren(createElement("option", "Todos los estados"));
  statusFilter.firstElementChild.value = "";
  for (const status of VALID_STATUSES) {
    const option = createElement("option", STATUS_LABELS[status], undefined);
    option.value = status;
    statusFilter.append(option);
  }

  const tracks = [...new Set(projectData.stages.map((currentStage) => currentStage.track))].sort();
  trackFilter.replaceChildren(createElement("option", "Todas las líneas"));
  trackFilter.firstElementChild.value = "";
  for (const track of tracks) {
    const option = createElement("option", TRACK_LABELS[track] || track);
    option.value = track;
    trackFilter.append(option);
  }
}

function renderProject(documentRoot = typeof document !== "undefined" ? document : null) {
  if (!documentRoot) return false;
  const app = documentRoot.getElementById("app");
  const summaryGrid = documentRoot.getElementById("summary-grid");
  const resolutionList = documentRoot.getElementById("resolution-list");
  const filters = documentRoot.getElementById("filters");
  const phaseList = documentRoot.getElementById("phase-list");
  const emptyState = documentRoot.getElementById("empty-state");
  const maintenance = documentRoot.getElementById("maintenance");
  const lastUpdated = documentRoot.getElementById("last-updated");
  const searchInput = documentRoot.getElementById("search-input");
  const statusFilter = documentRoot.getElementById("status-filter");
  const trackFilter = documentRoot.getElementById("track-filter");
  const filterStatus = documentRoot.getElementById("filter-status");
  const backToTop = documentRoot.getElementById("back-to-top");
  const expandAll = documentRoot.getElementById("expand-all");
  const collapseAll = documentRoot.getElementById("collapse-all");

  if (
    !app ||
    !summaryGrid ||
    !resolutionList ||
    !filters ||
    !phaseList ||
    !emptyState ||
    !statusFilter ||
    !trackFilter ||
    !searchInput
  ) {
    return false;
  }

  initializeFilters(statusFilter, trackFilter);
  renderMaintenance(maintenance);
  renderResolutionBoard(resolutionList);
  if (lastUpdated) {
    lastUpdated.dateTime = projectData.cutoffDate;
    lastUpdated.textContent = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${projectData.cutoffDate}T00:00:00Z`));
  }

  const allItems = flattenItems(projectData.stages);
  const form = filters.querySelector("form");
  const readFilters = () => ({
    query: searchInput.value,
    status: statusFilter.value,
    track: trackFilter.value,
  });
  const update = () => {
    const currentFilters = readFilters();
    const visibleItems = filterItems(allItems, currentFilters);
    renderSummary(
      summaryGrid,
      visibleItems,
      currentFilters,
      (status) => {
        statusFilter.value = statusFilter.value === status ? "" : status;
        update();
      },
      () => {
        searchInput.value = "";
        statusFilter.value = "";
        trackFilter.value = "";
        update();
      },
    );
    const visibleStages = getVisibleStages(projectData.stages, currentFilters);
    const usedAnchors = new Set();
    const renderedPhases = visibleStages.map((currentStage, index) => {
      const anchorId = getPhaseAnchorId(currentStage);
      const phaseId =
        anchorId && !usedAnchors.has(anchorId)
          ? anchorId
          : `${anchorId || currentStage.id}-${index}`;
      if (anchorId) usedAnchors.add(anchorId);
      return renderPhase(currentStage, phaseId);
    });
    for (const anchor of documentRoot.querySelectorAll(".phase-anchor")) anchor.remove();
    phaseList.replaceChildren(...renderedPhases);
    emptyState.hidden = visibleItems.length !== 0;
    if (filterStatus) {
      filterStatus.textContent = `${visibleItems.length} ${visibleItems.length === 1 ? "tarea visible" : "tareas visibles"}`;
    }
  };

  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("reset", (event) => {
      event.preventDefault();
      searchInput.value = "";
      statusFilter.value = "";
      trackFilter.value = "";
      update();
    });
  }

  if (backToTop && !backToTop.dataset.bound) {
    backToTop.dataset.bound = "true";
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const updateBackToTop = () => {
      backToTop.hidden = window.scrollY < 320;
    };
    backToTop.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" }),
    );
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();
  }

  if (expandAll && !expandAll.dataset.bound) {
    expandAll.dataset.bound = "true";
    expandAll.addEventListener("click", () => setVisiblePhasesExpanded(phaseList, true));
  }

  if (collapseAll && !collapseAll.dataset.bound) {
    collapseAll.dataset.bound = "true";
    collapseAll.addEventListener("click", () => setVisiblePhasesExpanded(phaseList, false));
  }

  update();
  return true;
}

function initialize() {
  renderProject(document);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
}

globalThis.ListaV2Project = {
  projectData,
  VALID_STATUSES,
  flattenItems,
  countStatuses,
  getStageProgress,
  normalizeText,
  itemMatches,
  filterItems,
  getPhaseAnchorId,
  getVisibleStages,
  getGlobalProgress,
  getImplementationDetails,
  getResolutionRequirements,
  renderResolutionBoard,
  setVisiblePhasesExpanded,
  renderProject,
  checklistProgress,
  countChecklist,
  RESOLUTION_NOTES,
};
