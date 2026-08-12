# tasks.md - BPT Jersey Academy Platform

Estados: `pendiente` -> `en-progreso` -> `revisión` -> `aprobada` -> `desplegada`; `bloqueada` cuando requiere una decisión o evidencia externa.

Cada tarea con impacto en código debe pasar el ciclo completo de autocrítica Nivel 3: seguridad, pruebas relevantes, evidencia y rendimiento cuando corresponda.

## M0 - Fundaciones y decisiones operativas

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T001 | Inicializar Git y el monorepo pnpm (`apps/web`, `apps/functions`, `packages/*`, `qa/`) | - | aprobada | `pnpm install --frozen-lockfile --offline` y listado de 7 workspaces pasan; audit sin vulnerabilidades |
| T002 | Configurar TypeScript estricto, lint, formato y comandos raíz | T001 | aprobada | `pnpm lint`, `pnpm typecheck` y `pnpm format:check` pasan |
| T003 | Configurar Vitest, Testing Library y convenciones de pruebas | T002 | aprobada | Vitest + RTL: 2 archivos/2 pruebas aprobados |
| T004 | Configurar Firebase CLI, proyectos/emuladores dev y archivos de entorno sin secretos | T001 | aprobada | Auth/Firestore/RTDB emulators + 3 Rules tests pasan |
| T005 | Configurar Playwright, proyectos por viewport y artefactos no versionados | T002 | aprobada | E2E smoke desktop/móvil 2/2 y estabilidad 10/10 pasan |
| T006 | Crear CI inicial con lint, tipos, unitarias, Rules y E2E smoke | T003,T005 | aprobada | Pipeline CI verde en `main` (run 31142117581) |
| T007 | Documentar clasificación de datos, amenazas y matriz preliminar de acceso | - | aprobada | Documento revisado sin gaps críticos |
| T008 | Confirmar programas, horarios, ubicaciones, capacidad, precios y reglas de membership | - | pendiente | Aprobación del operador/academia |
| T009 | Confirmar criterios y ponderaciones de evaluación/reconocimiento | - | bloqueada | Aprobación de head coach |
| T010 | Seleccionar proveedor de pagos disponible en Jersey | - | bloqueada | ADR y costos aprobados |
| T011 | Confirmar política de retención, residencia y borrado con asesoría aplicable a Jersey | - | bloqueada | Política aprobada |

## M1 - Identidad, autorización y auditoría

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T012 | Definir módulos de dominio, contratos base y errores tipados | T002,T007 | aprobada | Pruebas unitarias de contratos |
| T013 | Diseñar colecciones, índices, invariantes y plan de migraciones Firestore/RTDB | T007,T008 | aprobada | Modelo, rollback, fixture, índices y gate final documentados |
| T014 | Implementar Auth email/password y Google con emulador | T004 | pendiente | Flujos de alta/login/logout probados |
| T015 | Implementar roles y custom claims con mínimo privilegio | T013,T014 | pendiente | Matriz de roles probada |
| T016 | Implementar Firestore/RTDB Rules y pruebas de aislamiento por rol/familia | T013,T015 | pendiente | Suite de Rules sin accesos indebidos |
| T017 | Implementar MFA obligatorio para owner/admin | T014,T015 | cancelada | Sustituida por el rediseño administrativo aprobado el 2026-08-11, sin MFA |
| T018 | Implementar consentimiento versionado y registro de aceptación | T013,T016 | pendiente | Historial y revocación probados |
| T019 | Implementar audit log append-only para cambios sensibles | T012,T013,T016 | pendiente | Intentos de alteración rechazados |

## M2 - Familias, estudiantes y personal

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T020 | Construir design tokens, shell responsive y navegación accesible por rol | T002,T015 | pendiente | Visual QA + WCAG smoke |
| T020A | Integrar identidad visual oficial: logo en home, login, shell admin y acceso requerido; favicon solo como favicon; añadir navegación Home | T002,T017,T020 | revisión | Assets verificados, metadata/favicon, textos de marca conservados, rutas Home, responsive y visual QA desktop/móvil |
| T021 | Implementar perfiles de adultos, menores y tutores | T016,T020 | pendiente | CRUD autorizado y validado |
| T022 | Implementar familias multi-child, contactos y relaciones autorizadas | T021 | pendiente | E2E de tutor con varios menores |
| T023 | Implementar datos médicos/soporte con acceso restringido | T021,T011 | pendiente | Pruebas negativas por rol |
| T024 | Implementar documentos y waivers privados en R2 con URLs firmadas | T018,T021 | pendiente | Acceso autorizado, expiración y CORS probados |
| T025 | Implementar cuentas, roles, disponibilidad y asignaciones de coaches/staff | T015,T020 | pendiente | Alta, desactivación y revocación probadas |

## M3 - Agenda, reservas y asistencia

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T026 | Implementar programas, clases recurrentes y sesiones únicas | T008,T013,T025 | pendiente | Reglas de recurrencia y timezone probadas |
| T027 | Implementar elegibilidad, capacidad, roster, booking y cancelación básica | T021,T026 | pendiente | Conflictos y capacidad probados |
| T028 | Implementar QR/PIN/name search/manual check-in | T022,T027 | pendiente | E2E de cuatro métodos |
| T029 | Implementar puntualidad, asistencia, no-show y correcciones auditadas | T019,T028 | pendiente | Corrección conserva historial |
| T030 | Implementar child check-out y autorización de recogida | T022,T029 | pendiente | E2E de todos los estados de salida |
| T031 | Implementar vista operativa en vivo sin duplicar la fuente canónica | T029,T030 | pendiente | Reconexión y consistencia probadas |

## M4 - Membresías y pagos

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T032 | Implementar catálogo y reglas de planes/membresías | T008,T013 | pendiente | Accesos y límites semanales probados |
| T033 | Implementar lifecycle de membresía: trial, active, paused, overdue, cancelled | T032 | pendiente | Transiciones inválidas rechazadas |
| T034 | Implementar adaptador provider-independent de pagos | T010,T012 | pendiente | Contract tests del adaptador |
| T035 | Implementar hosted checkout y suscripciones sin datos crudos de tarjeta | T034 | pendiente | Flujo sandbox aprobado |
| T036 | Implementar webhooks firmados, idempotentes y tolerantes a reintentos | T019,T035 | pendiente | Repetición/desorden no duplica cargos |
| T037 | Implementar pagos manuales, facturas, recibos, balances y refunds | T033,T034 | pendiente | Conciliación y permisos probados |
| T038 | Vincular estado de pago/membresía y alerta básica de fallo | T036,T037 | pendiente | Casos de fallo y recuperación probados |

## M5 - Progreso y reconocimiento

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T039 | Implementar evaluaciones 1-5, notas basadas en evidencia y visibilidad familiar | T009,T021,T025 | pendiente | Permisos y correcciones probados |
| T040 | Implementar skill checklist y resumen de progreso | T039 | pendiente | Estados y cálculo probados |
| T041 | Implementar generación explicable de candidatos de reconocimiento | T029,T039 | pendiente | Pesos, mínimos y ausencias probados |
| T042 | Implementar revisión/aprobación exclusiva del head coach | T015,T041 | pendiente | Ninguna promoción automática/pública |

## M6 - CRM y comunicaciones

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T043 | Implementar pipeline CRM, owner, next action y tareas | T021,T025 | pendiente | Transiciones y filtros probados |
| T044 | Implementar timeline automático de lead/student/family | T019,T043 | pendiente | Eventos relevantes aparecen una vez |
| T045 | Implementar announcements y mensajes de clase | T025,T026 | pendiente | Audiencia y entrega probadas |
| T046 | Implementar email/in-app con historial de entrega | T045 | pendiente | Contract tests del proveedor |
| T047 | Aplicar safeguarding: mensajes de menores visibles al tutor | T022,T046 | pendiente | Intentos privados bloqueados |
| T048 | Implementar recordatorios de pagos y seguimiento de asistencia | T038,T044,T046 | pendiente | Reglas y opt-out probados |

