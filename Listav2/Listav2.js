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
  "desplegada",
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
    "Decisión D3 del operador, 2026-09-09. Auditado el mismo día: reservar exige `studentId` y `membershipId`, y ninguno de los dos existe antes de la aprobación. `requireStudentScope` (`apps/functions/src/schedule/schedule-callables.ts:64-82`) rechaza a `shopper`, y el resolutor canónico busca al alumno en `academies/{id}/students` o en `relationships`, colecciones que solo escribe la ruta de aprobación. Entre `shopper` y `adultStudent`/`guardian` no hay estado intermedio: el claim salta de golpe. Invertir el orden no es mover una comprobación, es crear la identidad de alumno antes de aprobar o abrir una ruta de reserva propia para la clase de prueba. Interrogada y decidida el 2026-09-09: se crea un alumno provisional con membresía `trial` en el registro y la clase de prueba viaja por la ruta de reserva única, porque `evaluateBookingEligibility` ya acepta `trial` y así el aforo, el quórum, los cortes, la asistencia y el contador de T015V2 se aplican sin escribir nada. Se descartó la ruta propia para no crear un segundo camino que toda regla futura tendría que acordarse de cubrir. El provisional no aparece en la base de miembros hasta ser aprobado; al rechazar, su membresía pasa a `cancelled`; el límite de una clase es un cupo de la propia membresía; la reserva cuenta para el mínimo de cuatro; y el aviso al administrador es uno solo, al reservar.",
  T007V2:
    'Hoy un único corte de una hora gobierna a la vez el cierre de reservas, el de cancelaciones y la cancelación automática por quórum. Las 12 h son un tercer concepto y hay que añadirlas aparte: mover el corte de una hora rompería el quórum. Precisado el 2026-09-09: no es una constante, es el parámetro por defecto `cutoffMinutes = 60` de `isWithinBookingCutoff` (`schedule-contracts.ts:816`), y las tres llamadas pasan `60` a mano (`booking-transaction-service.ts:598` reservas, `:806` cancelación, `decideQuorumSweep` en `schedule-contracts.ts:1024`). Y el fee no está «limitado a Town» por costumbre: está clavado en el dominio. `noShowPenaltyLocationId = "town"` (`packages/domain/src/penalties/no-show-penalty-contracts.ts:14`) y `decideNoShowPenalty` devuelve `skipReason: "otherSite"` para cualquier otra sede. GBP 15 es `noShowPenaltyAmountMinor = 1_500`. La propuesta no la genera nada automático: es el callable `proposeNoShowPenalties({ sessionId })`, que un miembro del personal ejecuta sesión por sesión. Interrogada y decidida el 2026-09-09: West también genera propuesta y por los mismos GBP 15, así que el identificador de sede pasa de constante a política por sede, lo que enmienda la decisión 2 del BRIEF. La banda real es de 12 h a 1 h, no de 12 h a 0, porque esa misma decisión ya cierra la cancelación una hora antes. La propuesta nace al cancelar, no en el barrido, porque `proposeNoShowPenalties` está indexado por asistencia y una reserva cancelada no produce registro de asistencia. Vive en la misma colección `noShowPenalties` con un motivo propio, y se retira sola si la sesión se cancela después por quórum.',
  T009V2:
    "Decisión D1 del operador, 2026-09-09. Auditado el mismo día: hoy un menor no tiene cuenta de ninguna clase. `buildMinorStudent` (`apps/functions/src/families/family-service.ts:718-757`) nunca escribe `userId`, aunque el campo existe como opcional en `StudentProfile`, así que el enganche a una cuenta ya está previsto en el contrato. Los roles de cliente son solo `shopper`, `guardian` y `adultStudent`: haría falta uno nuevo. El único umbral de edad del dominio es 18, en línea dentro de `deriveParticipantType` (`packages/domain/src/profiles/profile-contracts.ts:300-319`); no hay 16 en ninguna parte. La DPIA es un borrador sin aprobar (`docs/operations/t011-dpia-draft.md`) y el calendario de retención (`t011-retention-residency-erasure-policy.md`, tabla en las líneas 99-112) advierte en su línea 7 de que ningún plazo está implementado: hoy el sistema no borra nada al vencer. Interrogada y decidida el 2026-09-09: D1 prevalece sobre la decisión 6 del BRIEF, que decía literalmente que los menores no tienen cuenta propia y que se enmienda allí con fecha. Suelo de edad en 12, la línea que la academia ya traza entre Kids y Teens; sube a 13 si la DPIA acaba apoyándose en consentimiento. Hallazgo que le quita una pata a D1: «correo o teléfono» hoy es solo correo. Los proveedores cableados son Google y correo/contraseña; de teléfono no hay nada. Y el proyecto no puede enviar un correo a un tercero, porque `ExternalDeliveryProvider` devuelve siempre `skipped` con `provider_unconfigured` y no lo invoca ningún callable; ninguna función crea usuarios de Auth. Por eso la cuenta la crea el representante y le entrega el acceso, y eso se declara en la DPIA. Revocar quita el claim, desengancha el `userId` y deshabilita la cuenta de Auth. Se construye ya, pero no se despliega hasta que la DPIA esté aprobada.",
  T010V2:
    "Hoy `apps/web/src/content/academy.ts:154-168` lista a Miro, Eddie, Topo y Charlie. Cada entrada exige `credential`, y no tenemos la de los tres instructores nuevos. No se inventan grados ni cinturones.",
  T011V2:
    "El contenido tiene un único objeto de localización, Town Office (`academy.ts:48-53`), consumido como objeto único en la landing. `BPT West / Strive` solo existe como etiqueta de tarifa (`academy.ts:144`), sin domicilio.",
  T012V2:
    "Diagnosticado en producción el 2026-09-09, y la causa no era ninguna de las cuatro que la fila listaba. Cloud Run registra «Callable request verification passed» y acto seguido HTTP 403 en `getEnrolmentRequestDetail`, `listMembers`, `getMemberDetail` y `lookupMemberIdentity`, mientras `listEnrolmentRequests` responde 200 en la misma sesión. Lo que las separa es la puerta: las que fallan exigen, además del claim, un documento de personal aprovisionado en `academies/{academyId}/users/{uid}`. En producción la cuenta de `owner` lo tiene y pasa; la de `administrator` tiene claims válidos y ningún documento, y por eso la cola se pinta y ninguna fila se abre. Los botones no están inertes: «Approve and enrol» está `disabled` a propósito hasta que cargue el detalle, y «Send back to applicant» funciona pero exige escribir la nota. El único escritor de ese documento, `provisionAdminRole`, no está desplegado como callable. Decidido por el operador el 2026-09-09 (D5): se aprueba desde la cuenta de `owner` y no se escribe nada en producción. Teclear el documento a mano lo haría válido para la puerta y no dejaría rastro de quién concedió ese poder, porque `provisionAdminRole` lo escribe en la misma transacción que toma el cerrojo de rol y emite `admin.role.granted`; y el esquema es un `z.strictObject` de catorce campos, con dos `Timestamp` reales, donde un campo de más o de menos deja el 403 intacto. La cuenta de `administrator` queda inservible para el directorio canónico a propósito, y esa limitación la levanta T022V2 (D6). CORREGIDO más tarde el mismo día: el diagnóstico estaba incompleto y la fila culpaba a quien no era. Probado en producción desde `owner`, el detalle sí abre, porque `enrolmentRequestDetail` pasa `requiresCanonicalReader: false` y se salta la comprobación de estado; pero aprobar falla igual, con `approval_write_failed`. La causa real es que el directorio canónico nunca se inicializó en producción, que es T025V2. Lo del documento de `administrator` sigue siendo cierto, pero aprovisionarlo no habría dado de alta a nadie.",
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
    "Sale de la ronda del 2026-09-09 y bloquea a T019V2. «Centro» está dicho de ocho maneras con dos mayúsculas incompatibles, y tres de las capitalizadas están escritas en Firestore: `trainingCenter` en estudiantes, en el directorio de miembros y en familias, más `classSites`/`openMatSites` en los planes, más el `trainingCenter` de texto libre de la importación de Regyfit, cuyos valores son arbitrarios y no se arreglan con un `toLowerCase()`. Decidido: no se migra. La fila construye una única conversión canónica en el dominio que sustituya las cinco ternarias escritas a mano y las dos comparaciones literales, y que falle a la vista ante un valor inesperado. Ese es el bug real: `booking-transaction-service.ts:679` hace `locationId === 'town' ? 'Town' : 'West'`, de modo que un tercer valor caería en silencio en West. La migración completa queda expresamente fuera de alcance.",
  T025V2:
    "Causa raíz real del alta rota, encontrada el 2026-09-09 leyendo producción: la colección `academies/demo-academy/memberDirectoryStates` está vacía y el documento `current` que toda lectura y toda escritura del directorio exigen no existe. La lectura lo pide en `assertCanonicalReader` y lanza `unavailable`, que Firebase mapea a HTTP 400: es el 400 de `listMembers` que aparece en la consola desde una sesión de `owner`. La escritura lo exige además junto al documento de guarda `memberDirectoryRestoreGuards/{academyId}`, y por eso `approveEnrolmentRequest` muere con `approval_write_failed`. No es un problema de la cuenta sino de la academia: afecta igual a `owner` y a `administrator`, así que aprovisionar al administrador nunca habría bastado. Y hoy no hay ninguna vía para arreglarlo: el inicializador es de emulador por diseño en cuatro capas -constante `demo-bpt-jersey`, `z.literal` del mismo valor, `target: 'emulator'` y el rechazo `store.projectId !== projectId`-, su ejecutor clava el mismo proyecto y `index.ts` no lo exporta a propósito; además exige dieciocho colecciones vacías, incluida `auditEvents`, que producción ya tiene. Dato que tranquiliza: un intento fallido deja la solicitud en `approval-failed`, que sigue siendo aprobable, así que no hay nada atascado.",
  T024V2:
    "Sale de la ronda del 2026-09-09, y no es una mejora: es el incumplimiento de una decisión aprobada. La decisión 3 del BRIEF promete que una tarea idempotente cancela la sesión que no reúne cuatro reservas una hora antes. Esa tarea no ocurre en producción: `reconcileSessionQuorum` es un callable de staff al que ningún cliente web llama, y el único runner en lote se declara en su cabecera como deliberadamente no programado, restringido al emulador demo por `assertQuorumSweepRunnerEnvironment` (`quorum-sweep-runner.ts:8-15`, `:74`). La regla pura `decideQuorumSweep` y el servicio transaccional idempotente ya existen y están probados: lo que falta es que algo los dispare.",
  T022V2:
    "Decisión D6 del operador, 2026-09-09, salida de la pregunta 6 del ledger. `provisionAdminRole` (`apps/functions/src/auth/admin-provisioning.ts:677`) es el único escritor del documento de personal que exige la puerta canónica, y `apps/functions/src/index.ts:11` la reexporta como función suelta: no está desplegada. Convertirla no es envolverla en `onCall`. El objetivo llega como segundo parámetro de la función, no en `request.data`, y `provisioningRequestSchema` es un `z.strictObject({ action })` (`:78`) que rechaza cualquier campo extra, así que hoy `uid`, `email` y `role` no caben en la petición: desplegarla es ensanchar el contrato de entrada de la superficie de autorización. Lo que ya trae hecho es la puerta del concedente, `requireAdminActor` más `requireOwner` (`:589-590`), de modo que solo `owner` concede y un `administrator` no puede ascender a nadie ni a sí mismo. Lo que le falta frente a la puerta hermana: `requireCanonicalMemberDirectoryActor` verifica App Check en el manejador (`canonical-actor.ts:83-85`) y esta no lo hace. Leído en producción el 2026-09-09: el `owner` real es una cuenta de Google con documento de personal completo -`accountType: staff`, `adminRole: owner`, `createdBy: system:admin-bootstrap`-, y es la única que pasa la puerta canónica. De ahí sale un hallazgo que la fila no había previsto: toda cuenta que haya usado la plataforma como cliente lleva ya un claim no administrativo, y `requireTargetAdminClaims` rechaza cualquier objetivo cuyo claim no sea administrativo, así que hoy la callable solo acepta cuentas sin claim ninguno o cuentas que ya son administrativas. No existe vía auditada para ascender a un cliente, y si debe existir es una decisión de producto.",
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
      "Quitar la longitud de los campos del array de dependencias y sembrar el valor de la sesión una sola vez, con una guarda de «ya sembrado», en vez de ensanchar la condición actual. HECHO EL 2026-09-09: dependencias en `[session?.email, session?.displayName]` y guarda por referencia a lo ya sembrado. Las dos mitades hacen falta: quitar la longitud corta el re-render que reescribía el campo, y la referencia impide que un refresco de sesión con el mismo correo lo reescriba después.",
      true,
    ),
    requirement(
      "Prueba que borre cada campo entero y afirme que sigue vacío después del re-render, para los dos campos. HECHO EL 2026-09-09: cinco pruebas, cuatro rojas contra el código anterior. Además del borrado de cada campo, una borra tecla a tecla hasta la longitud 0 -el borde exacto donde fallaba, que un `clear()` de golpe se salta- y otra comprueba que la cortesía sigue viva cuando la sesión llega después del primer render.",
      true,
    ),
    requirement(
      "Desplegar el frontend, que es lo que hace que el solicitante deje de encontrarse el bug. HECHO EL 2026-09-09, y sin ningún paso manual: **el push a `main` despliega la web**, porque Cloudflare Pages está conectado al repositorio por integración de git y no por un job de workflows. El push de `8805ac3` creó el despliegue `e90663bf` en Production, y `bptjersey.pages.dev` sirve ese build. Verificado en el bundle servido, no en el panel: el build anterior (`a6d9da7`) lleva `email.length` y `fullName.length` dos veces cada uno en el trozo que contiene el formulario, y el que producción sirve hoy no los lleva en ningún chunk. `.length` sobrevive a la minificación, así que su ausencia habla del código que corre.",
      true,
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
    requirement("Invertir el orden actual, en el que la aprobación precede a cualquier reserva."),
    requirement(
      "Aplicar la restricción en reglas y callables, no solo en la interfaz: una restricción solo de cliente no restringe nada.",
    ),
    requirement(
      "Excluir al provisional del directorio canónico y de `listMembers` hasta que se le apruebe.",
    ),
    requirement("Transicionar la membresía a `cancelled` al rechazar la solicitud."),
    requirement("Disparar el aviso al administrador en el momento de la reserva."),
  ],
  T007V2: [
    requirement("Localizar el corte de cancelación vigente y con qué más comparte código.", true),
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
    requirement("Retirar la propuesta cuando la sesión se cancele por quórum."),
  ],
  T008V2: [
    requirement(
      "Marcaje de la asistencia de cada hijo desde el área de familia (`apps/web/src/app/account/family/page.tsx`).",
    ),
    requirement("Comprobar la relación tutor-menor en el servidor, no en el cliente."),
    requirement("Evitar la doble asistencia cuando el staff ya marcó a ese mismo menor en T014V2."),
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
    requirement("No desplegar hasta que la DPIA esté aprobada."),
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
    requirement("Comprobar si el dominio de tienda ya modela centro o retirada.", true),
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
      "Declararla como función de nube en vez de reexportarla suelta. HECHO EL 2026-09-09: `export const provisionAdminRole = onCall(browserAdminCallableOptions, ...)`, y el detector del release delta la mueve de la lista de saltadas a la de funciones. `qa/unit/release-delta.test.ts` afirma ese cambio de lado.",
      true,
    ),
    requirement(
      "Desplegarla en producción, que es lo que la hace existir. HECHO EL 2026-09-09 desde el commit 626170f, por la misma vía que T025V2: `functions.configDir` en una configuración temporal, con el valor del gate del waiver que producción ya llevaba y sin commitear ninguno. El inventario pasa de 71 a 72 funciones, el log solo registra una creación y ninguna retirada, `gcloud functions describe` la da ACTIVE, y el sondeo anónimo con cuerpo bien formado devuelve 401 UNAUTHENTICATED: la puerta se cierra antes de mirar el cuerpo.",
      true,
    ),
    requirement(
      "Ensanchar el contrato de entrada para que el objetivo viaje en `request.data`: hoy llega como segundo parámetro y `provisioningRequestSchema` es un `z.strictObject({ action })` que rechaza `uid`, `email` y `role`. HECHO EL 2026-09-09 con una unión de dos formas estrictas, no relajando la que había: `{ action }` para la costura interna y `{ action, uid, email, role }` para el navegador. Las dos siguen rechazando cualquier campo de más, así que `{ action, uid }` no encaja en ninguna; y `action` es obligatoria en la forma del navegador, para que una concesión de poder no salga de una omisión.",
      true,
    ),
    requirement(
      "Verificar App Check en el manejador, como hace `requireCanonicalMemberDirectoryActor`: la puerta que concede el poder no puede ser más débil que la que protege ese poder. HECHO EL 2026-09-09, dos veces a propósito: al principio de `provisionAdminRoleHandler`, para que un cliente sin atestiguar se rechace por lo que es y no por lo que manda, y dentro de `provisionAdminRoleWithServices`, que es la costura que alcanza cualquier otra vía. NO se copió la sonda de actividad de la puerta hermana: exige documento de personal a quien llama, y esta función es su único escritor, así que exigirlo dejaría a una academia nueva sin poder conceder el primer rol. La diferencia queda declarada, no heredada por descuido.",
      true,
    ),
    requirement(
      "Pruebas de que solo `owner` concede y de que un `administrator` no puede ascender a nadie ni a sí mismo. HECHO EL 2026-09-09: el caso de ascenderse a sí mismo faltaba y ahora está, y es el mismo rechazo, porque la puerta mira el rol de quien concede y no a quién apunta la petición.",
      true,
    ),
    requirement(
      "Evidencia de que `admin.role.granted` queda escrito en la misma transacción que el documento de personal: es lo que un documento tecleado por consola no deja. YA ESTABA PROBADA, y se cita en vez de duplicarse: al fallar Firestore `services.firestore.records` queda vacío del todo -ni documento ni evento-, y al conceder los dos salen de la misma transacción enlazados por `lastRoleChangeAuditId`.",
      true,
    ),
    requirement(
      'Elegir la cuenta que será el segundo owner, y que tiene que ser de Google. Corregido el 2026-09-09: NO puede ser admin@admin.com. Leyendo Auth, esa cuenta tiene proveedor `password` y ningún displayName, y el documento de personal que exige la puerta se valida contra `authProvider: z.literal("google")` y `displayName` no vacío, lo mismo que exige `requireGoogleUser` en el escritor. Escribirle `authProvider: google` sería meter una afirmación falsa en el registro de autorización. EL OPERADOR NOMBRÓ UNA CUENTA EL 2026-09-09 Y TAMPOCO PUEDE SERLO: leyendo Auth y Firestore, esa cuenta (uid `BZrK8L...`) es de Google y tiene `displayName`, pero su claim es `role: adultStudent` y su documento es `accountType: client` creado por el `owner` ese mismo día. Es la cuenta cliente del solicitante que escribió la aprobación de punta a punta de T012V2. `requireTargetAdminClaims` la rechazaría con `permission-denied`, porque `adultStudent` es un `userRole` válido que no está en `administrativeRoles`; y si no lo hiciera, el documento de personal se escribe con `set` sin `merge` sobre esa misma ruta, así que reemplazaría el documento cliente del estudiante y el claim `owner` sobrescribiría al de `adultStudent`. Hace falta una cuenta de Google distinta.',
    ),
    requirement(
      "Aprovisionar por esa vía la cuenta elegida y comprobar que después abre una fila de la cola. Es la limitación que D5 dejó declarada en T012V2.",
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
      "DECIDIDO EL 2026-09-09: se construye la vía de producción en vez de escribir los documentos a mano. El guardarraíl de emulador se deja intacto y se añade una vía propia al lado.",
      true,
    ),
    requirement(
      "Crear el documento de estado, el de guarda y su evento cero en una sola transacción create-only, con el evento de auditoría `member.directory.initialized` dentro de la misma. HECHO: callable `initializeCanonicalMemberDirectory`, solo para owner y con App Check, con la academia tomada del claim y nunca del payload.",
      true,
    ),
    requirement(
      "Revisar la precondición de vacuidad. HECHO: pasa de dieciocho colecciones a diez. `auditEvents` sale porque es un registro de solo añadir que describe intentos y no estado; `members` sale por la decisión D7 del 2026-09-09, ya con la medición de producción delante.",
      true,
    ),
    requirement(
      "Derivar la línea base de identidad vacía. Corregido el 2026-09-09: NO era prescindible, porque el esquema rechaza la cobertura completa sin ella y sin cobertura completa ni el lector ni el escritor aceptan el estado. Se deriva byte a byte como el flujo del artefacto.",
      true,
    ),
    requirement(
      "Dejar de esconder la causa en el directorio. HECHO: `listMembers` nombra las dos causas accionables con tipos propios en vez de colapsarlas en «please try again», que es por lo que el 400 solo se veía en la consola, y la página ofrece el botón únicamente cuando esa es la causa.",
      true,
    ),
    requirement(
      "Medir producción antes de desplegar. HECHO EL 2026-09-09: `academies/demo-academy/members` tiene 243 registros reales (`source: member-pdf-import`, evento `member.import.confirmed` del 2026-08-13) y era la primera de las once colecciones exigidas vacías, así que el botón habría devuelto `failed-precondition`. El directorio canónico sí está vacío: `students`, `studentIdentityKeys`, `studentAdminProfiles` y `memberDirectoryStates`, las cuatro a cero.",
      true,
    ),
    requirement(
      "Sacar `members` de la precondición. HECHO: no es el directorio canónico sino la colección origen de la migración forward, y esa migración exige la cobertura completa y la línea base que solo el inicializador escribe, así que exigirla vacía era un cerrojo circular. Decisión D7 del operador, con una prueba propia que lo fija.",
      true,
    ),
    requirement(
      "Desplegar `initializeCanonicalMemberDirectory`. HECHO EL 2026-09-09 desde el commit b033c23: el inventario pasa de 70 a 71 funciones, ninguna retirada, estado ACTIVE sobre nodejs22, ligando MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET@2, y el sondeo anónimo devuelve 401. Desbloqueado con `functions.configDir`, una vía del CLI que apunta el dotenv fuera del directorio que borra el predeploy; no se commiteó ningún valor del gate del waiver.",
      true,
    ),
    requirement(
      "Pulsar el botón desde owner. HECHO EL 2026-09-09, y falló: la callable devolvió 400 INVALID_ARGUMENT «Invalid audit event draft» y la transacción no escribió nada. La página hizo su parte entera y App Check y Auth se verificaron VALID.",
      true,
    ),
    requirement(
      "Arreglar la causa: `member.directory.initialized` no estaba en el catálogo `auditActions` del dominio, así que el propio evento de auditoría que esta fila añade era lo que impedía inicializar. No lo cazó nada porque el adaptador casteaba el borrador con `as unknown as AuditEventDraft` y la única prueba afirmaba el nombre contra un almacén falso. HECHO: la acción entra en el dominio, el casteo desaparece a favor de `buildInitializationAuditDraft` tipado de verdad, y una prueba nueva pasa el borrador por el parser real.",
      true,
    ),
    requirement(
      "Redesplegar y volver a pulsar el botón. HECHO EL 2026-09-09: la callable devuelve 200 con alreadyInitialized false y listMembers pasa de 400 a 200 en la misma pantalla. Estado, guarda, evento cero y el evento de auditoría member.directory.initialized comparten timestamp exacto, que es la prueba de que fue una sola transacción, y el evento nombra al owner como actor.",
      true,
    ),
    requirement(),
    requirement(
      "Aprobar a un solicitante real de punta a punta después de inicializar, que es lo que cierra también T012V2. HECHO EL 2026-09-09: approveEnrolmentRequest devuelve 200 con role adultStudent y un studentId nuevo, la solicitud pasa de approval-failed a approved, y el directorio canónico pasa de vacío a un estudiante escrito en students, studentIdentityKeys y studentAdminProfiles.",
      true,
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

  if (item.status === "desplegada") {
    return {
      implementationStatus: "verificada",
      implementationEvidence:
        "Desplegada en produccion y verificada alli, con la evidencia registrada en tasksv2.md.",
    };
  }

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

function task(
  id,
  title,
  status,
  description,
  dependsOn = "-",
  evidence,
  references,
  kind = "funcion",
) {
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
    "desplegada",
    "Ya se pueden vaciar: el prellenado siembra una vez y no vuelve a tocarlos.",
    "-",
    "Causa localizada: el efecto de prellenado llevaba la longitud de los propios campos en sus dependencias, así que al llegar a cero se volvía a disparar y reescribía el valor de la sesión. Arreglado el 2026-09-09: siembra una vez, con guarda por referencia a lo ya sembrado, y las dependencias quedan solo en los valores de la sesión. Cinco pruebas nuevas, cuatro rojas contra el código anterior, incluida una que borra tecla a tecla hasta la longitud 0, que es el borde exacto donde fallaba. La cortesía sigue viva: una sesión que llega tarde sigue rellenando los dos campos.",
    [REF_TASKS, "apps/web/src/app/enrol/page.tsx", "apps/web/src/app/enrol/page.test.tsx"],
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
    "desplegada",
    "Ningún botón acepta al nuevo miembro: hoy no se puede dar de alta a nadie.",
    "T025V2",
    "Diagnosticada el 2026-09-09: la cuenta de administrator tiene claims válidos y ningún documento de personal aprovisionado, así que la cola carga y toda callable detrás de la puerta canónica responde 403. Falta la escritura en producción, que espera al operador.",
    [
      REF_TASKS,
      "apps/web/src/app/admin/members/requests/page.tsx",
      "apps/web/src/lib/enrolment-client.ts",
    ],
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
    "en-progreso",
    "En curso el 2026-09-09. Ya existe la vía en producción; falta una cuenta de Google que pueda serlo. La primera que nombró el operador no sirve: es el estudiante que dio de alta T012V2.",
    "-",
    "Aplica D6. Es el único escritor del documento que exige la puerta canónica, y hasta hoy se reexportaba como función suelta, no como `onCall`. No era envolverla: el objetivo llegaba como segundo parámetro y `provisioningRequestSchema` rechazaba cualquier campo extra, así que desplegarla ensancha el contrato de entrada de la superficie de autorización. Código hecho el 2026-09-09: declarada como `onCall` con `browserAdminCallableOptions`, contrato ensanchado con una unión de dos formas estrictas -ninguna de las dos acepta campos de más, así que una petición a medio camino no se cuela por la permisiva- y App Check verificada en el manejador, al entrar y en la costura interna. No se copió la sonda de actividad de la puerta hermana porque exige documento de personal a quien llama y esta función es su único escritor: heredarla dejaría a una academia nueva sin poder conceder el primer rol. Desplegada en producción el mismo día y verificada: 72 funciones, ninguna retirada, estado ACTIVE, y 401 UNAUTHENTICATED al sondeo anónimo con cuerpo bien formado. Ya existe una vía en producción para aprovisionar a un administrador, que es lo que la fila levantaba de D5. Queda una sola cosa, y no es código: qué cuenta de Google será el segundo owner. `admin@admin.com` no puede serlo, por proveedor `password` y sin displayName.",
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
    "desplegada",
    "Nunca se inicializó, y sin su documento de estado no se puede dar de alta a nadie.",
    "-",
    "Causa raíz real del alta rota, verificada en producción el 2026-09-09: la colección memberDirectoryStates está vacía, así que la lectura devuelve 400 y la aprobación muere con approval_write_failed, para owner igual que para administrator. Vía de producción construida y probada el mismo día, sin tocar el guardarraíl de emulador: callable solo para owner que escribe estado, guarda y evento cero en una transacción create-only, con auditoría dentro. Preparando el despliegue se midió que la colección members tiene 243 registros reales del PDF y era la primera de las once que la precondición exigía vacías: el botón habría fallado. members no es el directorio canónico sino el origen de la migración forward, que a su vez exige el estado que solo el inicializador escribe, así que exigirla vacía dejaba a la academia sin poder inicializar ni migrar. Decisión D7: sale de la lista y quedan diez. Desplegada en producción el mismo día y verificada: ACTIVE, 401 al sondeo anónimo, 71 funciones. Al pulsarla desde owner falló con 400 INVALID_ARGUMENT «Invalid audit event draft», sin escribir nada: la acción member.directory.initialized no estaba en el catálogo del dominio y un doble casteo impedía que el compilador lo dijera. Arreglado, redesplegado y pulsado el mismo día: 200, directorio inicializado en una sola transacción y con su evento de auditoría atribuido al owner.",
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

/**
 * La superficie de una fila: los ficheros y carpetas que su trabajo va a **escribir**.
 *
 * No es lo mismo que `references`. Una referencia dice donde se encontro el problema y puede ser
 * una sola linea; la superficie dice donde va a caer el cambio, que es lo unico que decide si dos
 * personas se pisan. Confundirlas produciria repartos de trabajo afirmados con confianza y falsos,
 * que es peor que no repartir.
 *
 * Tres estados, y la diferencia importa:
 *
 * - una lista de rutas: superficie declarada;
 * - `[]`: la fila **no toca codigo**, asi que no puede chocar con nadie;
 * - `null`: **sin declarar**. No significa "compatible con todo", significa que no se puede
 *   afirmar nada. Una fila asi nunca se propone para trabajar en paralelo, y el tablero pide que
 *   alguien la declare antes de repartirla.
 *
 * Las rutas salen de lo que la propia fila de `tasksv2.md` nombra. Una carpeta cubre todo lo que
 * cuelga de ella.
 */
const TASK_SURFACES = {
  T001V2: ["apps/web/src/app/enrol/page.tsx"],
  T002V2: ["apps/web/src/app/enrol/page.tsx"],
  T003V2: ["apps/web/src/app/enrol/page.tsx", "apps/web/src/app/enrol/enrol.css"],
  T004V2: ["apps/web/src/app/page.tsx", "apps/web/src/lib/client-auth.tsx"],
  T005V2: ["packages/domain/src/consents/enrolment-waiver-terms.ts"],
  T006V2: [
    "apps/functions/src/schedule/schedule-callables.ts",
    "packages/domain/src/members/enrolment-request-contracts.ts",
  ],
  T007V2: [
    "packages/domain/src/schedule/schedule-contracts.ts",
    "packages/domain/src/penalties/no-show-penalty-contracts.ts",
  ],
  T008V2: ["apps/web/src/app/account/family/page.tsx"],
  T009V2: [
    "apps/functions/src/families/family-service.ts",
    "packages/domain/src/profiles/profile-contracts.ts",
    "apps/web/src/lib/auth-client.ts",
    "apps/functions/src/delivery/delivery-service.ts",
    "docs/operations/t011-dpia-draft.md",
  ],
  T010V2: ["apps/web/src/content/academy.ts"],
  T011V2: ["apps/web/src/content/academy.ts", "apps/web/src/app/page.tsx"],
  T012V2: [
    "apps/web/src/app/admin/members/requests/page.tsx",
    "apps/web/src/lib/enrolment-client.ts",
  ],
  T013V2: ["apps/web/src/app/admin/overview-page.tsx"],
  T014V2: ["apps/web/src/app/admin/overview-page.tsx"],
  T015V2: [
    "packages/domain/src/schedule/schedule-contracts.ts",
    "packages/domain/src/memberships/plan-contracts.ts",
    "apps/functions/src/schedule/booking-transaction-service.ts",
  ],
  T016V2: ["apps/web/src/app/admin/overview-page.tsx"],
  T017V2: ["apps/web/src/app/admin/overview-page.tsx"],
  T018V2: [
    "packages/domain/src/schedule/schedule-contracts.ts",
    "apps/functions/src/memberships/membership-callables.ts",
    "packages/domain/src/finance/financial-dashboard.ts",
  ],
  T019V2: ["apps/functions/src/finance/finance-service.ts", "packages/domain/src/shop"],
  T020V2: [
    "apps/web/src/app/admin/members/page.tsx",
    "apps/functions/src/profiles/profile-service.ts",
  ],
  // No toca codigo: lo que falta son datos que solo tiene el operador.
  T021V2: [],
  T022V2: ["apps/functions/src/auth/admin-provisioning.ts", "apps/functions/src/index.ts"],
  T023V2: [
    "packages/domain/src/families/family-contracts.ts",
    "apps/functions/src/schedule/booking-transaction-service.ts",
  ],
  T024V2: [
    "apps/web/src/lib/schedule-client.ts",
    "apps/functions/src/schedule/quorum-sweep-runner.ts",
  ],
  T025V2: [
    "apps/functions/src/members/canonical-directory-initialization.ts",
    "apps/functions/src/members/canonical-directory-initialization-firestore.ts",
    "packages/domain/src/audit/audit-event.ts",
  ],
};

// `desplegada` es el estado final del ledger: una fila que ya corre en produccion no es trabajo
// que repartir, igual que una aprobada o una cancelada.
const CLOSED_STATUSES = new Set(["desplegada", "aprobada", "cancelada"]);

// Una fila que alguien ya empezo: hay trabajo vivo cayendo sobre sus ficheros ahora mismo, este o
// no commiteado. Es el unico estado en el que un solape se paga en conflictos de merge de verdad.
const ACTIVE_STATUSES = new Set(["en-progreso", "revision"]);

/**
 * Cuanto pesa que otra fila escriba tus mismos ficheros. Tres niveles, y la diferencia es la que
 * el operador necesita para elegir fila:
 *
 * - `en-curso`: alguien la esta escribiendo. Coger la tuya es pelearse por el fichero hoy.
 * - `sin-empezar`: nadie la ha empezado. El choque es futuro y evitable coordinando el orden.
 * - `cerrada`: ya desplegada, aprobada o cancelada. El cambio ya cayo; no compite con nadie.
 *
 * `desplegada` cuenta como cerrada a proposito: saber que un fichero lo toco una fila ya en
 * produccion es informacion util -dice quien lo escribio el ultimo- pero no es un riesgo.
 */
function interferenceLevel(status) {
  if (ACTIVE_STATUSES.has(status)) return "en-curso";
  return CLOSED_STATUSES.has(status) ? "cerrada" : "sin-empezar";
}

const INTERFERENCE_SEVERITY = { "en-curso": 3, "sin-empezar": 2, cerrada: 1 };

/** Una carpeta cubre lo que cuelga de ella, asi que el solape no es igualdad de cadenas. */
function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function sharedPaths(left, right) {
  const shared = [];
  for (const leftPath of left) {
    for (const rightPath of right) {
      if (pathsOverlap(leftPath, rightPath)) {
        // Se nombra la ruta mas concreta de las dos: es la que hay que mirar.
        shared.push(leftPath.length >= rightPath.length ? leftPath : rightPath);
      }
    }
  }
  return [...new Set(shared)];
}

/**
 * Todo lo que encadena a una fila, directo o no. Se sigue la cadena entera porque una fila cuyo
 * bloqueo esta a dos saltos sigue sin poder empezarse, y ofrecerla seria mandar a alguien a
 * trabajar contra una pared.
 */
function transitiveDependencies(id, byId, seen = new Set()) {
  const item = byId.get(id);
  if (!item) return seen;
  for (const dependency of String(item.dependsOn || "").match(/T\d{3}V2/gu) || []) {
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    transitiveDependencies(dependency, byId, seen);
  }
  return seen;
}

/**
 * Anota en cada fila con quien se puede trabajar a la vez.
 *
 * Dos filas van en paralelo cuando se cumplen las tres a la vez: ninguna encadena a la otra, las
 * dos estan listas para empezar -sin dependencia abierta- y sus superficies no se solapan. Se
 * calcula, no se afirma: si manana una fila cambia de superficie, el reparto cambia solo, que es
 * justo lo que una etiqueta escrita a mano no hace.
 */
function annotateParallelWork(stages) {
  const items = stages.flatMap((currentStage) => currentStage.items);
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    const declared = TASK_SURFACES[item.id];
    item.surface = Array.isArray(declared) ? declared : null;
    item.open = !CLOSED_STATUSES.has(item.status);
    item.blockedBy = [...transitiveDependencies(item.id, byId)]
      .filter((id) => byId.get(id) && !CLOSED_STATUSES.has(byId.get(id).status))
      .sort();
    // `bloqueada` no es lo mismo que "con dependencias": T021V2 no espera a ninguna fila, espera un
    // dato que solo tiene el operador. Ofrecerla como lista para empezar seria mandar a alguien a
    // trabajar contra una pared distinta.
    item.ready = item.open && item.status !== "bloqueada" && item.blockedBy.length === 0;
    // `ready` dice que la fila se puede empezar; `available`, que ademas no la ha cogido nadie. Sin
    // esa segunda, una fila que alguien esta escribiendo salia anunciada como «lista» y el reparto
    // invitaba a cogerla dos veces. Se separan porque las dos hacen falta: la de en curso sigue
    // siendo comparable en paralelo -para quien elija la otra mitad del reparto-, pero ya no esta
    // libre.
    item.active = ACTIVE_STATUSES.has(item.status);
    item.available = item.ready && !item.active;
  }

  for (const item of items) {
    item.parallelWith = [];
    item.conflicts = [];
    if (!item.ready || item.surface === null) continue;

    for (const other of items) {
      if (other === item || !other.ready || other.surface === null) continue;
      const chained =
        transitiveDependencies(item.id, byId).has(other.id) ||
        transitiveDependencies(other.id, byId).has(item.id);
      if (chained) continue;

      const shared = sharedPaths(item.surface, other.surface);
      if (shared.length === 0) item.parallelWith.push(other.id);
      else item.conflicts.push({ id: other.id, files: shared });
    }
    item.parallelWith.sort();
    item.conflicts.sort((left, right) => left.id.localeCompare(right.id));
  }

  annotateInterference(items);
  return stages;
}

/**
 * Con quien comparte ficheros esta fila, **este quien este lista o no**.
 *
 * `conflicts` responde a otra pregunta -"si hoy repartimos dos filas listas, se pisan?"- y por eso
 * solo mira filas listas y descarta las encadenadas. Eso deja fuera justo el caso que hace dano:
 * una fila que alguien ya empezo. Si el compañero esta escribiendo T013V2 y yo cojo otra fila que
 * toca su mismo fichero, `conflicts` no dice nada, porque T013V2 dejo de estar "lista" en cuanto
 * paso a `en-progreso`.
 *
 * Aqui no se descarta nada: ni el estado de la otra fila ni la cadena de dependencias. Una fila que
 * depende de otra y escribe su mismo fichero interfiere igual; que ademas tenga que esperarla es un
 * hecho distinto, y lo cuenta `blockedBy`.
 */
function annotateInterference(items) {
  for (const item of items) {
    item.interference = [];

    if (item.surface === null) {
      item.interferenceLevel = "sin-declarar";
      continue;
    }
    if (item.surface.length === 0) {
      item.interferenceLevel = "no-toca";
      continue;
    }

    for (const other of items) {
      if (other === item || other.surface === null || other.surface.length === 0) continue;
      const files = sharedPaths(item.surface, other.surface);
      if (files.length === 0) continue;
      item.interference.push({
        id: other.id,
        status: other.status,
        level: interferenceLevel(other.status),
        files,
      });
    }

    // Lo peor primero: quien mira la insignia quiere saber si hay algo vivo, no leer una lista.
    item.interference.sort(
      (left, right) =>
        INTERFERENCE_SEVERITY[right.level] - INTERFERENCE_SEVERITY[left.level] ||
        left.id.localeCompare(right.id),
    );
    item.interferenceLevel =
      item.interference.length === 0 ? "ninguna" : item.interference[0].level;
  }
}

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
    "Poner la fila en `en-progreso` al empezarla, no solo al terminarla. Es lo que enciende el aviso de interferencia: la insignia de cada tarea y la columna «Interfiere con» del ledger leen el estado de las demás filas, así que una fila que alguien está escribiendo pero sigue puesta como `pendiente` sale como «sin empezar» y la tabla afirma que no hay nadie donde sí lo hay. Con dos personas repartiéndose el trabajo, ese paso deja de ser burocracia y pasa a ser la señal.",
    "Reensamblar con `node Listav2/build.mjs`: Listav2.js es generado a partir de Listav2.data.js y Listav2.engine.js, y editarlo a mano se pierde en el siguiente build.",
    "Marcar un requisito como resuelto se hace aquí, en RESOLUTION_REQUIREMENTS, poniendo su segundo argumento a true. No se marca desde la página: una marca es una afirmación sobre el proyecto y necesita autor, fecha y diff.",
    "Solo se marca lo que se puede demostrar. Lo que se averiguó, con su fecha, va en RESOLUTION_NOTES, que no es marcable porque un hecho no se completa.",
    "No tocar tasks.md ni Lista/: conservan la verdad de todo el trabajo anterior a esta segunda versión.",
    "Ajustar Listav2.html o Listav2.css solo cuando cambie la estructura o la presentación.",
    "Subir tasksv2.md y los archivos de Listav2 juntos en el mismo cambio lógico.",
    "Refrescar el grafo de graphify al cerrar una sesión de trabajo, y dejar la nota en tasksv2.md: `graphify-out/` está en .gitignore, así que el grafo no viaja en el repositorio y la nota es lo único que queda. Para el estado de una fila manda tasksv2.md, nunca el grafo: una etiqueta suya puede quedar desactualizada.",
    "En ese refresco hay tres pasos que graphify no da solo y que hay que dar a mano. Uno: normalizar a relativas las rutas `source_file` de la extracción antes de fusionar, porque el subagente semántico las escribe absolutas y el grafo las guarda relativas, así que sin eso el mismo fichero cuenta como dos. Dos: volver a imponer las etiquetas recién extraídas después de `build_merge`, que reconcilia quedándose con la vieja —con una excepción, que la etiqueta nueva no gane cuando es la vieja recortada, como cuando el extractor AST llama `page.tsx` a lo que el grafo tenía como `enrol/page.tsx`—. Tres: consolidar la deriva de identificadores, porque el id de un nodo de concepto sale de la etiqueta que elige el modelo y esa etiqueta cambia entre vueltas, así que un concepto renombrado pierde toda su historia de aristas y uno no mencionado desaparece. Comprobar nodo a nodo al terminar, no suponerlo.",
  ],
};

