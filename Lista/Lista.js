const VALID_STATUSES = [
  "aprobada",
  "revision",
  "en-progreso",
  "pendiente",
  "bloqueada",
  "cancelada",
];

const statusEvidence = {
  approved: "Estado aprobado en tasks.md.",
  review: "Implementado o verificado; queda pendiente de aprobación explícita.",
  "en-progreso":
    "Trabajo iniciado; la reconciliación o verificación indicada todavía está pendiente.",
  pending: "Trabajo pendiente o sin evidencia suficiente para aprobarlo.",
  blocked: "No puede avanzar hasta resolver la decisión o dependencia indicada.",
  cancelled: "Cancelada en tasks.md y sustituida por una decisión posterior.",
};

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

const RESOLUTION_REQUIREMENTS = {
  T127: [
    "Decidir si la firma presencial en papel sigue teniendo sentido ahora que la inscripcion digital de T121 recoge la aceptacion, o si el alta administrativa debe apoyarse en esa misma aceptacion. Es una decision de producto.",
    "Sacar consent-callables del gate BPT_SYNTHETIC_PILOT con un gate de produccion real: es tambien una de las decisiones de T058 (runbook 3.2), asi que se resuelve alli.",
    "Aportar credenciales R2 reales para la evidencia PDF; siguen siendo placeholders desde T104. Compartido con T058.",
    "Con esas tres, implementar el paso 2 segun docs/operations/t106-waiver-enrolment-integration-analysis.md, que sigue vigente y no hay que rehacer.",
  ],
  T126: [
    "Resuelta el 2026-09-07: el operador aporto el domicilio, Office 9, 13 Library Place, St Helier -la misma direccion que la sede Town-, y despues la forma exacta, sole trader.",
    "Consecuencia aplicada, no anotada: un sole trader es una persona fisica, asi que el controller no es una entidad. Los tres documentos pasan a nombrar a Vladimiro Afonso trading as Brazilian Power Team - Jersey.",
    "Actualizados la politica de retencion (celda del controller y criterios de cierre), la DPIA (cabecera y seccion 6, punto 2) y el acta (tabla de identidad y seccion 6). El bloque de firma del acta no se reescribio: cambio la descripcion de la parte firmada, no quien firmo ni cuando.",
    "Lo que desbloquea: contratos de encargado, polizas y el texto legal publicado de T117. No bloquea ninguna release.",
  ],
  T125: [
    "Resuelta el 2026-09-07: el operador conserva el campo tal cual y acepta el riesgo por escrito, porque son datos reales que la operacion usa y el administrador ya tiene permiso de uso.",
    "Lo que la aceptacion no cambia: siguen ausentes los cuatro controles del directorio canonico -proposito declarado, auditoria por lectura, limite por actor y sonda de vitalidad-, asi que una lectura de contrasena no deja rastro.",
    "Registrada en la seccion 3.1 del acta de T011, firmada ese mismo 2026-09-07 por poder (Andres Santiago, p.p. Vladimiro Afonso) por instruccion del operador: decision fechada y atribuida, con la atestacion por poder a la vista. El riesgo residual de la DPIA sigue siendo alto.",
  ],
  T010: [
    "Elegir expl\u00edcitamente un proveedor compatible con la forma real de la entidad, declarada no incorporada el 2026-09-07 (sole trader / asociacion sin registrar), no con una entidad incorporada como supon\u00eda este requisito.",
    "Completar onboarding, t\u00e9rminos, tarifas, monedas, disponibilidad regional y revisi\u00f3n legal.",
    "Definir presupuesto, l\u00edmites, alertas de gasto y custodia de credenciales sin almacenar tarjetas.",
    "Validar el adaptador en un entorno aislado con credenciales de prueba y documentar rollback.",
  ],
  T011: [
    "Hecho 2026-09-06: controller, owner y contacto designados; revisor independiente y registro JOIC retirados por decision del operador.",
    "Hecho 2026-09-06: DPIA redactada, con riesgo residual declarado alto que la firma no baja.",
    "Hecho 2026-09-07: las diez decisiones, la D11 y los doce plazos firmados por poder (Andres Santiago, p.p. Vladimiro Afonso).",
    "Hecho 2026-09-07: el operador declara la entidad no incorporada ni registrada (sole trader / asociacion sin registrar); con eso la forma juridica queda declarada y el numero de registro se cierra por inexistencia, no en blanco.",
    "Cerrada 2026-09-07 por instruccion del operador: no queda ninguna decision pendiente en esta fila. El dato que faltaba -domicilio y forma exacta- pasa a T126, que es donde bloquea de verdad: contratos de encargado, polizas y el texto legal de T117.",
    "Lo que el cierre no hace: los doce plazos de retencion siguen sin existir en el sistema, y el riesgo residual de la DPIA sigue alto.",
  ],
  T017: [
    "Mantener la cancelaci\u00f3n: no implementar MFA obligatorio dentro de esta tarea sustituida.",
    "Conservar como referencia el redise\u00f1o administrativo aprobado que reemplaza este requisito.",
    "Abrir una tarea nueva \u00fanicamente si aparece un requisito de seguridad distinto y aprobado.",
  ],
  T035: [
    "Resolver primero T010 y obtener proveedor, t\u00e9rminos, presupuesto y credenciales de prueba.",
    "Implementar checkout alojado y suscripciones detr\u00e1s del adaptador independiente del proveedor.",
    "Cubrir alta, renovaci\u00f3n, fallo, cancelaci\u00f3n, reintento e idempotencia sin guardar datos de tarjeta.",
    "Validar en Emulator/staging aislado con rollback y autorizaci\u00f3n expl\u00edcita antes de cobrar.",
  ],
  T036: [
    "Completar T035 y definir el contrato de eventos de pago aceptado por el adaptador.",
    "Verificar firma, timestamp, replay, idempotencia y payload divergente con fallo cerrado.",
    "Configurar secretos \u00fanicamente en el entorno aislado y probar rotaci\u00f3n sin exponerlos en logs.",
    "Ejecutar integraci\u00f3n y E2E con eventos sint\u00e9ticos antes de cualquier endpoint productivo.",
  ],
  T057: [
    "Cerrar T011 y documentar retenci\u00f3n, residencia, eliminaci\u00f3n y sus responsables.",
    "Crear y validar staging separado con datos sint\u00e9ticos, proyecto y alias sin acceso productivo.",
    "Definir costos, presupuesto, alertas, monitoreo, CD protegido y procedimiento de rollback.",
    "Ejecutar el checklist completo y obtener el checkpoint del operador antes de abrir T058.",
  ],
  T058: [
    "Autorizacion explicita del operador para esta release nombrando las 35 callables del primer lote: es la precondicion 4.0(1) del runbook y el propio runbook dice que 'ya se probo antes' no la sustituye. Es lo unico que falta del lado del codigo.",
    "Ventana fuera del horario de clases de Town y West, con aviso previo a office y coaches y el operador disponible la hora siguiente para la verificacion en navegador sobre bptjersey.pages.dev.",
    "Crear las cinco alertas del runbook 6.1 (presupuesto, 5xx en Cloud Run, fallos de Cloud Scheduler, uptime y canal de correo): exigen roles de facturacion y monitorizacion que el repositorio no tiene.",
    "Retirar las dos huerfanas (searchMembers, getMemberReportSummary) y listRegyfitAccessRecords en su paso propio del 4.3; nunca desplegar con --only functions sin nombres mientras existan.",
    "Despues de la release: registrar hash completo, functions:list posterior y la fila de release del ledger, y volver a medir el delta para los lotes siguientes (consentimientos, salud y export siguen fuera mientras BPT_SYNTHETIC_PILOT no se lleve, y todo lo de R2 mientras no haya credenciales reales).",
  ],
  T059: [
    "Completar T058 y conservar evidencia del release y del rollback ensayado.",
    "Ejecutar an\u00e1lisis de brechas, registrar riesgos residuales y crear o actualizar LECCIONES.md.",
    "Reconciliar tasks.md, Lista/ y documentaci\u00f3n final; dejar todas las dependencias cerradas.",
    "Registrar el checkpoint de cierre del proyecto sin ocultar pendientes ni riesgos.",
  ],
  T060: [
    "Definir y aprobar reglas de promociones, cr\u00e9ditos, recurrencia, expiraci\u00f3n y cancelaci\u00f3n.",
    "Implementar scheduler y workflows de ofertas FIFO, expiraci\u00f3n y reordenamiento con auditor\u00eda.",
    "Completar cr\u00e9ditos, reservas recurrentes y conflictos con capacidad y bookings existentes.",
    "Integrar pagos y mensajes solo con proveedores autorizados, l\u00edmites de costo y E2E aislada.",
  ],
  T061: [
    "Cerrar T010, T034 y T035 antes de ampliar el ciclo de facturaci\u00f3n.",
    "Definir reglas de reintentos, per\u00edodos de gracia, prorrateo, promociones, pausa y cancelaci\u00f3n.",
    "Conectar el adaptador al runtime con idempotencia y rechazo de payload divergente.",
    "Cubrir escenarios financieros, auditor\u00eda, seguridad, costos y rollback en Emulator/staging.",
  ],
  T062: [
    "Conectar el productor al runtime mediante endpoint, trigger o scheduler con l\u00edmites expl\u00edcitos.",
    "Completar bandeja y acciones CRM tenant-scoped con permisos, auditor\u00eda e idempotencia.",
    "Resolver studentReference, retenci\u00f3n y pol\u00edtica T011 antes de usar datos reales.",
    "A\u00f1adir Rules, Emulator, E2E y operaci\u00f3n de reintentos; no activar mensajes externos sin proveedor.",
  ],
  T063: [
    "Definir y aprobar el modelo de tutor secundario, vigencia, revocaci\u00f3n y contacto principal.",
    "Definir y aprobar si se habilita checkout adulto y bajo qu\u00e9 l\u00edmites de identidad y riesgo.",
    "Implementar guards, Rules, auditor\u00eda y UI correspondientes con pruebas negativas.",
    "Ejecutar E2E autenticada desktop/m\u00f3vil y registrar el checkpoint de producto.",
  ],
  T064: [
    "Seleccionar y autorizar proveedor, canales, contactos, presupuesto, l\u00edmites y alertas de costo.",
    "Completar la UI de preferencias y consentimiento con estados explicables y acceso RBAC.",
    "Conectar runtime, reintentos, idempotencia y entrega externa sin guardar mensajes o secretos sensibles.",
    "Ejecutar E2E autenticada con proveedor de prueba y registrar el checkpoint de producto.",
  ],
  T065: [
    "Definir la pol\u00edtica aprobada para resolver conflictos sin sobrescribir silenciosamente asistencia.",
    "Implementar sincronizaci\u00f3n autenticada con Firestore transaccional, idempotencia y l\u00edmites de dispositivo.",
    "A\u00f1adir Rules y pruebas Firestore Emulator para tenant, usuario, sesi\u00f3n y payload divergente.",
    "Ejecutar E2E real desktop/m\u00f3vil y validar el adaptador de almacenamiento del dispositivo elegido.",
  ],
  T066: [
    "Recibir y versionar contenido t\u00e9cnico definitivo en ingl\u00e9s desde una fuente aprobada.",
    "Revisar t\u00e9cnicas, requisitos, progresiones y permisos con el coach responsable.",
    "Cargar \u00fanicamente contenido validado y repetir persistencia, auditor\u00eda, UI y E2E.",
    "Registrar el checkpoint de producto; el contenido sint\u00e9tico no puede cerrar esta tarea.",
  ],
  T067: [
    "Conectar logros y res\u00famenes con la fuente can\u00f3nica real de progreso y asistencia.",
    "Implementar runner/scheduler determinista con replay, l\u00edmites, auditor\u00eda y fallo cerrado.",
    "Validar privacidad, visibilidad familiar, opt-in y ausencia de leaderboard infantil p\u00fablico.",
    "Ejecutar E2E con datos sint\u00e9ticos representativos y registrar el checkpoint de producto.",
  ],
  T090: [
    "Publicar el PDF oficial como asset inmutable y verificar que web y Functions conservan el mismo SHA-256.",
    "Mostrar el documento exacto en el paso de inscripcion y exigir la confirmacion de lectura, decisiones requeridas y nombre autenticado.",
    "Generar evidencia privada con las paginas originales del PDF y el registro de firma server-side; no sustituir el texto legal.",
    "Ejecutar pruebas focales, build del runtime y QA responsive antes de cerrar la tarea; no desplegar ni usar datos reales.",
  ],
  T068: [
    "Decidir si se necesita cliente nativo y seleccionar plataforma, alcance y fecha objetivo.",
    "Definir arquitectura, autenticaci\u00f3n, almacenamiento offline, privacidad y soporte de dispositivos.",
    "Implementar el cliente con paridad m\u00ednima, pruebas en dispositivos/CI y plan de distribuci\u00f3n.",
    "Obtener checkpoint de producto antes de mantener dos superficies operativas.",
  ],
  T069: [
    "Definir pol\u00edtica de moderaci\u00f3n, safeguarding, reportes, apelaciones y tiempos de respuesta.",
    "Definir roles, permisos, retenci\u00f3n, auditor\u00eda y controles de contenido generado por usuarios.",
    "Implementar el flujo m\u00ednimo y probar abuso, privacidad, accesibilidad y borrado controlado.",
    "Validar el modelo con el operador antes de activar comunidad o notificaciones.",
  ],
  T070: [
    "Separar referidos, clases privadas, competiciones y tienda en tareas con alcance independiente.",
    "Definir oferta, capacidad, pagos, reembolsos, elegibilidad y reglas comerciales de cada slice.",
    "Resolver dependencias de proveedor, costos, fraude, inventario y operaci\u00f3n.",
    "Implementar y probar cada slice solo despu\u00e9s del checkpoint de producto correspondiente.",
  ],
  T071: [
    "Definir objetivos de negocio, m\u00e9tricas, l\u00edmites de costo y se\u00f1ales de estabilidad del producto central.",
    "Resolver arquitectura de multiacademia, privacidad, segregaci\u00f3n tenant y estrategia de datos.",
    "Decidir el alcance de IA, proveedores, revisi\u00f3n humana, observabilidad y controles de seguridad.",
    "Implementar por etapas con pruebas de carga, contratos, migraci\u00f3n reversible y checkpoint ejecutivo.",
  ],
  T092: [
    "Definir una sola identidad can\u00f3nica de participante y las invariantes entre usuario, familia y estudiante.",
    "Documentar en un ADR la compatibilidad temporal de members y students, sin dual-write silencioso.",
    "Dise\u00f1ar dry-run, reconciliaci\u00f3n, cuarentena y rollback antes de cualquier backfill.",
    "Definir la matriz RED de colisi\u00f3n, tenant, privacidad, referencias, concurrencia y replays que T093 debe ejecutar.",
  ],
  T093: [
    "Conectar alta, listado e importaci\u00f3n administrativa a la identidad can\u00f3nica.",
    "Crear relaciones de familia y estudiante de forma at\u00f3mica o fallar sin escrituras parciales.",
    "Conservar procedencia, idempotencia y cuarentena de registros ambiguos sin exponer PII.",
    "Validar la convergencia en Firebase Emulator; no ejecutar backfill productivo.",
    "Escribir y ejecutar primero los RED definidos por T092, incluidos ID/VAT fuera de listados y exports generales.",
  ],
  T094: [
    "Cerrar el onboarding autenticado de adulto/tutor, perfil, familia y waiver oficial.",
    "Mantener salud y documentos privados fail-closed fuera de entornos expresamente permitidos.",
    "Cubrir autorizaci\u00f3n, consentimiento versionado, reintentos e idempotencia con pruebas negativas.",
    "Resolver T011 antes de datos reales o producci\u00f3n.",
  ],
  T095: [
    "Publicar UI operativa para planes, memberships, deuda PAYG, facturas y pagos manuales.",
    "Eliminar IDs fijos y cargar opciones desde contratos/callables can\u00f3nicos.",
    "Mantener checkout, tarjetas y proveedor externo fuera del MVP.",
    "Verificar persistencia, auditor\u00eda, errores y accesibilidad en desktop/m\u00f3vil.",
  ],
  T096: [
    "Publicar calendario y UI para crear clases, reservar, cancelar y aplicar el corte de una hora.",
    "Habilitar roster y check-in/out por QR, PIN y manual con overrides auditados.",
    "Usar sedes, programas, coaches y participantes can\u00f3nicos en vez de defaults hardcodeados.",
    "Probar quorum, capacidad, no-show, puntualidad y aislamiento por rol en Emulator.",
  ],
  T097: [
    "Conectar progreso propio/familiar, evaluaciones y propuestas de promoci\u00f3n a datos can\u00f3nicos.",
    "Mantener aprobaci\u00f3n humana de belts/stripes y excluir comparaci\u00f3n infantil.",
    "Conectar dashboards y reportes sin fallback sint\u00e9tico ni IDs sensibles.",
    "Verificar autorizaci\u00f3n, exactitud agregada y auditor\u00eda de correcciones.",
  ],
  T098: [
    "Corregir las expectativas obsoletas del gate solo cuando reproduzcan el contrato actual.",
    "Automatizar el golden path con Auth, Functions y Firestore Emulator reales.",
    "Ejecutar desktop/m\u00f3vil, Rules, contratos, carga, seguridad y cleanup con cero fallos del alcance.",
    "Registrar evidencia fresca; ninguna omisi\u00f3n del golden path puede contarse como aprobada.",
  ],
  T099: [
    "Hecho 2026-09-07: enmienda al contrato de T057, runbook de release y rollback, baseline reconstruible e inventario real de produccion, delta corregido y reproducible con scripts/release-delta.mjs.",
    "Hecho 2026-09-07: Rules 92/92 y golden path 19/19 sobre el commit 51918ad, mas revision adversarial de cuatro lentes con sus 17 hallazgos confirmados incorporados.",
    "Aprobada por el operador el 2026-09-07. Repetir Rules y golden path sobre el commit exacto que se despliegue es precondicion del runbook, no de esta fila.",
  ],
  T100: [
    "Vincular target=emulator al projectId demo y a hosts loopback exactos antes de inicializar Firebase.",
    "Mantener staging cerrado hasta que un projectId exacto entre en una allowlist positiva aprobada.",
    "Negar el projectId productivo por argumento, GCLOUD_PROJECT y FIREBASE_CONFIG antes de todo I/O.",
    "Probar seed y rollback con destinos cruzados, faltantes y host remoto antes de restaurar el avance.",
  ],
  T107: [
    "Borrar el archivo local sin trackear tras confirmar que ningun modulo lo importa.",
    "Reescribir el historial de main con git filter-repo y coordinar force-push y re-clonado.",
    "Verificar que origin ya no contiene el blob y registrar la evidencia en tasks.md.",
    "Valorar la notificacion de la exposicion conforme a la politica de T011.",
  ],
  T109: [
    "Declarar las coordenadas de cada sede como configuracion administrativa auditada, con el radio fijo de 50 m del BRIEF y sin guardar coordenadas de personas.",
    "Anadir la senal de proximidad al contrato de check-in y al registro de asistencia como senal, no como prueba.",
    "Exigir motivo y auditoria cuando la medicion situa el check-in fuera del radio; una medicion ausente o inutilizable se registra como unavailable sin bloquear.",
    "Declarar en la evidencia que el auto check-in del alumno sigue cerrado por el contrato de T028.",
  ],
  T110: [
    "Encadenar el calculo de quorum con la cancelacion de la sesion en una tarea idempotente y auditada.",
    "Emitir el aviso in-app a los reservados, derivado de la sesion cancelada y sin email ni SMS.",
    "Respetar el minimo elevado por owner o head coach y el corte de una hora antes.",
    "Probar en Emulator el replay de la tarea, la sesion que si alcanza quorum y la que ya estaba cancelada.",
  ],
  T111: [
    "Modelar el cargo de 15 GBP por no-show de Town como penalizacion manual auditable.",
    "Ofrecer a office una cola de resolucion con motivo, autor y momento en cada decision.",
    "Vincular la penalizacion cobrada con la factura manual que office emite en Billing (T095).",
    "Cerrar el E2E autenticado en Emulator del ciclo completo con negativos de rol y Rules.",
  ],
  T112: [
    "Derivar los cumpleanos del dateOfBirth canonico de los alumnos activos, no de datos inventados.",
    "Limitar el alcance por rol y no exponer la fecha completa a quien no la necesita.",
    "Probar la vista con alumnos sin fecha, con fecha del dia y con familia inactiva.",
  ],
  T113: [
    "Aplicar las franjas de edad del catalogo IBJJF al filtrar candidatos y propuestas.",
    "Mantener que belts y stripes nunca se otorgan automaticamente: la regla solo propone.",
    "Probar el borde de cada franja y el alumno cuya edad cambia de franja entre evaluaciones.",
  ],
  T114: [
    "Publicar una vista preclase para el coach con los asistentes probables de la sesion.",
    "Derivar la sugerencia de reservas y asistencia canonicas, sin inventar nombres ni rachas.",
    "Probar autorizacion por rol, sesion sin reservas y sesion ya cerrada.",
  ],
  T115: [
    "Separar la etiqueta corta de 25 caracteres de la nota clinica completa en el contrato.",
    "Validar el limite en dominio, callable y formulario, con el mismo mensaje seguro.",
    "Probar el limite exacto, el exceso y la migracion de las condiciones ya guardadas.",
  ],
  T116: [
    "Modelar la concesion de permisos administrativos a un coach como documento revocable y auditado.",
    "Mantener el fail-closed por rol: la concesion no amplia el claim ni sustituye la verificacion.",
    "Probar concesion, uso, revocacion y expiracion, y que sin concesion el coach sigue denegado.",
  ],
  T117: [
    "Modelar disclaimers versionados con aceptacion registrada por participante.",
    "Reutilizar el mecanismo de evidencia y auditoria del waiver de T090 en vez de duplicarlo.",
    "Esperar el texto legal aprobado (T011) antes de publicar cualquier version real.",
  ],
  T108: [
    "T099 aprobada y T011 firmada el 2026-09-07: ninguna de las dos bloquea ya. Sin staging separado, el ensayo es el Emulator y la ejecucion real entra por la release de T058 con backup verificado y confirmacion separada.",
    "Escribir los seis ejecutores que faltan del runbook member-directory-v1: forward, compensacion, rollback-projection, rollback-readonly, canonical-recovery e identity-reconcile. El de bootstrap existe desde el 2026-09-07, con su ensayo en Emulator.",
    "Anadir el documento de operacion padre y sus transiciones (frozen -> applying en el primer chunk comprometido, applying -> verified y verified -> completed), que hoy no existe como contrato, mas el plan privado congelado con su dry-run y la cuarentena.",
    "Acunar y consumir aprobaciones con lease, deadline y handoff de source; sin dual-write silencioso.",
    "Reabrir y poner en verde los 18 requisitos RED heredados de T093 con dry-run, cuarentena y rollback en Emulator, y backup verificado antes de produccion.",
  ],
  T104: [
    "Configurar NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY en Cloudflare Pages y relanzar el despliegue.",
    "Verificar en produccion que /admin/members/search carga los 249 registros y abre fichas.",
    "Comprobar que el resto de pantallas admin dependientes de Functions operan con App Check activo.",
    "Sustituir los cinco secretos placeholder antes de desplegar R2 o el directorio canonico.",
  ],
  T106: [
    "Paso 1 (hecho): capturar contacto de emergencia y direccion como bloques Confidential opcionales y completos.",
    "Decidir si la firma presencial en papel (recordWitnessedWaiver, in_person_witnessed) sigue teniendo sentido ahora que la inscripcion digital de T121 recoge la aceptacion del waiver del club.",
    "Sacar consent-callables del gate BPT_SYNTHETIC_PILOT con un gate de produccion real y publicar la version oficial del waiver; T011 firmada para datos reales.",
    "Credenciales R2 reales para la evidencia PDF; despues, exigir tutor vinculado para menores y permitir renovacion digital desde /account/waiver.",
  ],
  T101: [
    "Publicar el catalogo de Levels de forma atomica o mediante estados verificables con manifest completo.",
    "Rechazar como idempotente cualquier replay con hijos ausentes, alterados o conteos divergentes.",
    "Fijar los hashes aprobados y resolver las fuentes desde una ruta inmutable, no desde el CWD.",
    "Permitir rollback solo con operacion identificada, cero referencias y auditoria; mantener staging bloqueado.",
  ],
};
const IMPLEMENTATION_OVERRIDES = {
  T014: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Google emulator-native y gateway sin MFA verificados: focused 40/40, Auth Emulator 2/2, unitarias 442/442, E2E 8/8 y estabilidad 40/40.",
  },
  T015: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Contrato estricto para seis roles, narrowing owner/admin, pruebas negativas y gates globales aprobados sin ampliar provisioning.",
  },
  T016: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Evaluador fail-closed, actor de seis roles, matriz Firebase 16/16, unitarias 464/464 y packaging desplegable verificados.",
  },
  T019: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Contrato discriminado, adapter create-only y los tres writers migrados; focused 101/101, integración Firestore Emulator 8/8, typecheck y packaging portable aprobados.",
  },
  T020: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Shell responsive, navegación por rol y QA de teclado/móvil documentados; falta aprobación formal.",
  },
  T020A: {
    implementationStatus: "verificada",
    implementationEvidence: "Logo, favicon, Home, responsive y QA documentados.",
  },
  T021: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Domain 7/7, store 3/3, callables 4/4, web client/UI 12/12, suite 500/500, Rules 16/16, Firestore Emulator 8/8, lint/typecheck/build/formato, smoke E2E 5/5 y seguridad sin críticos.",
  },
  T022: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-6 verificadas: suite 533/533, Rules 23/23, lint/typecheck/build/formato/diff, domain 24/24, store 8/8, callables/deploy 18/18, Emulator 9/9, RTL 17/17 y E2E 2/2; pendiente aprobación formal.",
  },
  T023: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Implementación técnica verificada para el piloto sintético: unitarias 133 archivos/976 pruebas, Rules 4/4, integración Firestore Emulator 1/1, UI guardian/administrativa, typecheck, lint y formato; producción bloqueada por T011 y BPT_SYNTHETIC_PILOT.",
  },
  T032: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-6 verificadas: suite 572/572; Rules 30/30; domain 11/11 y regresión 98/98; store 15/15; runtime 2/2; callables 13/13 y regresión 31/31; Emulator 4/4 con casos individuales 1/1; lint/typecheck/build/formato/diff pasaron; audit sin high/critical, con DR-001 moderadas; el rate-limit de catálogo permanece documentado como control transversal que bloquea producción, no resuelto por T032; pendiente aprobación formal.",
  },
  T010: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Propuesta explicita 2026-09-01: CityPay Limited + Paylink alojado para pagos unicos GBP, detras del adapter provider-independent. T010 sigue bloqueada hasta aceptacion del operador, onboarding, contrato/tarifas/monedas/settlement, revision legal, presupuesto/alertas, secretos y sandbox con rollback; costo comprometido GBP 0, sin cobro.",
  },
  T008: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Piloto sintetico aprobado por el operador; reglas reales DOCX y defaults T008-P01..P07 solo para Emulator/staging aislado; no aprobacion operativa ni productiva.",
  },
  T009: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Piloto sintetico aprobado por el operador; baseline real de stripes y defaults T009-P01..P06 solo para Emulator/staging aislado; promociones bajo revision humana.",
  },
  T033: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-6 verificadas: lifecycle focused 8/8 y domain regression 106/106; audit 12/12, writer 7/7 y domain 110/110; store 9/9 y contracts/audit 20/20; callables 11/11 y regresión 36/36; Emulator 6/6, Rules 37/37 y unit 32/32; gates completos sin high/critical. Corregidos runtime mapping/draft status, audit getter snapshot/contracts expectation, store scope/internal IDs/uniqueness/read-before-write/audit retry y callable family-active/date payload/real invalid transition. DR-001 conserva dos moderadas transitivas y rate-limit residual transversal; pendiente aprobación formal y no es aprobación de producción.",
  },
  T037: {
    implementationStatus: "verificada",
    implementationEvidence:
      "T037 verificada: facturas como fuente canónica, pagos manuales append-only en efecto, balances/deuda PAYG derivados; owner/administrator escriben, guardian/adultStudent solo leen su alcance y coaches quedan denegados. Domain 7/7, store 9/9, callables 6/6, audit domain 13/13, writer 8/8, Emulator 4/4, Rules 44/44, suite 629/629, lint/typecheck/build/formato/diff pasan. Audit sin high/critical con dos moderadas DR-001; refunds, providers, UI y booking writes fuera de alcance; pendiente aprobación formal.",
  },
  T024: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Adaptador piloto verificado: unitarias 133 archivos/979 pruebas, focalizadas T024 20/20, integración Firestore Emulator con R2 sintético 1/1, Rules directas 4/4, typecheck, lint y formato; el cierre productivo depende de T011 y del texto/revisión legal final.",
  },
  T025: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-4 verificadas: suite unitaria 90 archivos/701 pruebas; Rules 6 archivos/50 pruebas; Emulator integration 9/9; UI /admin/staff y E2E sintético 10/10; Auth Emulator E2E 2/2; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; pendiente aprobación formal.",
  },
  T049: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Dashboard diario conectado y verificado con sesiones, asistencia y check-out canónicos; callable staff-only y proyección agregada sin roster.",
  },
  T050: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Dashboard financiero read-only conectado a membresías, facturas y pagos canónicos; sin PII/IDs sensibles, 1036/1036 unitarias, Rules 64/64 y E2E 67/67.",
  },
  T051: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Reporte owner/admin conectado y tenant-scoped para estudiantes, asistencia, membresías y finanzas manuales; rango máximo de 31 días, sin PII/IDs y gates completos.",
  },
  T053: {
    implementationStatus: "verificada",
    implementationEvidence:
      "CSV agregado T051/T052 owner/admin, piloto sintético fail-closed, journal y auditoría atómicos, rate limit persistente, sin PII/IDs ni archivo server-side; unitarias 1019/1019, Rules 64/64 y E2E 65/65.",
  },
  T055: {
    implementationStatus: "parcial",
    implementationEvidence:
      "QA aprobado unicamente para el piloto sintetico: verify:mvp local pasa con build normal y build:e2e-synthetic, unitarias 159/1082, Rules 64/64, carga sintetica 240 solicitudes/concurrencia 24 sin fallos (p95 82 ms), E2E smoke 5 pasan/1 omitida, runtime desplegable 2/2, secret scan sin coincidencias y audit sin high/critical. T011, carga live/staging y produccion siguen pendientes.",
  },
  T082: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Regla persistente añadida a AGENTS.md, Copilot y MASTER_PROMPT.md; 83 entradas únicas sincronizadas y Lista.js verificado.",
  },
  T026: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Contratos de dominio 27/27, generador determinístico de sesiones con soporte DST Europe/Jersey, store 6/6, callables protegidos 6/6, UI admin groups/activities 4/4, client 7/7, suite completa 788/788 en 105 archivos; typecheck/build/lint/format pasan; sin producción ni migraciones destructivas.",
  },
  T083: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-5 completadas y verificadas: 171 definiciones, 27 belts, 144 stripes, 11 habilidades y 165 requisitos; unitarias 101 archivos/739 pruebas; Rules 7 archivos/56 pruebas; Emulator integration 1/1; E2E Playwright 6/6; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; pendiente aprobación formal.",
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
      implementationEvidence: "Tarea aprobada en tasks.md con evidencia registrada.",
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

