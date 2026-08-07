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
| T006 | Crear CI inicial con lint, tipos, unitarias, Rules y E2E smoke | T003,T005 | revisión | Workflow implementado y gates locales verdes; falta ejecución en GitHub |
| T007 | Documentar clasificación de datos, amenazas y matriz preliminar de acceso | - | pendiente | Documento revisado sin gaps críticos |
| T008 | Confirmar programas, horarios, ubicaciones, capacidad, precios y reglas de membership | - | bloqueada | Aprobación del operador/academia |
| T009 | Confirmar criterios y ponderaciones de evaluación/reconocimiento | - | bloqueada | Aprobación de head coach |
| T010 | Seleccionar proveedor de pagos disponible en Jersey | - | bloqueada | ADR y costos aprobados |
| T011 | Confirmar política de retención, residencia y borrado con asesoría aplicable a Jersey | - | bloqueada | Política aprobada |

## M1 - Identidad, autorización y auditoría

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T012 | Definir módulos de dominio, contratos base y errores tipados | T002,T007 | pendiente | Pruebas unitarias de contratos |
| T013 | Diseñar colecciones, índices, invariantes y plan de migraciones Firestore/RTDB | T007,T008 | pendiente | Modelo y rollback documentados |
| T014 | Implementar Auth email/password y Google con emulador | T004 | pendiente | Flujos de alta/login/logout probados |
| T015 | Implementar roles y custom claims con mínimo privilegio | T013,T014 | pendiente | Matriz de roles probada |
| T016 | Implementar Firestore/RTDB Rules y pruebas de aislamiento por rol/familia | T013,T015 | pendiente | Suite de Rules sin accesos indebidos |
| T017 | Implementar MFA obligatorio para owner/admin | T014,T015 | pendiente | E2E de enrolamiento y enforcement |
| T018 | Implementar consentimiento versionado y registro de aceptación | T013,T016 | pendiente | Historial y revocación probados |
| T019 | Implementar audit log append-only para cambios sensibles | T012,T013,T016 | pendiente | Intentos de alteración rechazados |

## M2 - Familias, estudiantes y personal

| ID | Tarea atómica | Depende de | Estado | Evidencia de salida |
|---|---|---|---|---|
| T020 | Construir design tokens, shell responsive y navegación accesible por rol | T002,T015 | pendiente | Visual QA + WCAG smoke |
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
- Estado: `revisión`, no `aprobada`, porque la evidencia de salida exige un pipeline verde en una branch de GitHub y aún no se ha autorizado commit/push.
