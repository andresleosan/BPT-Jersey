const VALID_STATUSES = [
  "aprobada",
  "revisiÃ³n",
  "en-progreso",
  "pendiente",
  "bloqueada",
  "cancelada",
];

const statusEvidence = {
  approved: "Estado aprobado en tasks.md.",
  review: "Implementado o verificado; queda pendiente de aprobaciÃ³n explÃ­cita.",
  "en-progreso":
    "Trabajo iniciado; la reconciliaciÃ³n o verificaciÃ³n indicada todavÃ­a estÃ¡ pendiente.",
  pending: "Trabajo pendiente o sin evidencia suficiente para aprobarlo.",
  blocked: "No puede avanzar hasta resolver la decisiÃ³n o dependencia indicada.",
  cancelled: "Cancelada en tasks.md y sustituida por una decisiÃ³n posterior.",
};

const IMPLEMENTATION_STATUS_LABELS = {
  "no-iniciada": "Sin implementaciÃ³n registrada",
  parcial: "ImplementaciÃ³n parcial",
  implementada: "ImplementaciÃ³n realizada",
  verificada: "ImplementaciÃ³n verificada",
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
      "Contrato discriminado, adapter create-only y los tres writers migrados; focused 101/101, integraciÃ³n Firestore Emulator 8/8, typecheck y packaging portable aprobados.",
  },
  T020: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Shell responsive, navegaciÃ³n por rol y QA de teclado/mÃ³vil documentados; falta aprobaciÃ³n formal.",
  },
  T020A: {
    implementationStatus: "verificada",
    implementationEvidence: "Logo, favicon, Home, responsive y QA documentados.",
  },
  T021: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Domain 7/7, store 3/3, callables 4/4, web client/UI 12/12, suite 500/500, Rules 16/16, Firestore Emulator 8/8, lint/typecheck/build/formato, smoke E2E 5/5 y seguridad sin crÃ­ticos.",
  },
  T022: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-6 verificadas: suite 533/533, Rules 23/23, lint/typecheck/build/formato/diff, domain 24/24, store 8/8, callables/deploy 18/18, Emulator 9/9, RTL 17/17 y E2E 2/2; pendiente aprobaciÃ³n formal.",
  },
  T023: {
    implementationStatus: "verificada",
    implementationEvidence:
      "ImplementaciÃ³n tÃ©cnica verificada para el piloto sintÃ©tico: unitarias 133 archivos/976 pruebas, Rules 4/4, integraciÃ³n Firestore Emulator 1/1, UI guardian/administrativa, typecheck, lint y formato; producciÃ³n bloqueada por T011 y BPT_SYNTHETIC_PILOT.",
  },
  T032: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-6 verificadas: suite 572/572; Rules 30/30; domain 11/11 y regresiÃ³n 98/98; store 15/15; runtime 2/2; callables 13/13 y regresiÃ³n 31/31; Emulator 4/4 con casos individuales 1/1; lint/typecheck/build/formato/diff pasaron; audit sin high/critical, con DR-001 moderadas; el rate-limit de catÃ¡logo permanece documentado como control transversal que bloquea producciÃ³n, no resuelto por T032; pendiente aprobaciÃ³n formal.",
  },
  T010: {
    implementationStatus: "parcial",
    implementationEvidence:
      "Investigacion oficial 2026-08-27: shortlist real PayPal, Adyen y Revolut Business; Stripe descartado para una entidad incorporada en Jersey. PayPal es primera opcion a validar. T010 sigue bloqueada hasta seleccion, onboarding, terminos, cotizacion y alertas; no hay cuenta, credenciales, cobro ni gasto.",
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
      "Tasks 1-6 verificadas: lifecycle focused 8/8 y domain regression 106/106; audit 12/12, writer 7/7 y domain 110/110; store 9/9 y contracts/audit 20/20; callables 11/11 y regresiÃ³n 36/36; Emulator 6/6, Rules 37/37 y unit 32/32; gates completos sin high/critical. Corregidos runtime mapping/draft status, audit getter snapshot/contracts expectation, store scope/internal IDs/uniqueness/read-before-write/audit retry y callable family-active/date payload/real invalid transition. DR-001 conserva dos moderadas transitivas y rate-limit residual transversal; pendiente aprobaciÃ³n formal y no es aprobaciÃ³n de producciÃ³n.",
  },
  T037: {
    implementationStatus: "verificada",
    implementationEvidence:
      "T037 verificada: facturas como fuente canÃ³nica, pagos manuales append-only en efecto, balances/deuda PAYG derivados; owner/administrator escriben, guardian/adultStudent solo leen su alcance y coaches quedan denegados. Domain 7/7, store 9/9, callables 6/6, audit domain 13/13, writer 8/8, Emulator 4/4, Rules 44/44, suite 629/629, lint/typecheck/build/formato/diff pasan. Audit sin high/critical con dos moderadas DR-001; refunds, providers, UI y booking writes fuera de alcance; pendiente aprobaciÃ³n formal.",
  },
  T024: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Adaptador piloto verificado: unitarias 133 archivos/979 pruebas, focalizadas T024 20/20, integraciÃ³n Firestore Emulator con R2 sintÃ©tico 1/1, Rules directas 4/4, typecheck, lint y formato; el cierre productivo depende de T011 y del texto/revisiÃ³n legal final.",
  },
  T025: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-4 verificadas: suite unitaria 90 archivos/701 pruebas; Rules 6 archivos/50 pruebas; Emulator integration 9/9; UI /admin/staff y E2E sintÃ©tico 10/10; Auth Emulator E2E 2/2; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; pendiente aprobaciÃ³n formal.",
  },
  T049: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Dashboard diario conectado y verificado con sesiones, asistencia y check-out canÃ³nicos; callable staff-only y proyecciÃ³n agregada sin roster.",
  },
  T050: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Dashboard financiero read-only conectado a membresÃ­as, facturas y pagos canÃ³nicos; sin PII/IDs sensibles, 1036/1036 unitarias, Rules 64/64 y E2E 67/67.",
  },
  T051: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Reporte owner/admin conectado y tenant-scoped para estudiantes, asistencia, membresÃ­as y finanzas manuales; rango mÃ¡ximo de 31 dÃ­as, sin PII/IDs y gates completos.",
  },
  T053: {
    implementationStatus: "verificada",
    implementationEvidence:
      "CSV agregado T051/T052 owner/admin, piloto sintÃ©tico fail-closed, journal y auditorÃ­a atÃ³micos, rate limit persistente, sin PII/IDs ni archivo server-side; unitarias 1019/1019, Rules 64/64 y E2E 65/65.",
  },
  T055: {
    implementationStatus: "parcial",
    implementationEvidence:
      "QA aprobado unicamente para el piloto sintetico: verify:mvp local pasa con build normal y build:e2e-synthetic, unitarias 159/1082, Rules 64/64, carga sintetica 240 solicitudes/concurrencia 24 sin fallos (p95 82 ms), E2E smoke 5 pasan/1 omitida, runtime desplegable 2/2, secret scan sin coincidencias y audit sin high/critical. T011, carga live/staging y produccion siguen pendientes.",
  },
  T082: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Regla persistente aÃ±adida a AGENTS.md, Copilot y MASTER_PROMPT.md; 83 entradas Ãºnicas sincronizadas y Lista.js verificado.",
  },
  T026: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Contratos de dominio 27/27, generador determinÃ­stico de sesiones con soporte DST Europe/Jersey, store 6/6, callables protegidos 6/6, UI admin groups/activities 4/4, client 7/7, suite completa 788/788 en 105 archivos; typecheck/build/lint/format pasan; sin producciÃ³n ni migraciones destructivas.",
  },
  T083: {
    implementationStatus: "verificada",
    implementationEvidence:
      "Tasks 1-5 completadas y verificadas: 171 definiciones, 27 belts, 144 stripes, 11 habilidades y 165 requisitos; unitarias 101 archivos/739 pruebas; Rules 7 archivos/56 pruebas; Emulator integration 1/1; E2E Playwright 6/6; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; pendiente aprobaciÃ³n formal.",
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

  if (item.status === "revisiÃ³n") {
    return {
      implementationStatus: "verificada",
      implementationEvidence: "ImplementaciÃ³n y pruebas documentadas; falta aprobaciÃ³n formal.",
    };
  }

  return {
    implementationStatus: "no-iniciada",
    implementationEvidence: "No hay evidencia de ejecuciÃ³n registrada.",
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
    "bloqueada",
    "Elegir el proveedor manteniendo los pagos detras de un adaptador independiente del proveedor.",
    "-",
    "Investigacion oficial 2026-08-27: shortlist real PayPal, Adyen y Revolut Business; Stripe descartado para entidad de Jersey. PayPal es primera opcion a validar; T010 sigue bloqueada hasta seleccion explicita, onboarding, terminos, cotizacion y alertas; sin cuenta, credenciales, cobro ni gasto.",
    ["tasks.md", "BRIEF.md", "STACK.md", "docs/operations/payment-provider-decision-packet.md"],
    "decision",
  ),
  task(
    "T011",
    "Confirmar la polÃ­tica de retenciÃ³n, residencia y eliminaciÃ³n",
    "bloqueada",
    "Confirmar la polÃ­tica aplicable a los datos de la academia, menores e informaciÃ³n restringida.",
    "-",
    "Decision owner y reviewer confirmados como no designados el 2026-08-28; brief de seleccion/consulta listo sin envio ni gasto. T011 sigue bloqueada hasta aprobar controller/registro JOIC y las 10 decisiones.",
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
    "Configurar TypeScript estricto, lint, formato y comandos raÃ­z",
    "aprobada",
    "Establecer los controles de calidad del repositorio y la configuraciÃ³n estricta del compilador.",
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
    "Configurar la emulaciÃ³n local de Auth, Firestore y Realtime Database sin acceso a producciÃ³n.",
    "T001",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
  task(
    "T005",
    "Configurar proyectos de Playwright y artefactos de QA no versionados",
    "aprobada",
    "Configurar pruebas de humo del navegador en escritorio y mÃ³vil.",
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
    "Documentar clasificaciÃ³n de datos, amenazas y matriz de acceso",
    "aprobada",
    "Registrar los lÃ­mites de seguridad para menores, salud, pagos y datos operativos.",
    "-",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "foundation",
  ),
];

const identityItems = [
  task(
    "T012",
    "Definir mÃ³dulos de dominio, contratos base y errores tipados",
    "aprobada",
    "Definir los contratos de dominio compartidos por los mÃ³dulos posteriores.",
    "T002,T007",
    statusEvidence.approved,
    ["tasks.md"],
    "mvp",
  ),
  task(
    "T013",
    "DiseÃ±ar colecciones, Ã­ndices, invariantes y plan de migraciÃ³n",
    "aprobada",
    "Definir lÃ­mites de Firestore, uso de RTDB y documentaciÃ³n de reversiÃ³n.",
    "T007",
    statusEvidence.approved,
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T014",
    "Implementar autenticaciÃ³n por correo/contraseÃ±a y Google con emulador",
    "aprobada",
    "Proporcionar los flujos iniciales de registro, inicio y cierre de sesiÃ³n.",
    "T004,T084",
    "Google usa el popup SDK conectado al Auth Emulator; email/Google y login sin MFA revalidados con unitarias, integraciÃ³n local y E2E responsive.",
    ["tasks.md", "BRIEF.md", "STACK.md", "docs/adr/ADR-005-admin-auth-without-mfa.md"],
    "mvp",
  ),
  task(
    "T015",
    "Implementar roles y permisos personalizados de mÃ­nimo privilegio",
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
    "Mantener cerrado todo acceso Firebase directo y centralizar autorizaciÃ³n por tenant, rol, relaciÃ³n, asignaciÃ³n y propÃ³sito.",
    "T013,T015",
    "Evaluador fail-closed, actor de seis roles, matriz Firebase exhaustiva y packaging verificados con gates globales.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T017",
    "Implementar MFA obligatorio para propietario/administrador",
    "cancelada",
    "El requisito histÃ³rico de MFA fue sustituido por el rediseÃ±o administrativo aprobado sin MFA.",
    "T014,T015",
    "Cancelada y sustituida por el rediseÃ±o administrativo aprobado.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T019",
    "Implementar registro de auditorÃ­a de solo anexado para cambios sensibles",
    "aprobada",
    "Conservar autor, hora e historial de correcciones sensibles.",
    "T012,T013,T016",
    "DiseÃ±o create-only y plan TDD aprobados; pendiente centralizar admin, member import y Regyfit sin lectura/UI.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const peopleItems = [
  task(
    "T020",
    "Construir tokens de diseÃ±o, carcasa adaptable y navegaciÃ³n accesible por roles",
    "aprobada",
    "Crear la carcasa autenticada compartida y las bases de navegaciÃ³n.",
    "T002,T015",
    "Shell responsive, navegaciÃ³n por rol y QA de teclado/mÃ³vil documentados; falta aprobaciÃ³n formal.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T020A",
    "Integrar identidad visual oficial y navegaciÃ³n de inicio",
    "aprobada",
    "Aplicar los recursos de identidad aprobados, metadatos y rutas de inicio.",
    "T002,T020",
    "Los recursos, rutas y controles adaptables estÃ¡n documentados; la aprobaciÃ³n explÃ­cita sigue pendiente.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T021",
    "Implementar perfiles de adultos, menores y tutores",
    "aprobada",
    "Proporcionar perfiles autorizados sin crear cuentas individuales para menores.",
    "T016,T020",
    "Primer WIP documental: campos de nombre, fecha de nacimiento, telÃ©fono, email, sede y preferencias horarias.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T022",
    "Implementar familias con varios menores y relaciones autorizadas",
    "aprobada",
    "Modelar contactos familiares y relaciones de tutores permitidas.",
    "T021",
    "Inicio 2026-08-19; plan aprobado en ejecuciÃ³n inline, comenzando por contratos de dominio con TDD.",
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
    "Implementar datos mÃ©dicos y de apoyo restringidos",
    "aprobada",
    "Proteger la informaciÃ³n de apoyo restringida con pruebas de permisos negativos.",
    "T021",
    "Alcance tÃ©cnico del piloto sintÃ©tico aprobado por el operador el 2026-08-25; producciÃ³n y datos reales continÃºan bloqueados por T011 y BPT_SYNTHETIC_PILOT.",
    ["tasks.md", "BRIEF.md", "docs/superpowers/specs/2026-08-19-t023-health-support-design.md"],
    "mvp",
  ),
  task(
    "T024",
    "Implementar documentos privados y URLs firmadas de R2",
    "aprobada",
    "Mantener autorizados, breves y protegidos el acceso a consentimientos y documentos privados.",
    "T016,T021,T023",
    "Alcance tÃ©cnico con R2 sintÃ©tico aprobado por el operador el 2026-08-25; R2 productivo, datos reales y cierre productivo continÃºan bloqueados por T011 y por el texto/revisiÃ³n legal final.",
    ["tasks.md", "STACK.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T018",
    "Implementar waiver versionado y aceptaciÃ³n de registro",
    "aprobada",
    "Completar el registro con el waiver Ãºnico, aceptaciÃ³n, revocaciÃ³n y renovaciÃ³n sin sobrescritura destructiva.",
    "T016,T021,T022,T023,T024",
    "Aprobada explÃ­citamente por el operador el 2026-08-25 solo para el piloto sintÃ©tico: waiver versionado, firma tutor/adulto, revocaciÃ³n, PDF privado, auditorÃ­a y UI verificados; producciÃ³n bloqueada por T011 y por el texto/revisiÃ³n legal final.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPTJ FUNCTIONS APP.docx"],
    "mvp",
  ),
  task(
    "T025",
    "Implementar cuentas, disponibilidad y asignaciones de entrenadores/personal",
    "aprobada",
    "Gestionar el acceso del personal y las asignaciones operativas.",
    "T015,T020",
    "Tasks 1-4 verificadas: suite unitaria 90 archivos/701 pruebas; Rules 6 archivos/50 pruebas; Emulator integration 9/9; UI /admin/staff y E2E sintÃ©tico 10/10; Auth Emulator E2E 2/2; lint, typecheck, build y formato pasan; audit sin high/critical con dos moderadas DR-001; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
];

const levelsItems = [
  task(
    "T083",
    "Recrear catÃ¡logo completo y secciÃ³n MVP de Levels IBJJF",
    "aprobada",
    "Implementar la jerarquÃ­a completa de belts, stripes y habilidades antes de progreso y promociones.",
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
    "Contratos de dominio 27/27, generador determinÃ­stico de sesiones con soporte DST Europe/Jersey, store 6/6, callables 6/6 y UI admin verificados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T027",
    "Implementar elegibilidad, capacidad, lista, reserva y cancelaciÃ³n",
    "aprobada",
    "Aplicar las restricciones de elegibilidad y capacidad de las reservas.",
    "T021,T026",
    "Contratos y evaluador multicriterio 44/44, store transaccional de capacidad atÃ³mica/idempotencia 9/9, callables RBAC 8/8, client 8/8, suite completa 811/811 en 105 archivos; corte de 1h y quÃ³rum mÃ­nimo validados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T028",
    "Implementar registro de llegada por QR, PIN, nombre y mÃ©todo manual",
    "aprobada",
    "Admitir los cuatro mÃ©todos aprobados para registrar llegadas.",
    "T022,T027",
    "Contratos de check-in y 4 mÃ©todos 54/54, store de asistencia e idempotencia 10/10, callables protegidos RBAC 9/9, client 9/9, suite completa 824/824 en 105 archivos; puntualidad (attended/late) y reglas de seguridad verificadas; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T029",
    "Implementar puntualidad, asistencia, ausencia y correcciones auditadas",
    "aprobada",
    "Mantener trazables las correcciones mientras se registran los resultados de asistencia.",
    "T019,T028",
    "Contratos y parsers de correcciÃ³n 58/58, store con correctionOf inmutable y reconciliaciÃ³n de no-shows 12/12, callables RBAC 10/10, client 9/9, suite completa 831/831 en 105 archivos; eventos de auditorÃ­a registrados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T030",
    "Implementar salida de menores y autorizaciÃ³n de recogida",
    "aprobada",
    "Registrar al adulto autorizado, la salida independiente o la confirmaciÃ³n del personal.",
    "T022,T029",
    "Contratos y parsers de checkout 64/64, 3 mÃ©todos (authorizedAdult, independentRelease, staffOverride con notas), store con validaciÃ³n de asistencia previa e idempotencia 13/13, callables RBAC 11/11, client 10/10, suite completa 840/840 en 105 archivos; eventos de auditorÃ­a registrados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T031",
    "Implementar vista operativa en vivo sin duplicar la fuente canÃ³nica",
    "aprobada",
    "Mostrar las operaciones actuales de asistencia sin duplicar los registros canÃ³nicos.",
    "T029,T030",
    "ProyecciÃ³n pura agregada 65/65, store unificado sin estado duplicado 14/14, callable RBAC 12/12, client 11/11, suite completa 844/844 en 105 archivos; consistencia y quÃ³rum en vivo verificados; aprobada 2026-08-23.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
];

const membershipItems = [
  task(
    "T032",
    "Implementar catÃ¡logo y reglas base de planes de membresÃ­a",
    "aprobada",
    "Definir todos los planes, precios, sedes y accesos Town/West del DOCX, incluidos Kids, Teens, Adults y Open Mats.",
    "T013",
    "Tasks 1-6 verificadas; suite 572/572; Rules 30/30; domain 11/11 y regresiÃ³n 98/98; store 15/15; runtime 2/2; callables 13/13; Emulator 4/4; lint/typecheck/build/formato pasan; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md", "F:\\Proyectos\\BPT Jersey\\Varios\\BPT-memberships.docx"],
    "mvp",
  ),
  task(
    "T033",
    "Implementar ciclo de vida de la membresÃ­a",
    "aprobada",
    "Admitir transiciones de prueba, activa, pausada, vencida y cancelada sin perder el acceso definido por plan.",
    "T032",
    "Lifecycle completo, mÃºltiples suites verdes, gates sin high/critical; aprobada 2026-08-23.",
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
    "Implementar pago alojado y suscripciones post-piloto",
    "pendiente",
    "Usar flujos de pago alojados sin almacenar datos de tarjeta sin procesar.",
    "T034",
    "El pago alojado estÃ¡ fuera del piloto manual.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T036",
    "Implementar webhooks de pago post-piloto firmados e idempotentes",
    "pendiente",
    "Prevenir efectos financieros duplicados ante reintentos y eventos fuera de orden.",
    "T019,T035",
    "Los webhooks estÃ¡n fuera del piloto manual.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T037",
    "Implementar pagos manuales, facturas, recibos, saldos, deuda PAYG y refunds",
    "aprobada",
    "Admitir cash, factura/recibo, deuda PAYG, cobro de la sesiÃ³n nueva y de la anterior pendiente.",
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
    "Vincular estado manual de pago/membresÃ­a y restricciones por deuda",
    "aprobada",
    "Conectar el estado de facturaciÃ³n con el acceso y el seguimiento operativo.",
    "T037",
    "Suite 650/650, Rules 35/35, policy/service/Emulator verdes; integraciÃ³n PAYG 1750 -> 0 verificada; aprobada 2026-08-23.",
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
    "Contratos y parsers de evaluaciÃ³n 14/14, store con agregaciÃ³n y auditorÃ­a 7/7, callables RBAC con visibilidad familiar 10/10, client 5/5, suite completa 858/858 en 105 archivos; escala 1-5 y 11 habilidades vinculadas; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T040",
    "Implementar checklist de habilidades y resumen de progreso",
    "aprobada",
    "Resumir tÃ©cnicas, total de clases, horas, racha y belt/stripes sin promociÃ³n automÃ¡tica.",
    "T039",
    "Contratos y pure builder buildStudentProgressSummary 16/16, store aggregations 8/8, callables RBAC con visibilidad familiar 12/12, client 6/6, suite completa 864/864 en 105 archivos; checklist tÃ©cnico, clases, horas y elegibilidad no automÃ¡tica probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T041",
    "Implementar rachas y candidatos de reconocimiento explicables",
    "aprobada",
    "Calcular asistencia, rachas y candidatos con pesos explÃ­citos y ausencias mÃ©dicas.",
    "T029,T039",
    "Contratos y pure functions calculateAttendanceStreak/generateRecognitionCandidates 21/21, store methods 9/9, callables RBAC 16/16, client 8/8, suite completa 876/876 en 105 archivos; rachas, pausas mÃ©dicas justificadas y cola explicable de candidatos para el Head Coach probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T042",
    "Implementar revisiÃ³n y aprobaciÃ³n exclusivas del entrenador principal",
    "aprobada",
    "Mantener todas las promociones del catÃ¡logo MVP bajo aprobaciÃ³n humana autorizada.",
    "T015,T041",
    "Contratos y parsers de graduaciÃ³n/promociÃ³n 25/25, store con actualizaciÃ³n de perfil y auditorÃ­a 10/10, callables RBAC headCoach/owner 18/18, client 9/9, suite completa 884/884 en 105 archivos; regla de oro de aprobaciÃ³n humana formal, registro inmutable y trazabilidad probados; aprobada 2026-08-23.",
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
    "Implementar lÃ­nea de tiempo automÃ¡tica de CRM post-piloto",
    "aprobada",
    "Registrar una sola vez los eventos relevantes en una lÃ­nea de tiempo trazable.",
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
    "Contratos y parsers de anuncios 7/7, store en Firestore e in-memory con soporte readBy y auditorÃ­a 4/4, callables RBAC staff/client 3/3, client 4/4, suite completa 902/902 en 109 archivos; canales academy/class/group, estados draft/published/archived y lectura in-app probados; aprobada 2026-08-23.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T046",
    "Implementar email/SMS e historial externo de entrega post-piloto",
    "aprobada",
    "Integrar proveedores externos solo despuÃ©s del piloto.",
    "T045",
    "Frontera provider-independent, historial tenant-scoped y fallback unconfigured verificados; contract/service 7/7; typecheck de dominio/Functions, ESLint y Prettier del alcance pasan; proveedor unconfigured, sin red, credenciales, gasto ni envio real. Aprobacion explicita del operador recibida el 2026-08-27 para alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales.",
    ["tasks.md", "STACK.md"],
    "roadmap",
  ),
  task(
    "T047",
    "Aplicar safeguarding a avisos de menores visibles al tutor",
    "aprobada",
    "Mantener la comunicaciÃ³n con menores visible para el tutor autorizado.",
    "T022,T045",
    "Aprobada tÃ©cnicamente para el piloto: resolver canÃ³nico, portal guardian, pruebas unitarias/Rules, typecheck, lint y build pasan; sin producciÃ³n ni canales privados.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T048",
    "Implementar recordatorios in-app de pagos y asistencia",
    "aprobada",
    "Admitir recordatorios internos con audiencia y resoluciÃ³n auditables.",
    "T029,T038,T045",
    "Aprobada tÃ©cnicamente para recordatorios on-demand tenant-scoped; unit 930/930, rules exit 0, typecheck/lint/build/E2E gateway 8/8; sin producciÃ³n ni persistencia adicional.",
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
    "Dashboard conectado a sesiones, asistencia y check-out canÃ³nicos; callable staff-only, lÃ­mite de 24 h y vista agregada sin roster; unitarias 983/983, E2E sintÃ©tico 63/63 con 14 omitidos, typecheck/build/lint/formato/diff pasan; aprobado tÃ©cnicamente para el piloto.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T050",
    "Implementar panel de finanzas, saldos y renovaciones",
    "aprobada",
    "Mostrar a los operadores las acciones financieras manuales y renovaciones.",
    "T038",
    "ProyecciÃ³n read-only conectada a membresÃ­as, facturas y pagos canÃ³nicos; contrato owner/admin sin PII/IDs sensibles y gates completos.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T051",
    "Implementar informes de estudiantes, asistencia, membresÃ­as e ingresos manuales",
    "aprobada",
    "Proporcionar informes operativos autorizados con totales conciliados.",
    "T029,T038",
    "Reporte agregado owner/admin conectado a fuentes canÃ³nicas; tenant-scoped, rango mÃ¡ximo de 31 dÃ­as, sin PII/IDs; unitarias 998/998, Rules 64/64 y E2E 65/65 ejecutadas con 14 omitidas.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T052",
    "Implementar informes de cobertura de progreso, reconocimiento y evaluaciÃ³n",
    "aprobada",
    "Informar la cobertura de progreso respetando los lÃ­mites de privacidad.",
    "T042",
    "Aprobada tÃ©cnicamente para reporte agregado staff-only tenant-scoped; coverage/recognition/readiness y privacidad sin IDs.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T053",
    "Implementar exportaciÃ³n de datos autorizada y auditable",
    "aprobada",
    "Exportar Ãºnicamente los datos permitidos para el rol activo.",
    "T019,T051,T052",
    "CSV agregado T051/T052 owner/admin, piloto sintÃ©tico fail-closed, journal y auditorÃ­a atÃ³micos, rate limit persistente y sin PII/IDs ni archivo server-side; gates completos y producciÃ³n bloqueada por T011 y por el texto/revisiÃ³n legal final.",
    ["tasks.md", "BRIEF.md"],
    "mvp",
  ),
  task(
    "T054",
    "Configurar respaldos, restauraciÃ³n y guÃ­a de reversiÃ³n",
    "aprobada",
    "Demostrar la capacidad de recuperaciÃ³n antes de producciÃ³n.",
    "T013,T024",
    "Aprobada explÃ­citamente por el operador el 2026-08-25 solo para el piloto sintÃ©tico: contrato fail-closed, checksum/conteos, rehearsal Emulator applyâ†’rollback, runbook, unitarias 6/6, integraciÃ³n 1/1 y E2E 2/2; no autoriza backup/restore productivo.",
    ["tasks.md", "STACK.md"],
    "mvp",
  ),
  task(
    "T055",
    "Ejecutar pruebas de carga, contrato, seguridad, accesibilidad y roles",
    "aprobada",
    "Ejecutar el control de calidad completo previo a la publicaciÃ³n.",
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
    "revision",
    "Completar los controles operativos antes de produccion.",
    "T056",
    "Roles T011 no designados registrados y brief de revision externa preparado; Gate A sigue bloqueado. Sin contacto, cloud, credenciales, datos reales ni gasto.",
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
    "La publicacion en produccion todavia esta pendiente.",
    ["tasks.md", "STACK.md"],
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
    "revision",
    "Ampliar reservas despues del MVP; el corte basico de una hora pertenece a T027.",
    "-",
    "Slice T060 implementado: contratos estrictos de waitlist y creditos, estados waiting/offered/accepted/expired/cancelled, consumo parcial, agotamiento y reverso acotado; pruebas 9/9, typecheck de dominio, Prettier y diff pasan. Sin Firestore, UI, callable, migracion, cobro, credenciales ni datos reales; politicas de promocion, posiciones y creditos siguen pendientes.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/v2-v3-advance-plan.md",
      "packages/domain/src/schedule/advanced-booking-contracts.ts",
    ],
    "roadmap",
  ),
  task(
    "T061",
    "Reintentos, perÃ­odos de gracia, prorrateo, promociones y flujos de pausa/cancelaciÃ³n",
    "pendiente",
    "Automatizar operaciones mÃ¡s profundas del ciclo de facturaciÃ³n.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T062",
    "Alertas de retenciÃ³n y automatizaciÃ³n de CRM",
    "revision",
    "Automatizar acciones seleccionadas de retenciÃ³n y CRM.",
    "-",
    "Slice T062 implementado: contrato read-only de alertas de retencion para inactividad, no-shows repetidos y membresias proximas a vencer; politica explicita, evidencia minima, deduplicacion determinista y salida sin datos de contacto/financieros. Pruebas 10/10, typecheck de dominio, ESLint, Prettier y diff pasan. Sin Firestore writes, callables, UI, CRM externo, mensajes, credenciales, cobros ni datos reales; bandeja, Rules/Emulator, E2E y permisos de staff siguen pendientes.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t062-retention-alerts.md",
      "packages/domain/src/retention-contracts.ts",
    ],
    "roadmap",
  ),
  task(
    "T063",
    "Autoservicio ampliado para tutores y adultos",
    "revision",
    "Ampliar el autoservicio sin debilitar los lÃ­mites de roles.",
    "-",
    "Slice T063 implementado: aislamiento fail-closed para guardian/adulto en booking, cancelacion, consultas de booking/asistencia/historial y checkout; guardian solo opera sobre menor vinculado con relacion/familia/estudiante activos, adulto solo sobre si mismo y check-in delegado denegado. Pruebas focalizadas 14/14 + access policy 9/9, typecheck Functions, ESLint, Prettier y diff pasan. Sin migraciones, UI, credenciales, cobros ni datos reales; Rules/Emulator, E2E y decisiones de tutor secundario/checkout adulto siguen pendientes.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t063-self-service-rbac-matrix.md",
      "apps/functions/src/schedule/schedule-callables.ts",
    ],
    "roadmap",
  ),
  task(
    "T064",
    "Notificaciones externas y automatizadas completas",
    "revision",
    "Ampliar cobertura despuÃ©s de los avisos in-app bÃ¡sicos de T045 y T048.",
    "-",
    "Politica de notificaciones por consentimiento y canal; 6 pruebas focalizadas y 58 de regresion, typecheck, ESLint, Prettier y diff check pasan; sin proveedor, red, contactos ni gasto; quedan persistencia, runtime y E2E.",
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
    "Asistencia sin conexiÃ³n con sincronizaciÃ³n y resoluciÃ³n de conflictos",
    "revision",
    "Admitir operaciÃ³n controlada sin conexiÃ³n y conciliaciÃ³n.",
    "-",
    "Contrato de asistencia offline con idempotencia y conflictos fail-closed; 6 pruebas focalizadas y 48 de regresion, typecheck, ESLint, Prettier y diff check pasan; quedan adaptador, persistencia, Rules/Emulator y E2E.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t065-offline-attendance.md",
      "packages/domain/src/attendance/offline-contracts.ts",
    ],
    "roadmap",
  ),
  task(
    "T066",
    "Biblioteca tÃ©cnica ampliada y planificaciÃ³n avanzada de lecciones",
    "revision",
    "AÃ±adir profundidad al currÃ­culo bÃ¡sico y la aprobaciÃ³n humana del piloto.",
    "-",
    "Contrato de biblioteca tecnica versionada y lesson planning; 5 pruebas focalizadas y 42 de regresion, typecheck, ESLint, Prettier y diff check pasan; aprobacion solo por head_coach; quedan persistencia, Rules/Emulator y E2E.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t066-lesson-planning.md",
      "packages/domain/src/levels/lesson-planning-contracts.ts",
    ],
    "roadmap",
  ),
];