function task(id, title, status, description, dependsOn = "-", evidence, references, kind = "mvp") {
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

const phase0Items = [
  task(
    "T008",
    "Confirmar horarios, capacidades y reglas comerciales todavia configurables",
    "aprobada",
    "Completar los valores configurables que los DOCX no fijan.",
    "-",
    "Piloto sintetico aprobado por el operador; reglas reales DOCX y defaults T008-P01..P07 solo para Emulator/staging aislado; no aprobacion operativa ni productiva.",
    ["tasks.md", "BRIEF.md", "docs/operations/academy-configuration-decision-packet.md"],
    "decision",
  ),
  task(
    "T009",
    "Confirmar los criterios y pesos de evaluacion y reconocimiento",
    "aprobada",
    "Definir criterios uniformes de rendimiento y pesos de reconocimiento bajo la responsabilidad del entrenador principal.",
    "-",
    "Piloto sintetico aprobado por el operador; baseline real de stripes y defaults T009-P01..P06 solo para Emulator/staging aislado; promociones bajo revision humana.",
    ["tasks.md", "BRIEF.md", "docs/operations/evaluation-recognition-decision-packet.md"],
    "decision",
  ),
  task(
    "T010",
    "Seleccionar un proveedor de pagos disponible en Jersey para post-piloto",
    "aprobada",
    "Elegir el proveedor manteniendo los pagos detras de un adaptador independiente del proveedor.",
    "-",
    "Decision del operador 2026-09-06: no hay pasarela. El piloto cobra en efectivo y por transferencia registrados a mano, y office carga las instrucciones de pago desde su panel (T035 re-scope). CityPay queda solo como referencia; no bloquea nada. Propuesta explicita 2026-09-01: CityPay Limited + Paylink alojado para pagos unicos GBP, detras del adapter provider-independent. T010 sigue bloqueada hasta aceptacion del operador, onboarding, contrato/tarifas/monedas/settlement, revision legal, presupuesto/alertas, secretos y sandbox con rollback; costo comprometido GBP 0, sin cobro.",
    [
      "tasks.md",
      "BRIEF.md",
      "STACK.md",
      "docs/operations/payment-provider-decision-packet.md",
      "docs/adr/ADR-006-citypay-payment-provider-proposal.md",
    ],
    "decision",
  ),
  task(
    "T011",
    "Confirmar la política de retención, residencia y eliminación",
    "aprobada",
    "Confirmar la política aplicable a los datos de la academia, menores e información restringida.",
    "-",
    "Acta firmada el 2026-09-07 por instruccion del operador, en la forma que la propia acta prescribia para este caso: Andres Santiago, p.p. Vladimiro Afonso, con esa instruccion como autorizacion referenciada. Es una atestacion tipeada por poder, no la firma de puno del controller, y la diferencia esta escrita en el acta, en la DPIA y en el ledger. Firmado: las diez decisiones sin enmiendas, la D11 sobre las contrasenas en claro de Regyfit, los tres puntos marcados como menos fiables con su salvedad intacta, los doce plazos de retencion y el mapa de regiones. Con esto se cierra el segundo de los tres criterios de cierre. Queda uno, que es dato y no decision: la razon social completa (forma juridica, numero de registro y domicilio registrado), que bloquea contratos de encargado y no releases. Lo que la firma no cambia: el riesgo residual de la DPIA sigue alto, ninguno de los doce plazos existe todavia en el sistema, no hay revisor independiente, no se aprueba la DPIA ni se resuelve la notificacion a la JOIC, y ninguna release queda autorizada (ese gate es T058).",
    [
      "tasks.md",
      "BRIEF.md",
      "STACK.md",
      "docs/operations/t011-retention-residency-deletion-decision-packet.md",
      "docs/operations/t011-reviewer-engagement-brief.md",
    ],
    "decision",
  ),
];

const foundationItems = [
  task(
    "T001",
    "Inicializar Git y el monorepo de pnpm",
    "aprobada",
    "Crear la estructura de trabajo para web, funciones, paquetes y QA.",
    "-",
    statusEvidence.approved,
    ["tasks.md"],
    "foundation",
  ),
  task(
    "T002",
    "Configurar TypeScript estricto, lint, formato y comandos raíz",
    "aprobada",
    "Establecer los controles de calidad del repositorio y la configuración estricta del compilador.",
    "T001",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
  task(
    "T003",
    "Configurar Vitest, Testing Library y convenciones de pruebas",
    "aprobada",
    "Proporcionar la infraestructura de pruebas unitarias y de componentes.",
    "T002",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
  task(
    "T004",
    "Configurar Firebase CLI, proyectos de desarrollo y emuladores",
    "aprobada",
    "Configurar la emulación local de Auth, Firestore y Realtime Database sin acceso a producción.",
    "T001",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
  task(
    "T005",
    "Configurar proyectos de Playwright y artefactos de QA no versionados",
    "aprobada",
    "Configurar pruebas de humo del navegador en escritorio y móvil.",
    "T002",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
  task(
    "T006",
    "Crear CI inicial con controles de calidad, reglas y humo",
    "aprobada",
    "Ejecutar las comprobaciones automatizadas iniciales en CI.",
    "T003,T005",
    statusEvidence.approved,
    ["tasks.md"],
    "foundation",
  ),
  task(
    "T007",
    "Documentar clasificación de datos, amenazas y matriz de acceso",
    "aprobada",
    "Registrar los límites de seguridad para menores, salud, pagos y datos operativos.",
    "-",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
];

const identityItems = [
  task(
    "T012",
    "Definir módulos de dominio, contratos base y errores tipados",
    "aprobada",
    "Definir los contratos de dominio compartidos por los módulos posteriores.",
    "T002,T007",
    statusEvidence.approved,
    ["tasks.md"],
    "mvp",
  ),
  task(
    "T013",
    "Diseñar colecciones, índices, invariantes y plan de migración",
    "aprobada",
    "Definir límites de Firestore, uso de RTDB y documentación de reversión.",
    "T007",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T014",
    "Implementar autenticación por correo/contraseña y Google con emulador",
    "aprobada",
    "Proporcionar los flujos iniciales de registro, inicio y cierre de sesión.",
    "T004,T084",
    "Google usa el popup SDK conectado al Auth Emulator; email/Google y login sin MFA revalidados con unitarias, integración local y E2E responsive.",
    ["tasks.md", "BRIEF.md", "STACK.md", "docs/adr/ADR-005-admin-auth-without-mfa.md"],
    "mvp",
  ),
  task(
    "T015",
    "Implementar roles y permisos personalizados de mínimo privilegio",
    "aprobada",
    "Aplicar el modelo aprobado de roles y alcance de academia.",
    "T013,T014",
    "Parser exacto para seis roles, compatibilidad administrativa, pruebas negativas y gates globales aprobados sin ampliar provisioning.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T016",
    "Implementar reglas de Firestore y RTDB con pruebas de aislamiento",
    "aprobada",
    "Mantener cerrado todo acceso Firebase directo y centralizar autorización por tenant, rol, relación, asignación y propósito.",
    "T013,T015",
    "Evaluador fail-closed, actor de seis roles, matriz Firebase exhaustiva y packaging verificados con gates globales.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T017",
    "Implementar MFA obligatorio para propietario/administrador",
    "cancelada",
    "El requisito histórico de MFA fue sustituido por el rediseño administrativo aprobado sin MFA.",
    "T014,T015",
    "Cancelada y sustituida por el rediseño administrativo aprobado.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T019",
    "Implementar registro de auditoría de solo anexado para cambios sensibles",
    "aprobada",
    "Conservar autor, hora e historial de correcciones sensibles.",
    "T012,T013,T016",
    "Diseño create-only y plan TDD aprobados; pendiente centralizar admin, member import y Regyfit sin lectura/UI.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const peopleItems = [
  task(
    "T020",
    "Construir tokens de diseño, carcasa adaptable y navegación accesible por roles",
    "aprobada",
    "Crear la carcasa autenticada compartida y las bases de navegación.",
    "T002,T015",
    "Shell responsive, navegación por rol y QA de teclado/móvil documentados; falta aprobación formal.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T020A",
    "Integrar identidad visual oficial y navegación de inicio",
    "aprobada",
    "Aplicar los recursos de identidad aprobados, metadatos y rutas de inicio.",
    "T002,T020",
    "Los recursos, rutas y controles adaptables están documentados; la aprobación explícita sigue pendiente.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T021",
    "Implementar perfiles de adultos, menores y tutores",
    "aprobada",
    "Proporcionar perfiles autorizados sin crear cuentas individuales para menores.",
    "T016,T020",
    "Primer WIP documental: campos de nombre, fecha de nacimiento, teléfono, email, sede y preferencias horarias.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T022",
    "Implementar familias con varios menores y relaciones autorizadas",
    "aprobada",
    "Modelar contactos familiares y relaciones de tutores permitidas.",
    "T021",
    "Inicio 2026-08-19; plan aprobado en ejecución inline, comenzando por contratos de dominio con TDD.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/superpowers/specs/2026-08-19-t022-family-relationships-design.md",
      "docs/superpowers/plans/2026-08-19-t022-family-relationships-plan.md",
    ],
    "mvp",
  ),
  task(
    "T023",
    "Implementar datos médicos y de apoyo restringidos",
    "aprobada",
    "Proteger la información de apoyo restringida con pruebas de permisos negativos.",
    "T021",
    "Alcance técnico del piloto sintético aprobado por el operador el 2026-08-25; producción y datos reales continúan bloqueados por T011 y BPT_SYNTHETIC_PILOT.",
    ["tasks.md", "BRIEF.md", "docs/superpowers/specs/2026-08-19-t023-health-support-design.md"],
    "mvp",
  ),
  task(
    "T024",
    "Implementar documentos privados y URLs firmadas de R2",
    "aprobada",
    "Mantener autorizados, breves y protegidos el acceso a consentimientos y documentos privados.",
    "T016,T021,T023",
    "Alcance técnico con R2 sintético aprobado por el operador el 2026-08-25; R2 productivo, datos reales y cierre productivo continúan bloqueados por T011 y por el texto/revisión legal final.",
    ["tasks.md", "STACK.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T018",
    "Implementar waiver versionado y aceptación de registro",
    "aprobada",
    "Completar el registro con el waiver único, aceptación, revocación y renovación sin sobrescritura destructiva.",
    "T016,T021,T022,T023,T024",
    "Aprobada explícitamente por el operador el 2026-08-25 solo para el piloto sintético: waiver versionado, firma tutor/adulto, revocación, PDF privado, auditoría y UI verificados; producción bloqueada por T011 y por el texto/revisión legal final.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T025",
    "Implementar cuentas, disponibilidad y asignaciones de entrenadores/personal",
    "aprobada",
    "Gestionar el acceso del personal y las asignaciones operativas.",
    "T015,T020",
    "Tasks 1-4 verificadas: suite unitaria 90 archivos/701 pruebas; Rules 6 archivos/50 pruebas; Emulator integration 9/9; UI /admin/staff y E2E sintético 10/10; Auth Emulator E2E 2/2; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const levelsItems = [
  task(
    "T083",
    "Recrear catálogo completo y sección MVP de Levels IBJJF",
    "aprobada",
    "Implementar la jerarquía completa de belts, stripes y habilidades antes de progreso y promociones.",
    "T025,T072,T084",
    "Tasks 1-5 completadas y verificadas: 171 definiciones, 27 belts, 144 stripes, 11 habilidades y 165 requisitos; unitarias 101 archivos/739 pruebas; Rules 7 archivos/56 pruebas; Emulator integration 1/1; E2E Playwright 6/6; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; aprobada 2026-08-23.",
    [
      "tasks.md",
      "BRIEF.md",
      "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx",
      "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx",
      "docs/data/ibjjf-levels-observed.sanitized.json",
    ],
    "mvp",
  ),
];

const attendanceItems = [
  task(
    "T026",
    "Implementar programas, clases recurrentes y sesiones individuales",
    "aprobada",
    "Modelar el horario de clases y las reglas de zona horaria.",
    "T013,T025",
    "Contratos de dominio 27/27, generador determinístico de sesiones con soporte DST Europe/Jersey, store 6/6, callables 6/6 y UI admin verificados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T027",
    "Implementar elegibilidad, capacidad, lista, reserva y cancelación",
    "aprobada",
    "Aplicar las restricciones de elegibilidad y capacidad de las reservas.",
    "T021,T026",
    "Contratos y evaluador multicriterio 44/44, store transaccional de capacidad atómica/idempotencia 9/9, callables RBAC 8/8, client 8/8, suite completa 811/811 en 105 archivos; corte de 1h y quórum mínimo validados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T028",
    "Implementar registro de llegada por QR, PIN, nombre y método manual",
    "aprobada",
    "Admitir los cuatro métodos aprobados para registrar llegadas.",
    "T022,T027",
    "Contratos de check-in y 4 métodos 54/54, store de asistencia e idempotencia 10/10, callables protegidos RBAC 9/9, client 9/9, suite completa 824/824 en 105 archivos; puntualidad (attended/late) y reglas de seguridad verificadas; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T029",
    "Implementar puntualidad, asistencia, ausencia y correcciones auditadas",
    "aprobada",
    "Mantener trazables las correcciones mientras se registran los resultados de asistencia.",
    "T019,T028",
    "Contratos y parsers de corrección 58/58, store con correctionOf inmutable y reconciliación de no-shows 12/12, callables RBAC 10/10, client 9/9, suite completa 831/831 en 105 archivos; eventos de auditoría registrados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T030",
    "Implementar salida de menores y autorización de recogida",
    "aprobada",
    "Registrar al adulto autorizado, la salida independiente o la confirmación del personal.",
    "T022,T029",
    "Contratos y parsers de checkout 64/64, 3 métodos (authorizedAdult, independentRelease, staffOverride con notas), store con validación de asistencia previa e idempotencia 13/13, callables RBAC 11/11, client 10/10, suite completa 840/840 en 105 archivos; eventos de auditoría registrados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T031",
    "Implementar vista operativa en vivo sin duplicar la fuente canónica",
    "aprobada",
    "Mostrar las operaciones actuales de asistencia sin duplicar los registros canónicos.",
    "T029,T030",
    "Proyección pura agregada 65/65, store unificado sin estado duplicado 14/14, callable RBAC 12/12, client 11/11, suite completa 844/844 en 105 archivos; consistencia y quórum en vivo verificados; aprobada 2026-08-23.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
];

const membershipItems = [
  task(
    "T032",
    "Implementar catálogo y reglas base de planes de membresía",
    "aprobada",
    "Definir todos los planes, precios, sedes y accesos Town/West del DOCX, incluidos Kids, Teens, Adults y Open Mats.",
    "T013",
    "Tasks 1-6 verificadas; suite 572/572; Rules 30/30; domain 11/11 y regresión 98/98; store 15/15; runtime 2/2; callables 13/13; Emulator 4/4; lint/typecheck/build/formato pasan; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx"],
    "mvp",
  ),
  task(
    "T033",
    "Implementar ciclo de vida de la membresía",
    "aprobada",
    "Admitir transiciones de prueba, activa, pausada, vencida y cancelada sin perder el acceso definido por plan.",
    "T032",
    "Lifecycle completo, múltiples suites verdes, gates sin high/critical; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx"],
    "mvp",
  ),
  task(
    "T034",
    "Implementar adaptador de pagos independiente del proveedor post-piloto",
    "aprobada",
    "Mantener reemplazable la integracion de pagos y fuera del manejo de datos de tarjeta sin procesar.",
    "T010,T012",
    "Aprobada unicamente para alcance tecnico/sintetico: adapter provider-independent, unconfigured fail-closed, payload sin tarjeta/PII, idempotencia tenant-scoped; revalidacion 6/6, typechecks, ESLint y Prettier pasan. T010 sigue bloqueada y no hay proveedor, credenciales ni cobro real.",
    ["tasks.md", "BRIEF.md", "STACK.md", "docs/operations/payment-provider-decision-packet.md"],
    "roadmap",
  ),
  task(
    "T035",
    "Instrucciones de pago manual y transferencia (sin pasarela)",
    "aprobada",
    "Usar flujos de pago alojados sin almacenar datos de tarjeta sin procesar.",
    "T034",
    "Re-scope 2026-09-06: sin pasarela, la fila pasa a ser el pago manual completo. Office guarda una vez las cuentas de la academia (nombre, sort code normalizado, numero de cuenta, banco opcional, referencia a citar y si se acepta efectivo) en un documento auditado y cada miembro con saldo ve How to pay junto a sus facturas. Sin tarjetas ni credenciales. Dominio 8, store 5, callable 3, cliente 4, panel de office 4 y pagina del miembro 4. Golden path 19/19 y gate verde. El pago alojado está fuera del piloto manual. Aprobada por el operador el 2026-09-06.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T036",
    "Implementar webhooks de pago post-piloto firmados e idempotentes",
    "cancelada",
    "Prevenir efectos financieros duplicados ante reintentos y eventos fuera de orden.",
    "T019,T035",
    "Diferida 2026-09-06: sin pasarela no hay webhooks. No bloquea nada del piloto. Los webhooks están fuera del piloto manual. Cancelada por el operador el 2026-09-06: sin pasarela no existe evento que firmar, reintentar ni conciliar. Se conserva la fila como historial y el contador del piloto ya no la cuenta.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T037",
    "Implementar pagos manuales, facturas, recibos, saldos, deuda PAYG y refunds",
    "aprobada",
    "Admitir cash, factura/recibo, deuda PAYG, cobro de la sesión nueva y de la anterior pendiente.",
    "T019,T033",
    "Suite completa 629/629, Rules 44/44, domain/store/callables/audit verdes; aprobada 2026-08-23.",
    [
      "tasks.md",
      "BRIEF.md",
      "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx",
      "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx",
    ],
    "mvp",
  ),
  task(
    "T038",
    "Vincular estado manual de pago/membresía y restricciones por deuda",
    "aprobada",
    "Conectar el estado de facturación con el acceso y el seguimiento operativo.",
    "T037",
    "Suite 650/650, Rules 35/35, policy/service/Emulator verdes; integración PAYG 1750 -> 0 verificada; aprobada 2026-08-23.",
    [
      "tasks.md",
      "BRIEF.md",
      "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx",
      "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx",
    ],
    "mvp",
  ),
];

const progressItems = [
  task(
    "T039",
    "Implementar evaluaciones de 1 a 5 y notas de evidencia visibles para la familia",
    "aprobada",
    "Registrar evaluaciones basadas en evidencias con la visibilidad adecuada.",
    "T021,T025,T083",
    "Contratos y parsers de evaluación 14/14, store con agregación y auditoría 7/7, callables RBAC con visibilidad familiar 10/10, client 5/5, suite completa 858/858 en 105 archivos; escala 1-5 y 11 habilidades vinculadas; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T040",
    "Implementar checklist de habilidades y resumen de progreso",
    "aprobada",
    "Resumir técnicas, total de clases, horas, racha y belt/stripes sin promoción automática.",
    "T039",
    "Contratos y pure builder buildStudentProgressSummary 16/16, store aggregations 8/8, callables RBAC con visibilidad familiar 12/12, client 6/6, suite completa 864/864 en 105 archivos; checklist técnico, clases, horas y elegibilidad no automática probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T041",
    "Implementar rachas y candidatos de reconocimiento explicables",
    "aprobada",
    "Calcular asistencia, rachas y candidatos con pesos explícitos y ausencias médicas.",
    "T029,T039",
    "Contratos y pure functions calculateAttendanceStreak/generateRecognitionCandidates 21/21, store methods 9/9, callables RBAC 16/16, client 8/8, suite completa 876/876 en 105 archivos; rachas, pausas médicas justificadas y cola explicable de candidatos para el Head Coach probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T042",
    "Implementar revisión y aprobación exclusivas del entrenador principal",
    "aprobada",
    "Mantener todas las promociones del catálogo MVP bajo aprobación humana autorizada.",
    "T015,T041",
    "Contratos y parsers de graduación/promoción 25/25, store con actualización de perfil y auditoría 10/10, callables RBAC headCoach/owner 18/18, client 9/9, suite completa 884/884 en 105 archivos; regla de oro de aprobación humana formal, registro inmutable y trazabilidad probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const crmItems = [
  task(
    "T043",
    "Implementar embudo de CRM, responsable y tareas post-piloto",
    "aprobada",
    "Dar seguimiento a prospectos y acciones operativas.",
    "T021,T025",
    "Contratos de dominio, store in-memory/Firestore y callables CRM implementados; headCoach limitado a sus leads; UI con preview sintetico por defecto y callable opt-in; pruebas focalizadas 10/10, typecheck Functions/Web, regresion y verify:mvp pasan; sin PII/secretos, datos reales ni despliegue; Revalidacion tecnica 2026-08-27: pruebas focalizadas CRM/UI 5/5; typecheck de Functions/Web, ESLint CRM y Prettier del alcance pasan. No bloquea T056. Aprobacion explicita del operador recibida el 2026-08-27 para alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales.",
    ["tasks.md", "BRIEF.md", "docs/operations/t043-t044-crm-synthetic-scope.md"],
    "roadmap",
  ),
  task(
    "T044",
    "Implementar línea de tiempo automática de CRM post-piloto",
    "aprobada",
    "Registrar una sola vez los eventos relevantes en una línea de tiempo trazable.",
    "T019,T043",
    "Persistencia de timeline, idempotencia por eventKey, parser y callable implementados; duplicado conflictivo falla cerrado; pruebas focalizadas 10/10, typecheck Functions/Web, regresion y verify:mvp pasan; UI y datos reales no activados; Revalidacion tecnica 2026-08-27: pruebas focalizadas CRM/UI 5/5; typecheck de Functions/Web, ESLint CRM y Prettier del alcance pasan. No bloquea T056. Aprobacion explicita del operador recibida el 2026-08-27 para alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales.",
    ["tasks.md", "BRIEF.md", "docs/operations/t043-t044-crm-synthetic-scope.md"],
    "roadmap",
  ),
  task(
    "T045",
    "Implementar anuncios y mensajes in-app de academia y clase",
    "aprobada",
    "Entregar avisos internos de academia y clase adecuados al rol.",
    "T025,T026",
    "Contratos y parsers de anuncios 7/7, store en Firestore e in-memory con soporte readBy y auditoría 4/4, callables RBAC staff/client 3/3, client 4/4, suite completa 902/902 en 109 archivos; canales academy/class/group, estados draft/published/archived y lectura in-app probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T046",
    "Implementar email/SMS e historial externo de entrega post-piloto",
    "aprobada",
    "Integrar proveedores externos solo después del piloto.",
    "T045",
    "Frontera provider-independent, historial tenant-scoped y fallback unconfigured verificados; contract/service 7/7; typecheck de dominio/Functions, ESLint y Prettier del alcance pasan; proveedor unconfigured, sin red, credenciales, gasto ni envio real. Aprobacion explicita del operador recibida el 2026-08-27 para alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T047",
    "Aplicar safeguarding a avisos de menores visibles al tutor",
    "aprobada",
    "Mantener la comunicación con menores visible para el tutor autorizado.",
    "T022,T045",
    "Aprobada técnicamente para el piloto: resolver canónico, portal guardian, pruebas unitarias/Rules, typecheck, lint y build pasan; sin producción ni canales privados.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T048",
    "Implementar recordatorios in-app de pagos y asistencia",
    "aprobada",
    "Admitir recordatorios internos con audiencia y resolución auditables.",
    "T029,T038,T045",
    "Aprobada técnicamente para recordatorios on-demand tenant-scoped; unit 930/930, rules exit 0, typecheck/lint/build/E2E gateway 8/8; sin producción ni persistencia adicional.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const closeoutItems = [
  task(
    "T049",
    "Implementar panel diario de clases, asistencia y salida de menores",
    "aprobada",
    "Dar a los operadores una vista coherente de la actividad diaria.",
    "T031",
    "Dashboard conectado a sesiones, asistencia y check-out canónicos; callable staff-only, límite de 24 h y vista agregada sin roster; unitarias 983/983, E2E sintético 63/63 con 14 omitidos, typecheck/build/lint/formato/diff pasan; aprobado técnicamente para el piloto.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T050",
    "Implementar panel de finanzas, saldos y renovaciones",
    "aprobada",
    "Mostrar a los operadores las acciones financieras manuales y renovaciones.",
    "T038",
    "Proyección read-only conectada a membresías, facturas y pagos canónicos; contrato owner/admin sin PII/IDs sensibles y gates completos.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T051",
    "Implementar informes de estudiantes, asistencia, membresías e ingresos manuales",
    "aprobada",
    "Proporcionar informes operativos autorizados con totales conciliados.",
    "T029,T038",
    "Reporte agregado owner/admin conectado a fuentes canónicas; tenant-scoped, rango máximo de 31 días, sin PII/IDs; unitarias 998/998, Rules 64/64 y E2E 65/65 ejecutadas con 14 omitidas.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T052",
    "Implementar informes de cobertura de progreso, reconocimiento y evaluación",
    "aprobada",
    "Informar la cobertura de progreso respetando los límites de privacidad.",
    "T042",
    "Aprobada técnicamente para reporte agregado staff-only tenant-scoped; coverage/recognition/readiness y privacidad sin IDs.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T053",
    "Implementar exportación de datos autorizada y auditable",
    "aprobada",
    "Exportar únicamente los datos permitidos para el rol activo.",
    "T019,T051,T052",
    "CSV agregado T051/T052 owner/admin, piloto sintético fail-closed, journal y auditoría atómicos, rate limit persistente y sin PII/IDs ni archivo server-side; gates completos y producción bloqueada por T011 y por el texto/revisión legal final.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T054",
    "Configurar respaldos, restauración y guía de reversión",
    "aprobada",
    "Demostrar la capacidad de recuperación antes de producción.",
    "T013,T024",
    "Aprobada explícitamente por el operador el 2026-08-25 solo para el piloto sintético: contrato fail-closed, checksum/conteos, rehearsal Emulator applyâ†’rollback, runbook, unitarias 6/6, integración 1/1 y E2E 2/2; no autoriza backup/restore productivo.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T055",
    "Ejecutar pruebas de carga, contrato, seguridad, accesibilidad y roles",
    "aprobada",
    "Ejecutar el control de calidad completo previo a la publicación.",
    "T008,T009,T011,T018,T019,T021-T033,T037-T042,T045,T047-T054,T083,T086",
    "QA aprobado unicamente para el piloto sintetico: verify:mvp, unitarias 159/1082, Rules 64/64, carga sintetica 240 solicitudes/concurrencia 24 sin fallos (p95 82 ms) y E2E smoke 5 pasan/1 omitida. T011/live/staging/produccion siguen bloqueados; no autoriza datos reales ni despliegue.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T056",
    "Ejecutar piloto controlado y corregir hallazgos",
    "aprobada",
    "Validar el MVP con datos controlados y un registro de piloto aprobado.",
    "T055",
    "Piloto E2E sintetico ejecutado: 71 pasaron, 14 omitidos por live/staging u opt-in y 0 fallos; verify:mvp y carga sintetica pasan; acta aprobada explicitamente por el operador el 2026-08-27 unicamente para el piloto sintetico; no autoriza staging real, produccion, datos reales, pagos ni migraciones.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/operations/t056-pilot-readiness-packet.md",
      "docs/operations/t056-pilot-operator-acta-draft.md",
    ],
    "mvp",
  ),
  task(
    "T057",
    "Preparar checklist post-piloto de produccion, monitoreo, costos y rollback",
    "aprobada",
    "Completar los controles operativos antes de produccion.",
    "T056",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Revalidada 2026-08-31: checklist y rollback documentados; T089 aprobado tecnicamente con gate global 175/1237, Rules 78/78, carga p95 29 ms y smoke 5/5 + 1 omitida. T011, staging real, costos/alertas, CD protegido y autorizacion de T058 siguen abiertos; no se autoriza produccion.",
    [
      "tasks.md",
      "STACK.md",
      "docs/operations/t011-retention-residency-deletion-decision-packet.md",
      "docs/operations/t011-reviewer-engagement-brief.md",
      "docs/operations/t057-post-pilot-production-checklist.md",
      "docs/operations/t057-synthetic-staging-contract.md",
      "docs/operations/payment-provider-decision-packet.md",
    ],
    "roadmap",
  ),
  task(
    "T058",
    "Desplegar a produccion con confirmacion explicita del operador",
    "pendiente",
    "Realizar la publicacion solo despues de superar todos los controles requeridos.",
    "T057",
    "La publicacion coordinada en produccion sigue pendiente. Estado real al 2026-09-07, leido en solo lectura: 39 funciones desplegadas en seis lotes con commit de origen reconstruido, Rules e indices identicos a HEAD, Pages en 51918ad, y los tres secretos del directorio canonico ya en version 2 con material real (el placeholder que esta fila registraba se resolvio ese dia). Hueco medido con pnpm release:delta: la web invoca 149 callables y 114 no estan desplegadas (no 25); dos desplegadas ya no existen en el codigo (searchMembers, getMemberReportSummary) y un --only functions sin nombres las borraria; ninguna funcion define BPT_SYNTHETIC_PILOT, asi que las tres de consentimiento desplegadas estan inertes. Procedimiento en docs/operations/t058-release-rollback-runbook.md. 2026-09-07: el operador tomo las cuatro decisiones abiertas segun lo recomendado -no llevar BPT_SYNTHETIC_PILOT, R2 fuera hasta tener credenciales, retirar las dos huerfanas y listRegyfitAccessRecords, y empezar por el lote sin gate de codigo- y se preparo y midio el primer lote: 35 callables por nombre (staff 9, families 3, profiles 4, crm 3, penalties 3, listPublicShopCatalog, announcements 9, listClientReminders, listRetentionAlerts, listUpcomingBirthdays). Son 35 y no 36 porque createCrmLead esta exportada pero la web no la invoca. Precondiciones medidas: puertas locales verdes (verify:mvp completo, golden path 19/19, artefacto exit 0), delta medido, secretos en version 2 habilitada, ninguna de las 35 lee process.env, billingEnabled true, y compatibilidad de datos limpia porque los contratos de dominio son identicos entre los commits desplegados y HEAD. Falta lo que no pone el asistente: la autorizacion explicita para esta release, la ventana con aviso, y las cinco alertas del 6.1. No se desplego nada.",
    [
      "tasks.md",
      "STACK.md",
      "docs/operations/t058-release-rollback-runbook.md",
      "docs/operations/t057-post-pilot-production-checklist.md",
      "scripts/release-delta.mjs",
    ],
    "roadmap",
  ),
  task(
    "T059",
    "Cerrar el proyecto con analisis de brechas y LECCIONES.md",
    "pendiente",
    "Registrar la leccion final del proyecto despues de la publicacion.",
    "T058",
    "El cierre del proyecto todavia esta pendiente.",
    ["tasks.md"],
    "roadmap",
  ),
];

const roadmapV2Items = [
  task(
    "T060",
    "Booking avanzado, listas de espera, creditos y reservas recurrentes",
    "aprobada",
    "Ampliar reservas despues del MVP; el corte basico de una hora pertenece a T027.",
    "-",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). T060 en revision: oferta manual FIFO, reserva temporal de cupo, aceptacion/declinacion autorizada y booking/auditoria atomicos verificados. 1216/1216 unitarias, 78/78 Rules, integraciones Firestore 20/20 y E2E real 6/6 pasan; 0 high/critical abiertos. Sin promocion automatica, scheduler, mensajes, creditos, recurrencia, pagos, datos reales, migracion, despliegue ni produccion.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/v2-v3-advance-plan.md",
      "packages/domain/src/schedule/advanced-booking-contracts.ts",
      "apps/functions/src/schedule/advanced-booking-callables.ts",
      "apps/functions/src/schedule/advanced-booking-service.ts",
      "apps/functions/src/schedule/booking-transaction-service.ts",
      "apps/web/src/app/account/waitlist/page.tsx",
      "apps/web/src/app/admin/waitlists/page.tsx",
      "apps/web/src/lib/waitlist-client.ts",
      "qa/tests/waitlist-offer-auth-emulator.spec.ts",
      "docs/roadmap/t060-waitlist.md",
    ],
    "roadmap",
  ),
  task(
    "T061",
    "Reintentos, períodos de gracia, prorrateo, promociones y flujos de pausa/cancelación",
    "cancelada",
    "Automatizar operaciones más profundas del ciclo de facturación.",
    "T010,T034,T035",
    "Diferida 2026-09-06: sin pasarela no aplican reintentos ni prorrateo automatico; pausas y cancelaciones siguen manuales. No bloquea nada del piloto. Plan preliminar en docs/roadmap/v2-v3-advance-plan.md. Antes de habilitar proveedor, el primer gate debe rechazar replays con la misma clave de idempotencia y payload divergente; el adaptador base aun no esta conectado al runtime. Pendiente de slice, contrato, criterios y checkpoint humano. Cancelada por el operador el 2026-09-06: reintentos, prorrateo y promociones presuponen la pasarela que el operador descarto; pausa y cancelacion siguen siendo manuales en office. Se conserva la fila como historial y el contador del piloto ya no la cuenta.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T062",
    "Alertas de retención y automatización de CRM",
    "aprobada",
    "Automatizar acciones seleccionadas de retención y CRM.",
    "T019,T029,T033",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Revision 2026-08-31: productor interno DI-only tenant-scoped y runner manual local solo Emulator para memberships trial/active y attendance canonica schema-v1, limites 200/5000, IDs/hash/replay diario deterministas y alertas + retention.alerts.generated atomicos. Runner 3/3, corrida aislada codigo 0; gate global 176/1240 + Rules 78/78 + carga 240/240 (p95 34 ms) + smoke 5/5; reauditoria 0 critical/high/moderate. El productor no tiene wiring runtime, endpoint, trigger ni scheduler; el callable read-only preexistente listRetentionAlerts se conserva. Sin CRM/mensajes, datos reales, migracion ni despliegue; studentReference/T011/T057 bloquean produccion.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t062-retention-alerts.md",
      "docs/data/firestore-data-model.md",
      "packages/domain/src/retention-contracts.ts",
      "packages/domain/src/audit/audit-event.ts",
      "apps/functions/src/retention/retention-alert-service.ts",
      "apps/functions/src/retention/retention-alert-producer.ts",
      "apps/functions/src/retention/retention-alert-producer.test.ts",
      "apps/functions/src/retention/retention-alert-callables.ts",
      "apps/web/src/app/admin/retention/page.tsx",
      "qa/integration/retention-alert-producer.test.ts",
    ],
    "roadmap",
  ),
  task(
    "T063",
    "Autoservicio ampliado para tutores y adultos",
    "aprobada",
    "Ampliar el autoservicio sin debilitar los límites de roles.",
    "-",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). T063 en revision: checkout adulto queda expresamente fail-closed antes del store; booking, cancelacion, check-in y consultas propias no cambian. Callable 18/18, Emulator 2/2 y verify:mvp 1217 unitarias/78 Rules/carga 240/240/smoke 5+1 pasan; 0 high/critical. Tutor secundario y habilitacion de checkout adulto siguen pendientes de checkpoint.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t063-self-service-rbac-matrix.md",
      "apps/functions/src/schedule/schedule-callables.ts",
      "qa/integration/guardian-student-scope.test.ts",
      ".github/workflows/golden-path.yml",
      "qa/scripts/generate-synthetic-emulator-secrets.mjs",
      "qa/rules/schedule-boundary.test.ts",
      "qa/tests/client-self-service-auth-emulator.spec.ts",
    ],
    "roadmap",
  ),
  task(
    "T064",
    "Notificaciones externas y automatizadas completas",
    "aprobada",
    "Ampliar cobertura después de los avisos in-app básicos de T045 y T048.",
    "-",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Cierre tecnico 2026-08-31: preferencia tenant-scoped y auditoria Firestore atomica; pruebas focalizadas 13/13, suite 1297/1297, Firestore Emulator 1/1 y E2E autenticada 2/2 en desktop/movil; typecheck, build y diff check pasan. Sin proveedor real, limites de costo, UI final ni checkpoint de producto; T064 permanece en revision.",
    [
      "tasks.md",
      "BRIEF.md",
      "STACK.md",
      "docs/roadmap/t064-notification-policy.md",
      "packages/domain/src/delivery/notification-policy.ts",
    ],
    "roadmap",
  ),
  task(
    "T065",
    "Asistencia sin conexión con sincronización y resolución de conflictos",
    "aprobada",
    "Admitir operación controlada sin conexión y conciliación.",
    "-",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Corte tecnico 2026-08-31: cola local tenant-scoped y adaptador web opt-in verificados; offline-queue 5/5, adaptador web 2/2, typecheck Domain/Web y regresiones focales pasan. Payload divergente, cruce de scope, corrupcion y conflicto de misma sesion fallan cerrado. Sin red, Firestore writes, Rules/Emulator ni E2E de sync; politica operativa y adaptador productivo siguen pendientes.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t065-offline-attendance.md",
      "packages/domain/src/attendance/offline-contracts.ts",
      "packages/domain/src/attendance/offline-queue.ts",
      "packages/domain/src/attendance/offline-queue.test.ts",
      "apps/web/src/lib/offline-attendance-storage.ts",
      "apps/web/src/lib/offline-attendance-storage.test.ts",
    ],
    "roadmap",
  ),
  task(
    "T066",
    "Biblioteca técnica ampliada y planificación avanzada de lecciones",
    "aprobada",
    "Añadir profundidad al currículo básico y la aprobación humana del piloto.",
    "-",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Cierre tecnico 2026-09-01: auditoria atomica lesson.plan.approved, UI staff en /admin/lesson-plans y E2E autenticada Emulator 1/1; persistencia, Rules, RBAC, builds y typechecks verificados. Se mantienen datos y contenido sinteticos; quedan contenido definitivo y checkpoint de producto.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t066-lesson-planning.md",
      "packages/domain/src/levels/lesson-planning-contracts.ts",
      "apps/functions/src/levels/lesson-planning-service.ts",
      "apps/functions/src/levels/lesson-planning-callables.ts",
      "qa/rules/lesson-planning-boundary.test.ts",
      "apps/functions/src/levels/lesson-planning-firestore-service.test.ts",
      "apps/functions/src/levels/lesson-planning-callables.test.ts",
      "apps/web/src/lib/lesson-planning-client.ts",
      "apps/web/src/app/admin/lesson-plans/lesson-plan-admin-panel.tsx",
      "qa/tests/lesson-planning-auth-emulator.spec.ts",
      "qa/scripts/run-lesson-planning-ui-e2e.mjs",
      "docs/roadmap/t066-product-checkpoint.md",
    ],
    "roadmap",
  ),
];

const roadmapV3Items = [
  task(
    "T067",
    "Objetivos, logros y resúmenes familiares ampliados",
    "aprobada",
    "Añadir participación después de las rachas básicas de T041.",
    "-",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Cierre tecnico 2026-09-01: catalogo/persistencia tenant-scoped, auditoria atomica family.achievements.generated, callable read-only y UI staff verificados; envelope { summary } corregido; E2E autenticada Emulator 1/1, Rules 6/6, focal T067 49/49, typecheck/build/lint/Prettier/diff pasan; quedan fuente de progreso real, runner/scheduler y checkpoint de producto; sin migracion ni produccion.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t067-family-achievements.md",
      "packages/domain/src/levels/achievement-contracts.ts",
      "apps/functions/src/levels/family-achievement-catalog-service.ts",
      "apps/functions/src/levels/family-achievement-service.ts",
      "apps/functions/src/levels/family-achievement-callables.ts",
      "apps/web/src/lib/family-achievement-client.ts",
      "apps/web/src/app/admin/families/family-achievement-admin-panel.tsx",
      "apps/web/src/app/admin/families/page.tsx",
      "qa/tests/family-achievement-auth-emulator.spec.ts",
      "qa/scripts/run-family-achievement-ui-e2e.mjs",
      "qa/scripts/seed-family-achievement-emulator.mjs",
      "qa/rules/family-achievement-boundary.test.ts",
    ],
    "roadmap",
  ),
  task(
    "T068",
    "Aplicaciones nativas para iOS y Android",
    "cancelada",
    "Considerar clientes nativos después de validar el producto web.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP. Cancelada por el operador el 2026-09-06: las apps nativas quedan fuera del MVP y no hay evidencia de necesidad antes de validar el producto web. Se conserva la fila como historial y el contador del piloto ya no la cuenta.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T069",
    "Comunidad moderada",
    "cancelada",
    "Añadir funciones comunitarias controladas con protección.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP. Cancelada por el operador el 2026-09-06: la comunidad moderada queda fuera del MVP y exige politica de moderacion, safeguarding y retencion antes de cualquier corte. Se conserva la fila como historial y el contador del piloto ya no la cuenta.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T070",
    "Referidos, clases privadas, competiciones y tienda",
    "cancelada",
    "Ampliar crecimiento y comercio después de los seminarios operativos de T026.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP. Cancelada por el operador el 2026-09-06: referidos, privadas y competiciones quedan fuera del MVP; la tienda del club ya existe y esta desplegada en T105. Se conserva la fila como historial y el contador del piloto ya no la cuenta.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T071",
    "Analítica, IA asistida, multiacademia, marca blanca y SaaS",
    "cancelada",
    "Considerar funciones de escala solo cuando el producto central sea estable.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP. Cancelada por el operador el 2026-09-06: analitica predictiva, IA, multiacademia y SaaS quedan fuera del MVP; la plataforma es de una sola academia por diseno. Se conserva la fila como historial y el contador del piloto ya no la cuenta.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
    "roadmap",
  ),
];

