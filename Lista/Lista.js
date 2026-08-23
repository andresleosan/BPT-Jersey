const VALID_STATUSES = [
  "aprobada",
  "revisión",
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
  T032: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-6 verificadas: suite 572/572; Rules 30/30; domain 11/11 y regresión 98/98; store 15/15; runtime 2/2; callables 13/13 y regresión 31/31; Emulator 4/4 con casos individuales 1/1; lint/typecheck/build/formato/diff pasaron; audit sin high/critical, con DR-001 moderadas; el rate-limit de catálogo permanece documentado como control transversal que bloquea producción, no resuelto por T032; pendiente aprobación formal.",
  },
  T008: {
    implementationStatus: "bloqueada",
    implementationEvidence:
      "Paquete de decisión preparado en docs/operations/academy-configuration-decision-packet.md; Town/West, catálogo y reglas base aprobados en BRIEF.md; bloqueada hasta confirmación de horarios, capacidades y reglas comerciales. No se promovieron valores provisionales a producción.",
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
    implementationStatus: "parcial",
    implementationEvidence:
      "Adaptador R2 y URLs firmadas para documentos/PDF probados; los waivers completos siguen pendientes.",
  },
  T025: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-4 verificadas: suite unitaria 90 archivos/701 pruebas; Rules 6 archivos/50 pruebas; Emulator integration 9/9; UI /admin/staff y E2E sintético 10/10; Auth Emulator E2E 2/2; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; pendiente aprobación formal.",
  },
  T049: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Panel visible con preview sintético; la persistencia canónica real sigue pendiente.",
  },
  T050: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Panel financiero visible en preview; la persistencia real sigue pendiente.",
  },
  T051: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Informes y exportes de miembros visibles y probados; el conjunto completo del MVP sigue pendiente.",
  },
  T053: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Exportación PDF de miembros con límites, rate limit y cleanup probada; la exportación general sigue pendiente.",
  },
  T055: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Pruebas unitarias, Rules, integración y E2E sintético documentadas; el QA completo por rol y release siguen pendientes.",
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

  if (item.status === "revisión") {
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
  };
}

function stage(id, track, title, description, status, items) {
  return { id, track, title, description, status, items };
}