## M7 - Dashboard, reportes y cierre del MVP

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T049 | Implementar dashboard diario de clases, asistencia y child check-out | T031 | pendiente | Datos consistentes bajo concurrencia |
| T050 | Implementar dashboard financiero, renovaciones y follow-ups CRM | T038,T044 | pendiente | Totales reconciliados |
| T051 | Implementar reportes de students, attendance, memberships, revenue y CRM | T038,T043 | pendiente | Fixtures y totales verificados |
| T052 | Implementar reportes de progreso, reconocimiento y assessment coverage | T042 | pendiente | Filtros y privacidad probados |
| T053 | Implementar exportación de datos autorizada y auditable | T019,T051,T052 | pendiente | Export por rol sin fuga de datos |
| T054 | Configurar backups, restauración y runbook de rollback | T013,T024 | pendiente | Restauración de staging demostrada |
| T055 | Ejecutar carga, contratos, seguridad, accesibilidad y E2E completo por rol | T017-T054 | pendiente | Reportes sin fallos críticos |
| T056 | Ejecutar piloto con datos controlados y corregir hallazgos | T055 | pendiente | Acta de piloto aprobada |
| T057 | Preparar checklist de producción, monitoreo, costos y rollback | T056 | pendiente | Gates de despliegue completos |
| T058 | Desplegar a producción con confirmación explícita del operador | T057 | pendiente | Deployment verificado y rollback disponible |
| T059 | Cerrar proyecto: capability-gap-analysis y registrar `LECCIONES.md` | T058 | pendiente | Lección registrada |

## v2 - post-lanzamiento

- T060 - Booking windows, waitlists, créditos y reservas recurrentes.
- T061 - Retries, grace periods, proration, promos y workflows de freeze/cancel.
- T062 - Retention alerts y CRM automation.
- T063 - Parent/adult self-service ampliado.
- T064 - Notificaciones automatizadas completas.
- T065 - Offline attendance con sincronización y resolución de conflictos.
- T066 - Biblioteca técnica, currículo, lesson planning y promoción asistida.

## v3 - crecimiento y escala

- T067 - Goals, achievements, streaks y resúmenes familiares.
- T068 - Apps nativas iOS/Android.
- T069 - Comunidad moderada.
- T070 - Referrals, eventos, privadas, competencias y retail.
- T071 - Analytics, IA asistida, multi-academia, white label y SaaS.

## Evidencia del ciclo de autocrítica

### T001 - 2026-08-06

- Seguridad: scripts `postinstall` de `@firebase/util` y `protobufjs` revisados y bloqueados explícitamente con `allowBuilds: false`; `.gitignore` cubre `node_modules`, `.env` y `.env.local`; repositorio sin historial previo ni secretos commiteados.
- Dependencias: `corepack pnpm audit --audit-level high` -> `No known vulnerabilities found`.
- QA: `corepack pnpm install --frozen-lockfile --offline` -> exit 0; 7 workspaces listados; TypeScript 7.0.2 y Playwright 1.61.1 disponibles.
- Pruebas avanzadas: contratos/carga/casos límite no aplican todavía; T001 solo crea la estructura y no expone servicios.
- Gap de capacidad: ninguno; las skills existentes cubrieron la tarea.

### T002 - 2026-08-06

- Compatibilidad: TypeScript 7/ESLint 10 fueron descartados al quedar fuera de los rangos soportados por la cadena de Next.js 16; se fijaron TypeScript 6.0.3, ESLint 9.39.5 y `@types/node` 24.13.3, alineado con el runtime Node 22-24.
- Seguridad: dependencias exactas en lockfile; `@firebase/util`, `protobufjs` y `unrs-resolver` permanecen explícitamente sin permiso de build; `corepack pnpm audit --audit-level high` -> `No known vulnerabilities found`.
- Tipado: la configuración efectiva de la app confirma `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns` e `isolatedModules` en `true`.
- QA: `corepack pnpm lint` -> exit 0 sin warnings; `corepack pnpm typecheck` -> exit 0 en 6 workspaces; `corepack pnpm format:check` -> exit 0; instalación fresca con `corepack pnpm install --frozen-lockfile` -> 425 paquetes y exit 0.
- Pruebas avanzadas y rendimiento: no aplican a esta tarea de configuración sin rutas ni lógica ejecutable; Vitest, navegador y carga se incorporan en T003-T006.
- Limpieza: se eliminaron los árboles parciales de `node_modules` y el índice local `.pnpm-store` generados durante la recuperación; ambos eran cachés reemplazables y quedaron ignorados cuando corresponde.
- Gap de capacidad: ninguno; el toolchain configurado cubre lint, tipos y formato. La ausencia de código funcional queda deliberadamente para las siguientes tareas atómicas.

### T003 - 2026-08-06

- Implementación: Vitest 4.1.10 usa proyectos separados `web` (`jsdom`) y `node`; React Testing Library, `jest-dom`, User Event y cobertura V8 quedaron disponibles con convenciones en `qa/README.md`.
- Hallazgo del loop: los configs ESM producían warnings y el setup de matchers quedaba fuera del grafo TypeScript. Se declararon los packages raíz/web como ESM y se incluyó el setup compartido en el `tsconfig` web.
- Seguridad: no se añadieron endpoints, credenciales ni datos; pruebas automatizadas prohíben proyectos/credenciales de producción. `corepack pnpm audit --audit-level high` -> `No known vulnerabilities found`.
- QA: `corepack pnpm test:unit` -> 2 archivos/2 pruebas aprobados (render real de la homepage y contrato de runtime), sin warnings; `corepack pnpm lint` y `corepack pnpm typecheck` -> exit 0.
- Pruebas avanzadas: contratos, carga y entradas hostiles no aplican aún porque T003 solo crea el harness y no incorpora servicios ni lógica de dominio.
- Gap de capacidad: ninguno; la combinación Vitest/RTL cubre la capa unitaria y Playwright queda reservada para T005.

### T004 - 2026-08-06

- Implementación: Firebase CLI 15.26.0, SDK Admin 14.2.0 y Functions 7.3.2; proyecto seguro `demo-bpt-jersey`; Auth, Firestore y RTDB emulados en loopback; Functions configurado para runtime desplegable Node 22 y ESM.
- Seguridad: Firestore y RTDB parten en default-deny; `.env.example` no contiene valores secretos; el proyecto `demo-` no puede alcanzar recursos reales. El build nativo/red de `re2` permanece bloqueado y Firebase CLI 15.26.0 funciona sin ejecutarlo.
- QA: `corepack pnpm test:rules` inició Auth/Firestore/RTDB, ejecutó 3 rechazos esperados (anónimo y autenticado) y cerró emuladores con exit 0; Functions compila con `corepack pnpm --filter @bpt-jersey/functions build`; lint y typecheck pasan.
- Dependencias: audit sin hallazgos high/critical; dos moderadas transitivas quedaron evaluadas y registradas en `docs/security/dependency-risk-register.md` sin overrides mayores inseguros.
- Pruebas avanzadas: la primera capa de casos límite de seguridad ya prueba acceso anónimo y autenticado denegado. Contratos y carga no aplican hasta exponer funciones o flujos.
- Gap de capacidad: ninguno; la Emulator Suite y Rules Unit Testing cubren el aislamiento local requerido.

### T005 - 2026-08-06

- Implementación: Playwright 1.61.1 quedó configurado para Chromium en escritorio y Pixel 7, con trazas, capturas y video solo cuando aportan diagnóstico. El runner sirve exclusivamente `apps/web/out` en loopback y limpia los procesos hijos al terminar.
- Hallazgo del loop: Playwright buscaba el navegador en la caché global aunque ya existía una instalación aislada. `qa/run-e2e.mjs` ahora prefiere `.playwright-browsers` cuando está disponible y mantiene la ruta estándar en CI.
- Seguridad: servidor de prueba limitado a `GET`/`HEAD`, con protección contra path traversal, `X-Content-Type-Options: nosniff`, sin exposición de red ni secretos. Los artefactos visuales y reportes están ignorados por Git.
- QA funcional: build estático de Next.js aprobado; smoke desktop/móvil -> 2/2; repetición de estabilidad `--repeat-each=5` -> 10/10; sin errores de consola, overflow horizontal ni fallos de navegación.
- QA visual: screenshots desktop y móvil inspeccionados; jerarquía, contraste, layout responsive y contenido público en inglés son coherentes con la identidad BPT.
- Rendimiento: la página pública es prerenderizada como contenido estático y no incorpora JavaScript de cliente innecesario en la ruta principal.
- Gap de capacidad: Playwright MCP no estuvo expuesto como herramienta en esta sesión; Playwright CLI cubrió navegación, viewports, consola, screenshots y repetición de estabilidad sin reducir el alcance de T005.