const specialItems = [
  task(
    "T072",
    "Ejecutar descubrimiento estructural read-only de Regyfit",
    "aprobada",
    "Ejecutar descubrimiento estructural read-only de Regyfit.",
    "T007,T013",
    "Manifiesto sanitizado, contratos y Playwright offline 2/2; entidades fuente todavía insuficientes para aprobar el mapeo.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T073",
    "Implementar autorización, locks y provisioning administrativo de Regyfit",
    "aprobada",
    "Implementar autorización, locks y provisioning administrativo de Regyfit.",
    "T015,T016",
    "Locks renovables, fencing, recuperación y compensación fail-closed; 32 pruebas focused y 83 de suite documentadas.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T074",
    "Construir shell y panel read-only administrativo de Regyfit",
    "aprobada",
    "Construir shell y panel read-only administrativo de Regyfit.",
    "T020,T015",
    "Shell responsive, proyecciones owner/safe, filtros, foco, 24 E2E sintéticos; falta aprobación/live Auth completa.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T075",
    "Implementar importer Regyfit idempotente y aplicar lote aprobado",
    "aprobada",
    "Implementar importer Regyfit idempotente y aplicar lote aprobado.",
    "T073,T074",
    "Importer protegido, dry-run e importación de 10 registros verificada; lectura live owner/administrator y alertas de facturación pendientes.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T076",
    "Publicar callable protegido de registros Regyfit",
    "aprobada",
    "Publicar callable protegido de registros Regyfit.",
    "T074,T075",
    "Callable v2 desplegado y smoke sin identidad devuelve 403; verificación Auth live queda pendiente.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T077",
    "Implementar gateway unificado de login, logout y acceso administrativo",
    "aprobada",
    "Implementar gateway unificado de login, logout y acceso administrativo.",
    "T014,T015",
    "Email/Google, destinos allowlisted, logout, E2E sintético y verificación manual staging documentados; live Auth automatizado opt-in.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T078",
    "Entregar panel administrativo visible con preview sintético",
    "aprobada",
    "Entregar panel administrativo visible con preview sintético.",
    "T020,T021",
    "Overview, Members, Groups, Activities, Attendance, Reports, CRM y Finance con filtros y QA 374/374; persistencia real posterior.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T079",
    "Implementar operaciones de miembros, informes y exportación PDF protegida",
    "aprobada",
    "Implementar operaciones de miembros, informes y exportación PDF protegida.",
    "T021,T024,T053",
    "Callables, límites, rate limit, export journal, PDF Unicode, integración Firestore y QA 427/427 documentados.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T080",
    "Validar lote real de PDFs de miembros y planificar importación",
    "aprobada",
    "Validar lote real de PDFs de miembros y planificar importación.",
    "T079",
    "8 reportes, 243 canónicos, 0 conflictos y dry-run aprobado; cualquier apply continúa prohibido sin confirmación explícita y sin cerrar los gates productivos.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T081",
    "Implementar navegación responsive administrativa y tablas ordenables",
    "aprobada",
    "Implementar navegación responsive administrativa y tablas ordenables.",
    "T020,T078",
    "Drawer móvil, foco, responsive, ordenación y E2E desktop/móvil documentados; aprobación formal pendiente.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T082",
    "Establecer sincronización permanente entre `tasks.md` y `Lista/`",
    "aprobada",
    "Establecer sincronización permanente entre `tasks.md` y `Lista/`.",
    "T001",
    "Regla persistente añadida a AGENTS.md, Copilot y MASTER_PROMPT.md; 83 entradas únicas sincronizadas y Lista.js verificado.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T084",
    "Limitar el importador PDF al emulador y rechazar producción",
    "aprobada",
    "Eliminar el alias production-as-staging antes de continuar el MVP.",
    "T080,T085",
    "Runner/CLI emulator-only, fuente sintética temporal, symlinks rechazados y gates globales verdes.",
    ["tasks.md", "STACK.md"],
    "special",
  ),
  task(
    "T085",
    "Fijar nanoid parcheado y excluir caches Graphify del formatter",
    "aprobada",
    "Resolver los gates globales de seguridad y formato sin modificar artefactos generados.",
    "T002",
    "nanoid 3.3.18, audit sin high/critical y formato global verde sin modificar caches generadas.",
    ["tasks.md", "package.json", ".prettierignore"],
    "special",
  ),
  task(
    "T086",
    "Aislar E2E sintético de red externa y diferir el resolver de Google",
    "aprobada",
    "Mantener las pruebas sintéticas deterministas y cargar OAuth solo al iniciar Google sign-in.",
    "T014,T049,T050",
    "Resolver Google diferido, fixture operativa explícita, unitarias 1036/1036 y E2E 67/67; aprobada 2026-08-24.",
    ["tasks.md", "apps/web/src/lib/firebase-client.ts", "qa/tests/admin-auth.spec.ts"],
    "special",
  ),
  task(
    "T087",
    "Reconciliar el ledger y la lista visual",
    "aprobada",
    "Corregir estados, dependencias y evidencia divergentes antes de iniciar T018.",
    "T082",
    "Revalidada 2026-08-31: 90 IDs unicos sincronizados, 0 divergencias de estado, 0 tareas aprobadas con dependencias abiertas; sintaxis, Prettier y diff verificados.",
    ["tasks.md", "Lista/Lista.js"],
    "special",
  ),
  task(
    "T088",
    "Mostrar el catalogo canonico de Levels en el panel administrativo",
    "aprobada",
    "Cargar las 171 definiciones sanitizadas aprobadas en el preview y reservar Firestore para el modo backend explicito.",
    "T083,T087",
    "Aprobada 2026-08-28 para preview local/sanitizado: verify:mvp completo, Playwright focalizado 2/2 y cierre de seguridad; sin deploy, seed, migracion, datos reales ni gasto.",
    [
      "tasks.md",
      "apps/web/src/lib/levels-client.ts",
      "docs/data/ibjjf-levels-observed.sanitized.json",
      "docs/data/ibjjf-levels-business-criteria.sanitized.json",
      "qa/tests/levels-catalog.spec.ts",
      "scripts/verify-mvp.mjs",
    ],
    "special",
  ),
  task(
    "T089",
    "Bloquear el proyecto Firebase productivo en el importador Regyfit",
    "aprobada",
    "Impedir que una etiqueta staging pueda dirigir el importador local al proyecto productivo conocido.",
    "T075,T084",
    "Aprobada 2026-08-31 tras revision de seguridad y QA. Guarda fail-closed verificada: bptjersey-f5a25 se deniega por argumento/entorno/Firebase config antes de I/O y staging queda cerrado sin allowlist. Focales 23/23; verify:mvp completo con 175/1237 unitarias, Rules 78/78, carga 240/240 (p95 29 ms) y smoke 5/5 + 1 omitida esperada; audit 0 high/critical y 2 moderate transitivas preexistentes. Sin red, datos reales, migracion ni despliegue.",
    [
      "tasks.md",
      "STACK.md",
      "apps/functions/src/regyfit/access-import.ts",
      "apps/functions/src/regyfit/access-import.test.ts",
      "qa/unit/regyfit-access-import.test.ts",
      "docs/data/migrations/regyfit/README.md",
      "docs/operations/t057-post-pilot-production-checklist.md",
      "Lista/Lista.js",
    ],
    "special",
  ),
  task(
    "T090",
    "Integrar el waiver oficial como requisito obligatorio de inscripcion",
    "aprobada",
    "Usar el PDF oficial como unica plantilla legal, capturar firma autenticada y llevar el perfil completado al paso de waiver.",
    "T018,T021,T024",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Revisada 2026-09-01: PDF oficial web/Functions byte-a-byte identico, hash SHA-256 validado, evidencia basada en paginas originales, confirmacion obligatoria y redireccion desde perfil; focales 17/17, suite 197 archivos/1305 pruebas, typecheck, lint, Prettier, build y git diff --check pasan. E2E cliente desktop/mobile 2/2; caso admin historico requiere bootstrap autenticado. Sin despliegue ni datos reales.",
    [
      "tasks.md",
      "BRIEF.md",
      "STACK.md",
      "docs/superpowers/specs/2026-09-01-t090-official-waiver-registration-design.md",
      "apps/web/src/app/account/waiver/page.tsx",
      "apps/functions/src/consents/waiver-evidence-pdf.ts",
    ],
    "special",
  ),
  task(
    "T091",
    "Corregir vistas administrativas para mostrar solo datos conectados",
    "aprobada",
    "Eliminar fallbacks de preview en las vistas administrativas conectadas.",
    "T021,T024,T030,T047",
    "Overview, Activities, Groups, Attendance y CRM usan callables conectados, estados vacios explicitos y RBAC; la evidencia remota registrada no sustituye el nuevo golden path.",
    [
      "tasks.md",
      "apps/web/src/app/admin/overview/page.tsx",
      "apps/web/src/app/admin/activities/page.tsx",
      "apps/web/src/app/admin/groups/page.tsx",
      "apps/web/src/app/admin/attendance/page.tsx",
      "apps/web/src/app/admin/crm/page.tsx",
    ],
    "special",
  ),
];

