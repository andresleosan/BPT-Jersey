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
  T006V2: "Decisión D3 del operador, 2026-09-09.",
  T007V2:
    "Hoy un único corte de una hora (`packages/domain/src/schedule/schedule-contracts.ts:813`) gobierna a la vez el cierre de reservas, el de cancelaciones y la cancelación automática por quórum (`:984`). Las 12 h son un tercer concepto y hay que añadirlas aparte: mover el corte de una hora rompería el quórum.",
  T009V2: "Decisión D1 del operador, 2026-09-09.",
  T010V2:
    "Hoy `apps/web/src/content/academy.ts:154-168` lista a Miro, Eddie, Topo y Charlie. Cada entrada exige `credential`, y no tenemos la de los tres instructores nuevos. No se inventan grados ni cinturones.",
  T011V2:
    "El contenido tiene un único objeto de localización, Town Office (`academy.ts:48-53`), consumido como objeto único en la landing. `BPT West / Strive` solo existe como etiqueta de tarifa (`academy.ts:144`), sin domicilio.",
  T012V2:
    'Diagnosticado en producción el 2026-09-09, y la causa no era ninguna de las cuatro que la fila listaba. Cloud Run registra «Callable request verification passed» y acto seguido HTTP 403 en `getEnrolmentRequestDetail`, `listMembers`, `getMemberDetail` y `lookupMemberIdentity`, mientras `listEnrolmentRequests` responde 200 en la misma sesión. Lo que las separa es la puerta: las que fallan exigen, además del claim, un documento de personal aprovisionado en `academies/{academyId}/users/{uid}`. En producción la cuenta de `owner` lo tiene y pasa; la de `administrator` tiene claims válidos y ningún documento, y por eso la cola se pinta y ninguna fila se abre. Los botones no están inertes: «Approve and enrol» está `disabled` a propósito hasta que cargue el detalle, y «Send back to applicant» funciona pero exige escribir la nota. El único escritor de ese documento, `provisionAdminRole`, no está desplegado como callable.',
  T013V2:
    'El panel ya tiene un bloque "Today\'s classes" en `apps/web/src/app/admin/overview-page.tsx`; lo que falta es su posición y el detalle de las sesiones que quedan.',
  T015V2: "Open mat queda excluido por completo de esta regla.",
  T017V2:
    "El aviso de condición médica es dato de salud: gobierna quién puede leerlo, no solo cómo se muestra.",
  T018V2:
    "Hallazgo del 2026-09-09: `evaluateBookingEligibility` (`packages/domain/src/schedule/schedule-contracts.ts:911-953`) ya rechaza a quien no está `active` ni `trial`, es decir ya cubre `overdue`. Pero una búsqueda en `apps/` no encuentra ni una sola invocación: la regla existe en el dominio y no se aplica en ningún callable, así que hoy no bloquea a nadie.",
  T019V2:
    "Comprobado el 2026-09-09: no hay concepto de retirada ni de centro en `packages/domain/src/shop`. Es construcción nueva, no un ajuste.",
  T020V2:
    'Comprobado el 2026-09-09: la columna "Training center" ya existe en `apps/web/src/app/admin/members/page.tsx:37-41`, y `trainingCenter` es campo persistido con valores Town/West en `apps/functions/src/profiles/profile-service.ts`.',
  T021V2:
    "No se resuelve escribiendo código ni preguntando mejor: son datos que solo tiene el operador.",
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
      "DECISIÓN PENDIENTE DEL OPERADOR: si la cancelación tardía en West también genera propuesta y por qué importe; el fee actual es de GBP 15 y está limitado a Town.",
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
      "Aprovisionar en producción el documento de personal que falta para la cuenta de `administrator`, o decidir que se aprueba desde la cuenta de `owner`. DECISIÓN Y ESCRITURA PENDIENTES DEL OPERADOR: es producción y otorga escritura sobre el directorio canónico.",
    ),
    requirement(
      "Aprobar a un solicitante real de punta a punta. No se cierra con un mensaje de error mejor.",
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
      "Causa localizada en producción el 2026-09-09: falta el documento de personal aprovisionado de la cuenta de administrator, y sin él toda callable detrás de la puerta canónica responde 403. Corregido ya el mensaje ciego que lo ocultaba, con pruebas. Falta la escritura en producción, que espera al operador.",
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