### T006 - 2026-08-06

- Implementación: `.github/workflows/ci.yml` ejecuta instalación congelada, formato, lint, tipos, unitarias, audit, Firebase Rules, build y E2E desktop/móvil en Node 24 y Java 21.
- Seguridad: permisos globales reducidos a `contents: read`; sin secretos ni pasos de despliegue; timeout y cancelación de ejecuciones obsoletas; todas las GitHub Actions están fijadas a commits inmutables verificados contra sus tags oficiales.
- QA local: formato, lint, typecheck, 2/2 unitarias, 3/3 Rules, build estático y 2/2 E2E smoke pasan; `pnpm install --frozen-lockfile --lockfile-only --offline` valida el lockfile.
- Dependencias: `pnpm audit --audit-level high` pasa el gate y reporta únicamente las dos moderadas transitivas aceptadas temporalmente en `docs/security/dependency-risk-register.md`; no hay hallazgos high/critical.
- Evidencia remota: GitHub Actions run `31142117581` sobre el commit `e2e7618` terminó en `success` el 2026-08-06, sin pasos fallidos: https://github.com/andresleosan/BPT-Jersey/actions/runs/31142117581.

### T007 - 2026-08-06

- Implementación documental: `docs/security/data-classification-threat-model-access-matrix.md` define cuatro niveles, clasifica 26 dominios del MVP, registra 17 amenazas STRIDE/abuso y delimita 24 dominios de acceso para siete actores.
- Seguridad: `security-baseline` quedó trazado a controles y tareas posteriores; menores, salud, safeguarding, pagos, consentimientos, credenciales, archivos, audit logs, exports y backups tienen reglas negativas. No se detectaron gaps críticos sin mitigación o tarea bloqueante.
- Decisiones externas: `T008-T011` permanecen explícitamente abiertas; el documento no afirma cumplimiento legal ni fija retención, residencia, proveedor de pagos o reglas operativas aún no aprobadas.
- QA documental: búsquedas de cobertura confirmaron roles, clasificaciones, amenazas `THR-001` a `THR-017` y tareas propietarias; `git diff --check`, formato, lint, typecheck y unitarias 2/2 pasan.
- Dependencias: `pnpm audit --audit-level high` no reporta high/critical; conserva las dos moderadas registradas.
- Rules: la revalidación no se cuenta como aprobada en esta tarea porque otro proyecto (`hachi-greciaspa`) ocupa `8080/9099`; la configuración temporal en puertos alternativos confirmó además que el test actual fija `8080/9000`. No se modificaron Rules ni tests para ocultar el conflicto.
- Pruebas avanzadas: contratos, carga y entradas hostiles de runtime no aplican a este entregable documental; sus casos y fronteras quedaron asignados a `T055`.
- Aprobación: el operador aceptó el documento y autorizó continuar el 2026-08-06.

### T012 - 2026-08-07

- Implementación: `@bpt-jersey/domain` ahora expone el registro congelado de 14 módulos, 21 IDs nominales, `UtcDateTime`, paginación readonly, `Result`, contexto de actor, nueve errores de dominio serializables y una API pública explícita sin wildcard exports.
- TDD: el subagente documentó rojo por módulos ausentes y verde `9/9`; Cronos verificó rojo por `result`/`actor-context` ausentes y verde `8/8`, rojo por `errors` ausente y verde `2/2`, y rojo por export runtime incompleto seguido de verde final.
- Revisión: revisión independiente del bloque delegado -> `Spec compliance: PASS`, `Task quality: PASS`; revisión de integración -> sin hallazgos críticos/altos. Se reforzaron tests de exports runtime, retryability y serialización exacta.
- Seguridad: sin endpoints, entradas externas, integraciones, secretos, datos personales, logs ni dependencias nuevas; los escaneos no hallaron imports de Firebase/React/Next/Zod/HTTP/proveedores. Los únicos textos coincidentes (`password`, `stack`, `cause`) son aserciones negativas de `errors.test.ts`.
- QA: formato específico de `packages/domain/src/**/*.ts` aprobado; lint aprobado; typecheck raíz aprobado; unitarias `6` archivos/`17` pruebas aprobadas; `git diff --check` sin salida.
- Gate externo: `corepack pnpm format:check` sigue fallando únicamente por `opencode.json`, modificación ajena a T012 que cambia Cronos a `4.2.0` y habilita delegación. No se modificó ese archivo para ocultar el cambio del operador.
- Dependencias: `corepack pnpm audit --audit-level high` reporta únicamente las dos vulnerabilidades moderadas ya registradas; no hay high/critical.
- Pruebas avanzadas: contratos interservicio, carga, entradas hostiles, Rules y E2E no aplican a esta base de contratos sin endpoints; permanecen asignadas a las tareas funcionales y `T055`.
- Aprobación: el operador aprobó `T012` y autorizó continuar con `T013` el 2026-08-07.

### T008 - 2026-08-07

- Fuente pública: se consultaron `https://bptjersey.com/`, `/classes`, `/contact-us` y `/privacy-policy`; se registraron programas, ubicaciones, horarios y precios publicados con su procedencia.
- Datos ficticios: capacidades, zona horaria, estados iniciales, booking window, cancelación, waitlist, billing, freeze, overdue, trial y refund quedaron marcados `(f)` en `docs/operations/academy-configuration-provisional.md`.
- Decisiones pendientes: las contradicciones de kids/Carrefour/Strive/Age Concern, el texto `£8 class`, la dirección de Age Concern, capacidades, membresías, proveedor de pagos y `T011` permanecen `Pending approval`.
- Seguridad: no se añadieron datos personales, credenciales, secretos, clientes reales ni configuración ejecutable. El texto público de cuenta de relleno se registró solo como observación externa y no se importó.
- Estado: `T008` queda `pendiente`, con los datos provisionales disponibles pero sin aprobación operativa.
- Recordatorio: revisar `T008` el **2026-08-08** y confirmar valores publicados, reemplazar los `(f)` y resolver las decisiones pendientes antes de cerrar la tarea.
- Autorización de diseño (2026-08-07): el operador autorizó la opción 1; las relaciones estables pueden modelarse con valores `(f)` visibles como placeholders no productivos. `T008` permanece `pendiente` y ningún placeholder se convierte en una restricción de producción.

### T013 - 2026-08-07

- Implementación documental: `docs/adr/ADR-004-firestore-aggregate-boundaries.md` fija Firestore como fuente canónica, RTDB como presencia efímera, el límite de tenant `academies/{academyId}`, las colecciones directas por dominio, los IDs deterministas y las dependencias de `T008`, `T010`, `T011` y `T016`.
- Autorización de diseño: el operador autorizó el modelado de relaciones estables con valores `(f)` como placeholders no productivos; esta autorización no aprueba `T008` ni convierte valores provisionales en restricciones operativas.
- Estado previo: `T013` estaba `en-progreso` y conservaba la dependencia `T007,T008`.
- Seguridad: revisión documental sin secretos, credenciales, datos reales ni apertura de una fuente canónica en RTDB; el límite de tenant y las dependencias posteriores quedan explícitos.
- Verificación: `corepack pnpm exec prettier --check firestore.indexes.json` -> `Checking formatting...` y `All matched files use Prettier code style!`; `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` -> sin salida; las búsquedas de límites requeridas confirmaron las fronteras del ADR y los estados de T008/T009/T010/T011/T013.

#### Task 5 - gate final de evidencia