const recoveryItems = [
  task(
    "T092",
    "Definir el participante canonico y la convergencia members/students",
    "aprobada",
    "Fijar una sola identidad operativa y un plan reversible antes de tocar datos.",
    "T013,T021,T079,T091,T100",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). ADR-009, modelo y runbook cierran identidad, privacidad, rollback y restore aislado; tres revisiones independientes quedaron CLEAN sobre hashes exactos.",
    [
      "tasks.md",
      "STACK.md",
      "docs/adr/ADR-009-students-canonical-member-directory.md",
      "docs/data/firestore-data-model.md",
      "docs/data/migrations/member-directory-v1.md",
    ],
    "mvp",
  ),
  task(
    "T093",
    "Conectar administracion de miembros con estudiantes y familias canonicos",
    "aprobada",
    "Eliminar el silo funcional de members sin perder procedencia ni idempotencia.",
    "T092",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Corte aceptado: directorio canonico inicializado vacio y alimentado solo por escritores administrativos auditados, sin migrar la coleccion legacy members. E2E autenticado en Emulator a nivel de callable 2/2. Matriz RED consolidada: 25 covered, 9 partial y 11 out-of-cut, sin huecos accionables en el camino implementado; R44 fue un defecto real del attestation de backup v3 ya corregido. Los 11 out-of-cut y los 7 partial de migracion pasan a T108; R30 y R43 quedan bloqueados por T099/T011.",
    [
      "tasks.md",
      "docs/data/migrations/member-directory-v1.md",
      "docs/data/migrations/member-directory-v1-red-evidence.md",
      "qa/tests/member-directory-auth-emulator.spec.ts",
      "qa/scripts/run-member-directory-e2e.mjs",
      "qa/unit/canonical-directory-export-boundary.test.ts",
      "qa/integration/member-directory-concurrency.test.ts",
      "apps/functions/src/data/backup-v3-rehearsal.ts",
    ],
    "mvp",
  ),
  task(
    "T094",
    "Completar onboarding de perfil, tutor y waiver por entorno",
    "aprobada",
    "Cerrar el alta autenticada en Emulator/staging manteniendo datos reales bloqueados por T011.",
    "T090,T092,T093",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). 2026-09-05: onboarding autenticado de cliente cerrado en Emulator a nivel de callable, 3/3 y repetible: adulto (perfil canonico, replay, waiver con PDF de evidencia, descarga firmada, revocacion), tutor (perfil, familia con menor, aceptacion por el menor, evidencia denegada a adultos ajenos) y negativos fail-closed. Almacenamiento privado: R2 configurado gana, almacen en proceso solo en el Functions Emulator loopback con proyecto demo-, cerrado en cualquier otro entorno (28 unitarias). Datos reales, staging y produccion siguen bloqueados por T011; pendiente de aprobacion del operador.",
    [
      "tasks.md",
      "BRIEF.md",
      "apps/functions/src/storage/r2-client.ts",
      "apps/functions/src/consents/consent-callables.ts",
      "qa/tests/onboarding-auth-emulator.spec.ts",
      "qa/scripts/run-onboarding-e2e.mjs",
      "docs/development/firebase-emulators.md",
    ],
    "mvp",
  ),
  task(
    "T095",
    "Completar memberships, deuda PAYG y finanzas manuales desde UI",
    "aprobada",
    "Hacer operable el ciclo financiero manual del MVP sin proveedor online.",
    "T032,T033,T037,T038,T093",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). 2026-09-05: ciclo manual cerrado en Emulator a nivel de callable, 2/2: plan, membresia de adulto autoservicio creada por staff sin nombrar familia (derivada del registro canonico), factura manual, pago en efectivo, cuenta del adulto y del staff, dashboard y negativos fail-closed. Defecto real corregido: el store exigia relacion tutor-alumno tambien a adultos, que nunca podian recibir membresia; ahora solo a menores. UI de membresias y facturacion con selectores canonicos en vez de IDs tipeados (web 171/171, memberships 52/52). Decision del operador (opcion A): los adultos sin cuenta vinculada necesitan cuenta antes de recibir membresia o factura.",
    ["tasks.md"],
    "mvp",
  ),
  task(
    "T096",
    "Completar clases, bookings y asistencia desde UI",
    "aprobada",
    "Operar calendario, reserva, cancelacion y check-in/out con entidades canonicas.",
    "T026,T027,T028,T029,T030,T031,T093,T095",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). 2026-09-05: ciclo de operacion de clases cerrado en Emulator a nivel de callable, 2/2 sin cambios de backend: catalogo Town/West, programa, sesiones, reserva idempotente con corte de una hora y elegibilidad de sede, quorum, check-in manual por staff, asistencia, correccion, roster en vivo, cancelacion de reserva y de sesion, no-shows y negativos de rol, App Check, sesion, payload y Rules. QR/PIN siguen cerrados en el piloto. Aviso enganoso de PAYG en efectivo del panel del coach corregido.",
    [
      "tasks.md",
      "qa/tests/schedule-auth-emulator.spec.ts",
      "qa/scripts/run-schedule-e2e.mjs",
      "apps/web/src/app/coach/page.tsx",
      "docs/development/firebase-emulators.md",
    ],
    "mvp",
  ),
  task(
    "T097",
    "Conectar progreso, promociones revisadas y reportes",
    "aprobada",
    "Cerrar progreso propio/familiar y reportes sin fallback sintetico.",
    "T039,T040,T041,T042,T047,T048,T049,T050,T051,T052,T093",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: el resto de la fila -comparacion opt-in de adultos, que hoy no tiene modelo de opt-in, y reinicio de la barra de progresion al promover- se retoma despues de T116 y T117. 2026-09-05: apertura del nivel inicial por el head coach implementada (openStudentLevel, opcion A): callable auditado, una vez por alumno y solo cinturones, con UI en el panel del coach. E2E en Emulator 2/2 sobre el catalogo canonico: nivel abierto, asistencia y evaluacion en el resumen, candidatos a reconocimiento, primera promocion aprobada por el head coach y reporte de progreso; negativos de rol, App Check, sesion, payload y Rules. Progreso propio real en la cuenta sin competidores sinteticos. Segundo corte del 2026-09-05: progreso familiar del tutor conectado (FamilyProgressPanel lee el roster del tutor y un resumen canonico por hijo), pruebas de pagina 5/5 y tercer caso E2E de tutor en Emulator dentro del golden path 10/10. Pendiente: comparacion opt-in de adultos y reinicio de la barra al promover.",
    [
      "tasks.md",
      "apps/web/src/app/account/progress/own-progress.tsx",
      "apps/functions/src/levels/level-service.ts",
      "apps/functions/src/levels/level-callables.ts",
      "apps/web/src/app/coach/open-level-panel.tsx",
      "qa/tests/progress-auth-emulator.spec.ts",
      "qa/scripts/run-progress-e2e.mjs",
      "apps/web/src/app/account/progress/family-progress.tsx",
    ],
    "mvp",
  ),
  task(
    "T098",
    "Ejecutar el golden path autenticado completo en Firebase Emulator",
    "aprobada",
    "Reparar el gate y demostrar el flujo completo con Auth, Functions y Firestore Emulator.",
    "T094,T095,T096,T097",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: cada laguna nueva encadena su suite al golden path en la misma entrega, como se hizo con T109 a T115; el recorrido de navegador de callables con App Check sigue esperando a T099. 2026-09-05: golden path autenticado en una sola corrida de Emulator (run-golden-path-e2e.mjs): suites de T094-T097 encadenadas sobre una academia sintetica, 9/9 en 1.4 min, de familia/adulto a reporte con Rules y negativos. verify:mvp reparado el 2026-09-04 y en verde en cada corte (1696 unitarias, 91 Rules, carga, smoke desktop/movil). Segundo corte del 2026-09-05: gate bajo demanda y semanal en .github/workflows/golden-path.yml con pnpm test:e2e:golden-path y secretos sinteticos generados en el propio job; corrida local 10/10 en 1.5 min y verify:mvp completo verde (1699 unitarias, 91 Rules, carga 240/240, smoke 5+1). Limite: golden path a nivel de callable por App Check; el navegador exige staging.",
    [
      "tasks.md",
      "scripts/verify-mvp.mjs",
      "qa/tests",
      "qa/integration/membership-adapters.test.ts",
      "qa/integration/member-pdf-import.test.ts",
      "qa/integration/guardian-student-scope.test.ts",
      ".github/workflows/golden-path.yml",
      "qa/scripts/generate-synthetic-emulator-secrets.mjs",
    ],
    "mvp",
  ),
  task(
    "T099",
    "Ensayar la release coordinada que necesita T058, sin staging separado",
    "aprobada",
    "Validar el despliegue y su vuelta atras antes de tocar produccion, con el Emulator como gate.",
    "T011,T057,T098,T101",
    "Aprobada por el operador el 2026-09-07. Recortada ese mismo dia por decision suya: sin proyecto staging separado, el Emulator queda como gate funcional y T099 es el ensayo del despliegue coordinado que T058 necesita. Entregado: enmienda al contrato de T057 (ya existia), runbook de release y rollback en docs/operations/t058-release-rollback-runbook.md, baseline reconstruido con el mapa de hashes de T107 e inventario real de produccion leido en solo lectura (39 funciones en seis lotes atados a commits vivos, Rules identicas a HEAD, Pages en 51918ad), y delta corregido con scripts/release-delta.mjs: la web invoca 149 callables y 114 no estan desplegadas, no 25; dos desplegadas ya no existen en el codigo y un --only functions sin nombres las borraria. Revision adversarial de cuatro lentes con dos escepticos por hallazgo: 17 confirmados, todos incorporados. Evidencia sobre 51918ad: Rules 92/92, golden path 19/19, unitarias 268 archivos y 2186 pruebas, typecheck 6/6, lint y formato limpios. Ejecutar la release es T058.",
    [
      "tasks.md",
      "docs/operations/t058-release-rollback-runbook.md",
      "docs/operations/t057-synthetic-staging-contract.md",
      "scripts/release-delta.mjs",
      "qa/unit/release-delta.test.ts",
      "package.json",
    ],
    "mvp",
  ),
  task(
    "T100",
    "Vincular seed y rollback de Levels al destino Firebase permitido",
    "aprobada",
    "Impedir que una etiqueta no productiva alcance otro projectId antes de inicializar Admin SDK.",
    "T083,T089",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Guardas, artefacto y seed/rollback en Emulator verificados: focal 14/14 y verify:mvp verde. Sin acceso remoto, PII, migracion ni despliegue.",
    [
      "tasks.md",
      "apps/functions/scripts/seed-levels.mjs",
      "apps/functions/src/levels/level-seed.ts",
      "apps/functions/src/levels/level-seed.test.ts",
    ],
    "mvp",
  ),
  task(
    "T101",
    "Cerrar integridad de publicacion y rollback del catalogo Levels",
    "aprobada",
    "Evitar catalogos parciales y rollback inseguro antes de habilitar staging.",
    "T083,T100",
    "Aprobada por el operador 2026-09-04 (alcance sintetico/Emulator). Cierre tecnico 2026-09-04: 339 escrituras en una transaccion, replay idempotente solo con publicacion completa, fuentes resueltas desde el modulo con hashes aprobados, rollback con cero referencias y auditoria; CLI corregido para cargar firebase-admin del artefacto. Focales 26/26 y seed/replay/rollback reales en Emulator. Staging sigue cerrado hasta T099/T011.",
    [
      "tasks.md",
      "STACK.md",
      "apps/functions/src/levels/level-service.ts",
      "apps/functions/src/levels/level-seed.ts",
      "apps/functions/src/levels/level-catalog-publication.test.ts",
      "apps/functions/scripts/seed-levels.mjs",
    ],
    "mvp",
  ),
  task(
    "T102",
    "Consolidar el MVP funcional, panel de coaches y correccion de bugs",
    "aprobada",
    "Cerrar tipos, lint, panel /coach, comparativa de pares, salvaguarda medica y build estatico para Cloudflare Pages.",
    "T091,T100",
    "Desplegada 2026-09-04: verify:mvp completo en verde (1595 unitarias, 91 Rules, carga 240/240, smoke 5/5); commit 3da1f1c en main.",
    [
      "tasks.md",
      "apps/web/src/app/coach/page.tsx",
      "apps/web/next.config.ts",
      "scripts/verify-mvp.mjs",
    ],
    "mvp",
  ),
  task(
    "T103",
    "Restaurar el directorio completo de miembros reales y busqueda interactiva",
    "aprobada",
    "Directorio administrativo con KPIs, filtros y busqueda sobre los 243 miembros reales.",
    "T079,T080",
    "Desplegada en 73cf92b y superseded por T104: el dataset estatico con PII real se retiro del bundle, pero sigue en el historial git remoto (ver T107).",
    ["tasks.md", "apps/web/src/app/admin/members/search/page.tsx"],
    "mvp",
  ),
  task(
    "T104",
    "Servir registros reales de Regyfit detras de autenticacion admin y ficha completa",
    "aprobada",
    "Callables protegidos con los 249 socios reales y ficha completa estilo Regyfit.",
    "T076,T103",
    "Aprobada por el operador 2026-09-05. Recomendacion vigente: abrir una ficha en produccion con sesion admin real es la unica comprobacion que falta, es manual del operador y no bloquea ninguna otra fila. Backend desplegado (2 callables, import written:249). 2026-09-04: App Check configurado y verificado en produccion con sesion admin real: directorio de 249 registros cargado, callables 200, 0 errores. Apertura de ficha pendiente de comprobacion manual.",
    [
      "tasks.md",
      "apps/functions/src/regyfit/member-records.ts",
      "apps/web/src/app/admin/members/search/member-profile-panel.tsx",
      "qa/scripts/import-regyfit-member-records.mjs",
    ],
    "mvp",
  ),
  task(
    "T105",
    "Publicar la tienda del club: showcase, catalogo y pedidos de recogida",
    "aprobada",
    "Merchandise en landing, catalogo autenticado, pedidos de recogida pagados en academia y gestion administrativa.",
    "T016,T021",
    "Desplegada 2026-09-04: web 41394c8, 8 funciones en us-central1, Rules y catalogo oculto sembrado (5 productos). Pendiente del operador: publicar productos en /admin/shop. Sin pasarela de pago (T010).",
    [
      "tasks.md",
      "packages/domain/src/shop/shop-contracts.ts",
      "apps/functions/src/shop/shop-callables.ts",
      "apps/web/src/app/shop/page.tsx",
      "apps/web/src/app/admin/shop/page.tsx",
    ],
    "special",
  ),
  task(
    "T106",
    "Integrar el Waiver and Emergency Contact Form en el alta administrativa: datos (paso 1)",
    "aprobada",
    "Contacto de emergencia y direccion en el alta administrativa. La firma presencial atestiguada y la renovacion digital se separaron a T127 el 2026-09-07.",
    "T090,T093",
    "Partida el 2026-09-07 por instruccion del operador, con el mismo criterio que separo T011 de T126: lo hecho y probado se cierra, lo que falta se cuenta como trabajo abierto en su propia fila. Esta fila queda siendo el paso 1 (datos) y el paso 2 pasa a T127. Evidencia del paso 1, del 2026-09-04, para adultos y menores: bloques opcionales emergencyContact/postalAddress en perfil administrativo, alta, edicion y detalle restringido, nunca en filas generales; family-service crea el perfil administrativo del menor en la misma transaccion que estudiante, relacion y control plane; focales 407/407, typecheck y lint verdes. No se aprueba por instruccion: se aprueba porque esa evidencia es real, verificable y no ha cambiado, y lo que faltaba pertenecia a otro paso. Reconciliado 2026-09-07: T011 cerro ese dia y lo que le quedaba es hoy T126, que afecta a contratos de encargado y no a esta; el texto del waiver del club ya esta en el dominio (enrolment-waiver-terms, T121).",
    [
      "tasks.md",
      "docs/operations/t106-waiver-enrolment-integration-analysis.md",
      "packages/domain/src/members/member-directory-contracts.ts",
      "packages/domain/src/families/family-contracts.ts",
      "apps/functions/src/members/canonical-member-directory-service.ts",
      "apps/functions/src/families/family-service.ts",
      "apps/web/src/app/admin/members/add/page.tsx",
      "apps/web/src/app/admin/members/search/page.tsx",
      "apps/web/src/app/admin/families/page.tsx",
    ],
    "mvp",
  ),
  task(
    "T127",
    "Waiver en el alta administrativa, paso 2: firma presencial atestiguada y renovacion digital",
    "pendiente",
    "El paso 2 que T106 nunca construyo. Espera tres respuestas del operador, dos de ellas compartidas con T058.",
    "T106",
    "Alta 2026-09-07 al partir T106, cuyo paso 1 quedo aprobado con evidencia del 2026-09-04. Recoge la firma presencial atestiguada (recordWitnessedWaiver, in_person_witnessed) y la renovacion digital, que nunca se construyeron. Lo que falta no es codigo, son tres respuestas: (a) si la firma presencial en papel sigue teniendo sentido ahora que la inscripcion digital de T121 recoge la aceptacion, o si el alta administrativa debe apoyarse en esa misma aceptacion, que es una decision de producto y no una limitacion tecnica; (b) sacar consent-callables del gate BPT_SYNTHETIC_PILOT, hoy inerte en produccion, que es una de las decisiones de T058; y (c) credenciales R2 reales para la evidencia PDF, placeholders desde T104. Con esas tres el paso 2 es una tarea de codigo acotada por el analisis ya escrito, que sigue siendo valido. (b) y (c) se comparten con T058, asi que se resuelven juntas o no se resuelve ninguna. No bloquea a ninguna otra fila.",
    [
      "tasks.md",
      "docs/operations/t106-waiver-enrolment-integration-analysis.md",
      "packages/domain/src/consents/enrolment-waiver-terms.ts",
    ],
    "special",
  ),
  task(
    "T107",
    "Purgar el dataset real de miembros del historial git, del remoto y del arbol de trabajo",
    "aprobada",
    "Eliminar la PII real de T103 de forma verificable en local, historial y origin.",
    "T103,T104",
    "Aprobada por el operador 2026-09-05. Recomendacion vigente: quedan dos acciones del operador fuera del repositorio, pedir a GitHub la purga de objetos colgantes y valorar la notificacion conforme a T011. 2026-09-04: archivo local borrado, historial de main reescrito y publicado con force-push (origin/main 88 commits, 0 referencias), deployment 95d8b4d3 borrado, objetos locales purgados y bundle eliminado. Pendientes: purga de objetos colgantes en GitHub y notificacion (T011).",
    ["tasks.md", ".gitignore", "apps/web/src/app/admin/real-members-data.ts"],
    "special",
  ),
  task(
    "T108",
    "Migrar la coleccion legacy members al directorio canonico",
    "pendiente",
    "Ejecutar la migracion legacy diferida por el corte de T093 con aprobacion, chunks y rollback probados.",
    "T093,T099",
    "Sexta rebanada 2026-09-07: el primer ejecutor. El de bootstrap de claves de identidad, con sus escrituras de dominio enchufadas al envoltorio transaccional y su ensayo en Emulator, 5 pruebas contra Firestore real. Crea una reserva por cada identificador vigente en las cinco clases; preserva la clave compatible que ya existe en vez de reescribirla, que es lo que permite abandonar un bootstrap fallido sin borrar nada; y no pone nada en cuarentena: un registro ilegible, de otro inquilino, reasignado o inatribuible detiene el chunk y deja la congelacion en pie. El recibo del chunk pasa a probar lo que se escribio, porque el runner recomputa el MAC del conjunto de salida sobre las escrituras del ejecutor antes de leer nada. El adaptador Firestore convierte la decision del runner en un compare-and-set sobre revision y MAC de evento, que es lo que hace segura la division entre leer y comprometer. 273 ficheros y 2277 pruebas unitarias; Emulator 80/80. Corregido de paso un error de metodo: una asercion afirmaba probar el compare-and-set y fallaba antes por otra regla, asi que se aislo en una prueba propia y las tres reglas nuevas se comprobaron por mutacion. Falta la mayor parte: los otros seis ejecutores, el documento de operacion padre con sus transiciones, el plan privado congelado y su dry-run, la cuarentena y las aprobaciones. Arranque 2026-09-07, cinco rebanadas: contratos de migracion, ciclo de vida y lease, planificador de adquisicion, compromiso de chunk, y el envoltorio transaccional que valida la cadena estado-guard-evento y avanza estado, guard, recibo y auditoria juntos o nada. 70 pruebas focales; 272 ficheros y 2259 pruebas unitarias en verde. Queda: los siete ejecutores, cuarentena, aprobaciones, el adaptador Firestore y el ensayo en Emulator. Detalle: contratos de migracion, ciclo de vida y lease, planificador de adquisicion, y el compromiso de chunk con sus tres presupuestos (50 filas, 8 chunks, 400 filas) y la regla de replay: mismo recibo es no-op, recibo distinto falla cerrado. 63 pruebas focales, 614/614 del dominio. La criptografia y los vectores dorados ya existian de T093. Detalle: contratos de migracion, ciclo de vida y lease, y el planificador de adquisicion (tabla explicita de seis adquisiciones, dos de ellas ya congeladas; la proyeccion de rollback se niega tras el marcador global; el cambio forward->compensation conserva lease y resetea el contador de chunks). 56 pruebas focales, 607/607 del dominio. Detalle de las dos primeras: contratos de migracion y, encima, el ciclo de vida de la operacion (ocho estados como tabla cerrada, terminales, via inversa solo para directory-forward) y las reglas de lease (120 s, el vencimiento ya cuenta como expirado, nadie roba un lease vivo y uno expirado no lo renueva ni su dueno: exige recuperacion auditada). Corregidas dos cosas de la primera rebanada: la lista de fases con chunks y el recibo de chunk, que no ligaba status ni el chunk directo que la compensacion revierte. 39 pruebas focales, 590/590 del dominio. Entregados los contratos de migracion (nueve clasificaciones de dry-run con su elegibilidad, identificador y secuencia de chunk sin huecos, recibos de chunk y de dry-run sin PII por strictObject, y el limite de capacidad verificado en tiempo de plan), con 17 pruebas focales y 568/568 del dominio. Sigue pendiente porque falta la mayor parte: lease y transiciones de fase, escritor de chunks, los siete ejecutores, cuarentena, aprobaciones y el ensayo en Emulator; una rebanada entregada no es la tarea hecha. Alta 2026-09-05 al aprobar el corte de T093. Hereda los 11 requisitos out-of-cut (R06, R20-R22, R25, R26, R32-R34, R36, R45) y la clausula de migracion de los 7 partial (R07, R11, R12, R18, R23, R27, R31) de la matriz RED. Reconciliado 2026-09-07: sigue sin existir ningun ejecutor (ni escritor de memberDirectoryMigrationChunks ni acunacion o consumo de aprobaciones; solo el inicializador de baseline vacio y el ensayo de backup v3). El staging separado que esperaba se descarto con la enmienda de T057: el ensayo es el Emulator y la ejecucion real entra por la release de T058 con backup verificado y confirmacion separada. T099 en revision; T011 aprobada como borrador pero bloquea datos reales hasta la firma. No forma parte del piloto sintetico.",
    [
      "tasks.md",
      "docs/data/migrations/member-directory-v1.md",
      "docs/data/migrations/member-directory-v1-red-evidence.md",
      "docs/adr/ADR-009-students-canonical-member-directory.md",
    ],
    "special",
  ),
  task(
    "T109",
    "Senal de elegibilidad de 50 metros para el check-in",
    "aprobada",
    "Convertir el radio de 50 m en senal de check-in con override auditado.",
    "T028,T096",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: sin las coordenadas reales de Town y West en /admin/classes la senal queda en unavailable para todo check-in; es el fail-closed correcto, no un fallo. Alta y cierre tecnico el 2026-09-05. Decision 5 del BRIEF implementada como senal, nunca como prueba: coordenadas de sede guardadas por un callable auditado solo de administracion (radio fijo de 50 m), el navegador reduce su posicion a una distancia y solo envia distancia, precision y hora, la asistencia guarda within/outside/unavailable, un outside exige motivo de staff y anade el evento attendance.proximity_override, y la senal se oculta a adultos y tutores. Corregido de paso que guardar la primera geocerca hacia desaparecer la otra sede del catalogo. Golden path 10/10 en Emulator y gate completo verde. El auto check-in del alumno sigue cerrado por T028.",
    [
      "tasks.md",
      "BRIEF.md",
      "packages/domain/src/schedule/schedule-contracts.ts",
      "apps/functions/src/schedule/schedule-callables.ts",
      "apps/functions/src/schedule/attendance-transaction-service.ts",
      "apps/web/src/lib/check-in-proximity.ts",
      "apps/web/src/app/admin/classes/site-geofence-panel.tsx",
      "qa/tests/schedule-auth-emulator.spec.ts",
    ],
    "special",
  ),
  task(
    "T110",
    "Cancelacion automatica de la sesion sin quorum con aviso",
    "aprobada",
    "Encadenar quorum, cancelacion idempotente y avisos in-app a los reservados.",
    "T096,T062",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: el barrido es hoy un callable de staff y un runner manual, ambos idempotentes; ejecutarlo solo con una funcion programada es un checkpoint aparte. Alta y cierre tecnico el 2026-09-05. Decision 3 del BRIEF implementada: decideQuorumSweep decide (antes del corte, quorum alcanzado, no programada, ya cancelada por quorum, cancelar), el servicio transaccional cancela la sesion con motivo canonico, libera todas las reservas confirmadas, mueve la revision de capacidad y audita session.quorum.cancelled con id determinista, de modo que repetir el barrido no cambia nada. Callable reconcileSessionQuorum solo staff y runner manual de ventana; no se habilita ninguna funcion programada (checkpoint aparte, como en T062). El aviso in-app es derivado, no encolado: la clase cancelada que el miembro habia reservado se convierte en un recordatorio sessionCancelled sin identificadores. Golden path 10/10 en Emulator y gate completo verde.",
    [
      "tasks.md",
      "BRIEF.md",
      "apps/functions/src/schedule/quorum-sweep-service.ts",
      "apps/functions/src/schedule/quorum-sweep-runner.ts",
      "apps/functions/src/schedule/schedule-callables.ts",
      "packages/domain/src/reminders/reminder-contracts.ts",
    ],
    "special",
  ),
  task(
    "T111",
    "Penalizacion manual de 15 GBP por no-show de Town",
    "aprobada",
    "Registrar el cargo por no-show y su resolucion por office con auditoria.",
    "T095,T096",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: proponer las penalizaciones sigue siendo manual; automatizarlo es el mismo checkpoint que T110 y conviene decidirlos juntos. Alta 2026-09-05 y backend, web y unitarias el mismo dia. Decision 2 del BRIEF implementada como propuesta, nunca cargo automatico: un no-show de Town crea una entrada de cola de GBP 15 con identificador determinista y auditoria penalty.no_show.proposed, y office la resuelve una sola vez cobrandola (enlazando la factura manual de T095) o eximiendola, siempre con motivo y auditoria penalty.no_show.resolved. Una baja medica activa nunca genera propuesta. Cola en /admin/billing, Rules cerradas y modelo de datos documentado. E2E autenticado en Emulator cerrado el mismo dia con la suite nueva no-show-penalty-auth-emulator.spec.ts encadenada al golden path: ciclo completo (no-show, propuesta, cola, cobro con factura manual enlazada, exencion), negativos de rol, App Check, payloads y Rules. Golden path 12/12 en 1.9 min y verify:mvp verde con 1806 unitarias y 91 Rules. Pasa a revision.",
    [
      "tasks.md",
      "BRIEF.md",
      "packages/domain/src/penalties/no-show-penalty-contracts.ts",
      "apps/functions/src/penalties/no-show-penalty-service.ts",
      "apps/functions/src/penalties/no-show-penalty-callables.ts",
      "apps/web/src/app/admin/billing/no-show-penalty-queue.tsx",
      "qa/tests/no-show-penalty-auth-emulator.spec.ts",
      "qa/scripts/run-golden-path-e2e.mjs",
    ],
    "special",
  ),
  task(
    "T112",
    "Cumpleanos reales en el panel del coach",
    "aprobada",
    "Derivar los cumpleanos del directorio canonico en vez de anunciarlos sin datos.",
    "T093,T102",
    "Decision del operador 2026-09-06: el panel muestra ademas la edad que se cumple (entero), nunca la fecha ni el ano. Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: el panel no muestra la edad que se cumple, por alcance minimo; anadirla es una linea en la proyeccion y una decision de producto del operador. Alta 2026-09-05 e implementada el mismo dia. La constante sampleBirthdays desaparece: el panel lee listUpcomingBirthdays, que deriva la ventana de siete dias de los alumnos canonicos activos del sitio elegido. El ano de nacimiento nunca sale del backend: la proyeccion lleva nombre, cuantos dias faltan y si es adulto o menor, y office que necesite la fecha real la lee en el registro canonico. Solo staff puede llamarla; el cliente recibe 403. Un nacido el 29 de febrero se felicita el 28 en un ano comun. Dominio 16, servicio 8, callable 9, cliente web 3 y panel 15; E2E autenticado en Emulator dentro del golden path (14/14) con un alumno de Town y otro de West.",
    [
      "tasks.md",
      "packages/domain/src/birthdays/upcoming-birthday-contracts.ts",
      "apps/functions/src/birthdays/upcoming-birthday-service.ts",
      "apps/functions/src/birthdays/upcoming-birthday-callables.ts",
      "apps/web/src/lib/birthdays-client.ts",
      "apps/web/src/app/coach/page.tsx",
      "qa/tests/coach-birthday-auth-emulator.spec.ts",
    ],
    "special",
  ),
  task(
    "T113",
    "Reglas de stripes por franja de edad",
    "aprobada",
    "Aplicar las franjas de edad del catalogo al proponer stripes.",
    "T083,T097",
    "Decision del operador 2026-09-06: abrir fuera de franja sigue permitido pero el panel lo avisa; openStudentLevel devuelve la evaluacion de la franja y approvePromotion sigue sin consultarla. Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: la franja filtra candidatos y propuestas, pero openStudentLevel y approvePromotion siguen sin consultarla; extenderla a esos dos callables es decision del operador. Alta 2026-09-05 e implementada el mismo dia. Las 171 definiciones del catalogo llevan franja de edad y ninguna se leia: minAge y maxAge se parseaban y se guardaban sin usarse nunca. Ahora evaluateAgeBand decide la franja del rango de destino, buildStudentProgressSummary la publica como criterio propio y overallEligible la exige, de modo que la propuesta de reconocimiento nombra la franja cuando es lo que frena al alumno. Ambos extremos son inclusivos porque las franjas del catalogo comparten frontera (4-7 y 7-10). Sin fecha de nacimiento y con franja declarada la regla falla cerrada. La readiness sigue midiendo entrenamiento, no cumpleanos. Belts y stripes se siguen sin otorgar automaticamente y el head coach puede abrir un nivel fuera de franja. Dominio 19 casos nuevos; E2E autenticado en Emulator con dos hermanos del mismo cinturon dentro del golden path (15/15).",
    [
      "tasks.md",
      "BRIEF.md",
      "packages/domain/src/levels/level-contracts.ts",
      "packages/domain/src/levels/age-band-contracts.test.ts",
      "apps/functions/src/levels/level-service.ts",
      "apps/functions/src/levels/progress-report-service.ts",
      "qa/tests/level-age-band-auth-emulator.spec.ts",
    ],
    "special",
  ),
  task(
    "T114",
    "Interfaz preclase del coach con sugerencias de asistentes",
    "aprobada",
    "Publicar la vista previa a la clase con los asistentes probables.",
    "T096,T066",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: los 56 dias, las dos asistencias y la media hora son valores elegidos, no dictados por el DOCX; conviene revisarlos con datos reales (T099). Alta 2026-09-05 e implementada el mismo dia. Callable nueva getPreClassView solo para staff: junta a los reservados de la sesion con los habituales de la misma clase (mismo programa, misma sede, mismo dia de la semana y misma franja mas o menos media hora) durante las ultimas ocho semanas, exigiendo dos asistencias canonicas para considerarlo habito. Cada sugerencia viaja con su evidencia (cuantas de cuantas y la ultima), no con una racha inventada. No se sugiere a quien cancelo su reserva, a quien ya esta en el tatami ni a quien ya no esta activo, y una clase cancelada o terminada deja de sugerir. Nada se escribe: el coach sigue registrando cada check-in. Dominio 16, servicio 6, callable 11 y panel del coach 19; E2E dentro del golden path (15/15) con la asistencia corregida como estado vivo.",
    [
      "tasks.md",
      "packages/domain/src/schedule/pre-class-contracts.ts",
      "apps/functions/src/schedule/pre-class-service.ts",
      "apps/functions/src/schedule/pre-class-callables.ts",
      "apps/web/src/lib/schedule-client.ts",
      "apps/web/src/app/coach/page.tsx",
      "qa/tests/schedule-auth-emulator.spec.ts",
    ],
    "special",
  ),
  task(
    "T115",
    "Etiqueta de 25 caracteres para condiciones de salud",
    "aprobada",
    "Separar la etiqueta corta del detalle clinico y validar su limite.",
    "T035,T093",
    "Aprobada por el operador 2026-09-05 (alcance sintetico/Emulator). Recomendacion vigente: el coach deja de ver la nota clinica; si alguna practica real dependia de que la viera, es una decision de producto del operador y no un fallo tecnico. Alta 2026-09-05 y cerrada el mismo dia, con una correccion de la premisa: el limite de 25 caracteres y la separacion entre staffReferenceLabel y conditionSummary YA existian en el contrato de salud y estaban probados, y los dos formularios de administracion ya traian maxLength 25. Lo que faltaba era la consecuencia: la proyeccion de staff seguia llevando la nota clinica completa de hasta 1000 caracteres, asi que la separacion no significaba nada para un coach. Ahora la proyeccion de staff lleva la etiqueta corta y nunca la nota; el tutor sigue leyendo la nota que el mismo escribio y nunca la etiqueta; administracion conserva ambas. Dominio 8 y servicio 7, incluida la guarda de asignacion vigente del coach. Gate completo verde y golden path 15/15.",
    [
      "tasks.md",
      "packages/domain/src/health/health-contracts.ts",
      "apps/functions/src/health/health-service.ts",
    ],
    "special",
  ),
  task(
    "T116",
    "Permisos administrativos delegados a coaches",
    "aprobada",
    "Conceder permisos extra a un coach como documento revocable y auditado.",
    "T019,T093",
    'Aprobada por el operador 2026-09-06 (alcance sintetico/Emulator). Alta 2026-09-05 y cerrada el mismo dia. El claim no se toca: una concesion es un documento que nombra una sola permission de una lista cerrada (reviewPenalties, manageClasses), con motivo obligatorio, caducidad de como mucho 180 dias y revocacion inmediata, toda auditada. Lo ausente de la lista importa mas que lo presente: dinero, salud, safeguarding, exports y la propia administracion de personal no son delegables, porque un coach que pudiera conceder permisos podria concederse cualquiera. La autorizacion pasa a ser "lo permite el rol, o lo permite una concesion viva": el rol decide primero y sin cambios, asi que una caida del almacen de concesiones nunca deja a office fuera de su propia cola. Primer consumidor real: la cola de office de T111. Rules deny-by-default y el titular no puede ver ni revocar su concesion. Dominio 22, servicio 12, callables 10+13, cliente 6 y panel 15. Golden path 17/17 en Emulator, con el spec decodificando el token para afirmar que el claim sigue diciendo headCoach despues de conceder. Gate completo verde.',
    ["tasks.md", "apps/functions/src/staff", "firestore.rules"],
    "special",
  ),
  task(
    "T117",
    "Gestion de disclaimers y su aceptacion",
    "aprobada",
    "Modelar disclaimers versionados con aceptacion por participante.",
    "T090,T106",
    "Aprobada por el operador 2026-09-06 (alcance sintetico/Emulator) por el mecanismo; texto legal bloqueado por T011. Decision: un disclaimer obligatorio pendiente no bloquea inscripcion ni reserva hasta tener texto legal aprobado. Alta 2026-09-05 y mecanismo cerrado el mismo dia con contenido sintetico. No reutiliza el waiver de T090: aquel es un documento obligatorio de cuatro clausulas fijas que bloquea la inscripcion, y forzar esa forma sobre todo lo demas habria sido un error. Un disclaimer es independiente, con su clave, su audiencia (todos, adultos o menores) y su obligatoriedad. La propiedad que da sentido a la fila: la aceptacion queda ligada a una version y a su hash de contenido, no a la clave, asi que publicar v2 devuelve la fila a la lista del participante, se lo dice como reconsentimiento y conserva la aceptacion de v1 como historial. Aceptar con un hash desactualizado se rechaza con codigo propio. La plataforma no trae ni una palabra de texto legal: todo lo escribe office, y el panel lo dice. Office ve la adopcion como recuento, nunca como lista de personas. Dominio 20, servicio 18, callables 12, cliente web y dos paneles. Rules deny-by-default en ambas colecciones. Golden path 19/19 en Emulator y gate completo verde. El texto legal real sigue bloqueado por T011.",
    ["tasks.md", "apps/functions/src/consents", "apps/functions/src/documents"],
    "special",
  ),
  task(
    "T118",
    "Separar el acceso de miembros (/login) del acceso de staff (/staff/login)",
    "aprobada",
    "Miembros entran desde la landing; staff entra por una URL sin enlaces y el claim decide el destino.",
    "T014,T015,T077,T102",
    "Implementada el 2026-09-06 por instruccion del operador. /login sin selector de rol; /staff/login con robots noindex y X-Robots-Tag, sin enlaces publicos. Tras iniciar sesion, los claims deciden: office -> /admin, coaches -> /coach; una cuenta sin claim de staff se cierra en el acto. Corrige el callejon sin salida de los coaches (returnPath/returnTo y /coach no permitido). Gates de /admin y /coach enlazan a /staff/login?returnTo=. Unitarias web 409, node 1631, E2E estatico 43 + 1 omitida, lint, typecheck y prettier en verde. Aprobada por el operador el 2026-09-06.",
    [
      "tasks.md",
      "STACK.md",
      "apps/web/src/lib/login-flow.ts",
      "apps/web/src/app/staff/login/page.tsx",
    ],
    "mvp",
  ),
  task(
    "T119",
    "Reducir el panel administrativo al alcance del piloto y retirar codigo muerto",
    "aprobada",
    "Nav de 19 a 11 entradas en cinco grupos; fuera lo duplicado, lo v2 sin productor y lo que el BRIEF excluye.",
    "T078,T081,T091,T102",
    "Implementada el 2026-09-06 tras una auditoria de 16 grupos de paneles con verificacion adversarial. Borrados Groups y Activities (duplicados que escribian coach-1 y horas UTC), la vista web de Regyfit Access Records, la ruta duplicada /admin/overview, preview-data, el adaptador offline de T065, el componente y helpers MFA de T017 y peer-comparison.tsx con alumnos ficticios. Fuera del nav pero intactos: Class waitlists, CRM, Retention y Lesson plans. Families desde Members, dashboard financiero desde Billing. Coaches: /coach como inicio y en /admin solo Attendance (+ Classes para headCoach). Mismas compuertas que T118. Aprobada por el operador el 2026-09-06.",
    ["tasks.md", "apps/web/src/app/admin/admin-shell.tsx"],
    "mvp",
  ),
  task(
    "T120",
    "Cliente comprador y cliente estudiante, con catalogo de tienda publico",
    "aprobada",
    "Quien solo quiere comprar no necesita ser estudiante, y ver la tienda no deberia exigir cuenta.",
    "T015,T105,T118",
    "Aprobada por el operador el 2026-09-06 para el alcance sintetico registrado. El hallazgo real: setCustomUserClaims solo se llamaba desde el provisioning de admins y la gestion de staff, asi que quien se registraba con Google quedaba sin ningun claim y, como todos los callables exigen uno, quedaba bloqueado para siempre sin que nadie pudiera arreglarlo. Corte 1: catalogo publico sin sesion con App Check, solo productos activos. Corte 2: rol shopper en el vocabulario del dominio y callable registerShopperAccount que asigna el claim solo si la cuenta no tiene rol, nunca sobrescribe uno concedido por la academia, rechaza una cuenta de otra academia, no acepta payload (la academia sale de ACADEMY_ID), relee el claim y revierte si no cuajo, y deja auditoria. El modelo de acceso es lista blanca por requisito, asi que un rol que ninguna lista nombra queda denegado por construccion, con prueba que lo fija para los cuatro ambitos. En la web la sesion pide el rol una vez por cuenta y solo cuenta como iniciada si el token refrescado trae el claim; ClientAuthGate admite por defecto solo roles de estudiante y a un comprador le dice que el area es de estudiantes. Pendiente del operador: definir ACADEMY_ID en el entorno de Functions antes de desplegar, porque su valor por defecto es demo-academy.",
    ["tasks.md", "apps/functions/src/shop", "apps/web/src/app/shop"],
    "mvp",
  ),
  task(
    "T121",
    "Solicitud de inscripcion autoservicio y bandeja de solicitudes en miembros",
    "aprobada",
    "El solicitante llena sus datos una vez y office los revisa, en lugar de volver a teclearlos.",
    "T090,T093,T094,T117,T120",
    "Alta 2026-09-06. Corte 1 aprobado por el operador el 2026-09-06: contrato que reutiliza literalmente la forma del alta administrativa menos las dos casillas de office, requestId y membershipNumber, para que nadie reclame el numero de socio de otro; la edad decide el flujo en vez del checkbox; coleccion tenant-scoped con estado, auditoria y una sola solicitud abierta por persona; callables de envio, listado propio y retirada para roles de cliente incluido shopper, y listado y devolucion con nota para office. Corte 3a: pagina /enrol con el formulario del solicitante, que pide sesion, manda a /account a quien ya es estudiante y muestra el estado con la nota de office si ya hay solicitud abierta. Corte 3b: bandeja en /admin/members/requests que lista nombre, tipo, numero de menores, centro y estado, sin fecha de nacimiento ni direccion, y avisa cuando la pagina esta llena. Correcciones del 2026-09-06 tras auditoria: el guardia de una sola solicitud abierta podia fallar en silencio tras 20 filas de historial y ahora es un documento por solicitante; la cola ordena y declara truncado; el contrato rechaza adulto que ademas inscribe hijos, combinacion que ningun claim puede representar; el telefono pasa a obligatorio porque el documento de cliente no parsea sin el. Corte 2 implementado el 2026-09-06, alcance confirmado por el operador: adulto y tutor juntos, mas la proyeccion de detalle. La aprobacion no es una transaccion y no puede serlo, porque el estudiante vive en Firestore, el rol vive en Auth y createFamily exige el rol ya puesto; la solicitud misma es el cerrojo y fija la clave de idempotencia de la escritura administrativa, cada paso es idempotente bajo esa clave, y una secuencia cortada a medias queda en approval-failed, nunca en approved ni de vuelta con el solicitante. Sin ese cerrojo dos revisores concurrentes habrian creado dos estudiantes para una persona. Adulto: ficha primero y rol despues. Tutor: documento de cliente, claim guardian y createFamily, en ese orden porque el escritor de familias lo impone. Tres defectos destapados y corregidos de paso: el borrador de familia no llevaba gender ni frequencyNote y tiraba en silencio lo que el solicitante contesto sobre cada menor; el escritor de auditoria fijaba resultado completed para toda accion fuera de dos nombres, asi que la lectura restringida nueva habria afirmado algo falso; y los dos estados nuevos dejaban atrapada una solicitud que solo el solicitante podia arreglar, asi que office ahora puede devolverla con nota desde approval-failed. Corte 2 aprobado por el operador el 2026-09-06 y verificado en Emulator ese mismo dia: Rules 92/92 y E2E autenticado 6/6 contra Firestore y Auth reales. El E2E prueba lo que las unitarias no pueden: el defecto de T122 no vuelve, porque tras aprobar el miembro guarda su perfil y la academia sigue teniendo un estudiante y no dos, con los dos writers compartiendo Firestore en vez de un doble. Limite escrito: la prueba que manda dos aprobaciones juntas no es una carrera, porque el emulador las serializa. Corte 3c implementado el 2026-09-06 y con el la fila queda construida entera. La decision de diseno que cierra el hallazgo original: el boton de aprobar nace deshabilitado y solo se habilita cuando el revisor ha abierto de verdad la solicitud, porque office podia aprobar mirando un nombre y un centro sin haber visto nunca la fecha de nacimiento ni el contacto de emergencia que aprobaba; comprobado por mutacion. El detalle se pide bajo demanda y se cachea, nunca uno por fila, porque cada lectura esta auditada y gasta del mismo presupuesto restringido que leer una ficha. Aprobada el 2026-09-06 para el alcance sintetico/Emulator registrado; siguen vigentes para produccion el texto legal bloqueado por T011 y los tres secretos placeholder del directorio canonico.",
    [
      "tasks.md",
      "docs/superpowers/specs/2026-09-06-t121-slice-2-approval-design.md",
      "apps/functions/src/members",
      "apps/web/src/app/enrol",
    ],
    "mvp",
  ),
  task(
    "T122",
    "Vincular un miembro creado por office con la cuenta del propio miembro",
    "aprobada",
    "Una persona, una ficha: la que crea office y la que usa el miembro al entrar tienen que ser la misma.",
    "T093,T094",
    "Alta 2026-09-06 tras la auditoria del camino de aprobacion de T121. Defecto verificado y anterior a T121: el alta administrativa escribia el estudiante sin userId y sin reservar la clave auth-user-id, mientras que saveClientProfile busca al titular por userId y, al no encontrarlo, crea otra ficha con su propia familia y su documento de cliente. Es decir, si office daba de alta a alguien y esa persona entraba y guardaba su perfil, la academia acababa con dos fichas de la misma persona, una con los datos y sin acceso y otra con el acceso y sin los datos, y nada lo detectaba. Implementado el 2026-09-06: createAdminAdultForAccount escribe las dos mitades en una transaccion; los dos caminos comparten un solo plan de escritura cuyo unico parametro nuevo es la cuenta, asi que el alta sin cuenta queda igual, con prueba que lo fija. Falla cerrado sin telefono y ante una cuenta que ya tiene familia o documento de cliente. La prueba decisiva corre los dos writers sobre el mismo almacen y comprueba que el perfil del miembro adopta la ficha de office; con el vinculo desactivado esa misma prueba devuelve una segunda ficha, que es el defecto. Los guardias se comprobaron por mutacion. Al 2026-09-06 el corte 2 de T121 consume el metodo, asi que ya no es una capacidad sin flujo, y el camino de tutor con menores quedo disenado e implementado alli, sin pasar por este metodo porque el tutor no es estudiante. Aprobada por el operador el 2026-09-06 sobre evidencia unitaria y de mutacion, no sobre Emulator: esa verificacion, que el criterio de cierre de la fila exige por escrito, no se ejecuto porque firebase-tools pide Java 21 y aqui hay 1.8. Ese mismo dia se verifico en Emulator, que es lo que su criterio de cierre exigia: el supuesto bloqueo por Java era falso, el JDK 21 estaba instalado y un Oracle 8 lo tapaba en el PATH. El plan de escritura union se probo contra Firestore real con adulto y con tutor mas menores, y se reprodujo el escenario del defecto de punta a punta. La fila ya no descansa en evidencia unitaria: cumple su criterio.",
    [
      "tasks.md",
      "docs/superpowers/specs/2026-09-06-t122-member-account-link-design.md",
      "apps/functions/src/members",
    ],
    "mvp",
  ),
  task(
    "T123",
    "Corregir la etiqueta de destino del run de importacion PDF del 2026-08-12",
    "aprobada",
    "Un registro que afirma haber corrido contra staging cuando corrio contra produccion.",
    "T107",
    "Alta 2026-09-06, hallazgo de la reconstruccion del grafo de conocimiento. docs/data/migrations/member-pdf-import-run-2026-08-12.yaml sigue llevando targetLabelUsed: staging-allowlist sobre lo que en realidad era el proyecto de produccion. El runbook ya anota que la etiqueta fue incorrecta, pero el registro del run conserva la afirmacion falsa, asi que quien lo lea sin el runbook al lado concluye que aquello corrio contra staging. No cambia ningun dato: corrige el registro para que diga lo que paso. Implementada y aprobada el 2026-09-06: targetLabelUsed: staging-allowlist se reemplazo por target: production, targetProjectId: bptjersey-f5a25 y guardLabelInCode: staging-allowlist, con una nota que explica que la etiqueta del guardia estaba mal pero el destino no fue un error y que no existia entonces ni existe ahora un proyecto staging separado. La etiqueta incorrecta deja de estar donde un lector busca el entorno. Se corrigieron ademas dos lineas del checkpointPlan que llamaban staging a lo que fue produccion, y la nota del README apunta al campo nuevo. Segundo requisito cumplido: staging-allowlist aparece solo en esos dos archivos y ambos quedan correctos. Ningun dato, hash, recuento ni evidencia de backup de la corrida se toco.",
    [
      "tasks.md",
      "docs/data/migrations/member-pdf-import-run-2026-08-12.yaml",
      "docs/data/migrations/README.md",
    ],
    "mvp",
  ),
  task(
    "T124",
    "Verificar en Emulator y Rules el camino de inscripcion autoservicio",
    "aprobada",
    "La deuda de verificacion del camino de inscripcion, como trabajo visible y no como nota al pie.",
    "T121,T122",
    "Alta 2026-09-06 por decision del operador, al aprobar T122 y el corte 2 de T121 sobre evidencia unitaria y de mutacion. Existe para que ninguna de las dos filas afirme una prueba que no se ejecuto. Bloqueada por el entorno, no por el codigo: firebase-tools exige Java 21 y el JDK instalado es 1.8, asi que ni pnpm test:rules ni firebase emulators:exec pueden correr aqui. Hay que verificar el caso de Rules que fija enrolmentRequests y enrolmentRequestHolds como inalcanzables desde cliente, escrito el 2026-09-06 y nunca ejecutado; el plan de escritura union de T122 contra Firestore real con adulto y con tutor mas menores, que es el criterio de cierre textual de esa fila; que dos beginApproval simultaneas se serialicen de verdad sobre el documento de la solicitud, porque el cerrojo que impide dos estudiantes para una persona esta razonado y probado en unidad pero no observado bajo concurrencia; y el E2E del camino completo, que hoy no existe. Resuelta el mismo dia y el motivo del bloqueo era falso: el JDK 21 estaba instalado desde antes y un java.exe de Oracle 8 lo tapaba en el PATH, asi que java -version decia 1.8 y firebase-tools se negaba. Anteponiendo el JDK real: Rules 13 archivos y 92/92, con el caso de enrolmentRequests ejecutado por primera vez; plan de escritura union contra Firestore real con adulto y con tutor mas menores, incluido el escenario del defecto de T122 reproducido de punta a punta; y E2E del camino completo escrito y encadenado al runner de T093, 4/4. Un punto no se cumplio y no se finge: el emulador de Functions serializa las invocaciones con un solo worker, asi que dos aprobaciones enviadas juntas no compiten. Comprobado por mutacion, con la clave de idempotencia sin fijar la suite igual pasaba, asi que la prueba se renombro para decir lo que cubre de verdad y el limite quedo escrito en el spec y en la documentacion de emuladores.",
    [
      "tasks.md",
      "docs/superpowers/specs/2026-09-06-t121-slice-2-approval-design.md",
      "qa/rules/default-deny.test.ts",
    ],
    "mvp",
  ),
  task(
    "T125",
    "Decidir que se hace con las contrasenas en claro importadas de Regyfit",
    "aprobada",
    "Credenciales reales de miembros guardadas en texto y legibles sin dejar rastro: riesgo aceptado por el operador el 2026-09-07.",
    "T107",
    "Alta 2026-09-06, hallazgo verificado al redactar la DPIA de T011. Decidida por el operador el 2026-09-07: opcion (c) de la DPIA, se conserva el campo tal cual y se documenta la aceptacion del riesgo. Razon del operador: son datos reales que se necesitan para usar y hacer el seguimiento, el administrador ya tiene permiso de uso, y por eso se migra lo real. Lo que se acepta, sin adornos: el campo password de los 249 registros importados el 2026-09-04 sigue en claro, getRegyfitMemberRecord devuelve el registro entero a cualquier claim de administrador y member-profile-panel.tsx lo imprime como una fila mas de la ficha; siguen ausentes los cuatro controles que si tiene el directorio canonico -proposito declarado, evento de auditoria por lectura, limite de lecturas por actor y sonda de vitalidad-, asi que nadie puede saber despues quien leyo una contrasena y un administrador revocado la sigue leyendo mientras su token no expire. Precision anotada al decidir: el seguimiento de uso lo dan login, logins y lastLogin; password no lo lee el sistema para nada, solo se imprime. Dos numeros que nadie ha contado y que la decision no necesita pero la DPIA agradeceria: cuantos de los 249 traen password no vacio -el campo es optional- y cuantos son menores; ambos son contables en solo lectura. La fila cierra porque lo unico que faltaba era la decision; la aceptacion quedo en la seccion 3.1 del acta de T011, firmada ese mismo 2026-09-07 por poder (Andres Santiago, p.p. Vladimiro Afonso), y el riesgo residual de la DPIA sigue siendo alto.",
    [
      "tasks.md",
      "docs/operations/t011-dpia-draft.md",
      "packages/domain/src/members/regyfit-member-record-contracts.ts",
    ],
    "mvp",
  ),
  task(
    "T126",
    "Completar la identidad registrada del controller: domicilio y forma no incorporada exacta",
    "aprobada",
    "El unico dato que le quedaba a T011 y que no era una decision. Bloquea contratos de encargado, no releases.",
    "T011",
    "Alta 2026-09-07 al cerrar T011. El operador declaro ese dia la entidad no incorporada ni registrada, con lo que la forma juridica quedo declarada y el numero de registro cerrado por inexistencia; cerrada el 2026-09-07 con los dos datos que pedia: el domicilio, `Office 9, 13 Library Place, St Helier`, la misma direccion que la sede Town, y la forma exacta, sole trader. Un sole trader es una persona fisica, asi que el controller no es una entidad: es Vladimiro Afonso trading as Brazilian Power Team - Jersey, y los tres documentos se corrigieron para nombrarle a el. El bloque de firma del acta no se reescribio: cambio la descripcion de la parte firmada, no quien firmo. Desbloquea contratos de encargado, polizas y el texto legal publicado de T117. La distincion no es cosmetica: un sole trader es una persona fisica, y entonces el controller no es una entidad sino Vladimiro Afonso comerciando bajo el nombre. Bloquea cualquier contrato de encargado -un DPA nombra con exactitud a quien responde-, cualquier poliza y el texto legal publicado de T117; no bloquea ninguna release, ni T058 ni T059 ni el paso 2 de T106 ni T108. Se cierra con dos lineas del operador: no hay nada que el asistente pueda aportar aqui sin inventar una identidad juridica, que es justo lo que esta cadena de filas lleva evitando desde el 2026-09-05.",
    [
      "tasks.md",
      "docs/operations/t011-retention-residency-erasure-policy.md",
      "docs/operations/t011-dpia-draft.md",
      "docs/operations/t011-controller-approval-acta-draft.md",
    ],
    "mvp",
  ),
];