annotateParallelWork(projectData.stages);

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

/** Terminadas: aprobada, desplegada y cancelada ya no son trabajo pendiente. */
function isClosedStatus(status) {
  return status === "aprobada" || status === "desplegada" || status === "cancelada";
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

/**
 * Terminada a efectos de progreso.
 *
 * `countedItems` ya ha quitado las canceladas, asi que aqui solo quedan `aprobada` y `desplegada`.
 * Contar unicamente `aprobada` decia «0 de 25 completadas» con dos filas corriendo en produccion,
 * porque en este ledger el estado final es `desplegada` y una fila desplegada nunca vuelve a pasar
 * por `aprobada`. La barra afirmaba algo falso sobre el proyecto.
 */
function isCompletedStatus(status) {
  return isClosedStatus(status);
}

function getStageProgress(currentStage) {
  const counted = countedItems(currentStage.items);
  const total = counted.length;
  const approved = counted.filter((item) => isCompletedStatus(item.status)).length;
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
  desplegada: "Desplegada",
  aprobada: "Aprobada",
  revision: "En revisión",
  "en-progreso": "En progreso",
  pendiente: "Pendiente",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

const STATUS_CLASSES = {
  desplegada: "status-deployed",
  aprobada: "status-approved",
  revision: "status-review",
  "en-progreso": "status-in-progress",
  pendiente: "status-pending",
  bloqueada: "status-blocked",
  cancelada: "status-cancelled",
};

/**
 * Interferencia: si otra fila escribe los mismos ficheros que esta, y en que estado esta esa otra.
 *
 * La insignia de estado dice lo que le pasa a ESTA fila. Esta dice lo que le pasa a su alrededor,
 * que es la pregunta que hay que responder antes de coger una fila trabajando en paralelo: no
 * «¿esta desplegada?», sino «¿hay alguien escribiendo ahora mismo en los ficheros que voy a tocar?».
 */
const INTERFERENCE_STATE_LABELS = {
  "en-curso": "en curso",
  "sin-empezar": "sin empezar",
  cerrada: "ya cerrada",
};

const INTERFERENCE_CLASSES = {
  "en-curso": "interference-active",
  "sin-empezar": "interference-open",
  cerrada: "interference-closed",
  ninguna: "interference-none",
  "no-toca": "interference-none",
  "sin-declarar": "interference-unknown",
};

function describeInterference(item) {
  if (item.interferenceLevel === "sin-declarar") {
    return "Interferencia: sin calcular, esta fila no declara qué ficheros escribe";
  }
  if (item.interferenceLevel === "no-toca") {
    return "Interferencia: ninguna, no toca código";
  }

  const entries = item.interference || [];
  if (entries.length === 0) return "Interferencia: ninguna otra fila escribe sus ficheros";

  const worst = entries.filter((entry) => entry.level === item.interferenceLevel);
  const ids = worst.map((entry) => entry.id).join(", ");
  const rest = entries.length - worst.length;
  const tail = rest > 0 ? ` (+${rest} más)` : "";

  if (item.interferenceLevel === "en-curso") {
    return `Interferencia: ${ids} ${worst.length === 1 ? "está" : "están"} en curso sobre sus mismos ficheros${tail}`;
  }
  if (item.interferenceLevel === "sin-empezar") {
    return `Interferencia: ${ids} ${worst.length === 1 ? "escribe" : "escriben"} sus mismos ficheros, sin empezar${tail}`;
  }
  return `Interferencia: solo con filas ya cerradas (${ids})`;
}

function createInterferenceBadge(item) {
  if (item.interferenceLevel === undefined) return null;
  const badge = createElement(
    "span",
    describeInterference(item),
    `task-interference ${INTERFERENCE_CLASSES[item.interferenceLevel] || ""}`.trim(),
  );
  badge.dataset.interference = item.interferenceLevel;
  return badge;
}

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
  const approved = counted.filter((item) => isCompletedStatus(item.status)).length;
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

/**
 * Este tablero obedece a los mismos filtros que el resto de la pagina.
 *
 * Antes se pintaba una sola vez, fuera del ciclo de filtrado, asi que al filtrar por «Desplegada»
 * el resumen de arriba decia 2 y aqui abajo seguian saliendo las pendientes de siempre. La pagina
 * mostraba dos respuestas distintas a la misma pregunta, y la de abajo era la vieja.
 */
function renderResolutionBoard(resolutionList, filters = {}) {
  const matchedItems = flattenItems(projectData.stages).filter((item) =>
    itemMatches(item, filters),
  );
  // A cancelled row has nothing left to resolve, so it does not belong on this board either.
  const unresolvedItems = matchedItems.filter((item) => !isClosedStatus(item.status));
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
  if (summary) summary.textContent = describeChecklistSummary(matchedItems, unresolvedItems);
}

/**
 * Una lista vacia tiene dos causas distintas y hay que decir cual, porque «no sale nada» se lee
 * como «no hay nada que hacer»: o el filtro no encaja con ninguna fila, o encaja solo con filas ya
 * cerradas, que por definicion no tienen nada que resolver.
 */
function describeChecklistSummary(matchedItems, unresolvedItems) {
  if (unresolvedItems.length === 0) {
    if (matchedItems.length === 0) return "Ninguna tarea coincide con los filtros seleccionados.";
    return matchedItems.length === 1
      ? "La única tarea que coincide con el filtro ya está cerrada: no le queda nada que resolver."
      : `Las ${matchedItems.length} tareas que coinciden con el filtro ya están cerradas: no les queda nada que resolver.`;
  }

  const { done, total } = countChecklist(unresolvedItems);
  if (total === 0) return "No hay requisitos registrados.";
  return `${done} de ${total} requisitos resueltos en ${unresolvedItems.length} ${unresolvedItems.length === 1 ? "tarea" : "tareas"}.`;
}
/**
 * El bloque de reparto: con quien se puede trabajar a la vez y con quien no.
 *
 * Va detras de un guarda a proposito. El motor es el mismo que usa `Lista/`, cuyos datos no traen
 * este campo, y ahi tiene que seguir pintando exactamente lo de siempre.
 */
function renderParallelWork(item) {
  if (item.surface === undefined) return null;

  const container = createElement("div", undefined, "task-detail task-parallel");
  container.append(createElement("span", "Trabajo en paralelo", "detail-label"));

  if (item.surface === null) {
    container.append(
      createElement(
        "p",
        "Superficie sin declarar: no se puede afirmar que sea paralela a nada. Declara en " +
          "TASK_SURFACES los ficheros que va a escribir antes de repartirla.",
        "parallel-unknown",
      ),
    );
    return container;
  }

  const surface = createElement("p", undefined, "parallel-surface");
  surface.append(
    createElement("span", "Toca: ", "parallel-key"),
    document.createTextNode(item.surface.length === 0 ? "no toca codigo" : item.surface.join(" · ")),
  );
  container.append(surface);

  if (!item.ready) {
    const reason =
      item.blockedBy && item.blockedBy.length > 0
        ? `No se puede empezar todavia: depende de ${item.blockedBy.join(", ")}.`
        : "No se puede empezar todavia.";
    container.append(createElement("p", reason, "parallel-blocked"));
    // La interferencia se pinta igual: una fila que espera sigue compartiendo ficheros con otras, y
    // eso es lo que decide en que orden conviene cogerlas cuando se desbloquee.
    appendInterferenceLines(container, item);
    return container;
  }

  // Empezable y libre no son lo mismo: esta fila cumple las dos condiciones de `ready` y aun asi
  // ya tiene dueño. Decirlo antes de listar companeras evita que alguien la coja por segunda vez.
  if (item.active) {
    container.append(
      createElement(
        "p",
        "Ya la está haciendo alguien: no la cojas. Lo de abajo es con qué se puede repartir " +
          "mientras tanto.",
        "parallel-conflict",
      ),
    );
  }

  const partners = item.parallelWith || [];
  container.append(
    createElement(
      "p",
      partners.length > 0
        ? `Se puede hacer a la vez que: ${partners.join(", ")}.`
        : "Ninguna otra fila lista puede ir a la vez que esta.",
      "parallel-ready",
    ),
  );

  for (const conflict of item.conflicts || []) {
    container.append(
      createElement(
        "p",
        `Choca con ${conflict.id} en ${conflict.files.join(", ")}.`,
        "parallel-conflict",
      ),
    );
  }

  appendInterferenceLines(container, item);
  return container;
}

/**
 * El detalle de la insignia: fila a fila, con quien comparte ficheros y en que estado esta.
 *
 * Va aparte de «Choca con» porque responde a otra pregunta. «Choca con» solo mira filas listas, y
 * ahi no cabe la que hace dano de verdad: la que alguien ya empezo, que dejo de estar lista justo
 * al empezarla.
 */
function appendInterferenceLines(container, item) {
  const entries = item.interference || [];
  if (entries.length === 0) return;

  container.append(
    createElement("p", "Escriben sus mismos ficheros:", "parallel-key parallel-interference-key"),
  );
  for (const entry of entries) {
    container.append(
      createElement(
        "p",
        `${entry.id} (${INTERFERENCE_STATE_LABELS[entry.level] || entry.level}) en ${entry.files.join(", ")}.`,
        `parallel-interference ${INTERFERENCE_CLASSES[entry.level] || ""}`.trim(),
      ),
    );
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
  const parallelWork = renderParallelWork(item);
  details.append(detailGrid, evidence, implementationEvidence, references);
  if (parallelWork) details.append(parallelWork);

  const backlogBadge = createStatusBadge(item.status, "task-status");
  backlogBadge.textContent = `Backlog: ${STATUS_LABELS[item.status] || item.status}`;
  taskElement.append(header, checklist, description, backlogBadge);
  const interferenceBadge = createInterferenceBadge(item);
  if (interferenceBadge) taskElement.append(interferenceBadge);
  taskElement.append(details);
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
    renderResolutionBoard(resolutionList, currentFilters);
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
  isClosedStatus,
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
  renderParallelWork,
  describeInterference,
  interferenceLevel,
  INTERFERENCE_STATE_LABELS,
  renderResolutionBoard,
  describeChecklistSummary,
  setVisiblePhasesExpanded,
  renderProject,
  checklistProgress,
  countChecklist,
  RESOLUTION_NOTES,
  TASK_SURFACES,
};