- Implementación revisada: ADR-004, contrato `docs/data/firestore-data-model.md`, runbook `docs/data/migrations/README.md`, `firestore.indexes.json` con 16 índices compuestos, fixture sintético con 7 registros Firestore y 1 registro RTDB, y `qa/rules/t013-data-model.test.ts` con 1 prueba específica.
- Seguridad: el escaneo sensible sobre `docs/adr`, `docs/data`, `qa/fixtures` y `qa/rules` no encontró valores secretos, credenciales, datos de tarjetas, clientes reales ni material de service account. Las 13 coincidencias de `docs/data` son prohibiciones documentales (`no secrets`, `no card numbers`, `no passwords`, etc.) sin valores sensibles. Tenant isolation, separación de Restricted, RTDB no canónico, ausencia de datos crudos de pago y backup más aprobación explícita para cambios destructivos quedaron confirmados.
- Pruebas avanzadas: `corepack pnpm test:rules` ejecutó el emulador `demo-bpt-jersey` con default-deny intacto; pasó el fixture T013 y las negativas de Rules, con 2 archivos y 4 pruebas aprobadas. No hubo acceso a producción.
- Incidente de entorno y revalidación: una repetición inmediata posterior de `test:rules` no pudo iniciar por `9099`/`8080`; `netstat` mostró únicamente conexiones `TIME_WAIT`, sin proceso escuchando. Tras 15 segundos, el mismo comando pasó nuevamente con 2 archivos/4 pruebas; no fue un fallo de T013 ni se cambió configuración o procesos.
- Comandos: `corepack pnpm test:rules` -> 2 archivos/4 pruebas aprobadas, script exit 0; `corepack pnpm test` -> 6 archivos/17 pruebas aprobadas; `corepack pnpm lint` -> exit 0 sin errores; `corepack pnpm typecheck` -> 6 workspaces completados; `corepack pnpm exec prettier --check firestore.indexes.json qa/rules/t013-data-model.test.ts` -> todos los archivos usan el estilo Prettier; `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` -> salida vacía, exit 0.
- Formatter raíz: `corepack pnpm format:check` falla únicamente por `opencode.json` externo preexistente (`[warn] opencode.json`, exit 1). No se modificó ni ocultó ese archivo; el formatter específico de T013 sí pasó.
- Fronteras: no hay cambios en `firestore.rules`, `database.rules.json`, `firebase.json`, `.firebaserc`, `apps/web` ni `apps/functions` versionables. Los cambios previos no relacionados en configuración de Cronos, `.gitignore`, `AGENTS.md`, `.cronos/` y `packages/domain/src/index.ts` se conservaron sin alterarlos.
- Dependencias abiertas: `T008` continúa `pendiente`; `T009`, `T010` y `T011` continúan `bloqueadas`; `T016` conserva la propiedad de las Rules concretas. Los valores `(f)` y `Pending approval` siguen siendo placeholders no productivos.
- Operaciones: no se ejecutaron migraciones, `up`, `down`, backups, restauraciones, despliegues, cambios de Rules, operaciones destructivas, gastos, manejo de secretos ni commits. El emulador usado por `test:rules` no es una aprobación operativa.
- Checkpoint previo: `T013` pasó a `revisión` con evidencia del gate final; no se iniciaron T015/T016.
- Aprobación del operador (2026-08-07): el operador aceptó explícitamente T013 después de la revisión integral y la verificación fresca; T013 pasa a `aprobada`. T008-T011 y T016 conservan sus estados y ownership sin cambios.

### Regyfit discovery foundation - 2026-08-07

- Estado: `en revisión`; la sesión autenticada permitió una captura estructural read-only, pero todavía no se observaron entidades ni campos fuente suficientes para aprobar un mapeo de migración.
- Implementación: contratos de manifiesto, validación de seguridad, sanitización, captura de frames same-origin y pruebas offline en `packages/domain/src/migration/` y `qa/src/regyfit/`.
- Evidencia live: manifiesto sanitizado con 5 módulos (`admin2`, `mail_editor`, `quest_manager-php`, `image_manager-php`, `video_tutoriais-php`) y 3 rutas adicionales observadas solo como frames.
- Seguridad: no se guardaron filas, valores, cookies, storage, credenciales, documentos, screenshots ni acciones mutantes; exportación oficial y API documentada quedaron `not verified`.
- QA: `corepack pnpm test` -> 10 archivos/40 pruebas aprobadas; `corepack pnpm --dir qa typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; Playwright Regyfit offline -> 2/2 aprobadas y 2 live omitidas por falta de variables de entorno.
- Dependencias: `corepack pnpm audit --audit-level high` -> sin high/critical; `corepack pnpm audit` conserva 2 vulnerabilidades moderadas transitivas (`uuid` y `@opentelemetry/core`) fuera del alcance de esta tarea.
- Rendimiento: no aplica como release grande; la captura live fue limitada a 40 rutas, solo same-origin, con parámetros estructurales allowlisted y sin navegación a segmentos mutantes.

### Regyfit access admin integration - Task 3A - 2026-08-08

- Implementación verificada: locks de provisioning con `phase` obligatorio, `leaseDeadline` absoluto, renovación acotada, fencing por `lockId`, recuperación de leases expirados y compensación fail-closed; el heartbeat espera renovaciones en vuelo antes de limpiar.
- Seguridad: revisión específica sin secretos, endpoints sin autorización, exposición nueva de datos sensibles ni logs de registros; el bootstrap de owner continúa restringido a hosts loopback de los emuladores. Las dos vulnerabilidades moderadas transitivas permanecen registradas en `docs/security/dependency-risk-register.md`; no hay high/critical.
- QA: `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts` -> 2 archivos/32 pruebas aprobadas; `corepack pnpm test` -> 14 archivos/83 pruebas aprobadas; `corepack pnpm --filter @bpt-jersey/functions typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; Prettier específico -> todos los archivos usan el estilo; `git diff --check` -> salida vacía.
- Estado: resolución del blocker verificada y documentada; queda en `revisión` hasta aprobación explícita del operador. No se ejecutaron despliegues, migraciones, importación real ni commits.

### Regyfit access admin integration - Task 4 - 2026-08-08

- Implementación: shell administrativo data-free en `/admin`, con navegación semántica, skip link nativo, foco visible, sidebar responsive BPT y seis módulos en estado `Not yet imported`; la ruta permanece Server Component y no activa Firebase ni lee registros.
- QA: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx` -> 5/5; `corepack pnpm --filter @bpt-jersey/web typecheck` -> exit 0; `corepack pnpm --dir qa typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; Prettier específico -> todos los archivos usan el estilo; build web -> `/admin` prerenderizado; `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` -> 2/2 en desktop/móvil, con foco nativo, ausencia de datos/IP/secretos, errores de consola vacíos y sin overflow horizontal en document/body.
- Seguridad: sin endpoints nuevos, secretos, datos reales, Firebase, logs sensibles ni dependencias nuevas. Las dos vulnerabilidades moderadas transitivas continúan registradas; no hay high/critical.
- Observación menor aparcada: el servidor estático de QA requiere reescribir `/admin` a `admin.html`; el test conserva la URL semántica y valida el documento generado, sin cambiar la configuración del servidor.
- Estado: Task 4 verificada y en `revisión` hasta aprobación explícita del operador. No se ejecutaron despliegues, migraciones, importación real ni commits.

### Regyfit access admin integration - Task 5 - 2026-08-08

- Implementación: contrato de snapshot `RegyfitAccessRecord`, mapper con validación estricta, normalización UTC, IDs de origen opacos, proyecciones owner/safe y unicidad por `sourceId`; no deriva `userId`, `studentId` ni identidad Auth.
- Backend: lectura read-only únicamente desde `academies/{actor.academyId}/regyfitAccessRecords`, autorización con claims/academy scope, owner recibe `IP`, administrator recibe proyección sin `IP`, roles no administrativos y documentos fuera de scope son rechazados.
- QA: focused -> 2 archivos/17 pruebas; `corepack pnpm test:unit` -> 17 archivos/105 pruebas; typecheck de domain/functions -> exit 0; lint -> exit 0; Prettier específico -> todos los archivos pasan; audit -> sin high/critical, dos moderadas transitivas ya registradas.
- Seguridad: se rechazan tipos inválidos, campos inesperados, prototipos no planos, valores con forma de credencial, timestamps no canónicos, IDs vacíos, requests `null` y duplicados; los errores de documentos no incluyen valores sensibles.
- Observaciones menores aparcadas: los fallos de infraestructura de Firestore se propagan desde el servicio inyectable y el `context` tipado del mapper no tiene una comprobación runtime de prototipo plano; ambos quedan fuera del contrato `unknown`/scope de esta tarea.
- Estado: Task 5 verificada y en `revisión` hasta aprobación explícita del operador. No se ejecutaron despliegues, migraciones, importación real ni commits.