const projectData = {
  /**
   * Last evidence date reflected here for each task, as dated in tasks.md headings.
   * `qa/unit/lista-evidence-sync.test.ts` fails when tasks.md records newer evidence than the
   * date below, which is what happens when the ledger advances and this board is left behind.
   * When you update a task's evidence here, move its date forward in the same edit.
   */
  evidenceSyncDates: {
    T001: "2026-08-06",
    T002: "2026-08-06",
    T003: "2026-08-06",
    T004: "2026-08-06",
    T005: "2026-08-06",
    T006: "2026-08-06",
    T007: "2026-08-06",
    T008: "2026-08-25",
    T009: "2026-08-25",
    T010: "2026-09-06",
    T011: "2026-09-07",
    T012: "2026-08-07",
    T013: "2026-08-07",
    T014: "2026-08-18",
    T016: "2026-08-09",
    T017: "2026-08-09",
    T018: "2026-08-25",
    T022: "2026-08-19",
    T023: "2026-08-24",
    T024: "2026-08-24",
    T025: "2026-08-22",
    T032: "2026-08-19",
    T033: "2026-08-19",
    T034: "2026-08-28",
    T037: "2026-08-19",
    T038: "2026-08-19",
    T043: "2026-08-26",
    T044: "2026-08-26",
    T046: "2026-08-23",
    T047: "2026-08-24",
    T048: "2026-08-24",
    T049: "2026-08-24",
    T050: "2026-08-24",
    T051: "2026-08-24",
    T052: "2026-08-24",
    T053: "2026-08-24",
    T054: "2026-08-25",
    T055: "2026-08-28",
    T057: "2026-08-30",
    T058: "2026-09-07",
    T060: "2026-08-30",
    T062: "2026-08-31",
    T063: "2026-08-30",
    T064: "2026-08-31",
    T065: "2026-08-31",
    T066: "2026-09-01",
    T067: "2026-09-01",
    T082: "2026-08-13",
    T083: "2026-08-23",
    T084: "2026-08-18",
    T085: "2026-08-18",
    T086: "2026-08-24",
    T087: "2026-08-25",
    T088: "2026-08-28",
    T089: "2026-08-31",
    T090: "2026-09-01",
    T091: "2026-09-01",
    T092: "2026-09-03",
    T093: "2026-09-05",
    T094: "2026-09-05",
    T095: "2026-09-05",
    T096: "2026-09-05",
    T097: "2026-09-05",
    T098: "2026-09-05",
    T099: "2026-09-07",
    T100: "2026-09-03",
    T101: "2026-09-04",
    T102: "2026-09-04",
    T103: "2026-09-04",
    T104: "2026-09-05",
    T105: "2026-09-04",
    T106: "2026-09-07",
    T107: "2026-09-05",
    T108: "2026-09-07",
    T109: "2026-09-05",
    T110: "2026-09-05",
    T111: "2026-09-05",
    T112: "2026-09-06",
    T113: "2026-09-06",
    T114: "2026-09-05",
    T115: "2026-09-05",
    T116: "2026-09-06",
    T117: "2026-09-06",
    T061: "2026-09-06",
    T036: "2026-09-06",
    T035: "2026-09-06",
    T118: "2026-09-06",
    T119: "2026-09-06",
    T120: "2026-09-06",
    T121: "2026-09-06",
    T122: "2026-09-06",
    T123: "2026-09-06",
    T124: "2026-09-06",
    T125: "2026-09-07",
    T126: "2026-09-07",
    T127: "2026-09-07",
    T068: "2026-09-06",
    T069: "2026-09-06",
    T070: "2026-09-06",
    T071: "2026-09-06",
  },
  cutoffDate: "2026-09-07",
  sourceLedger: "tasks.md",
  ledgerCutoffDate: "2026-09-04",
  sourceFiles: [
    "tasks.md",
    "BRIEF.md",
    "STACK.md",
    "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx",
    "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx",
    "docs/superpowers/specs/2026-08-13-project-progress-list-design.md",
    "docs/superpowers/plans/2026-08-13-project-progress-list.md",
  ],
  statuses: VALID_STATUSES,
  stages: [
    stage(
      "phase-0",
      "phase-0",
      "Fase 0 - Decisiones operativas",
      "Decisiones abiertas con su bloqueo real; proveedor, retención y producción no detienen el piloto aislado.",
      "bloqueada",
      phase0Items,
    ),
    stage(
      "m0-foundations",
      "mvp",
      "M0 - Bases técnicas",
      "Bases técnicas aprobadas y documentación de seguridad. T008-T011 solo aparecen en la Fase 0.",
      "aprobada",
      foundationItems,
    ),
    stage(
      "m1-identity",
      "mvp",
      "M1 - Identidad, autorización y auditoría",
      "Bases de identidad, autorización, consentimiento y auditoría para la plataforma protegida de la academia.",
      "aprobada",
      identityItems,
    ),
    stage(
      "m2-people",
      "mvp",
      "M2 - Familias, estudiantes y personal",
      "Registros unificados de personas, relaciones familiares, datos restringidos y operaciones del personal.",
      "en-progreso",
      peopleItems,
    ),
    stage(
      "m2a-levels",
      "mvp",
      "M2A - Levels IBJJF MVP",
      "Catálogo completo de belts, stripes y habilidades disponible antes de progreso, reservas y operación del tatami.",
      "aprobada",
      levelsItems,
    ),
    stage(
      "m4-memberships",
      "mvp",
      "M4 - Membresías y pagos",
      "Planes y finanzas manuales del piloto; la integración online está marcada post-piloto.",
      "aprobada",
      membershipItems,
    ),
    stage(
      "m3-attendance",
      "mvp",
      "M3 - Horarios, reservas y asistencia",
      "Operaciones diarias de clases, registro de llegada, asistencia y salida de menores.",
      "aprobada",
      attendanceItems,
    ),
    stage(
      "m5-progress",
      "mvp",
      "M5 - Progreso y reconocimiento",
      "Evaluaciones basadas en evidencias y flujos de reconocimiento revisados por personas.",
      "aprobada",
      progressItems,
    ),
    stage(
      "m6-crm",
      "mvp",
      "M6 - Avisos y safeguarding; CRM post-piloto",
      "Avisos in-app protegidos para el piloto; las filas CRM/email están marcadas post-piloto.",
      "aprobada",
      crmItems,
    ),
    stage(
      "mvp-recovery",
      "mvp",
      "Recuperacion - Golden path operativo",
      "Convergencia de identidad y cierre desde onboarding hasta reportes, primero en Emulator y luego en staging separado.",
      "en-progreso",
      recoveryItems,
    ),
    stage(
      "m7-closeout",
      "mvp",
      "M7 - Paneles, informes y cierre del piloto",
      "Cierre verificable del piloto; producción y cierre global están marcados post-piloto.",
      "bloqueada",
      closeoutItems,
    ),
    stage(
      "special-lines",
      "special",
      "Líneas especiales",
      "Trabajo transversal seguido por separado del backlog MVP numerado.",
      "aprobada",
      specialItems,
    ),
    stage(
      "roadmap-v2",
      "roadmap",
      "Ruta v2 - Automatización y profundidad operativa",
      "Capacidades futuras después del lanzamiento MVP; estas entradas no son aprobaciones.",
      "pendiente",
      roadmapV2Items,
    ),
    stage(
      "roadmap-v3",
      "roadmap",
      "Ruta v3 - Participación, crecimiento y escala",
      "Capacidades futuras de participación, escala y plataforma; estas entradas no son aprobaciones.",
      "pendiente",
      roadmapV3Items,
    ),
  ],
  maintenanceSteps: [
    "Actualizar primero tasks.md porque es la fuente única de verdad del estado y la evidencia de las tareas.",
    "Actualizar Lista/Lista.js después, en el mismo cambio lógico, con el estado y la evidencia registrados, sin copiar datos sensibles.",
    "Ajustar Lista.html o Lista.css solo cuando cambie la estructura o la presentación del panel.",
    "Ejecutar las comprobaciones disponibles de sintaxis y del panel, y revisar el resultado.",
    "Subir tasks.md y los archivos modificados de Lista juntos cuando el trabajo con Git esté autorizado explícitamente.",
  ],
};

