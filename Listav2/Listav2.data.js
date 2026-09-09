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
    'Decisión D3 del operador, 2026-09-09. Auditado el mismo día: reservar exige `studentId` y `membershipId`, y ninguno de los dos existe antes de la aprobación. `requireStudentScope` (`apps/functions/src/schedule/schedule-callables.ts:64-82`) rechaza a `shopper`, y el resolutor canónico busca al alumno en `academies/{id}/students` o en `relationships`, colecciones que solo escribe la ruta de aprobación. Entre `shopper` y `adultStudent`/`guardian` no hay estado intermedio: el claim salta de golpe. Invertir el orden no es mover una comprobación, es crear la identidad de alumno antes de aprobar o abrir una ruta de reserva propia para la clase de prueba.',
  T007V2:
    "Hoy un único corte de una hora gobierna a la vez el cierre de reservas, el de cancelaciones y la cancelación automática por quórum. Las 12 h son un tercer concepto y hay que añadirlas aparte: mover el corte de una hora rompería el quórum. Precisado el 2026-09-09: no es una constante, es el parámetro por defecto `cutoffMinutes = 60` de `isWithinBookingCutoff` (`schedule-contracts.ts:816`), y las tres llamadas pasan `60` a mano (`booking-transaction-service.ts:598` reservas, `:806` cancelación, `decideQuorumSweep` en `schedule-contracts.ts:1024`). Y el fee no está «limitado a Town» por costumbre: está clavado en el dominio. `noShowPenaltyLocationId = \"town\"` (`packages/domain/src/penalties/no-show-penalty-contracts.ts:14`) y `decideNoShowPenalty` devuelve `skipReason: \"otherSite\"` para cualquier otra sede. GBP 15 es `noShowPenaltyAmountMinor = 1_500`. La propuesta no la genera nada automático: es el callable `proposeNoShowPenalties({ sessionId })`, que un miembro del personal ejecuta sesión por sesión.",
  T009V2:
    'Decisión D1 del operador, 2026-09-09. Auditado el mismo día: hoy un menor no tiene cuenta de ninguna clase. `buildMinorStudent` (`apps/functions/src/families/family-service.ts:718-757`) nunca escribe `userId`, aunque el campo existe como opcional en `StudentProfile`, así que el enganche a una cuenta ya está previsto en el contrato. Los roles de cliente son solo `shopper`, `guardian` y `adultStudent`: haría falta uno nuevo. El único umbral de edad del dominio es 18, en línea dentro de `deriveParticipantType` (`packages/domain/src/profiles/profile-contracts.ts:300-319`); no hay 16 en ninguna parte. La DPIA es un borrador sin aprobar (`docs/operations/t011-dpia-draft.md`) y el calendario de retención (`t011-retention-residency-erasure-policy.md`, tabla en las líneas 99-112) advierte en su línea 7 de que ningún plazo está implementado: hoy el sistema no borra nada al vencer.',
  T010V2:
    "Hoy `apps/web/src/content/academy.ts:154-168` lista a Miro, Eddie, Topo y Charlie. Cada entrada exige `credential`, y no tenemos la de los tres instructores nuevos. No se inventan grados ni cinturones.",
  T011V2:
    "El contenido tiene un único objeto de localización, Town Office (`academy.ts:48-53`), consumido como objeto único en la landing. `BPT West / Strive` solo existe como etiqueta de tarifa (`academy.ts:144`), sin domicilio.",
  T012V2:
    'Diagnosticado en producción el 2026-09-09, y la causa no era ninguna de las cuatro que la fila listaba. Cloud Run registra «Callable request verification passed» y acto seguido HTTP 403 en `getEnrolmentRequestDetail`, `listMembers`, `getMemberDetail` y `lookupMemberIdentity`, mientras `listEnrolmentRequests` responde 200 en la misma sesión. Lo que las separa es la puerta: las que fallan exigen, además del claim, un documento de personal aprovisionado en `academies/{academyId}/users/{uid}`. En producción la cuenta de `owner` lo tiene y pasa; la de `administrator` tiene claims válidos y ningún documento, y por eso la cola se pinta y ninguna fila se abre. Los botones no están inertes: «Approve and enrol» está `disabled` a propósito hasta que cargue el detalle, y «Send back to applicant» funciona pero exige escribir la nota. El único escritor de ese documento, `provisionAdminRole`, no está desplegado como callable. Decidido por el operador el 2026-09-09 (D5): se aprueba desde la cuenta de `owner` y no se escribe nada en producción. Teclear el documento a mano lo haría válido para la puerta y no dejaría rastro de quién concedió ese poder, porque `provisionAdminRole` lo escribe en la misma transacción que toma el cerrojo de rol y emite `admin.role.granted`; y el esquema es un `z.strictObject` de catorce campos, con dos `Timestamp` reales, donde un campo de más o de menos deja el 403 intacto. La cuenta de `administrator` queda inservible para el directorio canónico a propósito, y esa limitación la levanta T022V2 (D6).',
  T013V2:
    'El panel ya tiene un bloque "Today\'s classes" en `apps/web/src/app/admin/overview-page.tsx`; lo que falta es su posición y el detalle de las sesiones que quedan.',
  T015V2:
    'Open mat queda excluido por completo de esta regla. Hallazgo del 2026-09-09 que cambia lo que cuesta la fila: **hoy la exclusión no se puede ni expresar**. `SessionRecord` (`packages/domain/src/schedule/schedule-contracts.ts:165`) no tiene tipo de sesión; el vocabulario `sessionTypes = ["class", "openMat"]` vive solo en el dominio de planes (`packages/domain/src/memberships/plan-contracts.ts:27`) y no llega a la sesión. Segundo hallazgo: **no existe ningún barrido programado**. Las dos únicas funciones `onSchedule` del proyecto limpian sesiones de importación de miembros, y hasta el barrido de quórum es el callable manual `reconcileSessionQuorum`. Tercero: la asistencia no es un campo de la reserva, es un registro aparte con su propio vocabulario (`attendanceStates`, `schedule-contracts.ts:1039`) frente a `bookingStatuses = ["requested", "confirmed", "cancelled"]` (`:752`), y `no_show` ya existe ahí.',
  T017V2:
    "El aviso de condición médica es dato de salud: gobierna quién puede leerlo, no solo cómo se muestra.",
  T018V2:
    "Hallazgo del 2026-09-09: `evaluateBookingEligibility` (`packages/domain/src/schedule/schedule-contracts.ts:911-953`) ya rechaza a quien no está `active` ni `trial`, es decir ya cubre `overdue`. Pero una búsqueda en `apps/` no encuentra ni una sola invocación: la regla existe en el dominio y no se aplica en ningún callable, así que hoy no bloquea a nadie.",
  T019V2:
    'Comprobado el 2026-09-09: no hay concepto de retirada ni de centro en `packages/domain/src/shop`. Es construcción nueva, no un ajuste. Ampliado el mismo día: el pedido tampoco tiene referencia de pago, porque no hay pago online -`shopPaymentMethodNote` dice que se cobra en la academia al retirar-, así que «etiquetar el pago» no es añadir un campo a algo que ya existe. Del lado de finanzas, `invoiceReference` no se genera: lo teclea la oficina en el formulario de facturación y solo se valida y se usa como clave de idempotencia. Y «centro» está dicho de ocho maneras distintas en el repositorio, con dos mayúsculas incompatibles: `locationIds = ["town", "west"]` en horarios frente a `siteValues`, `trainingCenters` y `upcomingBirthdayTrainingCenters` en `["Town", "West"]`, más literales en línea en familias y en el informe operativo, más el `trainingCenter` de texto libre de la importación de Regyfit. Ya hay una traducción a mano entre las dos (`booking-transaction-service.ts:679`). Etiquetar pagos por centro sin unificar antes ese vocabulario reparte el problema en vez de resolverlo.',
  T020V2:
    'Comprobado el 2026-09-09: la columna "Training center" ya existe en `apps/web/src/app/admin/members/page.tsx:37-41`, y `trainingCenter` es campo persistido con valores Town/West en `apps/functions/src/profiles/profile-service.ts`.',
  T021V2:
    "No se resuelve escribiendo código ni preguntando mejor: son datos que solo tiene el operador.",
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
      "Decidir de dónde sale la identidad de alumno con la que se reserva antes de aprobar: un registro de alumno provisional, o una ruta de reserva propia para la clase de prueba que no exija `studentId` ni `membershipId`.",
    ),
    requirement("Invertir el orden actual, en el que la aprobación precede a cualquier reserva."),
    requirement(
      "Crear el estado «pendiente con reserva»: ve su reserva y no puede reservar una segunda clase.",
    ),
    requirement(
      "Aplicar esa restricción en reglas y callables, no solo en la interfaz: una restricción solo de cliente no restringe nada.",
    ),
    requirement("Disparar el aviso al administrador en el momento de la reserva."),
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
      "Añadir las 12 h como corte propio de cancelación sin coste, sin mover el corte de reservas ni el de quórum.",
    ),
    requirement("Emitir la propuesta de penalización al cancelar dentro de las 12 h."),
    requirement(
      "DECISIÓN PENDIENTE DEL OPERADOR: si la cancelación tardía en West también genera propuesta y por qué importe. El fee no está limitado a Town por costumbre: `noShowPenaltyLocationId` lo clava en el dominio y West sale por `skipReason: otherSite`, así que incluirla es cambiar esa regla, no configurarla.",
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
      "Crear el rol de cliente que hoy no existe: los únicos son `shopper`, `guardian` y `adultStudent`, y enganchar la cuenta al `userId` que `StudentProfile` ya prevé y que `buildMinorStudent` nunca escribe.",
    ),
    requirement(
      "Permitir al representante añadir correo o teléfono al hijo, y que el menor inicie sesión con eso.",
    ),
    requirement(
      "Alcance recortado: progreso, próximas clases, reservar y marcar asistencia. Nunca pagos, waiver, ficha del representante ni datos de otros miembros.",
    ),
    requirement(
      "El representante conserva la titularidad económica y legal y puede revocar el acceso.",
    ),
    requirement(
      "Actualizar la DPIA y el registro de retención de T011: es tratamiento de datos de menores nuevo.",
    ),
    requirement(
      "Reglas de Firestore que nieguen por defecto todo lo que quede fuera del alcance recortado.",
    ),
    requirement(
      "DECISIÓN PENDIENTE DEL OPERADOR: si hay edad mínima para que un menor tenga cuenta propia.",
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
      "Dar tipo a la sesión: hoy `SessionRecord` no distingue una clase de un open mat, así que la exclusión que pide la fila no se puede ni escribir.",
    ),
    requirement(
      "Elegir cómo vence el contador sin barrido programado: el proyecto no tiene ninguno, ni siquiera para el quórum. O se añade una función `onSchedule`, o el vencimiento se evalúa en lectura por hora de sesión.",
    ),
    requirement(
      "Contador de 20 minutos desde el inicio de la clase: sin marcaje al vencer, se pierde la clase.",
    ),
    requirement(
      "El vencimiento lo decide el servidor por hora de sesión, no un temporizador de navegador que se pierde al cerrar la pestaña.",
    ),
    requirement("Excluir open mat por completo."),
    requirement(
      "DECISIÓN PENDIENTE DEL OPERADOR: si la pérdida automática emite propuesta de fee igual que una cancelación tardía, o solo libera la plaza.",
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
      "Unificar el vocabulario de centro antes de etiquetar nada: hoy se dice de ocho maneras y con dos mayúsculas incompatibles, ya traducidas a mano en la ruta de reserva.",
    ),
    requirement("Etiquetar cada pago con el centro al que pertenece, en su referencia."),
    requirement(
      "Permitir elegir centro de retirada al comprar merchandising, y que esa elección etiquete el pago.",
    ),
    requirement(
      "DECISIÓN PENDIENTE DEL OPERADOR: si la etiqueta de un pago de suscripción sale del `trainingCenter` del miembro o se elige en cada cobro.",
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
      "Causa localizada en producción el 2026-09-09, y decidida el mismo día: se aprueba desde la cuenta de owner, que ya pasa la puerta, y no se escribe nada en producción. Corregido ya el mensaje ciego que lo ocultaba, con pruebas. Falta aprobar a un solicitante real desde owner, que es una acción en la sesión del operador.",
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
    "-",
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
    "-",
    "Verificado que no existe hoy: no hay concepto de retirada ni de centro en el dominio de tienda. Es construcción nueva, no ajuste.",
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
    "Interrogar la fila con /grill-me antes de escribir código cuando tenga decisiones abiertas: T006V2, T007V2, T009V2, T015V2 y T019V2.",
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