### Regyfit access admin integration - Task 6 - 2026-08-08

- Implementación: panel read-only responsive con búsqueda case-insensitive por `memberDisplayName`, `memberNumber` y `sourceId`; filtros `all/active/inactive` derivados solo de `loginCount`; estados no-results diferenciados; detalle completo de la proyección; IP restringida únicamente a owner.
- Seguridad y límites: props owner/administrator discriminadas en TypeScript; administrator no renderiza IP aun con objeto malformado; ruta directa y `/admin` permanecen data-free con role preview administrator en el panel; no hay Firebase Admin, staging root, `fetch`, secretos ni endpoints genéricos en la web.
- Accesibilidad: labels asociados, botones keyboard-accessible, `aria-controls`/`aria-expanded`, focus al detalle, región descriptiva, `aria-live` para estados vacíos, tabla adaptable a cards, focus visible y `prefers-reduced-motion`.
- QA: focused panel+shell -> 2 archivos/13 pruebas; web -> 5 archivos/23 pruebas; web typecheck -> exit 0; lint -> exit 0; Prettier específico -> pasa; web build -> `/admin` y `/admin/regyfit-access-records` prerenderizados.
- Alcance diferido: Task 7 debe añadir autenticación/denegación, bootstrap controlado, wiring backend/proyección real y E2E desktop/móvil antes de cargar cualquier registro.
- Estado: Task 6 verificada y en `revisión` hasta aprobación explícita del operador. No se ejecutaron despliegues, migraciones, importación real ni commits.

### Regyfit access admin integration - Task 7 - 2026-08-08

- Implementación: `/admin` y `/admin/regyfit-access-records` comparten una gate; build normal usa Firebase Auth y falla cerrado para signed-out/denied; la boundary E2E exige flag baked y hostname loopback, con roles allowlisted y sin activar el bypass en hosts no loopback.
- Bootstrap E2E: records solo sintéticos e inyectados por `page.addInitScript` para owner/administrator; `coach`, `guardian` y `adultStudent` no reciben records. Owner recibe IP; administrator recibe safe projection sin IP. El `importRunId` permanece visible por formar parte de `Omit<RegyfitAccessRecord, "ip">` aprobado.
- QA: build normal -> exit 0 sin records/IP sintéticos en HTML/chunks; build E2E -> exit 0; focused web/admin bootstrap -> 35/35; `corepack pnpm test` -> 19 archivos/129 pruebas; Playwright admin -> 24/24 desktop + Pixel 7; typechecks web/QA, lint y Prettier -> exit 0; audit sin high/critical, dos moderadas transitivas registradas.
- Entorno: `qa/run-e2e.mjs` solo propaga `BASE_URL`, `CI`, `PLAYWRIGHT_BROWSERS_PATH` y el flag E2E; no lee staging, secretos ni credenciales reales. No se ejecutaron Firebase Auth real, despliegues, migraciones, importación ni commits.
- Alcance pendiente: la lectura backend real/callable sigue pendiente antes de cargar registros reales; Task 8 conserva la propiedad del importer y la integración real debe usar la proyección autorizada de Functions.
- Estado: Task 7 verificada y en `revisión` hasta aprobación explícita del operador.

### Regyfit access admin integration - Task 8 - 2026-08-08

- Implementación: importer emulator-only/idempotente con path fijo `<privateRoot>/<runId>/<moduleKey>/chunk-000000.jsonl`, marcador privado no-symlink, root fuera del checkout, gates exactos de run/módulo/ruta/conteo, mapping de dominio y escritura determinista por `sourceId`.
- Seguridad: `importRegyfitAccessRecords` valida target antes de leer staging o Firestore; rechaza producción, emulator remoto y staging sin confirmación. Errores y receipt no incluyen root, rutas privadas, raw lines ni valores de registros. Audit único metadata-only.
- Idempotencia: `REGYFIT_CAPTURED_AT` fijo y UTC canónico, hash lexical/canónico estable, repetición -> `skippedCount=10`, conflicto no sobrescribe y transacción falla sin audit parcial.
- QA: focused importer -> 2 archivos/16 pruebas; `corepack pnpm test:unit` -> 21 archivos/145 pruebas; typecheck Functions/QA -> exit 0; lint, Prettier y `node --check` -> pass; audit sin high/critical, dos moderadas transitivas registradas.
- Observación menor: los symlinks intermedios del path se rechazan por `realpath`, aunque no tienen fixture separado; no se leyó staging real ni se inició Emulator.
- Estado: Task 8 verificada y en `revisión` hasta aprobación explícita del operador. El run real queda estrictamente para Task 9 con checkpoint operativo y confirmación explícita.
- Próximo gate: confirmar export/API oficial o relevar explícitamente los flujos de entidades/campos faltantes bajo el mismo límite read-only antes de diseñar migración ejecutable.

### Regyfit access admin integration - Task 9 - 2026-08-09

- Adaptación aprobada: el staging real contiene 10 envelopes de captura; el importer ahora valida el envelope, convierte `logins`, normaliza `lastLogin` desde `Europe/Jersey` a UTC y conserva `memberNumber` ausente como `null`, sin reconciliar identidades.
- QA de implementación: dominio `8/8`, importer `14/14`, backend projections `12/12`, panel web `9/9`; suite unitaria completa `151/151`; Rules `8/8`; admin E2E sintético `30/30` con 2 discovery live omitidos; QA typecheck, Functions build, runtime domain build, lint y `node --check` pasan.
- Dry-run real sin escritura: `plannedCount=10`, `skippedCount=0`, hash `a351dd5e8372e7100ca82b9b5e238d5265b3f091aca596039efb8356aee51c02`, audit path sanitizado `academies/demo-academy/auditEvents/regyfit-access-regyfit-20260808-acessos-01`.
- Baseline y autorización: el service account externo al checkout corresponde a `bptjersey-f5a25`; la colección y el audit scope estaban vacíos antes de aplicar. No se usó Emulator ni producción.
- Importación real: primer run `importedCount=10`, `skippedCount=0`; repetición idempotente `importedCount=0`, `skippedCount=10`; hash y audit path coinciden con el dry-run.
- Verificación post-import: `count=10`, `distinctSourceIdCount=10`, `importRunIdCount=10`, `auditEventCount=1`, `unexpectedFieldCount=0`, `auditMetadataOnly=true`.
- Estado: Task 9 verificada y en `revisión` hasta aprobación explícita del operador. Producción permanece intacta; rollback no destructivo: eliminar únicamente documentos del `importRunId` aprobado.

### Regyfit real panel wiring - 2026-08-09