function flattenItems(stages) {
  return stages.flatMap((currentStage) =>
    currentStage.items.map((item) => ({
      ...item,
      ...getImplementationDetails(item),
      stageId: currentStage.id,
      stageTitle: currentStage.title,
      track: item.kind === "roadmap" ? "roadmap" : currentStage.track,
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
  decision: "Decisión",
  foundation: "Base técnica",
  mvp: "MVP",
  roadmap: "Ruta futura",
  special: "Línea especial",
};

const TRACK_LABELS = {
  "phase-0": "Fase 0",
  mvp: "MVP",
  special: "Líneas especiales",
  roadmap: "Ruta futura",
};

function filterItems(items, filters = {}) {
  return items.filter((item) => itemMatches(item, filters));
}

function getPhaseAnchorId(currentStage) {
  const stageId = String(currentStage?.id ?? "");
  const track = String(currentStage?.track ?? "");

  if (stageId === "phase-0" || track === "phase-0") return "phase-0";
  if (stageId === "special-lines" || track === "special") return "special-lines";
  if (stageId === "roadmap-v2") return "v2";
  if (stageId === "roadmap-v3") return "v3";
  if (track === "mvp") return "mvp";
  if (track === "roadmap") return "v2";
  return null;
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
            track: item.kind === "roadmap" ? "roadmap" : currentStage.track,
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

function renderResolutionBoard(resolutionList) {
  // A cancelled row has nothing left to resolve, so it does not belong on this board either.
  const unresolvedItems = flattenItems(projectData.stages).filter(
    (item) => item.status !== "aprobada" && item.status !== "cancelada",
  );
  resolutionList.replaceChildren();

  for (const item of unresolvedItems) {
    const entry = createElement("article", undefined, "resolution-item");
    entry.dataset.resolutionItem = item.id;

    const heading = createElement("div", undefined, "resolution-item-header");
    heading.append(
      createElement("span", item.id, "task-id"),
      createElement("h3", item.title, "resolution-item-title"),
      createStatusBadge(item.status, "resolution-item-status"),
    );

    const metadata = createElement("p", undefined, "resolution-item-meta");
    metadata.append(
      createElement("strong", "Dependencias: "),
      document.createTextNode(item.dependsOn),
    );

    const requirements = createElement("ol", undefined, "resolution-requirements");
    for (const requirement of getResolutionRequirements(item)) {
      requirements.append(createElement("li", requirement));
    }

    entry.append(heading, metadata, requirements);
    resolutionList.append(entry);
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

globalThis.ListaProject = {
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
};