const phase0Items = [
  task(
    "T008",
    "Confirmar horarios, capacidades y reglas comerciales todavía configurables",
    "pendiente",
    "Completar los valores configurables que los DOCX no fijan.",
    "-",
    "Town/West, catálogo y reglas base están aprobados; faltan horarios, capacidades, freeze, descuentos y refunds.",
    ["tasks.md", "BRIEF.md"],
    "decision",
  ),
  task(
    "T009",
    "Confirmar los criterios y pesos de evaluación y reconocimiento",
    "bloqueada",
    "Definir criterios uniformes de rendimiento y pesos de reconocimiento bajo la responsabilidad del entrenador principal.",
    "-",
    "Bloqueada a la espera de la aprobación del entrenador principal.",
    ["tasks.md", "BRIEF.md"],
    "decision",
  ),
  task(
    "T010",
    "Seleccionar un proveedor de pagos disponible en Jersey para post-piloto",
    "bloqueada",
    "Elegir el proveedor manteniendo los pagos detrás de un adaptador independiente del proveedor.",
    "-",
    "Bloqueada a la espera de la decisión técnica y la aprobación de costos; no bloquea el piloto manual.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
    "decision",
  ),
  task(
    "T011",
    "Confirmar la política de retención, residencia y eliminación",
    "bloqueada",
    "Confirmar la política aplicable a los datos de la academia, menores e información restringida.",
    "-",
    "Paquete de decisión preparado en docs/operations/t011-retention-residency-deletion-decision-packet.md; bloqueada a la espera de la aprobación de la política y del asesoramiento aplicable para Jersey.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
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
    "T007,T008",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T014",
    "Implementar autenticación por correo/contraseña y Google con emulador",
    "revisión",
    "Proporcionar los flujos iniciales de registro, inicio y cierre de sesión.",
    "T004,T084",
    "Google usa el popup SDK conectado al Auth Emulator; email/Google y login sin MFA revalidados con unitarias, integración local y E2E responsive.",
    ["tasks.md", "BRIEF.md", "STACK.md", "docs/adr/ADR-005-admin-auth-without-mfa.md"],
    "mvp",
  ),
  task(
    "T015",
    "Implementar roles y permisos personalizados de mínimo privilegio",
    "revisión",
    "Aplicar el modelo aprobado de roles y alcance de academia.",
    "T013,T014",
    "Parser exacto para seis roles, compatibilidad administrativa, pruebas negativas y gates globales aprobados sin ampliar provisioning.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T016",
    "Implementar reglas de Firestore y RTDB con pruebas de aislamiento",
    "revisión",
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
    "revisión",
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
    "revisión",
    "Crear la carcasa autenticada compartida y las bases de navegación.",
    "T002,T015",
    "Shell responsive, navegación por rol y QA de teclado/móvil documentados; falta aprobación formal.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T020A",
    "Integrar identidad visual oficial y navegación de inicio",
    "revisión",
    "Aplicar los recursos de identidad aprobados, metadatos y rutas de inicio.",
    "T002,T017,T020",
    "Los recursos, rutas y controles adaptables están documentados; la aprobación explícita sigue pendiente.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T021",
    "Implementar perfiles de adultos, menores y tutores",
    "revisión",
    "Proporcionar perfiles autorizados sin crear cuentas individuales para menores.",
    "T016,T020",
    "Primer WIP documental: campos de nombre, fecha de nacimiento, teléfono, email, sede y preferencias horarias.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T022",
    "Implementar familias con varios menores y relaciones autorizadas",
    "revisión",
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
    "pendiente",
    "Proteger la información de apoyo restringida con pruebas de permisos negativos.",
    "T021,T011",
    "El flujo de datos restringidos todavía está pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T024",
    "Implementar documentos privados y URLs firmadas de R2",
    "pendiente",
    "Mantener autorizados, breves y protegidos el acceso a consentimientos y documentos privados.",
    "T016,T021,T023",
    "Subida y acceso privado del PDF firmado del waiver; evidencia, hash, permisos y expiración probados.",
    ["tasks.md", "STACK.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T018",
    "Implementar waiver versionado y aceptación de registro",
    "pendiente",
    "Completar el registro con el waiver único, aceptación, revocación y renovación sin sobrescritura destructiva.",
    "T016,T021,T022,T023,T024",
    "Waiver único versionado, PDF firmado, aceptación y UI de registro pendientes después de sus fundamentos.",
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
    "T008,T013,T025",
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
    "revisión",
    "Mantener trazables las correcciones mientras se registran los resultados de asistencia.",
    "T019,T028",
    "Contratos y parsers de corrección 58/58, store con correctionOf inmutable y reconciliación de no-shows 12/12, callables RBAC 10/10, client 9/9, suite completa 831/831 en 105 archivos; eventos de auditoría registrados.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T030",
    "Implementar salida de menores y autorización de recogida",
    "pendiente",
    "Registrar al adulto autorizado, la salida independiente o la confirmación del personal.",
    "T022,T029",
    "La salida de menores todavía está pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T031",
    "Implementar vista operativa en vivo sin duplicar la fuente canónica",
    "pendiente",
    "Mostrar las operaciones actuales de asistencia sin duplicar los registros canónicos.",
    "T029,T030",
    "La vista operativa en vivo todavía está pendiente.",
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
    "pendiente",
    "Mantener reemplazable la integración de pagos y fuera del manejo de datos de tarjeta sin procesar.",
    "T010,T012",
    "La decisión del proveedor y el adaptador están pendientes; no bloquean el piloto manual.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T035",
    "Implementar pago alojado y suscripciones post-piloto",
    "pendiente",
    "Usar flujos de pago alojados sin almacenar datos de tarjeta sin procesar.",
    "T034",
    "El pago alojado está fuera del piloto manual.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T036",
    "Implementar webhooks de pago post-piloto firmados e idempotentes",
    "pendiente",
    "Prevenir efectos financieros duplicados ante reintentos y eventos fuera de orden.",
    "T019,T035",
    "Los webhooks están fuera del piloto manual.",
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
    "pendiente",
    "Registrar evaluaciones basadas en evidencias con la visibilidad adecuada.",
    "T009,T021,T025,T083",
    "Las reglas de evaluación siguen dependiendo de T009 y cubren el catálogo completo de Levels del MVP.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T040",
    "Implementar checklist de habilidades y resumen de progreso",
    "pendiente",
    "Resumir técnicas, total de clases, horas, racha y belt/stripes sin promoción automática.",
    "T039",
    "El resumen completo de progreso del catálogo MVP todavía está pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T041",
    "Implementar rachas y candidatos de reconocimiento explicables",
    "pendiente",
    "Calcular asistencia, rachas y candidatos con pesos explícitos y ausencias médicas.",
    "T029,T039",
    "La generación de candidatos de reconocimiento todavía está pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T042",
    "Implementar revisión y aprobación exclusivas del entrenador principal",
    "pendiente",
    "Mantener todas las promociones del catálogo MVP bajo aprobación humana autorizada.",
    "T015,T041",
    "La aprobación del reconocimiento todavía está pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const crmItems = [
  task(
    "T043",
    "Implementar embudo de CRM, responsable y tareas post-piloto",
    "pendiente",
    "Dar seguimiento a prospectos y acciones operativas.",
    "T021,T025",
    "El embudo de CRM está fuera del piloto y no bloquea T056.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T044",
    "Implementar línea de tiempo automática de CRM post-piloto",
    "pendiente",
    "Registrar una sola vez los eventos relevantes en una línea de tiempo trazable.",
    "T019,T043",
    "La línea de tiempo de CRM está fuera del piloto y no bloquea T056.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T045",
    "Implementar anuncios y mensajes in-app de academia y clase",
    "pendiente",
    "Entregar avisos internos de academia y clase adecuados al rol.",
    "T025,T026",
    "Los anuncios todavía están pendientes.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T046",
    "Implementar email/SMS e historial externo de entrega post-piloto",
    "pendiente",
    "Integrar proveedores externos solo después del piloto.",
    "T045",
    "Email/SMS e historial externo están fuera del piloto.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T047",
    "Aplicar safeguarding a avisos de menores visibles al tutor",
    "pendiente",
    "Mantener la comunicación con menores visible para el tutor autorizado.",
    "T022,T045",
    "Las reglas de protección de comunicaciones todavía están pendientes.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T048",
    "Implementar recordatorios in-app de pagos y asistencia",
    "pendiente",
    "Admitir recordatorios internos con audiencia y resolución auditables.",
    "T029,T038,T045",
    "Los flujos de recordatorio todavía están pendientes.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const closeoutItems = [
  task(
    "T049",
    "Implementar panel diario de clases, asistencia y salida de menores",
    "revisión",
    "Dar a los operadores una vista coherente de la actividad diaria.",
    "T031",
    "Panel visible con preview sintético; la persistencia canónica real sigue pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T050",
    "Implementar panel de finanzas, saldos y renovaciones",
    "revisión",
    "Mostrar a los operadores las acciones financieras manuales y renovaciones.",
    "T038",
    "Panel financiero visible en preview; la persistencia real sigue pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T051",
    "Implementar informes de estudiantes, asistencia, membresías e ingresos manuales",
    "revisión",
    "Proporcionar informes operativos autorizados con totales conciliados.",
    "T029,T038",
    "Informes y exportes de miembros visibles y probados; el conjunto completo del piloto sigue pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T052",
    "Implementar informes de cobertura de progreso, reconocimiento y evaluación",
    "pendiente",
    "Informar la cobertura de progreso respetando los límites de privacidad.",
    "T042",
    "Los informes de progreso todavía están pendientes.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T053",
    "Implementar exportación de datos autorizada y auditable",
    "revisión",
    "Exportar únicamente los datos permitidos para el rol activo.",
    "T019,T051,T052",
    "Exportación PDF de miembros con límites, rate limit y cleanup probada; la exportación general sigue pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T054",
    "Configurar respaldos, restauración y guía de reversión",
    "pendiente",
    "Demostrar la capacidad de recuperación antes de producción.",
    "T013,T024",
    "La evidencia de respaldo y restauración todavía está pendiente.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T055",
    "Ejecutar pruebas de carga, contrato, seguridad, accesibilidad y roles",
    "revisión",
    "Ejecutar el control de calidad completo previo a la publicación.",
    "T018,T019,T021-T033,T037-T042,T045,T047-T054,T083",
    "Pruebas unitarias, Rules, integración y E2E sintético documentadas; el QA completo por rol y release siguen pendientes.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T056",
    "Ejecutar piloto controlado y corregir hallazgos",
    "pendiente",
    "Validar el MVP con datos controlados y un registro de piloto aprobado.",
    "T055",
    "La aprobación del piloto todavía está pendiente.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T057",
    "Preparar checklist post-piloto de producción, monitoreo, costos y reversión",
    "pendiente",
    "Completar los controles operativos antes de producción.",
    "T056",
    "La checklist de producción es posterior a T056.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T058",
    "Publicar en producción con confirmación explícita del operador",
    "pendiente",
    "Realizar la publicación solo después de superar todos los controles requeridos.",
    "T057",
    "La publicación en producción todavía está pendiente.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T059",
    "Cerrar el proyecto con análisis de brechas y LECCIONES.md",
    "pendiente",
    "Registrar la lección final del proyecto después de la publicación.",
    "T058",
    "El cierre del proyecto todavía está pendiente.",
    ["tasks.md"],
    "roadmap",
  ),
];

const roadmapV2Items = [
  task(
    "T060",
    "Booking avanzado, listas de espera, créditos y reservas recurrentes",
    "pendiente",
    "Ampliar reservas después del MVP; el corte básico de una hora pertenece a T027.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T061",
    "Reintentos, períodos de gracia, prorrateo, promociones y flujos de pausa/cancelación",
    "pendiente",
    "Automatizar operaciones más profundas del ciclo de facturación.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T062",
    "Alertas de retención y automatización de CRM",
    "pendiente",
    "Automatizar acciones seleccionadas de retención y CRM.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T063",
    "Autoservicio ampliado para tutores y adultos",
    "pendiente",
    "Ampliar el autoservicio sin debilitar los límites de roles.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T064",
    "Notificaciones externas y automatizadas completas",
    "pendiente",
    "Ampliar cobertura después de los avisos in-app básicos de T045 y T048.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T065",
    "Asistencia sin conexión con sincronización y resolución de conflictos",
    "pendiente",
    "Admitir operación controlada sin conexión y conciliación.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T066",
    "Biblioteca técnica ampliada y planificación avanzada de lecciones",
    "pendiente",
    "Añadir profundidad al currículo básico y la aprobación humana del piloto.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
];

const roadmapV3Items = [
  task(
    "T067",
    "Objetivos, logros y resúmenes familiares ampliados",
    "pendiente",
    "Añadir participación después de las rachas básicas de T041.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T068",
    "Aplicaciones nativas para iOS y Android",
    "pendiente",
    "Considerar clientes nativos después de validar el producto web.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T069",
    "Comunidad moderada",
    "pendiente",
    "Añadir funciones comunitarias controladas con protección.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T070",
    "Referidos, clases privadas, competiciones y tienda",
    "pendiente",
    "Ampliar crecimiento y comercio después de los seminarios operativos de T026.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T071",
    "Analítica, IA asistida, multiacademia, marca blanca y SaaS",
    "pendiente",
    "Considerar funciones de escala solo cuando el producto central sea estable.",
    "-",
    "Elemento de ruta futura; no implica aprobación del MVP.",
    ["tasks.md", "BRIEF.md", "STACK.md"],
    "roadmap",
  ),
];

const specialItems = [
  task(
    "T072",
    "Ejecutar descubrimiento estructural read-only de Regyfit",
    "revisión",
    "Ejecutar descubrimiento estructural read-only de Regyfit.",
    "T007,T013",
    "Manifiesto sanitizado, contratos y Playwright offline 2/2; entidades fuente todavía insuficientes para aprobar el mapeo.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T073",
    "Implementar autorización, locks y provisioning administrativo de Regyfit",
    "revisión",
    "Implementar autorización, locks y provisioning administrativo de Regyfit.",
    "T015,T016",
    "Locks renovables, fencing, recuperación y compensación fail-closed; 32 pruebas focused y 83 de suite documentadas.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T074",
    "Construir shell y panel read-only administrativo de Regyfit",
    "revisión",
    "Construir shell y panel read-only administrativo de Regyfit.",
    "T020,T015",
    "Shell responsive, proyecciones owner/safe, filtros, foco, 24 E2E sintéticos; falta aprobación/live Auth completa.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T075",
    "Implementar importer Regyfit idempotente y aplicar lote aprobado",
    "revisión",
    "Implementar importer Regyfit idempotente y aplicar lote aprobado.",
    "T073,T074",
    "Importer protegido, dry-run e importación de 10 registros verificada; lectura live owner/administrator y alertas de facturación pendientes.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T076",
    "Publicar callable protegido de registros Regyfit",
    "revisión",
    "Publicar callable protegido de registros Regyfit.",
    "T074,T075",
    "Callable v2 desplegado y smoke sin identidad devuelve 403; verificación Auth live queda pendiente.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T077",
    "Implementar gateway unificado de login, logout y acceso administrativo",
    "revisión",
    "Implementar gateway unificado de login, logout y acceso administrativo.",
    "T014,T015",
    "Email/Google, destinos allowlisted, logout, E2E sintético y verificación manual staging documentados; live Auth automatizado opt-in.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T078",
    "Entregar panel administrativo visible con preview sintético",
    "revisión",
    "Entregar panel administrativo visible con preview sintético.",
    "T020,T021",
    "Overview, Members, Groups, Activities, Attendance, Reports, CRM y Finance con filtros y QA 374/374; persistencia real posterior.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T079",
    "Implementar operaciones de miembros, informes y exportación PDF protegida",
    "revisión",
    "Implementar operaciones de miembros, informes y exportación PDF protegida.",
    "T021,T024,T053",
    "Callables, límites, rate limit, export journal, PDF Unicode, integración Firestore y QA 427/427 documentados.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T080",
    "Validar lote real de PDFs de miembros y planificar importación",
    "revisión",
    "Validar lote real de PDFs de miembros y planificar importación.",
    "T079,T054",
    "8 reportes, 243 canónicos, 0 conflictos tras resolución y dry-run aprobado; backup/restauración y apply staging pendientes.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T081",
    "Implementar navegación responsive administrativa y tablas ordenables",
    "revisión",
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
    "revisión",
    "Eliminar el alias production-as-staging antes de continuar el MVP.",
    "T080,T085",
    "Runner/CLI emulator-only, fuente sintética temporal, symlinks rechazados y gates globales verdes.",
    ["tasks.md", "STACK.md"],
    "special",
  ),
  task(
    "T085",
    "Fijar nanoid parcheado y excluir caches Graphify del formatter",
    "revisión",
    "Resolver los gates globales de seguridad y formato sin modificar artefactos generados.",
    "T002",
    "nanoid 3.3.18, audit sin high/critical y formato global verde sin modificar caches generadas.",
    ["tasks.md", "package.json", ".prettierignore"],
    "special",
  ),
];

const projectData = {
  cutoffDate: "2026-08-19",
  sourceLedger: "tasks.md",
  ledgerCutoffDate: "2026-08-19",
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
      "en-progreso",
      identityItems,
    ),
    stage(
      "m2-people",
      "mvp",
      "M2 - Familias, estudiantes y personal",
      "Registros unificados de personas, relaciones familiares, datos restringidos y operaciones del personal.",
      "revisión",
      peopleItems,
    ),
    stage(
      "m2a-levels",
      "mvp",
      "M2A - Levels IBJJF MVP",
      "Catálogo completo de belts, stripes y habilidades disponible antes de progreso, reservas y operación del tatami.",
      "revisión",
      levelsItems,
    ),
    stage(
      "m4-memberships",
      "mvp",
      "M4 - Membresías y pagos",
      "Planes y finanzas manuales del piloto; la integración online está marcada post-piloto.",
      "pendiente",
      membershipItems,
    ),
    stage(
      "m3-attendance",
      "mvp",
      "M3 - Horarios, reservas y asistencia",
      "Operaciones diarias de clases, registro de llegada, asistencia y salida de menores.",
      "pendiente",
      attendanceItems,
    ),
    stage(
      "m5-progress",
      "mvp",
      "M5 - Progreso y reconocimiento",
      "Evaluaciones basadas en evidencias y flujos de reconocimiento revisados por personas.",
      "pendiente",
      progressItems,
    ),
    stage(
      "m6-crm",
      "mvp",
      "M6 - Avisos y safeguarding; CRM post-piloto",
      "Avisos in-app protegidos para el piloto; las filas CRM/email están marcadas post-piloto.",
      "pendiente",
      crmItems,
    ),
    stage(
      "m7-closeout",
      "mvp",
      "M7 - Paneles, informes y cierre del piloto",
      "Cierre verificable del piloto; producción y cierre global están marcados post-piloto.",
      "pendiente",
      closeoutItems,
    ),
    stage(
      "special-lines",
      "special",
      "Líneas especiales",
      "Trabajo transversal seguido por separado del backlog MVP numerado.",
      "revisión",
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

function getStageProgress(currentStage) {
  const total = currentStage.items.length;
  const approved = currentStage.items.filter((item) => item.status === "aprobada").length;
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
  revisión: "En revisión",
  "en-progreso": "En progreso",
  pendiente: "Pendiente",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

const STATUS_CLASSES = {
  aprobada: "status-approved",
  revisión: "status-review",
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
  const approved = items.filter((item) => item.status === "aprobada").length;
  return {
    approved,
    total: items.length,
    percentage: items.length === 0 ? 0 : Math.round((approved / items.length) * 100),
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
  setVisiblePhasesExpanded,
  renderProject,
};