- Implementación: callable `listRegyfitAccessRecords` exportado por Functions; reutiliza la autorización por claims/academy y las proyecciones owner/safe existentes. El navegador usa `httpsCallable` y nunca recibe Admin SDK, service accounts ni staging paths.
- Web: `AdminAccessRecordsContent` carga la proyección real después de Auth, muestra estados de carga/error sanitizados y conserva datos sintéticos solo con `NEXT_PUBLIC_ADMIN_E2E=true` en loopback.
- Runtime: Functions smoke `functions-runtime-ok`; `main` corregido a `lib/src/index.js`; runtime domain acotado a los submódulos usados por Functions; `apps/functions/scripts/build-deploy-artifact.mjs` compila, prepara imports ESM, empaqueta sin `workspace:*`/`catalog:` y valida el artefacto antes del deploy.
- QA: suite completa `156/156`; Rules `8/8`; backend focused `45/45`; web callable/panel `26/26`; typechecks Functions/web/QA, lint, builds y formato específico pasan; E2E sintético `30/30` con 2 discovery live omitidos.
- Deploy: deploy exclusivo a `bptjersey-f5a25` completado; `listRegyfitAccessRecords` aparece `ACTIVE`, callable v2, Node 22, `us-central1`. Smoke HTTP sin identidad devuelve `403` en vez de `404`, confirmando que el endpoint existe y permanece protegido. Artifact Registry quedó con cleanup policy de 7 días en `us-central1`.
- Rollback: redeployar la revisión anterior de `apps/functions` con el mismo artefacto portable; los 10 documentos importados no se modifican y pueden eliminarse únicamente filtrando el `importRunId` aprobado.
- Limitación de verificación: no se ejecutó una lectura live owner/administrator porque no hay credenciales de Firebase Auth de staging disponibles en esta sesión; las proyecciones están cubiertas por `45/45` focused tests y el callable está publicado.
- Estado: Task 9 y el wiring real quedan en `revisión` hasta una verificación Auth live. Las alertas de facturación de Google Cloud siguen pendientes de configurar por el operador. Producción permanece intacta.

### Unified Login Gateway - hallazgos I-1 a I-6 y M-1 a M-3 - 2026-08-09

- Estado: `revisión`; no se desplegó, migró, crearon usuarios reales, leyeron secretos ni modificó el historial Git.
- Correcciones: `.gitignore` conserva secretos/builds ignorados y permite versionar `apps/web/src/lib/**`; Google atraviesa una sola boundary y conserva el adaptador de emulador; emuladores quedan local-only con guardia de build/runtime y documentación explícita para Cloudflare/staging; account/shop prueban el contrato real `role=client` y destinos allowlisted; el lint global pasa sin warnings; el skip link apunta a `#login-form`; Playwright cubre teclado, foco, validación ARIA, selector, consola y overflow en desktop/móvil; se agregó el proyecto `live-auth` opt-in, local-only y sin artefactos que puedan contener credenciales.
- QA: `node_modules/.bin/vitest.cmd run --project web --project node` -> 29 archivos, 187 pruebas aprobadas; `node_modules/.bin/eslint.cmd . --max-warnings 0` -> aprobado; typecheck directo web/UI/config/QA -> aprobado; build normal de `apps/web` -> aprobado; E2E gateway -> 8/8 desktop/móvil; E2E sintético completo con build local `NEXT_PUBLIC_ADMIN_E2E=true` -> 38/38 aprobadas y 4 omitidas por suites live/read-only; `node qa/run-e2e.mjs --project=live-auth` -> 1 omitida por falta de habilitación/credenciales locales; `git diff --check` -> sin salida.
- Dependencias: `corepack pnpm audit --audit-level high` -> 2 vulnerabilidades moderadas transitivas ya existentes, sin high/critical; permanecen registradas fuera del alcance del gateway.
- Guardia de entorno: build con `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` y `NEXT_PUBLIC_FIREBASE_ENV=staging` rechazado antes de compilar; el build normal fue restaurado y aprobado después.
- Limitación Auth live: no se ejecutó login real cliente/admin porque esta sesión no tiene una sesión local no productiva provista por el operador; no se reclama esa evidencia. La prueba queda disponible con `UNIFIED_LOGIN_LIVE_AUTH=true` y las cuatro variables inyectadas fuera del repositorio, omitida en CI.
- Formato/tipos: el check específico de código, QA, `STACK.md` y el informe pasa; el check global señala `tasks.md` por su formato histórico y `opencode.json` por un cambio preexistente ajeno. El wrapper `corepack pnpm typecheck` aborta por purga no interactiva de pnpm. Functions/domain directo conserva el fallo preexistente de extensiones `.js` en imports relativos bajo `node16`; no se amplió el alcance del gateway.
- Rollback: para frontend, publicar la revisión anterior de Cloudflare Pages; para backend, redeplegar la revisión anterior de Functions con el artefacto portable. Esta corrección no aplicó cambios de backend, migraciones ni despliegues.

### Unified Login Gateway - verificación live y logout - 2026-08-09

- Deploy frontend: Cloudflare Pages project `bptjersey`, production deployment `486fd9dd`, publicado en `https://bptjersey.pages.dev`; `/login` y `/admin` responden HTTP 200.
- Auth staging: la cuenta administrativa de prueba recibió únicamente `academyId=demo-academy` y `role=administrator`; no se alteraron contraseña, email, verificación ni otros usuarios.
- Verificación manual: operador confirmó acceso de cliente a `/account`, cierre de sesión con retorno al login y acceso administrativo con claims válidas a `/admin`.
- Corrección: el shell administrativo ahora muestra `Sign out`; el logout de cliente redirige a `/login?role=client&returnTo=/account`.
- QA posterior: suite unitaria `188/188`, lint global, typecheck web, Prettier específico y `git diff --check` aprobados; build Next y E2E gateway `8/8` aprobados en la misma entrega.
- Rollback: restaurar el deployment anterior de Cloudflare Pages; no hubo cambios de Functions, Firestore ni migraciones.
- Estado: `revisión`; producción funcional publicada, sin verificación de compra porque catálogo, carrito y pagos permanecen fuera de alcance.

### T016 - Firestore Rules boundary - 2026-08-09

- Estado: `revisión`; se cerró la lectura directa de `academies/{academyId}/regyfitAccessRecords` para todos los roles y se mantuvo la proyección autorizada exclusivamente en Functions.
- TDD: se cambió primero `qa/rules/regyfit-access-records.test.ts`; el focused emulator rojo falló solo porque el owner `getDoc` todavía sucedía bajo la excepción existente. Después se eliminó `isAcademyOwner` y el `allow get` positivo de `firestore.rules`.
- Implementación: `firestore.rules` conserva `allow create, update, delete: if false` y el fallback global `allow read, write: if false`; `database.rules.json` permanece sin cambios con `.read=false` y `.write=false`; `apps/functions/src/regyfit/access-records.ts` y sus proyecciones permanecen sin cambios.
- QA focused: `node_modules/.bin/firebase.cmd emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --project rules qa/rules/regyfit-access-records.test.ts"` -> `4/4`; `node_modules/.bin/vitest.cmd run apps/functions/src/regyfit/access-records.test.ts` -> `13/13`.
- QA completo: `node_modules/.bin/firebase.cmd emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node node_modules/vitest/vitest.mjs run --project rules"` -> 3 archivos, `8/8`; solo fixtures sintéticos y emuladores locales.
- Shape/security: assertion de Rules/RTDB -> `rules-shape-ok`; no hay cláusulas positivas `allow get/read/list`, no hay lectura web directa de Regyfit y ningún rol conserva write access. Los mensajes del emulator son únicamente denegaciones esperadas.
- Regresión: `node_modules/.bin/vitest.cmd run --project web --project node` -> 29 archivos, `188/188`; `node_modules/.bin/tsc.cmd --noEmit -p apps/web/tsconfig.json` -> aprobado; `node_modules/.bin/eslint.cmd . --max-warnings 0` -> aprobado; Prettier de `qa/rules` -> aprobado; `git diff --check` -> sin salida.
- Datos/operaciones: no se modificaron documentos, índices, migraciones, backups, staging o producción; no se crearon usuarios, leyeron secretos, desplegó ni hizo commit. No requiere backup porque el cambio es solo textual de Rules/prueba.
- Rollback textual: restaurar la versión anterior de `firestore.rules` y `qa/rules/regyfit-access-records.test.ts`; `database.rules.json` no requiere rollback ni restauración de datos.
- Concern: `node node_modules/prettier/bin/prettier.cjs --check tasks.md` mantiene el warning histórico de formato de `tasks.md`; no se reformateó el archivo completo para evitar cambios fuera de T016.

### T017 - MFA TOTP - 2026-08-09