const roadmapV3Items = [
  task(
    "T067",
    "Objetivos, logros y resÃºmenes familiares ampliados",
    "revision",
    "AÃ±adir participaciÃ³n despuÃ©s de las rachas bÃ¡sicas de T041.",
    "-",
    "Contrato de dominio para objetivos/logros y resumen familiar; 6 pruebas focalizadas y 37 de regresión, typecheck, ESLint, Prettier y diff check pasan; sin Firestore/UI/leaderboard; quedan persistencia, Rules/Emulator, E2E, auditoría y checkpoint de producto.",
    [
      "tasks.md",
      "BRIEF.md",
      "docs/roadmap/t067-family-achievements.md",
      "packages/domain/src/levels/achievement-contracts.ts",
    ],
    "roadmap",
  ),
  task(
    "T068",
    "Aplicaciones nativas para iOS y Android",
    "pendiente",
    "Considerar clientes nativos despuÃ©s de validar el producto web.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T069",
    "Comunidad moderada",
    "pendiente",
    "AÃ±adir funciones comunitarias controladas con protecciÃ³n.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T070",
    "Referidos, clases privadas, competiciones y tienda",
    "pendiente",
    "Ampliar crecimiento y comercio despuÃ©s de los seminarios operativos de T026.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP.",
    ["tasks.md", "BRIEF.md"],
    "roadmap",
  ),
  task(
    "T071",
    "AnalÃ­tica, IA asistida, multiacademia, marca blanca y SaaS",
    "pendiente",
    "Considerar funciones de escala solo cuando el producto central sea estable.",
    "-",
    "Plan preliminar de avance en docs/roadmap/v2-v3-advance-plan.md; pendiente de slice, contrato, criterios de aceptacion y checkpoint humano; no implica aprobacion del MVP.",
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
    "Manifiesto sanitizado, contratos y Playwright offline 2/2; entidades fuente todavÃ­a insuficientes para aprobar el mapeo.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T073",
    "Implementar autorizaciÃ³n, locks y provisioning administrativo de Regyfit",
    "aprobada",
    "Implementar autorizaciÃ³n, locks y provisioning administrativo de Regyfit.",
    "T015,T016",
    "Locks renovables, fencing, recuperaciÃ³n y compensaciÃ³n fail-closed; 32 pruebas focused y 83 de suite documentadas.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T074",
    "Construir shell y panel read-only administrativo de Regyfit",
    "aprobada",
    "Construir shell y panel read-only administrativo de Regyfit.",
    "T020,T015",
    "Shell responsive, proyecciones owner/safe, filtros, foco, 24 E2E sintÃ©ticos; falta aprobaciÃ³n/live Auth completa.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T075",
    "Implementar importer Regyfit idempotente y aplicar lote aprobado",
    "aprobada",
    "Implementar importer Regyfit idempotente y aplicar lote aprobado.",
    "T073,T074",
    "Importer protegido, dry-run e importaciÃ³n de 10 registros verificada; lectura live owner/administrator y alertas de facturaciÃ³n pendientes.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T076",
    "Publicar callable protegido de registros Regyfit",
    "aprobada",
    "Publicar callable protegido de registros Regyfit.",
    "T074,T075",
    "Callable v2 desplegado y smoke sin identidad devuelve 403; verificaciÃ³n Auth live queda pendiente.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T077",
    "Implementar gateway unificado de login, logout y acceso administrativo",
    "aprobada",
    "Implementar gateway unificado de login, logout y acceso administrativo.",
    "T014,T015",
    "Email/Google, destinos allowlisted, logout, E2E sintÃ©tico y verificaciÃ³n manual staging documentados; live Auth automatizado opt-in.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T078",
    "Entregar panel administrativo visible con preview sintÃ©tico",
    "aprobada",
    "Entregar panel administrativo visible con preview sintÃ©tico.",
    "T020,T021",
    "Overview, Members, Groups, Activities, Attendance, Reports, CRM y Finance con filtros y QA 374/374; persistencia real posterior.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T079",
    "Implementar operaciones de miembros, informes y exportaciÃ³n PDF protegida",
    "aprobada",
    "Implementar operaciones de miembros, informes y exportaciÃ³n PDF protegida.",
    "T021,T024,T053",
    "Callables, lÃ­mites, rate limit, export journal, PDF Unicode, integraciÃ³n Firestore y QA 427/427 documentados.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T080",
    "Validar lote real de PDFs de miembros y planificar importaciÃ³n",
    "aprobada",
    "Validar lote real de PDFs de miembros y planificar importaciÃ³n.",
    "T079",
    "8 reportes, 243 canÃ³nicos, 0 conflictos y dry-run aprobado; cualquier apply continÃºa prohibido sin confirmaciÃ³n explÃ­cita y sin cerrar los gates productivos.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T081",
    "Implementar navegaciÃ³n responsive administrativa y tablas ordenables",
    "aprobada",
    "Implementar navegaciÃ³n responsive administrativa y tablas ordenables.",
    "T020,T078",
    "Drawer mÃ³vil, foco, responsive, ordenaciÃ³n y E2E desktop/mÃ³vil documentados; aprobaciÃ³n formal pendiente.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T082",
    "Establecer sincronizaciÃ³n permanente entre `tasks.md` y `Lista/`",
    "aprobada",
    "Establecer sincronizaciÃ³n permanente entre `tasks.md` y `Lista/`.",
    "T001",
    "Regla persistente aÃ±adida a AGENTS.md, Copilot y MASTER_PROMPT.md; 83 entradas Ãºnicas sincronizadas y Lista.js verificado.",
    ["tasks.md"],
    "special",
  ),
  task(
    "T084",
    "Limitar el importador PDF al emulador y rechazar producciÃ³n",
    "aprobada",
    "Eliminar el alias production-as-staging antes de continuar el MVP.",
    "T080,T085",
    "Runner/CLI emulator-only, fuente sintÃ©tica temporal, symlinks rechazados y gates globales verdes.",
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
    "Aislar E2E sintÃ©tico de red externa y diferir el resolver de Google",
    "aprobada",
    "Mantener las pruebas sintÃ©ticas deterministas y cargar OAuth solo al iniciar Google sign-in.",
    "T014,T049,T050",
    "Resolver Google diferido, fixture operativa explÃ­cita, unitarias 1036/1036 y E2E 67/67; aprobada 2026-08-24.",
    ["tasks.md", "apps/web/src/lib/firebase-client.ts", "qa/tests/admin-auth.spec.ts"],
    "special",
  ),
  task(
    "T087",
    "Reconciliar el ledger y la lista visual",
    "aprobada",
    "Corregir estados, dependencias y evidencia divergentes antes de iniciar T018.",
    "T082",
    "87 IDs Ãºnicos sincronizados; 0 divergencias de estado y 0 tareas aprobadas con dependencias abiertas; sintaxis, Prettier y diff verificados el 2026-08-25.",
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
];

const projectData = {
  cutoffDate: "2026-08-28",
  sourceLedger: "tasks.md",
  ledgerCutoffDate: "2026-08-28",
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
      "Decisiones abiertas con su bloqueo real; proveedor, retenciÃ³n y producciÃ³n no detienen el piloto aislado.",
      "bloqueada",
      phase0Items,
    ),
    stage(
      "m0-foundations",
      "mvp",
      "M0 - Bases tÃ©cnicas",
      "Bases tÃ©cnicas aprobadas y documentaciÃ³n de seguridad. T008-T011 solo aparecen en la Fase 0.",
      "aprobada",
      foundationItems,
    ),
    stage(
      "m1-identity",
      "mvp",
      "M1 - Identidad, autorizaciÃ³n y auditorÃ­a",
      "Bases de identidad, autorizaciÃ³n, consentimiento y auditorÃ­a para la plataforma protegida de la academia.",
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
      "CatÃ¡logo completo de belts, stripes y habilidades disponible antes de progreso, reservas y operaciÃ³n del tatami.",
      "aprobada",
      levelsItems,
    ),
    stage(
      "m4-memberships",
      "mvp",
      "M4 - MembresÃ­as y pagos",
      "Planes y finanzas manuales del piloto; la integraciÃ³n online estÃ¡ marcada post-piloto.",
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
      "Avisos in-app protegidos para el piloto; las filas CRM/email estÃ¡n marcadas post-piloto.",
      "aprobada",
      crmItems,
    ),
    stage(
      "m7-closeout",
      "mvp",
      "M7 - Paneles, informes y cierre del piloto",
      "Cierre verificable del piloto; producciÃ³n y cierre global estÃ¡n marcados post-piloto.",
      "bloqueada",
      closeoutItems,
    ),
    stage(
      "special-lines",
      "special",
      "LÃ­neas especiales",
      "Trabajo transversal seguido por separado del backlog MVP numerado.",
      "aprobada",
      specialItems,
    ),
    stage(
      "roadmap-v2",
      "roadmap",
      "Ruta v2 - AutomatizaciÃ³n y profundidad operativa",
      "Capacidades futuras despuÃ©s del lanzamiento MVP; estas entradas no son aprobaciones.",
      "pendiente",
      roadmapV2Items,
    ),
    stage(
      "roadmap-v3",
      "roadmap",
      "Ruta v3 - ParticipaciÃ³n, crecimiento y escala",
      "Capacidades futuras de participaciÃ³n, escala y plataforma; estas entradas no son aprobaciones.",
      "pendiente",
      roadmapV3Items,
    ),
  ],
  maintenanceSteps: [
    "Actualizar primero tasks.md porque es la fuente Ãºnica de verdad del estado y la evidencia de las tareas.",
    "Actualizar Lista/Lista.js despuÃ©s, en el mismo cambio lÃ³gico, con el estado y la evidencia registrados, sin copiar datos sensibles.",
    "Ajustar Lista.html o Lista.css solo cuando cambie la estructura o la presentaciÃ³n del panel.",
    "Ejecutar las comprobaciones disponibles de sintaxis y del panel, y revisar el resultado.",
    "Subir tasks.md y los archivos modificados de Lista juntos cuando el trabajo con Git estÃ© autorizado explÃ­citamente.",
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
  "revisiÃ³n": "En revisiÃ³n",
  "en-progreso": "En progreso",
  pendiente: "Pendiente",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

const STATUS_CLASSES = {
  aprobada: "status-approved",
  "revisiÃ³n": "status-review",
  "en-progreso": "status-in-progress",
  pendiente: "status-pending",
  bloqueada: "status-blocked",
  cancelada: "status-cancelled",
};

const KIND_LABELS = {
  decision: "DecisiÃ³n",
  foundation: "Base tÃ©cnica",
  mvp: "MVP",
  roadmap: "Ruta futura",
  special: "LÃ­nea especial",
};

const TRACK_LABELS = {
  "phase-0": "Fase 0",
  mvp: "MVP",
  special: "LÃ­neas especiales",
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
    createElement("span", "EjecuciÃ³n detectada", "detail-label"),
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
  maintenance.append(createElement("h3", "Checklist de actualizaciÃ³n"), list);
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
  trackFilter.replaceChildren(createElement("option", "Todas las lÃ­neas"));
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