- Implementación histórica: T017 exigía exactamente `request.auth.token.firebase.sign_in_second_factor === "totp"`; quedó cancelada y sustituida por ADR-005, por lo que la autorización actual valida únicamente autenticación, claims administrativos y alcance de academia.
- Web Auth: la boundary Firebase expone únicamente enrolamiento TOTP en memoria, assertion de enrolamiento/desafío, detección de `enrolledFactors` y `getIdTokenResult(user, true)`. El resolver MFA queda en memoria durante el login administrativo; no se usa SMS/Phone Auth.
- Gate/UI histórico: los componentes TOTP siguen disponibles para el flujo opt-in documentado, pero el `AdminGate` actual no exige enrolamiento ni desafío MFA.
- E2E histórico: esta tarea fue cancelada y sustituida por ADR-005; sus pruebas TOTP y el proyecto `t017-mfa-live` permanecen como material histórico/opt-in, no como requisito del panel actual.
- Seguridad: QR/URI, secreto y código se mantienen solo en memoria de Auth/componente; no se escriben en Firestore, RTDB, custom claims, localStorage, URLs de navegación, logs, reportes ni artefactos. No existe bypass público ni código fijo. Recuperación requiere eliminar/re-enrolar el factor dedicado desde Firebase Auth por el operador.
- QA: `node_modules/.bin/vitest.cmd run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/regyfit/access-records.test.ts` -> `24/24`; boundary MFA -> `14/14`; provider/UI/login focused -> `17/17`; suite completa `node_modules/.bin/vitest.cmd run --project web --project node` -> `31 archivos, 203 pruebas`; typecheck web y QA -> exit 0; lint global -> exit 0; Prettier específico -> todos pasan; build web normal y build E2E -> exit 0; Functions tsc directo -> exit 0; E2E admin sintético -> `18/18` desktop/móvil; login gateway -> `8/8` desktop/móvil.
- Seguimiento del login: el commit publicado aún convertía `auth/multi-factor-auth-required` en el mensaje genérico; el cambio local en `login-form.tsx` enruta ese error administrativo al desafío TOTP y conserva el resolver en memoria. Prueba enfocada -> `12/12`; suite completa -> `33 archivos, 205 pruebas`; typecheck web, lint, Prettier específico, build Next y E2E login sintético -> `8/8` desktop/móvil.
- Dependencias: `corepack pnpm audit --audit-level high` -> dos vulnerabilidades moderadas transitivas ya registradas, sin high/critical. `corepack pnpm --filter @bpt-jersey/functions build` no pudo completar porque pnpm intentó purgar `node_modules` sin TTY; el equivalente directo `tsc` pasó y no se cambió la configuración para ocultar la limitación.
- Operaciones y secretos: no se desplegó, migró, crearon usuarios, leyeron/escribieron secretos, modificó historial Git ni hizo commit. La verificación live real de Firebase/TOTP queda pendiente de una cuenta administrativa staging dedicada y código inyectado por el operador; el seguimiento local todavía no está publicado.
 - Rollback: restaurar las revisiones anteriores de web/Functions; si se usa staging, retirar únicamente el factor TOTP de la cuenta dedicada en Firebase Auth. No hay migración de Firestore/RTDB ni backup de datos requerido.

### Task 4 - Members and reports fixes - 2026-08-11

- Alcance corregido: navegación admin sin hashes legacy y `aria-current` derivado de la ruta; `getMemberReportSummary` count-only con aggregate Firestore bounded; filtros web serializados con las 11 claves allowlisted; expiración de URL PDF ISO, futura y acotada; apertura de pestaña durante el gesto; export journal específico y durable antes de R2; rate limit transaccional por academia/administrador; límites de filas/tamaño; fallback seguro para Unicode en PDF; estados de tabla y counters separados.
- TDD rojo: focused web inicial -> 3 archivos, 11 pruebas fallidas por los contratos nuevos; focused Functions/PDF inicial -> 2 archivos, 5 pruebas fallidas, incluyendo la reproducción `WinAnsi cannot encode` para CJK. No se modificó código productivo antes de observar estos fallos.
- TDD verde: `corepack pnpm exec vitest run --project web apps/web/src/lib/members-client.test.ts apps/web/src/app/admin/members/search/page.test.tsx apps/web/src/app/admin/page.test.tsx` -> 3 archivos, 21/21; `corepack pnpm exec vitest run --project node apps/functions/src/members/member-report-pdf.test.ts apps/functions/src/members/member-callables.test.ts` -> 2 archivos, 38/38.
- Suite inicial de la segunda ronda: `corepack pnpm test` -> 40 archivos, 277/277 pruebas aprobadas.
- Tipos, lint y build: `corepack pnpm typecheck` -> exit 0 en 6 workspaces; `corepack pnpm lint` -> exit 0 sin warnings; `corepack pnpm build` -> Functions y Next.js build estático exit 0, rutas `/admin`, `/admin/members/search` y `/admin/regyfit-access-records` prerenderizadas.
- Formato: Prettier específico de los archivos modificados -> exit 0. `corepack pnpm format:check` -> exit 0 después de normalizar el artefacto generado `apps/web/next-env.d.ts`.
- Browser smoke: corrida normal sin flag E2E -> 2/4 aprobadas (homepage desktop/móvil) y 2 admin fallidas porque el build protegido queda signed-out sin `NEXT_PUBLIC_ADMIN_E2E`; después se actualizó el contrato de navegación y se ejecutó build sintético local con `NEXT_PUBLIC_ADMIN_E2E=true`; `corepack pnpm --dir qa test:e2e:smoke` -> 4/4 desktop/móvil, sin errores de consola ni overflow.
- Seguridad y dependencias: revisión sobre cambios sin secretos, PII en logs, URLs PDF construidas por cliente ni endpoints nuevos sin autorización; rate limit server-side requerido en `MemberCallableServices`; URLs firmadas de upload/download validadas como HTTPS absolutas; clave de rate limit no ambigua; `corepack pnpm audit --audit-level high` -> sin high/critical, 2 moderadas transitivas ya registradas en `docs/security/dependency-risk-register.md` (`uuid` y `@opentelemetry/core`).
- Operaciones: no se leyeron secretos, no se modificó Git, no se desplegó, no se migró ni se accedió a staging/producción. Concern residual: el aggregate Firestore y el rate limiter transaccional están cubiertos por adapters y tests inyectados, pero no se ejecutó una prueba contra un emulador Firestore específico para esas dos operaciones en esta ronda.
- Tercera ronda: `MemberStore.list(academyId, limit)` exige un límite; search usa `MAX_MEMBER_SEARCH_ROWS=10_000` y lee `limit(max+1)`, mientras reportes/PDF usan `MAX_MEMBER_REPORT_ROWS=2_000` y rechazan `resource-exhausted` antes de materializar/generar por encima del límite. El codec y los offsets de paginación HMAC no cambiaron.
- TDD: focused inicial de esta ronda -> 2 archivos, 5 fallos esperados (overflow search/report y URLs signer inválidas); focused verde -> `2 archivos, 47/47`.
- Corrección `noNumber`: `createFirestoreMemberStore.countByReport` usa la ruta bounded y `matchesMemberReport`, por lo que la ausencia real de `membershipNumber` equivale exactamente a `undefined`; no usa `where == null`.
- Integración local: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"` -> `1 archivo, 4/4`, con documentos sintéticos aislados y limpieza explícita. Cubre `countByReport/noNumber`, rate limiter transaccional y aislamiento de tuplas, y journals Firestore de report export/import cleanup. La suite unitaria normal no incluye `qa/integration`.
- QA final: `corepack pnpm test` -> `40 archivos, 287/287`; `corepack pnpm test:rules` -> `4 archivos, 9/9` en la evidencia previa; `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check` y builds web/Functions -> exit 0. `corepack pnpm audit --audit-level high` -> 2 moderadas transitivas conocidas, sin high/critical.
- Incidentes de entorno: una ejecución paralela de las dos Emulator Suites chocó en puertos y falló; la repetición secuencial de `test:rules` pasó. La integración emite un `MetadataLookupWarning` no fatal bajo el proyecto demo; no usa credenciales ni proyecto real.
- Estado: continúa en `revisión`; no se marca `aprobada` ni se ejecutan Git, despliegues o migraciones.

#### Post-verificación de la regresión temporal - 2026-08-12

- Hallazgo: dos aserciones de `page.test.tsx` consultaban el DOM con `getByRole` inmediatamente después de una actualización React en `startTransition`; la llamada mock ya había ocurrido, pero la fila todavía no estaba renderizada bajo la suite global.
- Corrección mínima: ambas aserciones usan `await screen.findByRole`, sin cambios en producción ni debilitamiento del contrato accesible. Revisión independiente: sin hallazgos.
- QA: `corepack pnpm test` -> 45 archivos, 364/364 pruebas; `corepack pnpm test:rules` -> 4 archivos, 9/9; integración Firestore con emulador local -> 1 archivo, 6/6; lint, typecheck, `format:check` y build normal -> exit 0.
- Browser QA: build local explícito con `NEXT_PUBLIC_ADMIN_E2E=true` y `corepack pnpm --dir qa test:e2e:smoke` -> 4/4 desktop/móvil; después se restauró y verificó el build normal sin el flag. La corrida normal del smoke sobre el build protegido no se considera evidencia sintética válida porque las rutas admin deben quedar signed-out sin ese flag.
- Seguridad: sin endpoints, secretos, PII, logs sensibles, permisos, migraciones ni despliegues nuevos. `corepack pnpm audit --audit-level high` conserva únicamente las 2 vulnerabilidades moderadas transitivas registradas; no hay high/critical.

### Visible administrative panel delivery - 2026-08-12

- Alcance aprobado por el operador: construir primero el panel administrativo visible completo,
  tomando la página replicada como contrato de campos, filtros, acciones rápidas y lenguaje visual.
  La tienda virtual queda para una fase posterior.
- Especificación: `docs/superpowers/specs/2026-08-12-administrative-panel-visible-delivery-design.md`.
- Plan: `docs/superpowers/plans/2026-08-12-visible-administrative-panel-delivery.md`.
- Implementación visible: `Overview`, `Members`, `Groups / Teams`, `Activities`, `Attendance`,
  `Reports`, `CRM` y `Finance` tienen rutas reales, navegación protegida por `AdminGate`, tablas,
  filtros, métricas, estados y acciones de preview. Members conserva los 11 filtros y los campos
  replicados; Members add/search/import permanecen disponibles.
- Barra de acciones: el dashboard expone `Add new member`, `Search members`, `Groups / teams`,
  `Create / manage activities`, `Attendance`, `Finance` y `Reports` como enlaces navegables.
- Datos: `apps/web/src/app/admin/preview-data.ts` contiene únicamente fixtures sintéticos locales,
  marcados como `synthetic-preview`; no representan importación real ni datos del cliente.
- QA focused: primitivas, dashboard, Members, Groups, Activities, Attendance, Finance, Reports y
  CRM -> 10 archivos, 18/18 pruebas; typecheck -> exit 0.
- QA global: `corepack pnpm test` -> 54 archivos, 374/374 pruebas; `corepack pnpm lint` -> exit 0;
  `corepack pnpm typecheck` -> exit 0; `corepack pnpm format:check` -> exit 0; `corepack pnpm build`
  -> exit 0 con las rutas admin prerenderizadas.
- Browser QA: build explícito con `NEXT_PUBLIC_ADMIN_E2E=true` y
  `corepack pnpm --dir qa test:e2e:smoke` -> 4/4 desktop/móvil; sin errores de consola ni overflow.
  El build normal fue restaurado después. El servidor estático QA ahora responde correctamente a
  los sidecars metadata-only de Next sin convertirlos en falsos errores de recursos.
- Seguridad: no se añadieron endpoints públicos, secretos, PII real, pagos, importación PDF,
   migraciones ni despliegues. `corepack pnpm audit --audit-level high` conserva únicamente las 2
   vulnerabilidades moderadas transitivas registradas; no hay high/critical.
- Revisión posterior: el claim técnico `owner` es el único autorizado para conceder o revocar
  accesos administrativos; la exportación de PII queda permitida sin restricción adicional; las
  búsquedas, reportes y contadores usan rate limiting durable por academia, administrador y
  operación, con scopes independientes para no bloquear los ocho contadores entre sí.
- TDD de rate limiting: prueba roja -> las lecturas no consumían cupo; prueba verde -> focused
  `apps/functions/src/members/member-callables.test.ts` `67/67` y focused web/backend `73/73`.
- Estado: `revisión`. El panel visible está listo para demostración con preview sintético; la
  persistencia real de Groups, Activities, Attendance, Finance, Reports y CRM requiere una fase
  posterior de callables/Firestore y no debe presentarse como conectada todavía.

### T020A - Identidad visual y navegación Home - 2026-08-09

- Implementación: `apps/web/public/bpt-jersey-logo.png` contiene el logo oficial y `apps/web/public/favicon.png` contiene el favicon separado. El logo se agregó al header público, al panel izquierdo del login, al sidebar autenticado y como watermark de los estados de acceso admin. Los textos existentes `BPT Jersey` y `BPT / Jersey` se conservaron junto a los assets.
- Navegación: login, shell admin y acceso admin bloqueado exponen un enlace `Home` hacia `/`; la navegación pública conserva su `Home` hacia `#top`.
- Metadata: `layout.tsx` usa exclusivamente `favicon.png` para `icon`, `shortcut` y `apple`; el favicon no se renderiza como logo.
- Accesibilidad: alt del logo, foco visible, orden de tabulación actualizado para el nuevo Home y layout responsive desktop/móvil conservado.
- QA: focused branding `8/8`; suite unitaria completa `33 archivos, 205 pruebas`; `corepack pnpm lint` -> exit 0; `corepack pnpm typecheck` -> exit 0; Prettier específico -> todos pasan; build web E2E -> exit 0; E2E sintético con `NEXT_PUBLIC_ADMIN_E2E=true` -> `42/42` ejecutables aprobados y `11` live/opt-in omitidos sin credenciales.
- Seguridad: no se añadieron endpoints, dependencias, secretos, datos de usuarios ni permisos. Los assets son archivos estáticos locales; el watermark no contiene información operativa.
- Operaciones: no se desplegó, migró, modificaron datos, leyeron secretos ni hicieron commits. Las rutas sintéticas actuales ya no requieren `adminTestMfa=verified`, en línea con ADR-005.
- Rollback: retirar los dos assets y revertir los cambios de branding/metadata/tests; no requiere migración ni backup.
- Ajuste visual posterior: `apps/web/src/content/academy.ts` conserva el título canónico con coma y añade tres grupos de línea; `apps/web/src/app/page.tsx` los renderiza como spans visuales con nombre accesible completo; `globals.css` ajusta el ritmo vertical, tracking y ancho responsive para evitar que la coma parezca un acento sobre la `D`.
- TDD/QA: contrato enfocado primero falló por el título local sin coma y la ausencia de `titleLines`; después pasó `4/4`. Suite unitaria completa `corepack pnpm test:unit` -> `33 archivos, 205 pruebas`; Prettier específico, ESLint específico y `tsc --noEmit -p apps/web/tsconfig.json` -> exit 0; build web -> exit 0; E2E homepage desktop/móvil -> `2/2`; captura visual desktop/móvil inspeccionada sin overflow horizontal ni errores de consola.
- Revisión independiente: se reforzó el contrato exacto del nombre accesible, se añadió la correspondencia `titleLines` -> `title`, se verificó la estructura de tres líneas en unitarias/E2E y cada span del hero dejó de heredar `overflow-wrap: anywhere`.
- Cierre de revisión: cada grupo usa `white-space: nowrap` y el mínimo móvil baja a `2.6rem`; E2E comprueba que cada grupo conserva un único rect físico en desktop y móvil.
- Seguridad: solo se modificaron contenido público, markup server-rendered y CSS; no hay endpoints, secretos, dependencias, permisos, datos ni integraciones nuevas. `corepack pnpm audit --audit-level high` conserva únicamente las dos vulnerabilidades moderadas transitivas ya registradas, sin hallazgos high/critical.
- Operaciones: no se desplegó, migró, modificaron datos, leyeron secretos ni hicieron commits. Rollback: restaurar `page.tsx`, `globals.css`, `academy.ts` y sus contratos de prueba; no requiere migración ni backup.
