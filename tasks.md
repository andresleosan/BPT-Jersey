# tasks.md - BPT Jersey Academy Platform

Estados: `pendiente` -> `en-progreso` -> `revisiÃ³n` -> `aprobada` -> `desplegada`; `bloqueada` cuando requiere una decisiÃ³n o evidencia externa.

Cada tarea con impacto en cÃ³digo debe pasar el ciclo completo de autocrÃ­tica Nivel 3: seguridad, pruebas relevantes, evidencia y rendimiento cuando corresponda.

El alcance vinculante del piloto es el de `BRIEF.md` y `STACK.md` revisado el 2026-08-18. Los IDs
histÃ³ricos se conservan para no perder trazabilidad; las filas marcadas post-piloto no bloquean
`T056` y se reubicarÃ¡n al convertir las fases aprobadas en el plan atÃ³mico de implementaciÃ³n.

## M0 - Fundaciones y decisiones operativas

| ID   | Tarea atÃ³mica                                                                         | Depende de | Estado    | Evidencia de salida                                                                                                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T001 | Inicializar Git y el monorepo pnpm (`apps/web`, `apps/functions`, `packages/*`, `qa/`) | -          | aprobada  | `pnpm install --frozen-lockfile --offline` y listado de 7 workspaces pasan; audit sin vulnerabilidades                                                                                                                                                                                                                                      |
| T002 | Configurar TypeScript estricto, lint, formato y comandos raÃ­z                         | T001       | aprobada  | `pnpm lint`, `pnpm typecheck` y `pnpm format:check` pasan                                                                                                                                                                                                                                                                                   |
| T003 | Configurar Vitest, Testing Library y convenciones de pruebas                           | T002       | aprobada  | Vitest + RTL: 2 archivos/2 pruebas aprobados                                                                                                                                                                                                                                                                                                |
| T004 | Configurar Firebase CLI, proyectos/emuladores dev y archivos de entorno sin secretos   | T001       | aprobada  | Auth/Firestore/RTDB emulators + 3 Rules tests pasan                                                                                                                                                                                                                                                                                         |
| T005 | Configurar Playwright, proyectos por viewport y artefactos no versionados              | T002       | aprobada  | E2E smoke desktop/mÃ³vil 2/2 y estabilidad 10/10 pasan                                                                                                                                                                                                                                                                                      |
| T006 | Crear CI inicial con lint, tipos, unitarias, Rules y E2E smoke                         | T003,T005  | aprobada  | Pipeline CI verde en `main` (run 31142117581)                                                                                                                                                                                                                                                                                               |
| T007 | Documentar clasificaciÃ³n de datos, amenazas y matriz preliminar de acceso             | -          | aprobada  | Documento revisado sin gaps crÃ­ticos                                                                                                                                                                                                                                                                                                       |
| T008 | Confirmar horarios concretos, capacidades y reglas comerciales todavia configurables   | -          | aprobada  | Piloto sintetico aprobado por el operador: catalogo real de 10 planes y reglas Town/West desde los DOCX; defaults T008-P01..P07 y horario ficticio solo para Emulator/staging aislado; no es aprobacion operativa ni productiva.                                                                                                            |
| T009 | Confirmar criterios y ponderaciones de evaluacion/reconocimiento                       | -          | aprobada  | Piloto sintetico aprobado por el operador: baseline real de stripes por edad desde BPTJ FUNCTIONS APP.docx y defaults T009-P01..P06 solo para Emulator/staging aislado; promociones siguen bajo revision humana y no es politica real del head coach.                                                                                       |
| T010 | Seleccionar proveedor de pagos disponible en Jersey para post-piloto                   | -          | bloqueada | Investigacion oficial 2026-08-27: shortlist real PayPal, Adyen y Revolut Business; Stripe descartado para entidad incorporada en Jersey. PayPal es primera opcion a validar. T010 sigue bloqueada hasta seleccion explicita, elegibilidad/onboarding, terminos, cotizacion, limites y alertas; no hay cuenta, credenciales, cobro ni gasto. |
| T011 | Confirmar politica de retencion, residencia y borrado con asesoria aplicable a Jersey  | -          | bloqueada | Decision owner y reviewer confirmados como no designados el 2026-08-28; brief de seleccion/consulta preparado sin envio ni gasto. Faltan controller/registro JOIC y las 10 decisiones aprobadas.                                                                                                                                            |

## M1 - Identidad, autorizaciÃ³n y auditorÃ­a

| ID   | Tarea atÃ³mica                                                                   | Depende de     | Estado    | Evidencia de salida                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------- | -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T012 | Definir mÃ³dulos de dominio, contratos base y errores tipados                    | T002,T007      | aprobada  | Pruebas unitarias de contratos                                                                                                                                                                                                                           |
| T013 | DiseÃ±ar colecciones, Ã­ndices, invariantes y plan de migraciones Firestore/RTDB | T007           | aprobada  | Modelo, rollback, fixture, Ã­ndices y gate final documentados; T008 conserva Ãºnicamente los valores operativos configurables del piloto                                                                                                                 |
| T014 | Implementar Auth email/password y Google con emulador                            | T004,T084      | aprobada  | Google usa el popup SDK conectado al Auth Emulator; email/Google y login sin MFA revalidados con unitarias, integraciÃ³n local y E2E responsive; aprobada 2026-08-23                                                                                     |
| T015 | Implementar roles y custom claims con mÃ­nimo privilegio                         | T013,T014      | aprobada  | Parser exacto para seis roles, compatibilidad administrativa y gates globales aprobados sin ampliar provisioning; aprobada 2026-08-23                                                                                                                    |
| T016 | Implementar Firestore/RTDB Rules y pruebas de aislamiento por rol/familia        | T013,T015      | aprobada  | Evaluador fail-closed, actor de seis roles, matriz Firebase exhaustiva y packaging verificados con gates globales; aprobada 2026-08-23                                                                                                                   |
| T017 | Implementar MFA obligatorio para owner/admin                                     | T014,T015      | cancelada | Sustituida por el rediseÃ±o administrativo aprobado el 2026-08-11, sin MFA                                                                                                                                                                               |
| T018 | Implementar consentimiento versionado y registro de aceptaciÃ³n                  | T016,T021-T024 | aprobada  | Aprobada explÃ­citamente por el operador el 2026-08-25 solo para el piloto sintÃ©tico: waiver versionado, firma tutor/adulto, revocaciÃ³n, PDF privado, auditorÃ­a y UI verificados; producciÃ³n bloqueada por T011 y por el texto/revisiÃ³n legal final |
| T019 | Implementar audit log append-only para cambios sensibles                         | T012,T013,T016 | aprobada  | Contrato discriminado, adapter create-only, tres writers migrados, replay Regyfit moderno/legacy, integraciÃ³n Firestore y gates documentados; aprobada 2026-08-23                                                                                       |

## M2 - Familias, estudiantes y personal

| ID    | Tarea atÃ³mica                                                                                                                              | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T020  | Construir design tokens, shell responsive y navegaciÃ³n accesible por rol                                                                   | T002,T015      | aprobada | Shell responsive, navegaciÃ³n por rol y QA teclado/mÃ³vil documentados; aprobada 2026-08-23                                                                                                                                    |
| T020A | Integrar identidad visual oficial: logo en home, login, shell admin y acceso requerido; favicon solo como favicon; aÃ±adir navegaciÃ³n Home | T002,T020      | aprobada | Assets verificados, metadata/favicon, textos de marca conservados, rutas Home, responsive y visual QA desktop/mÃ³vil; aprobada 2026-08-23                                                                                      |
| T021  | Implementar perfiles de adultos, menores y tutores                                                                                          | T016,T020      | aprobada | Domain 7/7, store 3/3, callables 4/4, web client/UI 12/12, suite completa 500/500, Rules 16/16, Firestore Emulator 8/8, lint/typecheck/build/formato, smoke E2E 5/5 y auditorÃ­a sin crÃ­ticos; aprobada 2026-08-23            |
| T022  | Implementar familias multi-child, contactos y relaciones autorizadas                                                                        | T021           | aprobada | Tasks 1-6 verificadas; suite `533/533`, Rules `23/23`, lint/typecheck/build/formato/diff pasan; E2E `2/2`; audit sin high/critical; aprobada 2026-08-23                                                                        |
| T023  | Implementar datos mÃ©dicos/soporte con acceso restringido                                                                                   | T021           | aprobada | Alcance tÃ©cnico del piloto sintÃ©tico aprobado por el operador 2026-08-25; producciÃ³n y datos reales continÃºan bloqueados por T011 y `BPT_SYNTHETIC_PILOT`                                                                  |
| T024  | Implementar documentos y waivers privados en R2 con URLs firmadas                                                                           | T016,T021,T023 | aprobada | Alcance tÃ©cnico con R2 sintÃ©tico aprobado por el operador 2026-08-25; R2 productivo, datos reales y cierre productivo continÃºan bloqueados por T011 y por el texto/revisiÃ³n legal final                                    |
| T025  | Implementar cuentas, roles, disponibilidad y asignaciones de coaches/staff                                                                  | T015,T020      | aprobada | Tasks 1-4 verificadas; suite unitaria 90/90 y 701/701; Rules 6/6 y 50/50; Emulator integration 9/9; UI /admin/staff y E2E sintÃ©tico 10/10; Auth Emulator E2E 2/2 con login real; audit sin high/critical; aprobada 2026-08-23 |

## M2A - Levels IBJJF MVP

| ID   | Tarea atÃ³mica                                            | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T083 | Recrear catÃ¡logo completo y secciÃ³n MVP de Levels IBJJF | T025,T072,T084 | aprobada | Tasks 1-5 completadas; 171 definiciones, 27 belts, 144 stripes, 11 habilidades, 165 requisitos; unitarias 101/101 (739 pass); Rules 7/7 (56 pass); Emulator 1/1; E2E 6/6; audit sin high/critical; aprobada 2026-08-23 |

## M3 - Agenda, reservas y asistencia

| ID   | Tarea atÃ³mica                                                                          | Depende de | Estado   | Evidencia de salida                                                                                                                                                                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T026 | Implementar grupos, currÃ­culo, clases recurrentes, seminarios y sesiones Ãºnicas       | T013,T025  | aprobada | Contratos de dominio 27/27, generador determinÃ­stico de sesiones con soporte DST Europe/Jersey, store 6/6, callables protegidos 6/6, UI admin groups/activities 4/4, client 7/7, suite completa 788/788 en 105 archivos; los valores operativos concretos permanecen bajo T008; aprobada 2026-08-23                                                                         |
| T027 | Implementar elegibilidad, capacidad, roster, booking, mÃ­nimo y cancelaciÃ³n a una hora | T021,T026  | aprobada | Contratos y evaluador multicriterio 44/44, store transaccional de capacidad atÃ³mica/idempotencia 9/9, callables RBAC 8/8, client 8/8, suite completa 811/811 en 105 archivos; corte de 1h y quÃ³rum mÃ­nimo validados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                               |
| T028 | Implementar QR/PIN/name search/manual check-in                                          | T022,T027  | aprobada | Contratos de check-in y 4 mÃ©todos 54/54, store de asistencia e idempotencia 10/10, callables protegidos RBAC 9/9, client 9/9, suite completa 824/824 en 105 archivos; puntualidad (attended/late) y reglas de seguridad verificadas; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                 |
| T029 | Implementar puntualidad, asistencia, no-show y correcciones auditadas                   | T019,T028  | aprobada | Contratos y parsers de correcciÃ³n 58/58, store con correctionOf inmutable y reconciliaciÃ³n de no-shows 12/12, callables RBAC 10/10, client 9/9, deploy runtime 2/2, suite completa 831/831 en 105 archivos; eventos de auditorÃ­a registrados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                      |
| T030 | Implementar child check-out y autorizaciÃ³n de recogida                                 | T022,T029  | aprobada | Contratos y parsers de checkout 64/64, 3 mÃ©todos (authorizedAdult, independentRelease, staffOverride con notas), store con validaciÃ³n de asistencia previa e idempotencia 13/13, callables RBAC 11/11, client 10/10, deploy runtime 2/2, suite completa 840/840 en 105 archivos; eventos de auditorÃ­a registrados; typecheck/build/lint/format pasan; aprobada 2026-08-23 |
| T031 | Implementar vista operativa en vivo sin duplicar la fuente canÃ³nica                    | T029,T030  | aprobada | ProyecciÃ³n pura agregada 65/65, store unificado sin estado duplicado 14/14, callable RBAC 12/12, client 11/11, deploy runtime 2/2, suite completa 844/844 en 105 archivos; consistencia y quÃ³rum en vivo verificados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                               |

## M4 - MembresÃ­as y pagos

| ID   | Tarea atÃ³mica                                                                         | Depende de | Estado    | Evidencia de salida                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------- | ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T032 | Implementar catÃ¡logo y reglas base de planes/membresÃ­as                              | T013       | aprobada  | Tasks 1-6 verificadas; suite `572/572`, Rules `30/30`, lint/typecheck/build/formato/diff pasan; audit sin high/critical; aprobada 2026-08-23                                                                                                                                                                                                                                                                                                         |
| T033 | Implementar lifecycle de membresÃ­a: trial, active, paused, overdue, cancelled         | T032       | aprobada  | Lifecycle completo, mÃºltiples suites verdes, gates sin high/critical; aprobada 2026-08-23                                                                                                                                                                                                                                                                                                                                                           |
| T034 | Implementar adaptador provider-independent de pagos post-piloto                        | T010,T012  | aprobada  | Contrato provider-independent y adapter sintético implementados; payload sin tarjeta/PII, proveedor `unconfigured` fail-closed, checkout hosted normalizado, idempotencia por tenant/idempotencyKey y pruebas focalizadas 6/6; `verify:mvp` 159/159 archivos, 1082/1082 tests, Rules 64/64, carga 240/240 (p95 82 ms), E2E 5 passed/1 skipped; T010 sigue bloqueada y no hay proveedor, credenciales, cobro, checkout real, migracion ni produccion. |
| T035 | Implementar hosted checkout y suscripciones post-piloto sin datos crudos de tarjeta    | T034       | pendiente | Flujo sandbox aprobado; fuera del piloto manual                                                                                                                                                                                                                                                                                                                                                                                                      |
| T036 | Implementar webhooks post-piloto firmados, idempotentes y tolerantes a reintentos      | T019,T035  | pendiente | RepeticiÃ³n/desorden no duplica cargos; fuera del piloto manual                                                                                                                                                                                                                                                                                                                                                                                      |
| T037 | Implementar pagos manuales, facturas, recibos, balances, deuda PAYG y refunds manuales | T019,T033  | aprobada  | Suite completa `629/629`, Rules `44/44`, domain/store/callables/audit verdes; audit sin high/critical; aprobada 2026-08-23                                                                                                                                                                                                                                                                                                                           |
| T038 | Vincular estado manual de pago/membresÃ­a y restricciones por deuda                    | T037       | aprobada  | Suite `650/650`, Rules `35/35`, policy/service/Emulator verdes; integraciÃ³n PAYG `1750 -> 0` verificada; audit sin high/critical; aprobada 2026-08-23                                                                                                                                                                                                                                                                                               |

## M5 - Progreso y reconocimiento

| ID   | Tarea atÃ³mica                                                                  | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------- | -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T039 | Implementar evaluaciones 1-5, notas basadas en evidencia y visibilidad familiar | T021,T025,T083 | aprobada | Contratos y parsers de evaluaciÃ³n 14/14, store con agregaciÃ³n y auditorÃ­a 7/7, callables RBAC con visibilidad familiar 10/10, client 5/5, deploy runtime 2/2, suite completa 858/858 en 105 archivos; T009 conserva la configuraciÃ³n de criterios/pesos del head coach; aprobada 2026-08-23                                                                         |
| T040 | Implementar skill checklist y resumen completo de progreso                      | T039           | aprobada | Contratos y pure builder buildStudentProgressSummary 16/16, store aggregations 8/8, callables RBAC con visibilidad familiar 12/12, client 6/6, deploy runtime 2/2, suite completa 864/864 en 105 archivos; checklist tÃ©cnico, clases, horas y elegibilidad no automÃ¡tica probados; typecheck/build/lint/format pasan; aprobada 2026-08-23                             |
| T041 | Implementar rachas y generaciÃ³n explicable de candidatos de reconocimiento     | T029,T039      | aprobada | Contratos y pure functions calculateAttendanceStreak/generateRecognitionCandidates 21/21, store methods 9/9, callables RBAC 16/16, client 8/8, deploy runtime 2/2, suite completa 876/876 en 105 archivos; rachas, pausas mÃ©dicas justificadas y cola explicable de candidatos para el Head Coach probados; typecheck/build/lint/format pasan; aprobada 2026-08-23     |
| T042 | Implementar revisiÃ³n/aprobaciÃ³n exclusiva del head coach                      | T015,T041      | aprobada | Contratos y parsers de graduaciÃ³n/promociÃ³n 25/25, store con actualizaciÃ³n de perfil y auditorÃ­a 10/10, callables RBAC headCoach/owner 18/18, client 9/9, deploy runtime 2/2, suite completa 884/884 en 105 archivos; regla de oro de aprobaciÃ³n humana formal, registro inmutable y trazabilidad probados; typecheck/build/lint/format pasan; aprobada 2026-08-23 |

## M6 - Avisos y safeguarding; CRM post-piloto

| ID   | Tarea atÃ³mica                                                        | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------- | -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T043 | Implementar pipeline CRM, owner, next action y tareas post-piloto     | T021,T025      | aprobada | Contratos de dominio, store in-memory/Firestore y callables CRM implementados; headCoach queda limitado a sus leads; UI usa preview sintetico por defecto y callable opt-in; pruebas focalizadas 10/10, typecheck Functions/Web y regresion completa 159 archivos/1082 pruebas pasan; verify:mvp y validacion sin PII/secretos pasan; Rules cliente siguen default-deny y no hay datos reales, despliegue ni aprobacion productiva. Revalidacion tecnica 2026-08-27: pruebas focalizadas CRM/UI 5/5; typecheck de Functions/Web, ESLint CRM y Prettier del alcance pasan. Aprobacion explicita del operador recibida el 2026-08-27 para el alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales. |
| T044 | Implementar timeline CRM automatico post-piloto                       | T019,T043      | aprobada | Persistencia de timeline, idempotencia por eventKey, parser de eventos y callable de lectura implementados; duplicado conflictivo falla cerrado; pruebas focalizadas 10/10, typecheck Functions/Web y regresion completa 159 archivos/1082 pruebas pasan; verify:mvp pasa; UI y datos reales no activados, sin migracion ni despliegue productivo. Revalidacion tecnica 2026-08-27: pruebas focalizadas CRM/UI 5/5; typecheck de Functions/Web, ESLint CRM y Prettier del alcance pasan. Aprobacion explicita del operador recibida el 2026-08-27 para el alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales.                                                                                  |
| T045 | Implementar announcements y mensajes in-app de academia/clase         | T025,T026      | aprobada | Contratos y parsers de anuncios 7/7, store en Firestore e in-memory con soporte readBy y auditorÃ­a 4/4, callables RBAC staff/client 3/3, client 4/4, deploy runtime 2/2, suite completa 902/902 en 109 archivos; canales academy/class/group, estados draft/published/archived y lectura in-app probados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                                                                                                                                                                                                                                                                                                             |
| T046 | Implementar email/SMS e historial externo de entrega post-piloto      | T045           | aprobada | Frontera provider-independent, historial tenant-scoped, fallback seguro y contract tests registrados abajo. Revalidacion tecnica 2026-08-27: contract/service 7/7; typecheck de dominio/Functions, ESLint y Prettier del alcance pasan; proveedor unconfigured, sin red, credenciales, gasto ni envio real. Aprobacion explicita del operador recibida el 2026-08-27 para el alcance tecnico/sintetico; no autoriza produccion, credenciales, red ni servicios externos reales.                                                                                                                                                                                                                                                               |
| T047 | Aplicar safeguarding a avisos de menores visibles al tutor            | T022,T045      | aprobada | Resolver canÃ³nico por `students`/`relationships` con tenant y estados activos; avisos server-only entregados al tutor guardian; portal `/account` sin `minorStudentId`; pruebas y gates registrados abajo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| T048 | Implementar recordatorios in-app de pagos y seguimiento de asistencia | T029,T038,T045 | aprobada | ProyecciÃ³n on-demand de pagos/asistencia con audiencia tenant-scoped; pruebas y gates registrados abajo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## M7 - Dashboard, reportes y cierre del MVP

| ID   | Tarea atÃ³mica                                                             | Depende de                                                            | Estado    | Evidencia de salida                                                                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T049 | Implementar dashboard diario de clases, asistencia y child check-out       | T031                                                                  | aprobada  | Dashboard diario conectado a sesiones, asistencia y check-out canÃ³nicos; callable staff-only, lÃ­mite de 24 h y vista agregada sin roster; gates registrados abajo                                                                                                                                         |
| T050 | Implementar dashboard financiero, balances y renovaciones                  | T038                                                                  | aprobada  | ProyecciÃ³n read-only conectada a membresÃ­as, facturas y pagos canÃ³nicos; contrato sin PII/IDs sensibles y gates completos; aprobada 2026-08-24                                                                                                                                                           |
| T051 | Implementar reportes de students, attendance, memberships y revenue manual | T029,T038                                                             | aprobada  | Reporte agregado owner/admin conectado a fuentes canÃ³nicas; tenant-scoped, rango mÃ¡ximo de 31 dÃ­as y sin PII/IDs; gates registrados abajo                                                                                                                                                                |
| T052 | Implementar reportes de progreso, reconocimiento y assessment coverage     | T042                                                                  | aprobada  | Aggregate staff-only tenant-scoped, coverage/recognition/readiness y privacidad sin IDs                                                                                                                                                                                                                     |
| T053 | Implementar exportaciÃ³n de datos autorizada y auditable                   | T019,T051,T052                                                        | aprobada  | CSV agregado T051/T052 owner/admin, piloto sintÃ©tico fail-closed, journal y auditorÃ­a atÃ³micos, rate limit persistente y sin PII/IDs ni archivo server-side; gates registrados abajo                                                                                                                     |
| T054 | Configurar backups, restauraciÃ³n y runbook de rollback                    | T013,T024                                                             | aprobada  | Aprobada explÃ­citamente por el operador el 2026-08-25 solo para el piloto sintÃ©tico: contrato fail-closed, checksum/conteos, rehearsal Emulator applyâ†’rollback, runbook, unitarias 6/6, integraciÃ³n 1/1 y E2E 2/2; no autoriza backup/restore productivo                                               |
| T055 | Ejecutar carga, contratos, seguridad, accesibilidad y E2E completo por rol | T008,T009,T011,T018,T019,T021-T033,T037-T042,T045,T047-T054,T083,T086 | aprobada  | QA aprobado unicamente para el piloto sintetico: verify:mvp, unitarias 159/1082, Rules 64/64, carga sintetica 240 solicitudes/concurrencia 24 sin fallos (p95 82 ms) y E2E smoke 5 pasan/1 omitida. T011, carga live/staging y produccion siguen bloqueados; no autoriza datos reales ni despliegue.        |
| T056 | Ejecutar piloto con datos controlados y corregir hallazgos                 | T055                                                                  | aprobada  | Piloto E2E sintetico ejecutado: 71 pasaron, 14 omitidos por live/staging u opt-in y 0 fallos; verify:mvp y carga sintetica pasan; acta aprobada explicitamente por el operador el 2026-08-27 unicamente para el piloto sintetico; no autoriza staging real, produccion, datos reales, pagos ni migraciones. |
| T057 | Preparar checklist post-piloto de produccion, monitoreo, costos y rollback | T056                                                                  | revision  | PR #2 permanece como draft; la CI del PR y el preview de Pages finalizaron exitosamente sin produccion. El merge a `main` sigue bloqueado porque el autodeploy de Pages no coordina Functions/Rules; T011, staging, costos/alertas, CD protegido y T058 siguen abiertos.                                    |
| T058 | Desplegar a producciÃ³n con confirmaciÃ³n explÃ­cita del operador          | T057                                                                  | pendiente | Produccion no esta desplegada: la release parcial de Pages fue revertida; T058 depende del cierre de T057 y de autorizacion explicita del operador.                                                                                                                                                         |
| T059 | Cerrar proyecto: capability-gap-analysis y registrar `LECCIONES.md`        | T058                                                                  | pendiente | LecciÃ³n registrada despuÃ©s de producciÃ³n; fuera del piloto                                                                                                                                                                                                                                               |

## v2 - post-lanzamiento

- T060 - Booking avanzado, waitlists, crÃ©ditos y reservas recurrentes; el corte bÃ¡sico de una hora
  ya pertenece a `T027`.
- T061 - Retries, grace periods, proration, promos y workflows de freeze/cancel. Depende de
  T010/T034/T035; antes de habilitar un proveedor debe rechazar replays con la misma clave de
  idempotencia y payload divergente.
- T062 - Retention alerts y CRM automation.
- T063 - Parent/adult self-service ampliado.
- T064 - Notificaciones externas y automatizadas completas; los avisos in-app bÃ¡sicos pertenecen a
  `T045` y `T048`.
- T065 - Offline attendance con sincronizaciÃ³n y resoluciÃ³n de conflictos.
- T066 - Biblioteca tÃ©cnica adicional posterior a las 11 habilidades del catÃ¡logo MVP, lesson planning
  avanzado y automatizaciones de promociÃ³n; el catÃ¡logo completo MVP y la aprobaciÃ³n humana pertenecen
  al piloto y no se pueden diferir.

## v3 - crecimiento y escala

- T067 - Goals, achievements y resÃºmenes familiares ampliados; las rachas bÃ¡sicas pertenecen a
  `T041`.
- T068 - Apps nativas iOS/Android.
- T069 - Comunidad moderada.
- T070 - Referrals, privadas, competencias y retail; los seminarios operativos pertenecen a `T026`.
- T071 - Analytics, IA asistida, multi-academia, white label y SaaS.

## Plan provisional de avance v2/v3

El contador de Lista incluye T060-T071 como roadmap futuro. El discovery se prioriza en T060, T063,
T062 y T067; el detalle, RICE preliminar, dependencias y gates esta en
docs/roadmap/v2-v3-advance-plan.md. T060 vuelve a revision tras cerrar el corte de oferta FIFO y
booking transaccional confirmado el 2026-08-30; T062 vuelve a `revision` tras cerrar el productor
interno auditado autorizado el 2026-08-31. T064, T065, T066 y T067 quedan en revision por sus
slices tecnicos; T061 y T068-T071 permanecen pendientes hasta contar con slice, contrato, criterios
de aceptacion y evidencia de pruebas. T063 vuelve a `revision` tras cerrar la divergencia fail-closed
del checkout adulto detectada durante la reanudacion; no queda WIP activo.

### Reanudacion T063 - checkout adulto fail-closed - 2026-08-30

- Hallazgo: la matriz vigente deja el checkout de `adultStudent` pendiente de decision y lo reporta
  como denegado, pero el guard compartido permite actualmente que un adulto registre checkout sobre
  su propio `studentId`.
- Alcance correctivo: denegar `recordCheckout` a `adultStudent` antes de invocar el store, conservar
  booking/check-in/consultas propias y checkout de guardian vinculado o staff sin cambios, agregar
  regresion focal y reconciliar documentacion/Lista.
- Fuera de alcance: habilitar checkout adulto, tutor secundario, nuevas solicitudes de correccion,
  esquema, Rules, UI, datos reales, migracion, despliegue o produccion.
- Reversion: retirar el guard especifico y su regresion; no hay datos ni esquema que revertir.

### Evidencia T060 - contratos de waitlist y creditos - 2026-08-27

- Se implementaron contratos de dominio en packages/domain/src/schedule/advanced-booking-contracts.ts y pruebas focalizadas en packages/domain/src/schedule/advanced-booking-contracts.test.ts.
- La frontera cubre parser estricto de solicitud y registro de waitlist, estados de oferta/cancelacion, contrato de creditos, consumo parcial, agotamiento y reverso acotado sin mutacion.
- Verificacion: pruebas focalizadas 9/9, corepack pnpm --filter @bpt-jersey/domain typecheck, Prettier focalizado y git diff --check pasan.
- Alcance: no hay Firestore, migracion, callable, UI, cobro, credenciales ni datos reales. T060 pasa a revision; quedan pendientes la politica de promocion automatica, asignacion de posiciones y reglas operativas de creditos.

### Checkpoint T060 - waitlist persistida - 2026-08-28

- Aprobacion explicita del operador para seguir con el corte recomendado y publicar commit/push; T060 pasa a en-progreso como unico WIP.
- Usuario prioritario: guardian/adulto que encuentra una sesion completa; sin este corte, la academia mantiene seguimiento manual y pierde intencion de reserva. Metrica futura: solicitudes recuperables en waitlist frente a intentos rechazados por capacidad.
- Alcance: `waitlistEntries` tenant-scoped, join/list/cancel idempotentes, posicion asignada atomicamente, sesion scheduled y llena, membership exacta del estudiante con estado active/trial y vigencia temporal, student-scope/RBAC, Rules deny-direct, Emulator y E2E de callable.
- Fuera de alcance: promocion u oferta automatica, aceptar cupo, reordenar posiciones, UI final, creditos, recurrencia, cobros, mensajes, proveedor, datos reales, credenciales, gasto, migracion o despliegue.
- Reversion: retirar callables y codigo aditivo de waitlist; los fixtures sinteticos del Emulator son desechables y no se ejecuta limpieza productiva.

### Evidencia T060 - waitlist persistida - 2026-08-28

- Store Firestore tenant-scoped con join/cancel transaccionales e idempotentes, posicion atomica, consultas acotadas, identidad determinista y validacion fail-closed de sesion llena, membership vigente y booking confirmado duplicado.
- Callables `joinWaitlist`, `cancelWaitlistEntry`, `listStudentWaitlist` y `listSessionWaitlist` derivan tenant/actor del token, aplican student-scope/RBAC y devuelven proyecciones minimizadas. Rules niega todo acceso directo a `waitlistEntries`.
- Verificacion focal: dominio/store/callables 25/25; Firestore Emulator 2/2; Rules focales 7/7; E2E real Auth + Functions + Firestore Emulator 5/5 repeticiones sin retries; artefacto de Functions cargado correctamente.
- Gate global: `corepack pnpm verify:mvp` pasa con formato, lint, typecheck y build; 1155/1155 unitarias, 78/78 Rules, carga sintetica 240/240 sin fallos (p95 32 ms) y smoke E2E 5 aprobadas/1 omitida esperada. `corepack pnpm audit --audit-level high`: 2 moderadas, 0 high/critical; `git diff --check` pasa.
- Autocritica: sin hallazgos high/critical ni secretos. App Check, rate limit persistente, auditoria de mutaciones, promocion/ofertas, aceptacion, expiracion, reordenamiento, creditos, recurrencia, UI final, pagos y mensajes quedan fuera; produccion sigue bloqueada por T011/T057. Sin datos reales, credenciales, gasto, migracion ni despliegue. T060 vuelve a revision y no queda WIP activo.

### Checkpoint T060 - autoservicio de waitlist - 2026-08-28

- Aprobacion explicita del operador para seguir con el corte recomendado; T060 pasa a `en-progreso` como unico WIP.
- Usuario prioritario: adulto o tutor autenticado que necesita conservar su intencion cuando una sesion esta llena. La UI usa nombres de participantes y clases, nunca pide IDs internos.
- Alcance: adaptadores web validados para `joinWaitlist`, `cancelWaitlistEntry` y `listStudentWaitlist`; ruta `/account/waitlist` con seleccion de participante basada en memberships propias, sesiones futuras, lista por posicion, cancelacion con confirmacion y estados loading/error/empty/success responsive y accesibles.
- Criterios de aceptacion: student-scope/RBAC permanece en backend; payloads y respuestas fallan cerrado; una mutacion refresca la lista sin borrar el feedback transaccional; pruebas unitarias y E2E Auth/Functions/Firestore Emulator sin retries.
- Fuera de alcance: staff UI, promocion/oferta o aceptacion automatica, reordenamiento, creditos, recurrencia, booking automatico, cobros, mensajes, App Check, rate limit persistente, auditoria nueva, datos reales, migracion, despliegue o produccion.
- Reversion: retirar la ruta/adaptadores y el enlace de cuenta; no cambia el esquema ni requiere limpieza de datos.

### Evidencia T060 - autoservicio minimo de waitlist - 2026-08-28

- Implementacion: adaptadores exactos y fail-closed para memberships y waitlist; ruta autenticada `/account/waitlist`, enlace desde cuenta, participantes adulto/tutor por nombre, sesiones futuras, posicion/estado, confirmacion de cancelacion, estados loading/error/empty/success y bloqueo de reapertura que el backend no permite.
- Contrato y seguridad: IDs/timestamps/respuestas desconocidas se rechazan, incluso fechas calendario imposibles; mensajes no filtran backend; el navegador usa Auth + callables y la E2E confirma cero acceso directo a Firestore/RTDB y cero IDs internos visibles. Student-scope/RBAC permanece en Functions y Rules conserva deny-direct.
- QA focal: 23/23 pruebas web focales, typecheck web/QA, lint oficial y build de 30 rutas pasan. Playwright real Auth + Functions + Firestore Emulator pasa 5/5 ciclos con reseed, un worker y `retries=0`; una pasada final adicional pasa despues de corregir el render en cascada hallado por lint.
- QA global: `corepack pnpm verify:mvp` pasa formato, lint, typecheck de 6 proyectos, build, 172 archivos/1166 unitarias, 10 archivos/78 Rules, carga sintetica 240/240 sin fallos (p95 37 ms) y smoke E2E 5 aprobadas/1 omitida esperada.
- Autocritica: se corrigieron fecha imposible aceptada por `Date.parse`, nombres de familia en cuentas mixtas, reapertura engañosa de entradas historicas y `setState` sincronico en efecto. `pnpm audit` reporta 2 moderadas transitivas solo en `firebase-tools`, 0 high/critical. No se agregaron endpoints ni se amplio rate limiting/App Check.
- Higiene operativa: un arranque local heredó `DEBUG` y volcó en el log de herramienta una credencial efimera de la extension Playwright; se retiro `DEBUG`, no se repitio y los escaneos de workspace e historial confirmaron 0 persistencia. Se recomienda reconectar/rotar esa extension antes de cualquier trabajo productivo.
- Estado: T060 vuelve a `revision`; no queda WIP activo. Staff UI, promociones/ofertas/aceptacion, expiracion/reordenamiento, creditos, recurrencia, booking automatico, pagos, mensajes, datos reales, migracion, despliegue y produccion siguen fuera del corte.

### Checkpoint T060 - oferta FIFO y booking transaccional - 2026-08-30

- Aprobacion explicita del operador para actualizar Graphify y seguir con este corte; T060 pasa a
  `en-progreso` como unico WIP. La oferta es manual por `owner`/`administrator`; `headCoach` y `coach`
  conservan lectura, pero no pueden mutar la cola.
- Orden y capacidad: el backend elige la primera entrada `waiting` por `position` y `requestedAt`; el
  cliente no envia ni elige estudiante. Solo puede existir una oferta activa por sesion. La oferta
  reserva un cupo y su replay es idempotente sin extender el vencimiento.
- Tiempo: TTL de 30 minutos, limitado siempre a una hora antes de `session.startAt`. La expiracion se
  materializa bajo demanda, sin scheduler; las posiciones son historicas y no se renumeran.
- Aceptacion: adulto/tutor puede aceptar su propia oferta mediante student-scope canonico. Oferta y
  aceptacion revalidan tenant, sesion, membresia, capacidad, plan/cuota y politica financiera T038.
  La aceptacion crea o restaura atomicamente el booking determinista confirmado, marca la waitlist
  `accepted` y registra auditoria; un replay devuelve el mismo resultado.
- Declinacion: adulto/tutor puede declinar su oferta; queda terminal `cancelled` y no se reencola de
  forma automatica. El detalle de oferta/vencimiento se muestra en `/account/waitlist`; staff recibe
  una superficie minima en `/admin/waitlists` para consultar la sesion y ofrecer el primer lugar.
- Prerrequisito de integridad: corregir el booking Firestore actual para que capacidad y datos
  dependientes se lean y escriban dentro de una transaccion antes de habilitar aceptacion.
- Criterios de aceptacion: contratos estrictos, RBAC/student-scope fail-closed, una sola oferta/cupo,
  carreras concurrentes sin sobrecupo, replays idempotentes, auditoria, pruebas unitarias, Emulator,
  Rules y E2E real Auth + Functions + Firestore con `retries=0` y burn-in.
- Fuera de alcance: promocion automatica, scheduler, notificaciones o proveedor, reordenamiento,
  creditos operativos, recurrencia, pagos/cobros nuevos, App Check/rate limit nuevos, datos reales,
  credenciales, gasto, migracion, despliegue o produccion.
- Reversion: retirar callables/UI y restaurar el flujo previo; el esquema es aditivo y los fixtures del
  Emulator son desechables. No se ejecuta limpieza ni rollback de datos productivos.

### Evidencia T060 - oferta FIFO y booking transaccional - 2026-08-30

- Implementacion: owner/administrator emiten manualmente la primera oferta FIFO sin seleccionar
  estudiante; headCoach/coach solo leen. Una oferta activa reserva capacidad, vence bajo demanda,
  y adulto/tutor autorizado acepta o declina desde /account/waitlist. La aceptacion confirma el
  booking, actualiza la waitlist y audita dentro de una sola transaccion.
- Integridad y safeguarding: se corrigieron colisiones y duales fisicos canonical/legacy, incluso con
  estados distintos; FIFO compara el instante absoluto con precision nanosegundo; cancelacion y
  aceptacion comparten sessionCapacityStates; invoice/payment/membership se aislan por
  academy/family/invoice; el tipo kids/teens/adult se deriva del DOB a la fecha local de la sesion; y
  backup valida IDs Firestore y lastPosition >= max(position) antes de crear, verificar o ensayar.
- QA focal final: typecheck de 6 proyectos y 75/75 unitarias focales; Firestore Emulator 17/17 para
  booking/ofertas y 3/3 para waitlist base/restore; Rules 10 archivos/78 pruebas; artefacto local de
  Functions construido; E2E real Auth + Functions + Firestore pasa 6/6 (desktop y mobile), un worker
  y retries=0. La primera corrida de integracion roja expuso dos fixtures incorrectos
  (cronologia ISO y lock pesimista), ambos corregidos antes de la evidencia verde.
- Gate global: corepack pnpm verify:mvp pasa formato, lint, typecheck, build estatico de 31 rutas,
  174 archivos/1216 unitarias, 10 archivos/78 Rules, carga sintetica 240/240 sin fallos (p95 28 ms) y
  smoke E2E 5 aprobadas/1 omitida esperada. corepack pnpm audit --audit-level high reporta 2
  moderadas y 0 high/critical; git diff --check queda como gate final de higiene.
- Autocritica independiente: 0 hallazgos critical/high abiertos despues de corregir RBAC, aislamiento
  tenant/finance, colisiones legacy, duales divergentes, FIFO temporal, carrera cancel/accept,
  elegibilidad por edad e invariantes de backup. No se agregaron secretos, proveedor ni gasto.
- Herramientas: Graphify CLI/skills quedaron en 0.9.53; el indice existente sigue obsoleto y no se
  reconstruyo porque el corpus supera 500 archivos sin una subcarpeta confirmada. AutoSkills 0.3.6
  detecto 15 skills, 11 ya instaladas y 4 redundantes para T060; no se instalo ninguna.
- Estado: T060 vuelve a revision; no queda WIP activo. Promocion automatica, scheduler,
  notificaciones, creditos operativos, recurrencia, pagos/cobros nuevos, datos reales, migracion,
  despliegue y produccion siguen fuera de alcance.

### Evidencia T063 - aislamiento de autoservicio guardian/adulto - 2026-08-27

- Se corrigieron los callables de agenda para que un `guardian` no pueda operar con un `studentId` arbitrario: booking, cancelacion, consultas de booking, asistencia, historial y checkout exigen relacion activa, familia activa, contacto principal coincidente y menor activo en el mismo tenant.
- Los adultos conservan scope propio; el check-in delegado por guardian queda denegado. Staff mantiene sus operaciones existentes.
- Verificacion: `corepack pnpm exec vitest run --project node apps/functions/src/schedule/schedule-callables.test.ts packages/domain/src/authorization/access-policy.test.ts` -> 23/23; typecheck Functions, ESLint focalizado, Prettier y `git diff --check` pasan.
- Alcance: sin Firestore writes, migraciones, Rules nuevas, UI, E2E, credenciales, proveedores, cobros ni datos reales. T063 pasa a revision; quedan pendientes Rules/Emulator, E2E responsive y checkpoint sobre tutor secundario y checkout adulto.

### Evidencia T063 - Rules/Emulator y E2E restrictivo - 2026-08-28

- El resolver Firestore valida tambien la vigencia `validFrom <= now < validTo`; reloj invalido, relacion futura/expirada/inactiva, tutor no relacionado y tutor secundario fallan cerrado. La regla actual de contacto principal no se amplio.
- La matriz de Rules incluye `checkouts` y conserva denegadas todas las operaciones directas de cliente. El seed de Auth Emulator acepta solo `owner`, `guardian` o `adultStudent` y exige credenciales sinteticas `@example.test`.
- E2E usa login real de Auth Emulator con rol guardian y callables controlados: solo muestra el menor vinculado en la proyeccion redacted, no hace acceso directo a Firestore/RTDB, deniega el admin shell y no presenta overflow en desktop/movil.
- Verificacion: unitarias focalizadas 23/23; Firestore Emulator 2/2; Rules completa 64/64; build web; E2E responsive 2/2 y repeticion 10/10; typecheck Functions, ESLint, Prettier, `corepack pnpm audit --audit-level high` sin high/critical y `git diff --check` pasan.
- Gate global: `corepack pnpm verify:mvp` pasa con 1122/1122 unitarias, 64/64 Rules, carga sintetica de 240 solicitudes sin fallos (p95 28 ms) y smoke E2E 5 aprobadas/1 omitida esperada.
- Autocritica: sin hallazgos high/critical ni secretos; contrato y casos limite temporales cubiertos. No se requirio una prueba de carga especifica del resolver; el baseline global sintetico paso. T063 vuelve a revision; tutor secundario y checkout adulto siguen pendientes de checkpoint y permanecen denegados/fail-closed. Sin despliegue, migracion, datos reales, proveedor, cobro ni gasto.

### Cierre correctivo T063 - checkout adulto fail-closed - 2026-08-30

- Implementacion: `recordCheckout` deniega expresamente a `adultStudent` despues de autenticar y
  validar el payload, y antes de resolver scope o invocar el store. El error especifico de
  `staffOverride`, booking/cancelacion/check-in/consultas adultas, guardian vinculado y staff no
  cambian.
- TDD: la regresion roja demostro que el store se alcanzaba y devolvia el error de asistencia. La
  primera iteracion verde revelo una insercion en el handler de cancelacion y la segunda preservo el
  orden contractual de `staffOverride`; ambas se corrigieron antes del resultado final 18/18.
- Seguridad: autenticacion, parser estricto y RBAC fallan cerrado; no hay respuesta exitosa, write,
  dato nuevo, secreto, integracion, rate limit o superficie publica adicional. Escaneo acotado de
  secretos 0 coincidencias; audit 2 moderate y 0 high/critical.
- QA: Functions typecheck pasa; callable focal 18/18; Firestore Emulator del resolver 2/2;
  `verify:mvp` pasa formato, lint, typecheck, build de 31 rutas, 174 archivos/1217 unitarias,
  10 archivos/78 Rules, carga 240/240 sin fallos (p95 40 ms) y smoke E2E 5/5 con 1 omision esperada.
- Estado: T063 vuelve a `revision` y no queda WIP activo. Tutor secundario, habilitacion de checkout
  adulto y solicitudes de correccion de otros dominios requieren checkpoint humano; produccion,
  datos reales, migracion, despliegue y gasto permanecen fuera de alcance.

### Evidencia T062 - contrato de alertas de retencion - 2026-08-27

- Se implemento packages/domain/src/retention-contracts.ts con triggers `attendance_gap`, `repeated_no_show` y `membership_expiring`; la politica es explicita y la alerta conserva razon, evidencia minima y clave de deduplicacion determinista.
- Solo se consideran estudiantes activos con membresia activa; se ignoran eventos futuros y la salida no contiene contacto, nombre, membership ID, invoice ID ni mensaje libre.
- Verificacion: `corepack pnpm exec vitest run --project node packages/domain/src/retention-contracts.test.ts packages/domain/src/reminders/reminder-contracts.test.ts` -> 10/10; typecheck de dominio, ESLint, Prettier y `git diff --check` pasan.
- Alcance: sin Firestore writes, callables, UI, CRM externo, email/SMS, credenciales, cobros ni datos reales. T062 pasa a revision; quedan pendientes bandeja tenant-scoped, Rules/Emulator, E2E y permisos de staff.

### Checkpoint T062 - bandeja interna persistida - 2026-08-28

- Aprobacion explicita del operador para continuar con la recomendacion; T062 pasa a en-progreso como unico WIP.
- Alcance: persistencia tenant-scoped e idempotente en `retentionAlerts`, escritura solo desde backend confiable, callable read-only para `owner` y `administrator`, bandeja admin responsive, Rules, Firestore Emulator y E2E sintetico.
- Fuera de alcance: productor automatico, asignacion/cierre/snooze, acceso de otros roles, CRM externo, email/SMS, datos reales, credenciales, cobros, gasto, migracion o despliegue.
- Reversion: retirar callable/ruta/UI y la coleccion aditiva; no se toca produccion y los fixtures sinteticos del Emulator son desechables.

### Evidencia T062 - bandeja interna persistida - 2026-08-28

- Store Firestore tenant-scoped con transacciones idempotentes, identidad determinista, conflicto fail-closed ante replay alterado, validacion estricta y limite de 200; el contrato puro conserva las tres senales explicables.
- `listRetentionAlerts` acepta solo payload nulo, deriva tenant del actor, autoriza exclusivamente owner/administrator y devuelve una proyeccion minimizada. Rules niega todo acceso directo cliente a `retentionAlerts`.
- `/admin/retention` es read-only y responsive. El E2E sintetico y el E2E real con Auth + Functions + Firestore Emulator cubren desktop/movil, RBAC y ausencia de acceso directo.
- Se corrigio el empaquetado de Functions para limpiar solo `apps/functions/lib` y compilar con `--rootDir apps/functions`; el artefacto regenerado exporta `listRetentionAlerts` y las pruebas de runtime pasan 2/2.
- Verificacion focalizada: servicio/callable 15/15, cliente 8/8, store Emulator 1/1, Rules 71/71, E2E sintetico 2/2, E2E real 2/2, typecheck Functions/Web/QA, lint/build, audit sin high/critical y `git diff --check` aprobados.
- Autocritica: sin hallazgos high/critical ni secretos. La consulta y lotes quedan acotados; no hay productor automatico, auditoria persistida, App Check ni rate limit persistente por actor, por lo que produccion sigue bloqueada por T011/T057. Sin mensajes externos, CRM, datos reales, credenciales, gasto, migracion ni despliegue.
- Gate global: `corepack pnpm verify:mvp` pasa con 1139/1139 unitarias, 71/71 Rules, carga sintetica 240/240 sin fallos (p95 32 ms) y smoke E2E 5 aprobadas/1 omitida esperada.
- Estado: T062 vuelve a revision; no queda WIP activo y no se solicita aprobacion funcional ni productiva.

### Evidencia T064 - politica de notificaciones externas - 2026-08-27

- Se implemento packages/domain/src/delivery/notification-policy.ts para decidir elegibilidad por academy, audience, proposito, canal, enabled y consentimiento.
- In-app no requiere consentimiento externo; email y sms requieren consentState granted. Disabled, withdrawn y preferencias ausentes se reportan como skipped.
- La salida solo contiene candidatos y razones de skip: no incluye contactos, proveedor, credenciales, mensajes ni llamadas externas. Los duplicados y campos extra fallan cerrado.
- Verificacion: pruebas focalizadas T064 6/6 y regresion de delivery/offline/Levels/progreso/recordatorios 58/58; corepack pnpm --filter @bpt-jersey/domain typecheck, ESLint focalizado, Prettier y git diff --check pasan.
- Alcance: sin proveedor, red, Firestore writes, UI, reintentos, credenciales ni gasto nuevo. T064 pasa a revision; quedan persistencia de preferencias, RBAC/runtime, Rules/Emulator, E2E, seleccion de proveedor y limites de costo.

### Evidencia T065 - asistencia offline y conflictos - 2026-08-27

- Se implemento packages/domain/src/attendance/offline-contracts.ts con parser estricto de eventos offline y reconciliacion determinista.
- Reintentos exactos se deduplican; un mismo eventId con payload diferente y dos eventos para la misma sesion/estudiante/tipo no se eligen automaticamente: quedan como conflictos.
- El parser exige IDs validos, tipos permitidos, timestamps validos y capturedAt no anterior a occurredAt; entradas invalidas fallan cerrado.
- Verificacion: pruebas focalizadas T065 6/6 y regresion de dominio Levels/progreso/recordatorios 48/48; corepack pnpm --filter @bpt-jersey/domain typecheck, ESLint focalizado, Prettier y git diff --check pasan.
- Alcance: sin sincronizacion de red, Firestore writes, UI, cola local persistida, migraciones, credenciales ni datos reales. T065 pasa a revision; quedan adaptador de dispositivo, politica operativa de conflictos, persistencia, Rules/Emulator y E2E.

### Evidencia T066 - biblioteca tecnica y lesson planning - 2026-08-27

- Se implemento packages/domain/src/levels/lesson-planning-contracts.ts para versionar bibliotecas de tecnicas y validar planes contra una version exacta.
- Las tecnicas inactivas o desconocidas no pueden entrar en un plan; los estados draft/submitted/approved/archived y la metadata de aprobacion tienen invariantes explicitas.
- Solo un head_coach puede aprobar un plan submitted. El contrato no otorga belts, stripes ni promociones automaticamente.
- Verificacion: pruebas focalizadas T066 5/5 y regresion de Levels, progreso y recordatorios 42/42; corepack pnpm --filter @bpt-jersey/domain typecheck, ESLint focalizado, Prettier y git diff --check pasan.
- Alcance: sin Firestore writes, callables, UI, fuentes externas, migraciones, credenciales, pagos ni datos reales. T066 pasa a revision; quedan pendientes persistencia, Rules/Emulator, E2E, auditoria y checkpoint de producto.

### Evidencia T067 - objetivos, logros y resumen familiar - 2026-08-27

- Se implementó packages/domain/src/levels/achievement-contracts.ts con objetivos por métrica, candidatos de logros y resumen familiar inmutable.
- La comparación familiar exige opt-in explícito de adultos activos; los menores quedan excluidos. No se otorgan belts, stripes ni promociones: el resultado solo emite candidatos.
- Verificación: pruebas focalizadas T067 6/6 y regresión de niveles/progreso/recordatorios 37/37; `corepack pnpm --filter @bpt-jersey/domain typecheck`, ESLint focalizado, Prettier y `git diff --check` pasan.
- Alcance: sin Firestore writes, callables, UI, leaderboard público, auditoría persistida, migraciones, credenciales, pagos ni datos reales. T067 pasa a revision; quedan pendientes persistencia tenant-scoped, Rules/Emulator, E2E, auditoría y checkpoint de producto.

### Evidencia de implementaciÃ³n T022 (2026-08-19)

- Ledger: T022 pasÃ³ de `pendiente` a `en-progreso` antes de tocar cÃ³digo; se ejecuta inline segÃºn
  `docs/superpowers/plans/2026-08-19-t022-family-relationships-plan.md` y la spec aprobada.
- RED de Task 1: `corepack pnpm exec vitest run --project node packages/domain/src/families/family-contracts.test.ts packages/domain/src/profiles/profile-contracts.test.ts`
  fallÃ³ de forma esperada porque `family-contracts` no existÃ­a; los 7 tests de perfiles previos pasaron.
- GREEN focused: el mismo conjunto ampliado con `packages/domain/src/contracts.test.ts` pasÃ³ `24/24`.
  Cubre enums congelados, familia, relaciÃ³n guardian, borrador de menor, `familyId` opcional, allowlists
  exactas, fechas, IDs, permisos duplicados, campos prohibidos, sÃ­mbolos, propiedades no enumerables y
  prototipos.
- ImplementaciÃ³n: se aÃ±adieron `packages/domain/src/families/family-contracts.ts`, sus exports
  source/runtime y la extensiÃ³n opcional `familyId` en `StudentProfile`; no se crean Auth accounts ni
  claims y el borrador no acepta autoridad clÃ­nica, financiera, progreso ni `userId`.
- Gates de Task 1: `corepack pnpm --filter @bpt-jersey/domain typecheck` pasÃ³; `corepack pnpm --filter @bpt-jersey/domain build:runtime`
  pasÃ³; Prettier focused pasÃ³; `git diff --check` focused pasÃ³.
- AutocrÃ­tica de seguridad: no hay endpoints, integraciones, secretos ni logs nuevos; las entradas se
  validan como objetos planos con `Reflect.ownKeys`, allowlists exactas, IDs acotados y fechas ISO;
  las salidas se clonan y congelan. Sin hallazgos crÃ­ticos abiertos. UI/E2E, Rules, rendimiento y
  auditorÃ­a de dependencias no aplican todavÃ­a a esta unidad; quedan para las tareas del plan.
- Estado: T022 permanece `en-progreso`; Task 1 queda verificada internamente. Task 2 se ejecutÃ³ sin
  migraciÃ³n ni I/O productivo y su siguiente acciÃ³n es el cierre de callables en Task 3.
- Task 2 RED: `corepack pnpm exec vitest run --project node apps/functions/src/families/family-service.test.ts`
  fallÃ³ de forma esperada porque `family-service` no existÃ­a.
- Task 2 GREEN: el focused de store pasÃ³ `8/8`; cubre creaciÃ³n atÃ³mica multi-child, tutor/Auth existente,
  tenant, colisiones, preservaciÃ³n del envelope, lookup staff/guardian, reasignaciÃ³n de tutor, bajas y
  proyecciÃ³n guardian redacted.
- Store: `apps/functions/src/families/family-service.ts` limita paths a `academies/{academyId}`, lee
  documentos y queries antes de escribir, usa `transaction.create/set`, deriva `minor`, mantiene un Ãºnico
  tutor, genera relationship IDs deterministas y no elimina documentos.
- Gates Task 2: `corepack pnpm --filter @bpt-jersey/functions typecheck`, Prettier focused y
  `git diff --check` focused pasaron. No se ejecutÃ³ aÃºn Emulator: corresponde a Task 4.
- AutocrÃ­tica Task 2: errores fail-closed para Auth ausente, tenant distinto, documentos invÃ¡lidos,
  duplicados y relaciones guardian ambiguas; no hay logs ni datos sensibles aÃ±adidos. Rollback de esta
  unidad es revertir cÃ³digo; no hubo migraciÃ³n, backup requerido, staging, producciÃ³n ni deploy.
- Task 2 deja como siguiente unidad escribir RED para `apps/functions/src/families/family-callables.test.ts`
  y proteger las operaciones con claims/roles y payloads exactos; esa unidad quedÃ³ cubierta por Task 3.
- Task 3 RED: `corepack pnpm exec vitest run --project node apps/functions/src/families/family-callables.test.ts`
  fallÃ³ de forma esperada porque los handlers no existÃ­an.
- Task 3 GREEN y regresiones: focused `18/18` en callables, autorizaciÃ³n de usuario y deploy runtime;
  Functions typecheck pasÃ³. La primera corrida detectÃ³ imports raÃ­z no portables en el nuevo cÃ³digo;
  se corrigieron usando `@bpt-jersey/domain/families` y `@bpt-jersey/domain/profiles`, y el runtime
  portable final pasÃ³ sin imports workspace residuales. El harness imprime warnings de Node/sourcemaps
  no bloqueantes de la prueba existente.
- Callables: `createFamily`, `getFamily` y `updateFamily` derivan actor/tenant, aceptan solo owner/admin
  para escritura, guardian solo puede leer con payload `null`, rechazan authority fields y mapean errores
  internos a mensajes pÃºblicos genÃ©ricos; no hay logging de payloads.
- Gates Task 3: `corepack pnpm --filter @bpt-jersey/functions typecheck`, Prettier focused y
  `git diff --check` focused pasaron. No se desplegÃ³ ni se inicializÃ³ una operaciÃ³n productiva.
- Task 3 dejÃ³ como siguiente acciÃ³n aÃ±adir integraciÃ³n Firestore Emulator y la matriz explÃ­cita
  deny-by-default de `families`/`relationships`; esa unidad quedÃ³ cubierta por Task 4.
- Task 4: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,auth
"node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts
qa/integration/family-adapters.test.ts qa/integration/firestore-adapters.test.ts"` pasÃ³ `9/9`.
  Auth/Firestore Emulator verificÃ³ creaciÃ³n staff de dos menores, envelope, lectura guardian redacted,
  guardian cruzado, reasignaciÃ³n, desactivaciÃ³n y duplicado de tutor.
- Rules: `corepack pnpm test:rules` pasÃ³ `23/23` en 5 archivos; la matriz explÃ­cita de `families` y
  `relationships` cubre get/list/create/update/delete para anÃ³nimo, owner, administrator, headCoach,
  coach, guardian y adultStudent. Las Rules siguen deny-by-default; los warnings de permission_denied
  son la salida esperada de las pruebas negativas.
- Ãndice: `firestore.indexes.json` aÃ±ade Ãºnicamente la consulta `relationships` por `adultUserId` y
  `status`; no se aplicÃ³ a producciÃ³n. Rollback definido como retirar esa entrada antes de cualquier
  despliegue futuro.
- AutocrÃ­tica Task 4: el Emulator descubriÃ³ y corrigiÃ³ el uso de objetos simulados como queries; el
  adapter ahora construye `collection().where().limit()` real y conserva dobles unitarios. Sin hallazgos
  crÃ­ticos, migraciÃ³n, secretos, datos productivos ni deploy.
- Task 4 dejÃ³ como siguiente acciÃ³n escribir RED para `family-client` y las pÃ¡ginas staff/guardian en
  Task 5; esa unidad quedÃ³ cubierta por Task 5.
- Task 5 RED: el focused web fallÃ³ porque `family-client` y las pÃ¡ginas `/admin/families` y
  `/account/family` no existÃ­an.
- Task 5 GREEN: `corepack pnpm exec vitest run --project web apps/web/src/lib/family-client.test.ts
apps/web/src/app/admin/families/page.test.tsx apps/web/src/app/account/family/page.test.tsx
apps/web/src/app/account/page.test.tsx apps/web/src/lib/login-flow.test.ts` pasÃ³ `17/17`.
- Web: el cliente callable sanitiza payloads, valida proyecciones staff/guardian con allowlists exactas
  y mensajes seguros; la UI staff admite tutor y mÃºltiples menores con validaciÃ³n/foco/estado de doble
  envÃ­o; guardian es lectura sin IDs internos, relaciones, acciones de escritura ni campos restringidos.
- Gates web: `corepack pnpm --filter @bpt-jersey/web typecheck` pasÃ³; Prettier focused pasÃ³. El build
  estÃ¡tico con `NEXT_PUBLIC_ADMIN_E2E=true` generÃ³ `/admin/families` y `/account/family`.
- Browser QA: `corepack pnpm --dir qa test:e2e --grep "@family"` con `NEXT_PUBLIC_ADMIN_E2E=true`
  pasÃ³ `2/2` (desktop Chromium y mobile Chromium), staff multi-child mockeado, consola limpia y sin
  overflow horizontal. Guardian queda cubierto por RTL y la integraciÃ³n Auth/Firestore; no se creÃ³ un
  bypass de autenticaciÃ³n para E2E.
- AutocrÃ­tica Task 5: no hay acceso Firestore directo en navegador, secretos, PII en logs ni respuesta
  de autoridad visible; labels, foco, alertas, targets y reduced motion siguen el DNA existente.
- Task 6: `docs/data/firestore-data-model.md` documenta `families`, `relationships`, `familyId` de
  menores, ownership `owner`/`administrator`, proyecciÃ³n guardian redacted, lÃ­mites de permisos, Rules
  deny-by-default, Ã­ndice `adultUserId ASC, status ASC` y rollback aditivo retirando la entrada antes
  de cualquier despliegue.
- RegresiÃ³n global: la primera `corepack pnpm test` detectÃ³ dos aserciones histÃ³ricas de navegaciÃ³n que
  esperaban 9 enlaces despuÃ©s de aÃ±adir `Families`; se actualizaron a la ruta y total 10, y la suite
  final pasÃ³ `74` archivos y `533/533` pruebas.
- Gates finales: `corepack pnpm test` pasÃ³ `533/533`; `corepack pnpm test:rules` pasÃ³ `5` archivos y
  `23/23` en Emulator; `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`,
  `corepack pnpm format:check` y `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check`
  pasaron. El check de formato requiriÃ³ formatear `qa/tests/family-relationships.spec.ts`.
- Seguridad final: callables con Auth/tenant/rol, allowlists exactas y errores pÃºblicos seguros; no hay
  secretos, endpoints sin autorizaciÃ³n, acceso cliente directo, PII en logs ni migraciones/despliegues.
  `corepack pnpm audit --audit-level high` reporta `0` high/critical y las dos moderadas transitivas
  ya registradas en `docs/security/dependency-risk-register.md` (`uuid@9.0.1` y
  `@opentelemetry/core@1.30.1`, DR-001).
- Estado: T022 pasa a `revisiÃ³n`; no se ejecutaron migraciones, despliegues ni commits. La aprobaciÃ³n
  final queda separada de esta verificaciÃ³n tÃ©cnica.

### Evidencia de implementaciÃ³n T032 (2026-08-19)

- El ledger conserva T032 en `en-progreso` hasta que los gates finales de Task 6
  pasen; Task 5 actualiza la fila canÃ³nica de `plans` sin modificar runtime,
  UI, pagos, membresÃ­as lifecycle, migraciones, despliegue ni Git.
- Task 1: focused `11/11` y regresiÃ³n de dominio `98/98`; se corrigiÃ³ la
  validaciÃ³n de getters hostiles.
- Task 2: store `15/15`, runtime deploy `2/2` y typecheck; se corrigieron
  seed/get/runtime, preservaciÃ³n del envelope y la superficie de activaciÃ³n.
- Task 3: callables `13/13`, regresiÃ³n aislada `31/31` y typecheck; se aÃ±adiÃ³ el
  comando explÃ­cito `activatePlan` sin hacer editable `active` en `savePlan`.
- Task 4: integraciÃ³n Firestore/Auth Emulator `4/4`; cada caso individual
  `1` pasado (`idempotently`, `lifecycle`, `isolates`, `documents`); Rules
  `30/30`; typecheck y formato pasaron. Se corrigiÃ³ el read-before-write de
  Firestore y se aislaron las pruebas de integraciÃ³n/envelope.
- La reconciliaciÃ³n documental conserva los diez `planId`/valores exactos de
  `BPT-memberships.docx` y `BRIEF.md`, precios en peniques GBP, PAYG por sesiÃ³n,
  ownership tenant-scoped, proyecciÃ³n pÃºblica solo activa, activaciÃ³n explÃ­cita,
  desactivaciÃ³n blanda, acceso directo deny-by-default, sin Ã­ndice compuesto y
  rollback de seed solo en Emulator/staging.
- No hubo commits, migraciones, escrituras productivas, despliegues, llamadas a
  pagos ni cambios de configuraciÃ³n de Git. El reporte de Task 5 queda en
  `.superpowers/sdd/2026-08-19-t032-membership-catalog-plan/task-5-report.md`.
- Task 6: `corepack pnpm test` pasÃ³ `77` archivos y `572/572` pruebas; `corepack
pnpm test:rules` pasÃ³ `5` archivos y `30/30` pruebas. `corepack pnpm lint`,
  `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm format:check`
  y `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` pasaron.
- Seguridad final: callables con Auth/rol/tenant, allowlists exactas, proyecciones
  redacted y Rules deny-by-default; no hay secretos, PII en logs, pagos,
  migraciones, despliegues ni integraciones nuevas. `corepack pnpm audit
--audit-level high` conserva solo `2` moderadas transitivas (`uuid` y
  `@opentelemetry/core`) registradas en DR-001; no hay high/critical. La
  protecciÃ³n de abuso/rate limit de catÃ¡logo queda como control transversal para
  el gate de endpoints del proyecto, no como una falsa afirmaciÃ³n de que T032 lo
  resolviÃ³.
- T032 pasa a `revisiÃ³n`; queda pendiente aprobaciÃ³n formal. No se ejecutÃ³ commit.

### Evidencia T033 Task 3 (2026-08-19)

- RED: `corepack pnpm exec vitest run --project node apps/functions/src/memberships/membership-service.test.ts` fallÃ³ de forma esperada porque `membership-service.js` no existÃ­a.
- GREEN: el focused final inicial pasÃ³ `8/8`; cubre creaciÃ³n `trial`/`active`, referencias same-tenant y relaciÃ³n activa, plan inactivo, estudiante desconocido, familia cruzada, tenant isolation, unicidad current, todas las transiciones vÃ¡lidas, transiciÃ³n invÃ¡lida/terminal, retry idempotente, `endsAt`, envelope, drafts de auditorÃ­a, ausencia de efectos financieros y mapeo seguro de errores del adapter.
- Store: `apps/functions/src/memberships/membership-service.ts` usa transacciones read-before-write sobre `memberships`, `families`, `students`, `plans` y `relationships`; valida contratos T033/T032, limita el scope por tenant/familia/estudiante/membresÃ­a, preserva referencias/envelope, deja `cancelled` terminal y agrega `membership.created`/`membership.status.changed` con `appendAuditEventInTransaction`.
- Gates de Task 3: `corepack pnpm --filter @bpt-jersey/functions typecheck` y Prettier focused pasaron. `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` focused no reportÃ³ errores; solo warnings de conversiÃ³n LF/CRLF de Git.
- AutocrÃ­tica de seguridad: sin secretos, logs, datos financieros, proveedores, pagos, deuda, invoices, receipts, migraciones, despliegues o writes productivos; errores de transacciÃ³n no exponen mensajes crudos. Sin hallazgos crÃ­ticos abiertos.
- Estado: T033 permanece `en-progreso`; Task 4 de callables, Task 5 de Emulator/Rules y Task 6 de documentaciÃ³n/gates completos quedan pendientes. No se hizo commit ni se modificÃ³ configuraciÃ³n de Git.

### Fix report de revisiÃ³n T033 Task 3 (2026-08-19)

- `transitionMembership` ahora valida `familyIds`, `studentIds` y `membershipIds` despuÃ©s de leer y validar el registro, antes de devolverlo o escribirlo.
- `storedFamily`, `storedStudent` y `storedPlan` comparan sus IDs internos con el ID esperado del documento; los checks de tenant permanecen activos.
- La consulta de unicidad por `studentId` ya no usa lÃ­mite; detecta una membresÃ­a vigente despuÃ©s de `101` documentos histÃ³ricos cancelados sin duplicar estados.
- El fake transaccional falla ante cualquier lectura posterior a la primera escritura; la creaciÃ³n prueba explÃ­citamente que el flujo read-before-write no dispara esa guardia.
- El retry same-state comprueba que no genera writes ni auditorÃ­a.
- El focused corregido pasÃ³ `9/9`; T033 permanece `en-progreso` porque callables, Emulator/Rules y gates finales siguen fuera de esta Task 3.

### Evidencia final T033 Task 6 (2026-08-19)

- El contrato canÃ³nico documenta exactamente los campos `membershipId`, `academyId`, `familyId`,
  `studentId`, `planId`, `status`, `startsAt`, `endsAt`, `nextBillingAt`, `schemaVersion`,
  `createdAt`, `createdBy`, `updatedAt` y `updatedBy`; referencias same-tenant, la tabla completa
  de estados, la unicidad de una sola membresÃ­a current y el historial terminal `cancelled`.
- La documentaciÃ³n fija guardian/adultStudent en creaciÃ³n `trial` dentro de su alcance, owner/admin
  para creaciÃ³n y transiciones, coach/headCoach denegados, Functions/Auth/tenant/scopes,
  payloads server-owned, auditorÃ­a `membership.created`/`membership.status.changed` create-only con
  campos generados por servidor y redacciÃ³n sin PII, precios, pagos o deuda.
- TambiÃ©n fija Rules browser deny-by-default, que T033 no aÃ±ade compound indexes, la separaciÃ³n
  T037/T038 para deuda/finanzas manuales, T034-T036 para providers, y rollback solo en Emulator o
  staging aislado mediante cleanup o estado `cancelled`.
- Evidencia exacta acumulada: Task 1 lifecycle focused `8/8` y domain regression `106/106`; Task 2
  audit `12/12`, writer `7/7`, domain `110/110`; Task 3 store `9/9`, contracts/audit `20/20`;
  Task 4 callables `11/11`, regression `36/36`; Task 5 Emulator `6/6`, Rules `37/37`, unit `32/32`.
- Correcciones reconciliadas: lifecycle runtime mapping/draft status; audit getter snapshot y
  contracts expectation; store scope, internal IDs, uniqueness, read-before-write y audit retry;
  callable family-active, date payload y transiciÃ³n invÃ¡lida real.
- Se conserva T033 en `revisiÃ³n`, no `aprobada`: las pruebas y gates tÃ©cnicos pasan, pero esta
  verificaciÃ³n no equivale a aprobaciÃ³n de producciÃ³n. No se hicieron commits, migraciones, writes
  productivos, deployments, pagos, deuda ni cambios de configuraciÃ³n Git.
- Preocupaciones residuales: `corepack pnpm audit --audit-level high` conserva las dos moderadas
  transitivas de DR-001 (`uuid` y `@opentelemetry/core`), sin high/critical; el rate-limit/protecciÃ³n
  contra abuso sigue siendo un control transversal pendiente y no queda resuelto por T033.

### T037 - Inicio de implementaciÃ³n (2026-08-19)

- DiseÃ±o aprobado por el operador: facturas como fuente canÃ³nica, pagos manuales append-only en
  efecto, balance/deuda derivados y sin colecciones `balances`/`debts`.
- AutorizaciÃ³n aprobada: owner/administrator escriben; guardian/adultStudent solo leen su alcance;
  headCoach/coach quedan denegados.
- El alcance de esta tarea excluye refunds por falta de polÃ­tica aprobada, providers, checkout,
  webhooks, UI, bloqueo de reservas, producciÃ³n y migraciones.
- T037 pasa a `en-progreso`; la evidencia de cada ciclo RED/GREEN y la autocrÃ­tica se agregarÃ¡ aquÃ­
  antes de moverla a `revisiÃ³n`.

### T038 - Inicio de implementaciÃ³n (2026-08-19)

- DiseÃ±o aprobado por el operador: `trial`/`active` permiten solo con deuda PAYG derivada en cero;
  `paused`/`overdue`/`cancelled` deniegan siempre; pagar la deuda restaura el permiso sin cambiar
  automÃ¡ticamente el estado de membresÃ­a.
- La implementaciÃ³n serÃ¡ un guard puro de dominio y un servicio backend read-only que compone
  `MembershipStore` con `FinanceStore`; T027 consumirÃ¡ el resultado cuando existan bookings.
- El alcance excluye writes de booking, UI, callable, colecciones de restricciones, migraciones,
  deploys, producciÃ³n, proveedores y cambios automÃ¡ticos de membresÃ­a.
- T038 pasÃ³ a `en-progreso` antes de tocar cÃ³digo y siguiÃ³ el plan TDD
  `docs/superpowers/plans/2026-08-19-t038-financial-access-plan.md`.
- Domain policy: `packages/domain/src/finance/financial-access.ts` y sus pruebas; focused `8/8`,
  suite domain `126/126`, typecheck, runtime build, Prettier e import del subpath
  `@bpt-jersey/domain/finance/access` pasan. `trial`/`active` con deuda cero permiten; deuda
  positiva deniega; `paused`/`overdue`/`cancelled` deniegan siempre; entradas hostiles fallan cerrado.
- Backend read-only: `apps/functions/src/finance/financial-access-service.ts` y sus pruebas;
  focused service/domain `21/21` (`13` service + `8` domain), Functions typecheck y Prettier pasan. Valida tenant/identidad,
  deriva familia/estudiante desde membership y no escribe ni expone payloads financieros.
- Emulator: `qa/integration/financial-access.test.ts`; Firestore Emulator `1/1`, con guardia
  `FIRESTORE_EMULATOR_HOST`, deuda PAYG `1750 -> 0` en dos invoices, recuperaciÃ³n `ALLOWED`, membership sin mutar,
  colecciones de restricciones ausentes y aislamiento cross-tenant.
- Gates finales: `corepack pnpm test` secuencial `85/85` archivos y `650/650` tests; lint,
  typecheck, build, format, audit high y `git diff --check` pasan. Rules requiere Firestore,
  Auth y RTDB; corregido el comando, `35/35` pasan con warnings `permission_denied` esperados.
- Seguridad: sin hallazgos nuevos high/critical; no hay endpoints, secretos, proveedores, writes
  productivos, migraciones ni colecciones nuevas. DR-001 mantiene dos moderadas transitivas y el
  rate limit transversal sigue pendiente. T038 queda en `revisiÃ³n`, no aprobada ni desplegada.

## Tareas complementarias integradas desde la evidencia del proyecto

Estas tareas no reemplazan las tareas MVP numeradas. Registran trabajo posterior que existÃ­a en
la evidencia, pero no tenÃ­a un ID propio en el backlog. `tasks.md` conserva el estado oficial y
la evidencia; `Lista/Lista.js` debe reflejar esta secciÃ³n sin crear tareas fuera de este archivo.

| ID   | Tarea atÃ³mica                                                                                | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T072 | Ejecutar descubrimiento estructural read-only de Regyfit                                      | T007,T013      | aprobada | Manifiesto sanitizado, contratos y Playwright offline 2/2; aprobada 2026-08-23                                                                                                                                               |
| T073 | Implementar autorizaciÃ³n, locks y provisioning administrativo de Regyfit                     | T015,T016      | aprobada | Locks renovables, fencing, recuperaciÃ³n y compensaciÃ³n fail-closed; 32 focused y 83 suite; aprobada 2026-08-23                                                                                                             |
| T074 | Construir shell y panel read-only administrativo de Regyfit                                   | T020,T015      | aprobada | Shell responsive, proyecciones owner/safe, filtros, foco, 24 E2E sintÃ©ticos; aprobada 2026-08-23                                                                                                                            |
| T075 | Implementar importer Regyfit idempotente y aplicar lote aprobado                              | T073,T074      | aprobada | Importer protegido, dry-run e importaciÃ³n de 10 registros verificada; aprobada 2026-08-23                                                                                                                                   |
| T076 | Publicar callable protegido de registros Regyfit                                              | T074,T075      | aprobada | Callable v2, smoke 403 sin identidad verificado; aprobada 2026-08-23                                                                                                                                                         |
| T077 | Implementar gateway unificado de login, logout y acceso administrativo                        | T014,T015      | aprobada | Email/Google, destinos allowlisted, logout, E2E sintÃ©tico documentados; aprobada 2026-08-23                                                                                                                                 |
| T078 | Entregar panel administrativo visible con preview sintÃ©tico                                  | T020,T021      | aprobada | Overview, Members, Groups, Activities, Attendance, Reports, CRM y Finance; QA 374/374; aprobada 2026-08-23                                                                                                                   |
| T079 | Implementar operaciones de miembros, informes y exportaciÃ³n PDF protegida                    | T021,T024,T053 | aprobada | Callables, lÃ­mites, rate limit, export journal, PDF Unicode, integraciÃ³n Firestore; QA 427/427; aprobada 2026-08-23                                                                                                        |
| T080 | Validar lote real de PDFs de miembros y planificar importaciÃ³n                               | T079           | aprobada | 8 reportes, 243 canÃ³nicos, 0 conflictos y dry-run aprobado; cualquier apply continÃºa prohibido sin confirmaciÃ³n explÃ­cita y sin cerrar los gates productivos; aprobada 2026-08-23                                        |
| T081 | Implementar navegaciÃ³n responsive administrativa y tablas ordenables                         | T020,T078      | aprobada | Drawer mÃ³vil, foco, responsive, ordenaciÃ³n y E2E desktop/mÃ³vil; aprobada 2026-08-23                                                                                                                                       |
| T082 | Establecer sincronizaciÃ³n permanente entre `tasks.md` y `Lista/`                             | T001           | aprobada | Regla persistente aÃ±adida a `AGENTS.md`, Copilot y `MASTER_PROMPT.md`; 83 entradas Ãºnicas sincronizadas y `Lista.js` verificado                                                                                            |
| T084 | Impedir que el importador de PDFs trate producciÃ³n como staging y limitar writes al emulador | T080,T085      | aprobada | Runner/CLI emulator-only, fuente sintÃ©tica temporal, symlinks rechazados y gates globales verdes; aprobada 2026-08-23                                                                                                       |
| T085 | Fijar `nanoid >=3.3.18` y excluir caches Graphify del formatter                               | T002           | aprobada | `nanoid@3.3.18`, audit sin high/critical y formato global verde; aprobada 2026-08-23                                                                                                                                         |
| T086 | Aislar E2E sintÃ©tico de red externa y diferir el resolver del popup de Google                | T014,T049,T050 | aprobada | Resolver Google diferido hasta el sign-in y fixture operativa explÃ­cita; unitarias 1036/1036 y E2E 67/67; aprobada 2026-08-24                                                                                               |
| T087 | Reconciliar estados, dependencias y evidencia entre `tasks.md` y `Lista/`                     | T082           | aprobada | 87 IDs Ãºnicos sincronizados; 0 divergencias de estado y 0 tareas aprobadas con dependencias abiertas; sintaxis, Prettier y diff verificados 2026-08-25                                                                      |
| T088 | Mostrar el catalogo canonico de Levels en el panel administrativo                             | T083,T087      | aprobada | Aprobada 2026-08-28 para preview local/sanitizado: 171 definiciones visibles, backend solo opt-in, verify:mvp completo, Playwright focalizado 2/2 y cierre de seguridad; sin deploy, seed, migracion, datos reales ni gasto. |

| T089 | Bloquear el proyecto Firebase productivo en el importador Regyfit | T075,T084 | revision | El ID productivo exacto queda denegado por argumento/entorno/Firebase config antes de I/O y staging permanece cerrado sin allowlist positiva. Focales 23/23 y verify:mvp 1220/1220 + Rules 78/78 + carga 240/240 + smoke 5/5; audit 0 high/critical. |

## Plan de implementaciÃ³n del MVP aprobado

> **Para workers agentic:** usar `subagent-driven-development` o `executing-plans` al ejecutar
> cada fase. Cada cambio funcional sigue RED -> GREEN -> REFACTOR, autocrÃ­tica y evidencia fresca.

**Objetivo:** reemplazar previews por un MVP persistente y verificable en emuladores o staging
separado, sin nuevas escrituras o despliegues productivos.

**Arquitectura:** se extiende el monolito modular existente. Los contratos viven en
`packages/domain`, los comandos autorizados y adapters Firestore en `apps/functions`, los clientes
Firebase y UI responsive en `apps/web`, y los gates Rules/integraciÃ³n/E2E en `qa`. Firestore sigue
siendo canÃ³nico; RTDB solo puede almacenar presencia efÃ­mera.

**Stack:** TypeScript 6.0.3, Zod 4.4.3, Next.js 16.3.0, React 19.2.8, Firebase Admin/Functions,
Vitest 4.1.10, Firebase Emulator Suite y Playwright 1.61.1.

### Restricciones globales

- UI, mensajes y contenido visible: inglÃ©s; documentaciÃ³n interna: espaÃ±ol.
- `bptjersey-f5a25` es producciÃ³n y no puede ser alias de local, emulator o staging.
- Piloto: datos sintÃ©ticos/sanitizados, pagos manuales, avisos in-app y ninguna dependencia de
  proveedor de pago/email/SMS.
- Toda entrada externa usa schema Zod estricto y `safeParse`; el backend deriva tenant, actor,
  timestamps, estados sensibles e IDs no deterministas.
- Menores no tienen cuenta, comparaciÃ³n pÃºblica ni comunicaciÃ³n privada con coaches.
- Belts, stripes y reconocimientos son propuestas hasta aprobaciÃ³n humana del head coach.
- WCAG 2.2 AA: teclado, foco visible/no oculto, labels, errores anunciados, targets >=24px,
  reduced motion y desktop/mobile sin overflow.
- No se crea una segunda fuente de verdad, una capa genÃ©rica anticipada ni compatibilidad retroactiva
  sin un consumidor real.
- No hay commit, migraciÃ³n, deploy ni gasto sin la autorizaciÃ³n especÃ­fica que corresponda.

### Orden de ejecuciÃ³n

| Fase | Orden WIP=1                                                                            | Salida verificable                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P0   | `T085 -> T084`                                                                         | Toolchain sin high advisories; importaciones productivas imposibles y dry-run/confirm solo contra emulador loopback.               |
| P1   | `T014 -> T015 -> T016 -> T019 -> T021 -> T022 -> T023 -> T024 -> T018 -> T025 -> T083` | Auth/Rules/auditorÃ­a revalidados; registro DOCX, waiver, staff y catÃ¡logo completo de Levels persistentes.                       |
| P2   | `T032 -> T033 -> T037 -> T038`                                                         | CatÃ¡logo Town/West, lifecycle, pagos manuales y deuda PAYG.                                                                       |
| P3   | `T008 -> T026 -> T027`                                                                 | ConfiguraciÃ³n aprobada; grupos, currÃ­culo, clases/seminarios, booking, mÃ­nimo y cancelaciÃ³n.                                   |
| P4   | `T028 -> T029 -> T030 -> T031`                                                         | Check-in/out, puntualidad, asistencia y vista operativa canÃ³nica.                                                                 |
| P5   | `T009 -> T039 -> T040 -> T041 -> T042`                                                 | Criterios aprobados, skills, evaluaciones, rachas y promociones/reconocimientos revisados sobre el catÃ¡logo Levels ya disponible. |
| P6   | `T020 -> T045 -> T047 -> T048 -> T049 -> T050 -> T051 -> T052 -> T053`                 | Portales por rol, avisos internos, dashboards, reportes y exports autorizados.                                                     |
| P7   | `T054 -> T055 -> T056`                                                                 | RestauraciÃ³n, `verify:mvp`, E2E por rol y acta del piloto.                                                                        |

### Trazabilidad obligatoria de los DOCX

Los dos DOCX son fuentes funcionales vinculantes. Una fila solo se considera cubierta cuando su tarea
responsable tiene implementaciÃ³n, pruebas y evidencia; `Lista/Lista.js` debe reflejar estos vÃ­nculos.

| Requisito                                                       | Fuente                                             | Tareas responsables | Criterio de entrega MVP                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `FUN-REG-01` datos del participante, sede y preferencia horaria | `BPTJ FUNCTIONS APP.docx`                          | `T021`              | Registro de nombre, fecha de nacimiento, telÃ©fono, email, sede y preferencia de maÃ±ana/tarde/noche.                     |
| `FUN-REG-02` tutor legal, menor y contacto de emergencia        | `BPTJ FUNCTIONS APP.docx` + waiver                 | `T022`              | Tutor legal vinculado, relaciÃ³n, telÃ©fono, alternativo y uso en nombre del menor.                                       |
| `FUN-REG-03` condiciones, lesiones, alergias y medicaciÃ³n      | `BPTJ FUNCTIONS APP.docx` + waiver                 | `T023`              | Campo restringido de mÃ¡ximo 1000 caracteres, aviso administrativo y acceso negativo por rol.                             |
| `FUN-WVR-01` waiver Ãºnico, clÃ¡usulas y aceptaciÃ³n            | waiver compartido por el operador                  | `T018`              | Texto versionado, aceptaciÃ³n, revocaciÃ³n, renovaciÃ³n, foto/video, tratamiento mÃ©dico, higiene y protecciÃ³n de datos. |
| `FUN-WVR-02` PDF firmado como evidencia                         | waiver compartido por el operador                  | `T024`              | PDF firmado subido a R2 privado con hash, firmante, versiÃ³n, timestamp de servidor y permisos.                           |
| `FUN-CLASS-01` sedes, grupos, currÃ­culo, clases y seminarios   | `BPTJ FUNCTIONS APP.docx` + memberships            | `T008,T026`         | Town/West, recurrencia, capacidad, currÃ­culo y seminarios disponibles para el piloto.                                    |
| `FUN-BOOK-01` mÃ­nimo, cancelaciÃ³n y aviso de clase            | `BPTJ FUNCTIONS APP.docx`                          | `T027,T045`         | MÃ­nimo de cuatro una hora antes, override superior del coach y aviso in-app de cancelaciÃ³n.                             |
| `FUN-CHECK-01` QR, manual, distancia y asistencia               | `BPTJ FUNCTIONS APP.docx`                          | `T028,T029`         | QR/manual, seÃ±al de 50 metros, cash de coach, puntualidad, no-show y correcciones auditadas.                             |
| `FUN-PROG-01` catÃ¡logo completo, habilidades y belts           | `BPTJ FUNCTIONS APP.docx` + inventario Regyfit     | `T083`              | Las 171 definiciones, 27 belts, 144 stripes y 11 habilidades estÃ¡n disponibles dentro del MVP.                           |
| `FUN-PROG-02` horas, clases, rachas, conducta y promociones     | `BPTJ FUNCTIONS APP.docx`                          | `T039-T042`         | Progreso calculado, conducta menor de 16, candidatos explicables y aprobaciÃ³n exclusiva del head coach.                  |
| `MEM-01` catÃ¡logo, precios y accesos Town/West                 | `BPT-memberships.docx`                             | `T032,T033`         | Todos los planes y accesos del documento, sin omitir Kids, Teens, Adults ni Open Mats.                                    |
| `MEM-02` PAYG, cash, deuda y bloqueo de reserva                 | `BPTJ FUNCTIONS APP.docx` + `BPT-memberships.docx` | `T037,T038`         | Pago manual, factura/recibo, doble cobro de deuda pendiente y recuperaciÃ³n de acceso.                                    |

Cada fase recibe aquÃ­ su bloque de archivos/interfaces/pasos antes de tocar su cÃ³digo. Este corte
just-in-time evita duplicar un plan especulativo para siete subsistemas y mantiene `tasks.md` como
Ãºnica fuente de verdad.

### P0 / T084 - Guarda fail-closed del importador PDF

**Archivos:**

- Modificar: `apps/functions/src/members/member-pdf-import-runner.test.ts`
- Modificar: `apps/functions/src/members/member-pdf-import-runner.ts`
- Modificar: `qa/scripts/import-member-pdfs.mjs`
- Modificar: `docs/data/migrations/README.md`
- Modificar al cerrar: `tasks.md` y `Lista/Lista.js`

**Interfaces que produce:**

```ts
type MemberPdfImportTargetInput = Readonly<{
  target: string;
  projectId: string;
  academyId: string;
}>;

type MemberPdfImportTarget = Readonly<{
  target: "emulator";
  projectId: "demo-bpt-jersey";
  academyId: "demo-academy";
}>;

type MemberPdfImportCliIo = Readonly<{
  firestoreEmulatorHost?: string;
}>;

function validateMemberPdfImportCliEnvironment(
  mode: "dry-run" | "confirm",
  firestoreEmulatorHost: string | undefined,
): void;
```

La validaciÃ³n acepta ausencia de host solo para `dry-run`. `confirm` exige exactamente
`127.0.0.1:8080`; rechaza `localhost`, hosts remotos, producciÃ³n, `staging`, proyectos desconocidos
y flags ambiguos antes de `initializeApp`, lectura de receipts o lectura de PDFs.

- [x] **Paso 1 - RED: escribir pruebas de frontera de entorno**

```ts
const emulatorTarget = {
  target: "emulator" as const,
  projectId: "demo-bpt-jersey",
  academyId: "demo-academy",
};

expect(() =>
  validateMemberPdfImportTarget({
    target: "staging",
    projectId: "bptjersey-f5a25",
    academyId: "demo-academy",
  }),
).toThrow("Member PDF import target is not allowed");
expect(() => validateMemberPdfImportCliEnvironment("confirm", undefined)).toThrow(
  "Firestore emulator host is required",
);
expect(() => validateMemberPdfImportCliEnvironment("confirm", "127.0.0.1:8080")).not.toThrow();
```

- [x] **Paso 2 - verificar RED**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts
```

Resultado esperado: falla porque el contrato actual acepta producciÃ³n como `staging` y la guarda no
distingue `dry-run` de `confirm`.

- [x] **Paso 3 - GREEN: aplicar el contrato mÃ­nimo emulator-only**

```ts
const approvedTarget = "emulator" as const;
const approvedProjectId = "demo-bpt-jersey" as const;
const approvedAcademyId = "demo-academy" as const;
const approvedFirestoreEmulatorHost = "127.0.0.1:8080";

export function validateMemberPdfImportCliEnvironment(
  mode: "dry-run" | "confirm",
  firestoreEmulatorHost: string | undefined,
): void {
  if (mode === "dry-run" && firestoreEmulatorHost === undefined) return;
  if (firestoreEmulatorHost !== approvedFirestoreEmulatorHost) {
    throw new Error("Firestore emulator host is required");
  }
}
```

Reemplazar los literales/flags `staging` por `emulator` y `--yes-confirm-staging` por
`--yes-confirm-emulator` en runner, receipts y rollback planner. `runMemberPdfImportCli` valida
inmediatamente despuÃ©s del parseo, antes de leer el receipt o construir el plan:

```ts
const input = parseMemberPdfImportCliArguments(argv);
validateMemberPdfImportCliEnvironment(input.mode, io.firestoreEmulatorHost);
```

El script pasa el host al runner y no inicializa Admin hasta que target, host, receipt y
confirmaciÃ³n hayan pasado:

```js
await runMemberPdfImportCli(process.argv.slice(2), createApplyServices(), {
  firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
  readReceipt,
  writeReceipt: async (path, content) =>
    writeFile(
      path,
      `${content}
`,
      { encoding: "utf8", flag: "wx" },
    ),
});
```

- [x] **Paso 4 - verificar GREEN y regresiones focused**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts
corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-service.test.ts
```

Resultado esperado: todos los tests pasan; dry-run no llama `apply`/Admin y confirm solo llega a
`apply` con proyecto demo + host loopback + receipt fresca + confirmaciÃ³n explÃ­cita.

- [x] **Paso 5 - actualizar el runbook sin reescribir evidencia histÃ³rica**

AÃ±adir a `docs/data/migrations/README.md` una advertencia fechada que declare
`member-pdf-import-run-2026-08-12.yaml` como evidencia histÃ³rica no reutilizable, prohÃ­ba tomar su
label `staging-allowlist` como autorizaciÃ³n y documente el comando emulator-only. No modificar el
YAML histÃ³rico ni ejecutar importaciÃ³n.

- [x] **Paso 6 - gates tÃ©cnicos y de seguridad**

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm build
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

AdemÃ¡s, buscar en runner/script cualquier allowlist productiva o flag viejo. La coincidencia del ID
productivo solo es vÃ¡lida en pruebas negativas o documentaciÃ³n histÃ³rica.

- [x] **Paso 7 - autocrÃ­tica y cierre del WIP**

Revisar autorizaciÃ³n previa a I/O, errores sin datos, ausencia de credenciales/logs, dependencia de
host exacto, idempotencia y rollback. Registrar comandos/resultados en la evidencia de `T084`, pasar
`T084` a `revisiÃ³n`, desbloquear `T083` y sincronizar `Lista/Lista.js`. No crear commit sin pedido
explÃ­cito.

### P1 / T014 - Auth email/password y Google emulator-only, sin MFA

**Objetivo:** revalidar el gateway de identidad ya existente contra el Auth Emulator local, corregir
el flujo Google que hoy depende de un adapter nunca registrado y alinear el login activo con ADR-005:
email/password y Google para cliente/administrador, sin que el selector conceda permisos y sin UI MFA.

**Archivos:**

- Modificar: `apps/web/src/lib/firebase-client.test.ts`
- Modificar: `apps/web/src/lib/firebase-client.ts`
- Modificar: `apps/web/src/app/login/login-form.test.tsx`
- Modificar: `apps/web/src/app/login/login-form.tsx`
- Crear: `qa/integration/auth-emulator.test.ts`
- Modificar al cerrar: `tasks.md` y `Lista/Lista.js`

**Interfaces conservadas:**

```ts
function getFirebaseAuth(): Auth;
function signInWithGoogle(): Promise<UserCredential>;
function signInWithEmail(email: string, password: string): Promise<UserCredential>;
function createClientWithEmail(email: string, password: string): Promise<UserCredential>;
```

`getFirebaseAuth()` conecta `http://127.0.0.1:9099` solo cuando
`NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` y `NEXT_PUBLIC_FIREBASE_ENV=local`. DespuÃ©s,
`signInWithGoogle()` usa siempre `signInWithPopup(auth, new GoogleAuthProvider())`: el SDK dirige ese
mismo flujo a la pÃ¡gina IdP local del emulador. `LoginRole` continÃºa siendo contexto UX; `/admin`
sigue protegido por claims y `academyId` en `AdminAuthProvider`, propiedad de `T015`.

- [x] **Paso 1 - RED: expresar Google emulator-native y login sin MFA**

En `firebase-client.test.ts`, reemplazar la expectativa del adapter local por:

```ts
it("uses the Firebase popup flow after connecting the local Auth emulator", async () => {
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";
  process.env.NEXT_PUBLIC_FIREBASE_ENV = "local";

  await signInWithGoogle();

  expect(firebaseSdk.connectAuthEmulator).toHaveBeenCalledWith(
    firebaseAuth,
    "http://127.0.0.1:9099",
    { disableWarnings: true },
  );
  expect(firebaseSdk.signInWithPopup).toHaveBeenCalledWith(
    firebaseAuth,
    expect.any(GoogleAuthProvider),
  );
});
```

En `login-form.test.tsx`, reemplazar el caso que espera un desafÃ­o TOTP por dos casos
email/Google que entregan `auth/multi-factor-auth-required` y exigen un error genÃ©rico, manteniendo
visible el formulario y sin renderizar `Verify your authenticator`.

- [x] **Paso 2 - verificar RED**

```powershell
corepack pnpm exec vitest run --project web apps/web/src/lib/firebase-client.test.ts apps/web/src/app/login/login-form.test.tsx
```

Resultado esperado: fallos especÃ­ficos porque Google local intenta usar el adapter huÃ©rfano y el
login administrativo todavÃ­a renderiza `AdminMfaChallenge`.

Resultado real 2026-08-18: `2` archivos, `3` fallos esperados y `9` pruebas aprobadas. Google fallÃ³
con `Firebase emulator auth adapter is not configured`; email y Google no encontraron el alert
genÃ©rico porque ambos renderizaron `Verify your authenticator`.

- [x] **Paso 3 - GREEN: aplicar la correcciÃ³n mÃ­nima**

En `firebase-client.ts`, eliminar `EmulatorAuthAdapter`, `emulatorAuthAdapter` y
`registerFirebaseEmulatorAuthAdapter`; mantener la conexiÃ³n local fail-closed de
`getFirebaseAuth()` y delegar Google directamente:

```ts
export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
}
```

En `login-form.tsx`, eliminar el import/tipo `MultiFactorError`, las operaciones pending/resolver,
`isMfaRequiredError`, el estado `mfaError` y el render de `AdminMfaChallenge`. Todos los errores de
Firebase, incluido `auth/multi-factor-auth-required`, pasan por `toAuthMessage` sin cÃ³digo, email,
token ni detalle de infraestructura. Los artefactos aislados de la cancelada `T017` no se conectan
al gateway ni se ejecutan.

- [x] **Paso 4 - verificar GREEN focused**

```powershell
corepack pnpm exec vitest run --project web apps/web/src/lib/firebase-client.test.ts apps/web/src/lib/auth-client.test.ts apps/web/src/lib/login-flow.test.ts apps/web/src/app/login/login-form.test.tsx apps/web/src/lib/client-auth.test.tsx apps/web/src/lib/admin-auth.test.tsx
```

Resultado esperado: todas las pruebas focused pasan; Google usa popup despuÃ©s de conectar el
emulador y MFA-required queda sanitizado sin reemplazar el formulario.

Resultado real 2026-08-18: `6` archivos y `40/40` pruebas focused aprobadas. El primer intento GREEN
detectÃ³ un constructor mock invÃ¡lido (`11/12`); se corrigiÃ³ el doble para reflejar la clase del SDK y
la repeticiÃ³n quedÃ³ limpia.

- [x] **Paso 5 - integraciÃ³n real con Auth Emulator**

Crear `qa/integration/auth-emulator.test.ts` con usuarios sintÃ©ticos Ãºnicos. Probar
`createUserWithEmailAndPassword -> signOut -> signInWithEmailAndPassword` y un usuario Google con
`GoogleAuthProvider.credential()` + `signInWithCredential()` usando un ID token JSON ficticio que el
emulador admite. Borrar cada usuario y la app al finalizar; no usar red, credenciales ni proyectos
reales.

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth "corepack pnpm exec vitest run --config qa/integration/vitest.config.ts qa/integration/auth-emulator.test.ts"
```

Resultado esperado: email/password y Google crean/autentican identidades solo en
`127.0.0.1:9099`, y el proceso del emulador termina limpio.

Resultado real 2026-08-18: `1` archivo, `2/2` pruebas aprobadas bajo el proyecto demo. El Auth
Emulator confirmÃ³ alta/login email-password y credencial Google sintÃ©tica; despuÃ©s cerrÃ³ sus
procesos. Los usuarios y la app se eliminaron en cleanup, sin credenciales ni red productiva.

- [x] **Paso 6 - gates funcionales y globales**

```powershell
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --dir qa test:e2e tests/login-gateway.spec.ts --project=desktop-chromium --project=mobile-chromium
corepack pnpm format:check
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

AdemÃ¡s, buscar imports/referencias MFA dentro de `apps/web/src/app/login`; no debe quedar ninguno.
La suite histÃ³rica `T017_MFA_*` permanece fuera de CI y no cuenta como evidencia del piloto.

- [x] **Paso 7 - autocrÃ­tica y cierre del WIP**

Aplicar `security-baseline`, verificando entorno local exacto, separaciÃ³n selector/claims, ausencia
de registro administrativo, errores genÃ©ricos, no persistencia de credenciales/tokens y ningÃºn
acceso productivo. Registrar RED/GREEN/gates y limitaciones aquÃ­, pasar `T014` a `revisiÃ³n` y
sincronizar `Lista/Lista.js`. No crear usuarios fuera del emulador, no desplegar y no hacer commit.

## Regla permanente de continuidad y sincronizaciÃ³n

Esta regla aplica a cualquier sesiÃ³n, fecha, plataforma o agente, aunque se pierda el chat:

1. Antes de trabajar, leer `BRIEF.md`, `STACK.md` y `tasks.md`; `tasks.md` es el ledger recuperable y la fuente oficial del estado.
2. Todo cambio de cÃ³digo, documentaciÃ³n, prueba, configuraciÃ³n, diseÃ±o o despliegue debe pertenecer a una tarea existente de `tasks.md`.
3. Si el trabajo no tiene tarea, crear primero una tarea con ID Ãºnico, alcance, dependencias, estado `pendiente` y evidencia esperada; despuÃ©s comenzar el trabajo.
4. Al iniciar una tarea, cambiarla a `en-progreso` y registrar la fecha, el alcance y el plan o especificaciÃ³n relacionado.
5. Al terminar una unidad de trabajo, actualizar inmediatamente la fila y aÃ±adir debajo la evidencia real: archivos, comandos, resultados, limitaciones, riesgos y rollback cuando corresponda.
6. No marcar `aprobada` solo porque exista cÃ³digo o una especificaciÃ³n: exige pruebas reales, revisiÃ³n de seguridad y aprobaciÃ³n humana cuando el flujo lo requiera.
7. Si hay implementaciÃ³n o pruebas, pero falta aprobaciÃ³n, usar `revisiÃ³n`; si falta una decisiÃ³n externa, usar `bloqueada`; si no hay trabajo real, usar `pendiente`.
8. Actualizar `tasks.md` antes de actualizar `Lista/Lista.js`; la lista visual solo puede representar tareas, estados y evidencias que estÃ©n registradas aquÃ­.
9. `Lista/Lista.js`, `Lista.html` y `Lista.css` deben actualizarse en el mismo cambio lÃ³gico que `tasks.md`; no se permite dejar el panel visual con datos inventados o atrasados.
10. Al comenzar una nueva sesiÃ³n, revisar el Ãºltimo estado de `tasks.md`, los cambios del workspace y la evidencia reciente antes de continuar; no depender de la memoria del chat.
11. Antes de cerrar la sesiÃ³n, verificar que no existan cambios de cÃ³digo sin tarea, estados desactualizados o evidencia ausente; dejar la siguiente acciÃ³n escrita en `tasks.md`.

## Evidencia del ciclo de autocrÃ­tica

### T082 - 2026-08-13

- ImplementaciÃ³n: regla permanente de continuidad aÃ±adida a `AGENTS.md`, `.github/copilot-instructions.md` y `.cronos/MASTER_PROMPT.md`; `tasks.md` queda definido como ledger persistente y fuente Ãºnica de verdad entre sesiones.
- SincronizaciÃ³n: `Lista/Lista.js` declara `sourceLedger: "tasks.md"`, representa 83 entradas Ãºnicas, incluye `T072-T082` y conserva los estados reconciliados del ledger.
- QA: `node --check Lista/Lista.js` -> exit 0; VM global -> `entries=83`, `uniqueIds=83`, `sourceLedger=tasks.md`, `T072-T082 PASS`, estados esperados PASS; controles de panel, checklist, filtros y expandir/contraer global verificados en la corrida de Task 9.
- Formato: `git diff --check -- tasks.md AGENTS.md .github/copilot-instructions.md .cronos/MASTER_PROMPT.md Lista/Lista.js Lista/Lista.html Lista/Lista.css` -> salida vacÃ­a, exit 0.
- Seguridad y operaciones: no se leyeron secretos, no se modificaron datos, no se desplegÃ³, no se migrÃ³ y no se ejecutaron operaciones destructivas.
- Estado: `T082` pasa a `aprobada` porque la regla, la reconciliaciÃ³n y la verificaciÃ³n tienen evidencia real. La publicaciÃ³n en GitHub continÃºa sujeta a un commit autorizado.

### T001 - 2026-08-06

- Seguridad: scripts `postinstall` de `@firebase/util` y `protobufjs` revisados y bloqueados explÃ­citamente con `allowBuilds: false`; `.gitignore` cubre `node_modules`, `.env` y `.env.local`; repositorio sin historial previo ni secretos commiteados.
- Dependencias: `corepack pnpm audit --audit-level high` -> `No known vulnerabilities found`.
- QA: `corepack pnpm install --frozen-lockfile --offline` -> exit 0; 7 workspaces listados; TypeScript 7.0.2 y Playwright 1.61.1 disponibles.
- Pruebas avanzadas: contratos/carga/casos lÃ­mite no aplican todavÃ­a; T001 solo crea la estructura y no expone servicios.
- Gap de capacidad: ninguno; las skills existentes cubrieron la tarea.

### T002 - 2026-08-06

- Compatibilidad: TypeScript 7/ESLint 10 fueron descartados al quedar fuera de los rangos soportados por la cadena de Next.js 16; se fijaron TypeScript 6.0.3, ESLint 9.39.5 y `@types/node` 24.13.3, alineado con el runtime Node 22-24.
- Seguridad: dependencias exactas en lockfile; `@firebase/util`, `protobufjs` y `unrs-resolver` permanecen explÃ­citamente sin permiso de build; `corepack pnpm audit --audit-level high` -> `No known vulnerabilities found`.
- Tipado: la configuraciÃ³n efectiva de la app confirma `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns` e `isolatedModules` en `true`.
- QA: `corepack pnpm lint` -> exit 0 sin warnings; `corepack pnpm typecheck` -> exit 0 en 6 workspaces; `corepack pnpm format:check` -> exit 0; instalaciÃ³n fresca con `corepack pnpm install --frozen-lockfile` -> 425 paquetes y exit 0.
- Pruebas avanzadas y rendimiento: no aplican a esta tarea de configuraciÃ³n sin rutas ni lÃ³gica ejecutable; Vitest, navegador y carga se incorporan en T003-T006.
- Limpieza: se eliminaron los Ã¡rboles parciales de `node_modules` y el Ã­ndice local `.pnpm-store` generados durante la recuperaciÃ³n; ambos eran cachÃ©s reemplazables y quedaron ignorados cuando corresponde.
- Gap de capacidad: ninguno; el toolchain configurado cubre lint, tipos y formato. La ausencia de cÃ³digo funcional queda deliberadamente para las siguientes tareas atÃ³micas.

### T003 - 2026-08-06

- ImplementaciÃ³n: Vitest 4.1.10 usa proyectos separados `web` (`jsdom`) y `node`; React Testing Library, `jest-dom`, User Event y cobertura V8 quedaron disponibles con convenciones en `qa/README.md`.
- Hallazgo del loop: los configs ESM producÃ­an warnings y el setup de matchers quedaba fuera del grafo TypeScript. Se declararon los packages raÃ­z/web como ESM y se incluyÃ³ el setup compartido en el `tsconfig` web.
- Seguridad: no se aÃ±adieron endpoints, credenciales ni datos; pruebas automatizadas prohÃ­ben proyectos/credenciales de producciÃ³n. `corepack pnpm audit --audit-level high` -> `No known vulnerabilities found`.
- QA: `corepack pnpm test:unit` -> 2 archivos/2 pruebas aprobados (render real de la homepage y contrato de runtime), sin warnings; `corepack pnpm lint` y `corepack pnpm typecheck` -> exit 0.
- Pruebas avanzadas: contratos, carga y entradas hostiles no aplican aÃºn porque T003 solo crea el harness y no incorpora servicios ni lÃ³gica de dominio.
- Gap de capacidad: ninguno; la combinaciÃ³n Vitest/RTL cubre la capa unitaria y Playwright queda reservada para T005.

### T004 - 2026-08-06

- ImplementaciÃ³n: Firebase CLI 15.26.0, SDK Admin 14.2.0 y Functions 7.3.2; proyecto seguro `demo-bpt-jersey`; Auth, Firestore y RTDB emulados en loopback; Functions configurado para runtime desplegable Node 22 y ESM.
- Seguridad: Firestore y RTDB parten en default-deny; `.env.example` no contiene valores secretos; el proyecto `demo-` no puede alcanzar recursos reales. El build nativo/red de `re2` permanece bloqueado y Firebase CLI 15.26.0 funciona sin ejecutarlo.
- QA: `corepack pnpm test:rules` iniciÃ³ Auth/Firestore/RTDB, ejecutÃ³ 3 rechazos esperados (anÃ³nimo y autenticado) y cerrÃ³ emuladores con exit 0; Functions compila con `corepack pnpm --filter @bpt-jersey/functions build`; lint y typecheck pasan.
- Dependencias: audit sin hallazgos high/critical; dos moderadas transitivas quedaron evaluadas y registradas en `docs/security/dependency-risk-register.md` sin overrides mayores inseguros.
- Pruebas avanzadas: la primera capa de casos lÃ­mite de seguridad ya prueba acceso anÃ³nimo y autenticado denegado. Contratos y carga no aplican hasta exponer funciones o flujos.
- Gap de capacidad: ninguno; la Emulator Suite y Rules Unit Testing cubren el aislamiento local requerido.

### T005 - 2026-08-06

- ImplementaciÃ³n: Playwright 1.61.1 quedÃ³ configurado para Chromium en escritorio y Pixel 7, con trazas, capturas y video solo cuando aportan diagnÃ³stico. El runner sirve exclusivamente `apps/web/out` en loopback y limpia los procesos hijos al terminar.
- Hallazgo del loop: Playwright buscaba el navegador en la cachÃ© global aunque ya existÃ­a una instalaciÃ³n aislada. `qa/run-e2e.mjs` ahora prefiere `.playwright-browsers` cuando estÃ¡ disponible y mantiene la ruta estÃ¡ndar en CI.
- Seguridad: servidor de prueba limitado a `GET`/`HEAD`, con protecciÃ³n contra path traversal, `X-Content-Type-Options: nosniff`, sin exposiciÃ³n de red ni secretos. Los artefactos visuales y reportes estÃ¡n ignorados por Git.
- QA funcional: build estÃ¡tico de Next.js aprobado; smoke desktop/mÃ³vil -> 2/2; repeticiÃ³n de estabilidad `--repeat-each=5` -> 10/10; sin errores de consola, overflow horizontal ni fallos de navegaciÃ³n.
- QA visual: screenshots desktop y mÃ³vil inspeccionados; jerarquÃ­a, contraste, layout responsive y contenido pÃºblico en inglÃ©s son coherentes con la identidad BPT.
- Rendimiento: la pÃ¡gina pÃºblica es prerenderizada como contenido estÃ¡tico y no incorpora JavaScript de cliente innecesario en la ruta principal.
- Gap de capacidad: Playwright MCP no estuvo expuesto como herramienta en esta sesiÃ³n; Playwright CLI cubriÃ³ navegaciÃ³n, viewports, consola, screenshots y repeticiÃ³n de estabilidad sin reducir el alcance de T005.

### T006 - 2026-08-06

- ImplementaciÃ³n: `.github/workflows/ci.yml` ejecuta instalaciÃ³n congelada, formato, lint, tipos, unitarias, audit, Firebase Rules, build y E2E desktop/mÃ³vil en Node 24 y Java 21.
- Seguridad: permisos globales reducidos a `contents: read`; sin secretos ni pasos de despliegue; timeout y cancelaciÃ³n de ejecuciones obsoletas; todas las GitHub Actions estÃ¡n fijadas a commits inmutables verificados contra sus tags oficiales.
- QA local: formato, lint, typecheck, 2/2 unitarias, 3/3 Rules, build estÃ¡tico y 2/2 E2E smoke pasan; `pnpm install --frozen-lockfile --lockfile-only --offline` valida el lockfile.
- Dependencias: `pnpm audit --audit-level high` pasa el gate y reporta Ãºnicamente las dos moderadas transitivas aceptadas temporalmente en `docs/security/dependency-risk-register.md`; no hay hallazgos high/critical.
- Evidencia remota: GitHub Actions run `31142117581` sobre el commit `e2e7618` terminÃ³ en `success` el 2026-08-06, sin pasos fallidos: https://github.com/andresleosan/BPT-Jersey/actions/runs/31142117581.

### T007 - 2026-08-06

- ImplementaciÃ³n documental: `docs/security/data-classification-threat-model-access-matrix.md` define cuatro niveles, clasifica 26 dominios del MVP, registra 17 amenazas STRIDE/abuso y delimita 24 dominios de acceso para siete actores.
- Seguridad: `security-baseline` quedÃ³ trazado a controles y tareas posteriores; menores, salud, safeguarding, pagos, consentimientos, credenciales, archivos, audit logs, exports y backups tienen reglas negativas. No se detectaron gaps crÃ­ticos sin mitigaciÃ³n o tarea bloqueante.
- Decisiones externas: `T008-T011` permanecen explÃ­citamente abiertas; el documento no afirma cumplimiento legal ni fija retenciÃ³n, residencia, proveedor de pagos o reglas operativas aÃºn no aprobadas.
- QA documental: bÃºsquedas de cobertura confirmaron roles, clasificaciones, amenazas `THR-001` a `THR-017` y tareas propietarias; `git diff --check`, formato, lint, typecheck y unitarias 2/2 pasan.
- Dependencias: `pnpm audit --audit-level high` no reporta high/critical; conserva las dos moderadas registradas.
- Rules: la revalidaciÃ³n no se cuenta como aprobada en esta tarea porque otro proyecto (`hachi-greciaspa`) ocupa `8080/9099`; la configuraciÃ³n temporal en puertos alternativos confirmÃ³ ademÃ¡s que el test actual fija `8080/9000`. No se modificaron Rules ni tests para ocultar el conflicto.
- Pruebas avanzadas: contratos, carga y entradas hostiles de runtime no aplican a este entregable documental; sus casos y fronteras quedaron asignados a `T055`.
- AprobaciÃ³n: el operador aceptÃ³ el documento y autorizÃ³ continuar el 2026-08-06.

### T012 - 2026-08-07

- ImplementaciÃ³n: `@bpt-jersey/domain` ahora expone el registro congelado de 14 mÃ³dulos, 21 IDs nominales, `UtcDateTime`, paginaciÃ³n readonly, `Result`, contexto de actor, nueve errores de dominio serializables y una API pÃºblica explÃ­cita sin wildcard exports.
- TDD: el subagente documentÃ³ rojo por mÃ³dulos ausentes y verde `9/9`; Cronos verificÃ³ rojo por `result`/`actor-context` ausentes y verde `8/8`, rojo por `errors` ausente y verde `2/2`, y rojo por export runtime incompleto seguido de verde final.
- RevisiÃ³n: revisiÃ³n independiente del bloque delegado -> `Spec compliance: PASS`, `Task quality: PASS`; revisiÃ³n de integraciÃ³n -> sin hallazgos crÃ­ticos/altos. Se reforzaron tests de exports runtime, retryability y serializaciÃ³n exacta.
- Seguridad: sin endpoints, entradas externas, integraciones, secretos, datos personales, logs ni dependencias nuevas; los escaneos no hallaron imports de Firebase/React/Next/Zod/HTTP/proveedores. Los Ãºnicos textos coincidentes (`password`, `stack`, `cause`) son aserciones negativas de `errors.test.ts`.
- QA: formato especÃ­fico de `packages/domain/src/**/*.ts` aprobado; lint aprobado; typecheck raÃ­z aprobado; unitarias `6` archivos/`17` pruebas aprobadas; `git diff --check` sin salida.
- Gate externo: `corepack pnpm format:check` sigue fallando Ãºnicamente por `opencode.json`, modificaciÃ³n ajena a T012 que cambia Cronos a `4.2.0` y habilita delegaciÃ³n. No se modificÃ³ ese archivo para ocultar el cambio del operador.
- Dependencias: `corepack pnpm audit --audit-level high` reporta Ãºnicamente las dos vulnerabilidades moderadas ya registradas; no hay high/critical.
- Pruebas avanzadas: contratos interservicio, carga, entradas hostiles, Rules y E2E no aplican a esta base de contratos sin endpoints; permanecen asignadas a las tareas funcionales y `T055`.
- AprobaciÃ³n: el operador aprobÃ³ `T012` y autorizÃ³ continuar con `T013` el 2026-08-07.

### T008 - 2026-08-07

- Fuente pÃºblica: se consultaron `https://bptjersey.com/`, `/classes`, `/contact-us` y `/privacy-policy`; se registraron programas, ubicaciones, horarios y precios publicados con su procedencia.
- Datos ficticios: capacidades, zona horaria, estados iniciales, booking window, cancelaciÃ³n, waitlist, billing, freeze, overdue, trial y refund quedaron marcados `(f)` en `docs/operations/academy-configuration-provisional.md`.
- Decisiones pendientes: las contradicciones de kids/Carrefour/Strive/Age Concern, el texto `Â£8 class`, la direcciÃ³n de Age Concern, capacidades, membresÃ­as, proveedor de pagos y `T011` permanecen `Pending approval`.
- Seguridad: no se aÃ±adieron datos personales, credenciales, secretos, clientes reales ni configuraciÃ³n ejecutable. El texto pÃºblico de cuenta de relleno se registrÃ³ solo como observaciÃ³n externa y no se importÃ³.
- Estado: `T008` queda `pendiente`, con los datos provisionales disponibles pero sin aprobaciÃ³n operativa.
- Recordatorio: revisar `T008` el **2026-08-08** y confirmar valores publicados, reemplazar los `(f)` y resolver las decisiones pendientes antes de cerrar la tarea.
- AutorizaciÃ³n de diseÃ±o (2026-08-07): el operador autorizÃ³ la opciÃ³n 1; las relaciones estables pueden modelarse con valores `(f)` visibles como placeholders no productivos. `T008` permanece `pendiente` y ningÃºn placeholder se convierte en una restricciÃ³n de producciÃ³n.
- ReconciliaciÃ³n 2026-08-18: los dos DOCX vinculantes y las decisiones del operador sustituyen para
  el piloto los precios, sedes y reglas provisionales `(f)`. `BRIEF.md` contiene el catÃ¡logo
  Town/West y `STACK.md` las fases P0-P7; proveedor, CRM, email/SMS y producciÃ³n quedan post-piloto.
- Pendiente vigente: confirmar horarios/capacidades configurables y polÃ­ticas de freeze,
  descuentos y refunds. Esto bloquea sus reglas especÃ­ficas, no el catÃ¡logo base de `T032`.
- PreparaciÃ³n autÃ³noma 2026-08-19: se creÃ³ `docs/operations/academy-configuration-decision-packet.md`
  con los valores aprobados, hechos pÃºblicos no reconciliados y el conjunto mÃ­nimo de decisiones
  operativas. `T008` queda `bloqueada` hasta confirmaciÃ³n de la academia; no se modificaron fixtures,
  contratos, Rules, Ã­ndices ni valores productivos, y ningÃºn placeholder `(f)` fue promovido.
- RevisiÃ³n DOCX 2026-08-19: `BPTJ FUNCTIONS APP.docx` sÃ­ fija el corte de una hora, la penalizaciÃ³n
  Town de GBP 15, el mÃ­nimo de cuatro reservas y la capacidad configurable al crear la clase;
  `BPT-memberships.docx` sÃ­ fija el catÃ¡logo, precios, accesos y lÃ­mites semanales. El paquete fue
  corregido para no pedir confirmaciÃ³n de esas reglas ya vinculantes; quedan abiertas solo las
  decisiones que los DOCX no fijan.
- ReanudaciÃ³n 2026-08-25: el operador autorizÃ³ continuar con las tareas, por lo que `T008` pasa a
  `en-progreso` para preparar una configuraciÃ³n candidata y una plantilla de respuesta. Esta
  autorizaciÃ³n no confirma horarios, capacidades, instructores ni polÃ­ticas comerciales, y no
  permite promover placeholders o propuestas a cÃ³digo, fixtures, staging o producciÃ³n.
- PreparaciÃ³n: `docs/operations/academy-configuration-decision-packet.md` separa los valores
  vinculantes, el alcance fuera del piloto, siete defaults reversibles `T008-P01..T008-P07` y dos
  tablas para que el operador entregue clases/Open Mats, instructores, horarios y capacidades sin
  datos personales ni secretos.
- AutocrÃ­tica: no se aÃ±adieron endpoints, entradas, integraciones, dependencias ni exposiciÃ³n de
  datos. El escaneo de patrones sensibles no encontrÃ³ secretos; `pnpm audit --audit-level high`
  reporta 0 high/critical y 2 moderadas preexistentes. Se documentÃ³ que rechazar `T008-P02` para
  permitir clases ilimitadas obliga a devolver `T026` a revisiÃ³n, porque el contrato actual exige
  una capacidad positiva.
- VerificaciÃ³n: `node --check Lista/Lista.js`, Prettier focalizado y `git diff --check` pasan; la
  reconciliaciÃ³n automÃ¡tica reporta `ledger=88 lista=88 unique=88 divergences=0 T008=en-progreso`.
  Rendimiento no aplica a este cambio documental/de ledger. `T008` no se cierra sin la respuesta
  operativa explÃ­cita definida en el paquete.

- Borrador ficticio autorizado por el operador: se aÃ±adieron ocho clases y cuatro Open Mats con
  capacidades, horarios e instructores sintÃ©ticos marcados (f). No son datos de academia ni
  identidades reales; deben reemplazarse o eliminarse antes de cualquier uso operativo.
- AutocrÃ­tica final del borrador: node --check Lista/Lista.js, Prettier de tasks.md, Lista.js y el
  paquete, git diff --check y reconciliaciÃ³n ledger=88/lista=88/unique=88/divergences=0 pasan.
  El escaneo de secretos no encuentra coincidencias; pnpm audit --audit-level high conserva 0
  high/critical y 2 moderadas preexistentes. No se requieren pruebas de rendimiento para este
  cambio documental y de ledger.
- Placeholder temporal solicitado por el operador: T008-P01..T008-P07 y las ocho clases/cuatro
  Open Mats (f) quedan provisionalmente aceptados solo para Emulator/isolated staging. El estado
  pasa a revisiÃ³n para reflejar que el paquete estÃ¡ listo para confirmaciÃ³n, no para aprobar datos
  de academia, instructores, polÃ­tica comercial, facturaciÃ³n ni producciÃ³n.
- AutocrÃ­tica del placeholder: no se aÃ±adieron secretos, endpoints, dependencias, contratos, fixtures
  productivos ni datos reales; el bloque queda marcado como sintÃ©tico y reversible. La confirmaciÃ³n
  del operador/academia sigue siendo el gate para cualquier promociÃ³n.

- T009 - 2026-08-25: se iniciÃ³ el paquete de decisiÃ³n de evaluaciÃ³n y reconocimiento. La propuesta
  conserva score 1-5 por skill, requisitos del catÃ¡logo, elegibilidad AND y readiness de 1/3 por
  clases-tiempo-skills; no crea un score global ni promociones automÃ¡ticas.
- T009 - datos sintÃ©ticos: se aÃ±adieron ejemplos student-alpha/beta/gamma marcados (f) para probar
  readiness, elegibilidad y la decisiÃ³n pendiente sobre ausencias mÃ©dicas. No contienen identidad,
  notas mÃ©dicas ni rendimiento real.
- T009 queda en revisiÃ³n hasta que el head coach confirme pesos, tratamiento de medical leave,
  categorÃ­as de reconocimiento y cadencia/evidencia de evaluaciÃ³n.
- AutocrÃ­tica T009: node --check Lista/Lista.js, Prettier focalizado, git diff --check y
  reconciliaciÃ³n ledger=88/lista=88/unique=88/divergences=0 pasan; el escaneo de secretos no
  encuentra coincidencias y pnpm audit --audit-level high conserva 0 high/critical y 2 moderadas
  preexistentes. No se modificaron contratos, endpoints, Rules, fixtures productivos ni datos reales.
- Placeholder temporal solicitado por el operador: T009-P01..T009-P06 quedan provisionalmente
  aceptados solo para Emulator/isolated staging; medical leave conserva la racha sin crÃ©ditos
  automÃ¡ticos, recognition queda limitado a promotion-readiness y la revisiÃ³n sintÃ©tica se fija cada
  cuatro semanas. El estado es revisiÃ³n, no aprobaciÃ³n real del head coach ni autorizaciÃ³n productiva.
- AutocrÃ­tica de placeholder: se detectÃ³ y eliminÃ³ un bloque duplicado del paquete. La verificaciÃ³n
  final deja un solo Temporary Synthetic Placeholder; node --check, Prettier y git diff --check
  pasan. T009 permanece en revisiÃ³n hasta la confirmaciÃ³n real del head coach.

- Reconciliacion 2026-08-28: la nota del corte 2026-08-25 quedo superada al registrar T088 para la correccion de Levels. El inventario actual contiene 89 IDs unicos tanto en `tasks.md` como en `Lista/Lista.js` (incluidos T020A y el roadmap T060-T071), con 0 faltantes y 0 extras.

### T013 - 2026-08-07

- ImplementaciÃ³n documental: `docs/adr/ADR-004-firestore-aggregate-boundaries.md` fija Firestore como fuente canÃ³nica, RTDB como presencia efÃ­mera, el lÃ­mite de tenant `academies/{academyId}`, las colecciones directas por dominio, los IDs deterministas y las dependencias de `T008`, `T010`, `T011` y `T016`.
- AutorizaciÃ³n de diseÃ±o: el operador autorizÃ³ el modelado de relaciones estables con valores `(f)` como placeholders no productivos; esta autorizaciÃ³n no aprueba `T008` ni convierte valores provisionales en restricciones operativas.
- Estado previo: `T013` estaba `en-progreso` y conservaba la dependencia `T007,T008`.
- Seguridad: revisiÃ³n documental sin secretos, credenciales, datos reales ni apertura de una fuente canÃ³nica en RTDB; el lÃ­mite de tenant y las dependencias posteriores quedan explÃ­citos.
- VerificaciÃ³n: `corepack pnpm exec prettier --check firestore.indexes.json` -> `Checking formatting...` y `All matched files use Prettier code style!`; `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` -> sin salida; las bÃºsquedas de lÃ­mites requeridas confirmaron las fronteras del ADR y los estados de T008/T009/T010/T011/T013.

#### Task 5 - gate final de evidencia

- ImplementaciÃ³n revisada: ADR-004, contrato `docs/data/firestore-data-model.md`, runbook `docs/data/migrations/README.md`, `firestore.indexes.json` con 16 Ã­ndices compuestos, fixture sintÃ©tico con 7 registros Firestore y 1 registro RTDB, y `qa/rules/t013-data-model.test.ts` con 1 prueba especÃ­fica.
- Seguridad: el escaneo sensible sobre `docs/adr`, `docs/data`, `qa/fixtures` y `qa/rules` no encontrÃ³ valores secretos, credenciales, datos de tarjetas, clientes reales ni material de service account. Las 13 coincidencias de `docs/data` son prohibiciones documentales (`no secrets`, `no card numbers`, `no passwords`, etc.) sin valores sensibles. Tenant isolation, separaciÃ³n de Restricted, RTDB no canÃ³nico, ausencia de datos crudos de pago y backup mÃ¡s aprobaciÃ³n explÃ­cita para cambios destructivos quedaron confirmados.
- Pruebas avanzadas: `corepack pnpm test:rules` ejecutÃ³ el emulador `demo-bpt-jersey` con default-deny intacto; pasÃ³ el fixture T013 y las negativas de Rules, con 2 archivos y 4 pruebas aprobadas. No hubo acceso a producciÃ³n.
- Incidente de entorno y revalidaciÃ³n: una repeticiÃ³n inmediata posterior de `test:rules` no pudo iniciar por `9099`/`8080`; `netstat` mostrÃ³ Ãºnicamente conexiones `TIME_WAIT`, sin proceso escuchando. Tras 15 segundos, el mismo comando pasÃ³ nuevamente con 2 archivos/4 pruebas; no fue un fallo de T013 ni se cambiÃ³ configuraciÃ³n o procesos.
- Comandos: `corepack pnpm test:rules` -> 2 archivos/4 pruebas aprobadas, script exit 0; `corepack pnpm test` -> 6 archivos/17 pruebas aprobadas; `corepack pnpm lint` -> exit 0 sin errores; `corepack pnpm typecheck` -> 6 workspaces completados; `corepack pnpm exec prettier --check firestore.indexes.json qa/rules/t013-data-model.test.ts` -> todos los archivos usan el estilo Prettier; `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` -> salida vacÃ­a, exit 0.
- Formatter raÃ­z: `corepack pnpm format:check` falla Ãºnicamente por `opencode.json` externo preexistente (`[warn] opencode.json`, exit 1). No se modificÃ³ ni ocultÃ³ ese archivo; el formatter especÃ­fico de T013 sÃ­ pasÃ³.
- Fronteras: no hay cambios en `firestore.rules`, `database.rules.json`, `firebase.json`, `.firebaserc`, `apps/web` ni `apps/functions` versionables. Los cambios previos no relacionados en configuraciÃ³n de Cronos, `.gitignore`, `AGENTS.md`, `.cronos/` y `packages/domain/src/index.ts` se conservaron sin alterarlos.
- Dependencias abiertas: `T008` continÃºa `pendiente`; `T009`, `T010` y `T011` continÃºan `bloqueadas`; `T016` conserva la propiedad de las Rules concretas. Los valores `(f)` y `Pending approval` siguen siendo placeholders no productivos.
- Operaciones: no se ejecutaron migraciones, `up`, `down`, backups, restauraciones, despliegues, cambios de Rules, operaciones destructivas, gastos, manejo de secretos ni commits. El emulador usado por `test:rules` no es una aprobaciÃ³n operativa.
- Checkpoint previo: `T013` pasÃ³ a `revisiÃ³n` con evidencia del gate final; no se iniciaron T015/T016.
- AprobaciÃ³n del operador (2026-08-07): el operador aceptÃ³ explÃ­citamente T013 despuÃ©s de la revisiÃ³n integral y la verificaciÃ³n fresca; T013 pasa a `aprobada`. T008-T011 y T016 conservan sus estados y ownership sin cambios.

### Regyfit discovery foundation - 2026-08-07

- Estado: `en revisiÃ³n`; la sesiÃ³n autenticada permitiÃ³ una captura estructural read-only, pero todavÃ­a no se observaron entidades ni campos fuente suficientes para aprobar un mapeo de migraciÃ³n.
- ImplementaciÃ³n: contratos de manifiesto, validaciÃ³n de seguridad, sanitizaciÃ³n, captura de frames same-origin y pruebas offline en `packages/domain/src/migration/` y `qa/src/regyfit/`.
- Evidencia live: manifiesto sanitizado con 5 mÃ³dulos (`admin2`, `mail_editor`, `quest_manager-php`, `image_manager-php`, `video_tutoriais-php`) y 3 rutas adicionales observadas solo como frames.
- Seguridad: no se guardaron filas, valores, cookies, storage, credenciales, documentos, screenshots ni acciones mutantes; exportaciÃ³n oficial y API documentada quedaron `not verified`.
- QA: `corepack pnpm test` -> 10 archivos/40 pruebas aprobadas; `corepack pnpm --dir qa typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; Playwright Regyfit offline -> 2/2 aprobadas y 2 live omitidas por falta de variables de entorno.
- Dependencias: `corepack pnpm audit --audit-level high` -> sin high/critical; `corepack pnpm audit` conserva 2 vulnerabilidades moderadas transitivas (`uuid` y `@opentelemetry/core`) fuera del alcance de esta tarea.
- Rendimiento: no aplica como release grande; la captura live fue limitada a 40 rutas, solo same-origin, con parÃ¡metros estructurales allowlisted y sin navegaciÃ³n a segmentos mutantes.

### Regyfit access admin integration - Task 3A - 2026-08-08

- ImplementaciÃ³n verificada: locks de provisioning con `phase` obligatorio, `leaseDeadline` absoluto, renovaciÃ³n acotada, fencing por `lockId`, recuperaciÃ³n de leases expirados y compensaciÃ³n fail-closed; el heartbeat espera renovaciones en vuelo antes de limpiar.
- Seguridad: revisiÃ³n especÃ­fica sin secretos, endpoints sin autorizaciÃ³n, exposiciÃ³n nueva de datos sensibles ni logs de registros; el bootstrap de owner continÃºa restringido a hosts loopback de los emuladores. Las dos vulnerabilidades moderadas transitivas permanecen registradas en `docs/security/dependency-risk-register.md`; no hay high/critical.
- QA: `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts` -> 2 archivos/32 pruebas aprobadas; `corepack pnpm test` -> 14 archivos/83 pruebas aprobadas; `corepack pnpm --filter @bpt-jersey/functions typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; Prettier especÃ­fico -> todos los archivos usan el estilo; `git diff --check` -> salida vacÃ­a.
- Estado: resoluciÃ³n del blocker verificada y documentada; queda en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. No se ejecutaron despliegues, migraciones, importaciÃ³n real ni commits.

### Regyfit access admin integration - Task 4 - 2026-08-08

- ImplementaciÃ³n: shell administrativo data-free en `/admin`, con navegaciÃ³n semÃ¡ntica, skip link nativo, foco visible, sidebar responsive BPT y seis mÃ³dulos en estado `Not yet imported`; la ruta permanece Server Component y no activa Firebase ni lee registros.
- QA: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx` -> 5/5; `corepack pnpm --filter @bpt-jersey/web typecheck` -> exit 0; `corepack pnpm --dir qa typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; Prettier especÃ­fico -> todos los archivos usan el estilo; build web -> `/admin` prerenderizado; `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` -> 2/2 en desktop/mÃ³vil, con foco nativo, ausencia de datos/IP/secretos, errores de consola vacÃ­os y sin overflow horizontal en document/body.
- Seguridad: sin endpoints nuevos, secretos, datos reales, Firebase, logs sensibles ni dependencias nuevas. Las dos vulnerabilidades moderadas transitivas continÃºan registradas; no hay high/critical.
- ObservaciÃ³n menor aparcada: el servidor estÃ¡tico de QA requiere reescribir `/admin` a `admin.html`; el test conserva la URL semÃ¡ntica y valida el documento generado, sin cambiar la configuraciÃ³n del servidor.
- Estado: Task 4 verificada y en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. No se ejecutaron despliegues, migraciones, importaciÃ³n real ni commits.

### Regyfit access admin integration - Task 5 - 2026-08-08

- ImplementaciÃ³n: contrato de snapshot `RegyfitAccessRecord`, mapper con validaciÃ³n estricta, normalizaciÃ³n UTC, IDs de origen opacos, proyecciones owner/safe y unicidad por `sourceId`; no deriva `userId`, `studentId` ni identidad Auth.
- Backend: lectura read-only Ãºnicamente desde `academies/{actor.academyId}/regyfitAccessRecords`, autorizaciÃ³n con claims/academy scope, owner recibe `IP`, administrator recibe proyecciÃ³n sin `IP`, roles no administrativos y documentos fuera de scope son rechazados.
- QA: focused -> 2 archivos/17 pruebas; `corepack pnpm test:unit` -> 17 archivos/105 pruebas; typecheck de domain/functions -> exit 0; lint -> exit 0; Prettier especÃ­fico -> todos los archivos pasan; audit -> sin high/critical, dos moderadas transitivas ya registradas.
- Seguridad: se rechazan tipos invÃ¡lidos, campos inesperados, prototipos no planos, valores con forma de credencial, timestamps no canÃ³nicos, IDs vacÃ­os, requests `null` y duplicados; los errores de documentos no incluyen valores sensibles.
- Observaciones menores aparcadas: los fallos de infraestructura de Firestore se propagan desde el servicio inyectable y el `context` tipado del mapper no tiene una comprobaciÃ³n runtime de prototipo plano; ambos quedan fuera del contrato `unknown`/scope de esta tarea.
- Estado: Task 5 verificada y en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. No se ejecutaron despliegues, migraciones, importaciÃ³n real ni commits.

### Regyfit access admin integration - Task 6 - 2026-08-08

- ImplementaciÃ³n: panel read-only responsive con bÃºsqueda case-insensitive por `memberDisplayName`, `memberNumber` y `sourceId`; filtros `all/active/inactive` derivados solo de `loginCount`; estados no-results diferenciados; detalle completo de la proyecciÃ³n; IP restringida Ãºnicamente a owner.
- Seguridad y lÃ­mites: props owner/administrator discriminadas en TypeScript; administrator no renderiza IP aun con objeto malformado; ruta directa y `/admin` permanecen data-free con role preview administrator en el panel; no hay Firebase Admin, staging root, `fetch`, secretos ni endpoints genÃ©ricos en la web.
- Accesibilidad: labels asociados, botones keyboard-accessible, `aria-controls`/`aria-expanded`, focus al detalle, regiÃ³n descriptiva, `aria-live` para estados vacÃ­os, tabla adaptable a cards, focus visible y `prefers-reduced-motion`.
- QA: focused panel+shell -> 2 archivos/13 pruebas; web -> 5 archivos/23 pruebas; web typecheck -> exit 0; lint -> exit 0; Prettier especÃ­fico -> pasa; web build -> `/admin` y `/admin/regyfit-access-records` prerenderizados.
- Alcance diferido: Task 7 debe aÃ±adir autenticaciÃ³n/denegaciÃ³n, bootstrap controlado, wiring backend/proyecciÃ³n real y E2E desktop/mÃ³vil antes de cargar cualquier registro.
- Estado: Task 6 verificada y en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. No se ejecutaron despliegues, migraciones, importaciÃ³n real ni commits.

### Regyfit access admin integration - Task 7 - 2026-08-08

- ImplementaciÃ³n: `/admin` y `/admin/regyfit-access-records` comparten una gate; build normal usa Firebase Auth y falla cerrado para signed-out/denied; la boundary E2E exige flag baked y hostname loopback, con roles allowlisted y sin activar el bypass en hosts no loopback.
- Bootstrap E2E: records solo sintÃ©ticos e inyectados por `page.addInitScript` para owner/administrator; `coach`, `guardian` y `adultStudent` no reciben records. Owner recibe IP; administrator recibe safe projection sin IP. El `importRunId` permanece visible por formar parte de `Omit<RegyfitAccessRecord, "ip">` aprobado.
- QA: build normal -> exit 0 sin records/IP sintÃ©ticos en HTML/chunks; build E2E -> exit 0; focused web/admin bootstrap -> 35/35; `corepack pnpm test` -> 19 archivos/129 pruebas; Playwright admin -> 24/24 desktop + Pixel 7; typechecks web/QA, lint y Prettier -> exit 0; audit sin high/critical, dos moderadas transitivas registradas.
- Entorno: `qa/run-e2e.mjs` solo propaga `BASE_URL`, `CI`, `PLAYWRIGHT_BROWSERS_PATH` y el flag E2E; no lee staging, secretos ni credenciales reales. No se ejecutaron Firebase Auth real, despliegues, migraciones, importaciÃ³n ni commits.
- Alcance pendiente: la lectura backend real/callable sigue pendiente antes de cargar registros reales; Task 8 conserva la propiedad del importer y la integraciÃ³n real debe usar la proyecciÃ³n autorizada de Functions.
- Estado: Task 7 verificada y en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador.

### Regyfit access admin integration - Task 8 - 2026-08-08

- ImplementaciÃ³n: importer emulator-only/idempotente con path fijo `<privateRoot>/<runId>/<moduleKey>/chunk-000000.jsonl`, marcador privado no-symlink, root fuera del checkout, gates exactos de run/mÃ³dulo/ruta/conteo, mapping de dominio y escritura determinista por `sourceId`.
- Seguridad: `importRegyfitAccessRecords` valida target antes de leer staging o Firestore; rechaza producciÃ³n, emulator remoto y staging sin confirmaciÃ³n. Errores y receipt no incluyen root, rutas privadas, raw lines ni valores de registros. Audit Ãºnico metadata-only.
- Idempotencia: `REGYFIT_CAPTURED_AT` fijo y UTC canÃ³nico, hash lexical/canÃ³nico estable, repeticiÃ³n -> `skippedCount=10`, conflicto no sobrescribe y transacciÃ³n falla sin audit parcial.
- QA: focused importer -> 2 archivos/16 pruebas; `corepack pnpm test:unit` -> 21 archivos/145 pruebas; typecheck Functions/QA -> exit 0; lint, Prettier y `node --check` -> pass; audit sin high/critical, dos moderadas transitivas registradas.
- ObservaciÃ³n menor: los symlinks intermedios del path se rechazan por `realpath`, aunque no tienen fixture separado; no se leyÃ³ staging real ni se iniciÃ³ Emulator.
- Estado: Task 8 verificada y en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. El run real queda estrictamente para Task 9 con checkpoint operativo y confirmaciÃ³n explÃ­cita.
- PrÃ³ximo gate: confirmar export/API oficial o relevar explÃ­citamente los flujos de entidades/campos faltantes bajo el mismo lÃ­mite read-only antes de diseÃ±ar migraciÃ³n ejecutable.

### Regyfit access admin integration - Task 9 - 2026-08-09

- AdaptaciÃ³n aprobada: el staging real contiene 10 envelopes de captura; el importer ahora valida el envelope, convierte `logins`, normaliza `lastLogin` desde `Europe/Jersey` a UTC y conserva `memberNumber` ausente como `null`, sin reconciliar identidades.
- QA de implementaciÃ³n: dominio `8/8`, importer `14/14`, backend projections `12/12`, panel web `9/9`; suite unitaria completa `151/151`; Rules `8/8`; admin E2E sintÃ©tico `30/30` con 2 discovery live omitidos; QA typecheck, Functions build, runtime domain build, lint y `node --check` pasan.
- Dry-run real sin escritura: `plannedCount=10`, `skippedCount=0`, hash `a351dd5e8372e7100ca82b9b5e238d5265b3f091aca596039efb8356aee51c02`, audit path sanitizado `academies/demo-academy/auditEvents/regyfit-access-regyfit-20260808-acessos-01`.
- Baseline y autorizaciÃ³n: el service account externo al checkout corresponde a `bptjersey-f5a25`; la colecciÃ³n y el audit scope estaban vacÃ­os antes de aplicar. No se usÃ³ Emulator ni producciÃ³n.
- ImportaciÃ³n real: primer run `importedCount=10`, `skippedCount=0`; repeticiÃ³n idempotente `importedCount=0`, `skippedCount=10`; hash y audit path coinciden con el dry-run.
- VerificaciÃ³n post-import: `count=10`, `distinctSourceIdCount=10`, `importRunIdCount=10`, `auditEventCount=1`, `unexpectedFieldCount=0`, `auditMetadataOnly=true`.
- Estado: Task 9 verificada y en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. ProducciÃ³n permanece intacta; rollback no destructivo: eliminar Ãºnicamente documentos del `importRunId` aprobado.

### Regyfit real panel wiring - 2026-08-09

- ImplementaciÃ³n: callable `listRegyfitAccessRecords` exportado por Functions; reutiliza la autorizaciÃ³n por claims/academy y las proyecciones owner/safe existentes. El navegador usa `httpsCallable` y nunca recibe Admin SDK, service accounts ni staging paths.
- Web: `AdminAccessRecordsContent` carga la proyecciÃ³n real despuÃ©s de Auth, muestra estados de carga/error sanitizados y conserva datos sintÃ©ticos solo con `NEXT_PUBLIC_ADMIN_E2E=true` en loopback.
- Runtime: Functions smoke `functions-runtime-ok`; `main` corregido a `lib/src/index.js`; runtime domain acotado a los submÃ³dulos usados por Functions; `apps/functions/scripts/build-deploy-artifact.mjs` compila, prepara imports ESM, empaqueta sin `workspace:*`/`catalog:` y valida el artefacto antes del deploy.
- QA: suite completa `156/156`; Rules `8/8`; backend focused `45/45`; web callable/panel `26/26`; typechecks Functions/web/QA, lint, builds y formato especÃ­fico pasan; E2E sintÃ©tico `30/30` con 2 discovery live omitidos.
- Deploy: deploy exclusivo a `bptjersey-f5a25` completado; `listRegyfitAccessRecords` aparece `ACTIVE`, callable v2, Node 22, `us-central1`. Smoke HTTP sin identidad devuelve `403` en vez de `404`, confirmando que el endpoint existe y permanece protegido. Artifact Registry quedÃ³ con cleanup policy de 7 dÃ­as en `us-central1`.
- Rollback: redeployar la revisiÃ³n anterior de `apps/functions` con el mismo artefacto portable; los 10 documentos importados no se modifican y pueden eliminarse Ãºnicamente filtrando el `importRunId` aprobado.
- LimitaciÃ³n de verificaciÃ³n: no se ejecutÃ³ una lectura live owner/administrator porque no hay credenciales de Firebase Auth de staging disponibles en esta sesiÃ³n; las proyecciones estÃ¡n cubiertas por `45/45` focused tests y el callable estÃ¡ publicado.
- Estado: Task 9 y el wiring real quedan en `revisiÃ³n` hasta una verificaciÃ³n Auth live. Las alertas de facturaciÃ³n de Google Cloud siguen pendientes de configurar por el operador. ProducciÃ³n permanece intacta.

### Unified Login Gateway - hallazgos I-1 a I-6 y M-1 a M-3 - 2026-08-09

- Estado: `revisiÃ³n`; no se desplegÃ³, migrÃ³, crearon usuarios reales, leyeron secretos ni modificÃ³ el historial Git.
- Correcciones: `.gitignore` conserva secretos/builds ignorados y permite versionar `apps/web/src/lib/**`; Google atraviesa una sola boundary y conserva el adaptador de emulador; emuladores quedan local-only con guardia de build/runtime y documentaciÃ³n explÃ­cita para Cloudflare/staging; account/shop prueban el contrato real `role=client` y destinos allowlisted; el lint global pasa sin warnings; el skip link apunta a `#login-form`; Playwright cubre teclado, foco, validaciÃ³n ARIA, selector, consola y overflow en desktop/mÃ³vil; se agregÃ³ el proyecto `live-auth` opt-in, local-only y sin artefactos que puedan contener credenciales.
- QA: `node_modules/.bin/vitest.cmd run --project web --project node` -> 29 archivos, 187 pruebas aprobadas; `node_modules/.bin/eslint.cmd . --max-warnings 0` -> aprobado; typecheck directo web/UI/config/QA -> aprobado; build normal de `apps/web` -> aprobado; E2E gateway -> 8/8 desktop/mÃ³vil; E2E sintÃ©tico completo con build local `NEXT_PUBLIC_ADMIN_E2E=true` -> 38/38 aprobadas y 4 omitidas por suites live/read-only; `node qa/run-e2e.mjs --project=live-auth` -> 1 omitida por falta de habilitaciÃ³n/credenciales locales; `git diff --check` -> sin salida.
- Dependencias: `corepack pnpm audit --audit-level high` -> 2 vulnerabilidades moderadas transitivas ya existentes, sin high/critical; permanecen registradas fuera del alcance del gateway.
- Guardia de entorno: build con `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` y `NEXT_PUBLIC_FIREBASE_ENV=staging` rechazado antes de compilar; el build normal fue restaurado y aprobado despuÃ©s.
- LimitaciÃ³n Auth live: no se ejecutÃ³ login real cliente/admin porque esta sesiÃ³n no tiene una sesiÃ³n local no productiva provista por el operador; no se reclama esa evidencia. La prueba queda disponible con `UNIFIED_LOGIN_LIVE_AUTH=true` y las cuatro variables inyectadas fuera del repositorio, omitida en CI.
- Formato/tipos: el check especÃ­fico de cÃ³digo, QA, `STACK.md` y el informe pasa; el check global seÃ±ala `tasks.md` por su formato histÃ³rico y `opencode.json` por un cambio preexistente ajeno. El wrapper `corepack pnpm typecheck` aborta por purga no interactiva de pnpm. Functions/domain directo conserva el fallo preexistente de extensiones `.js` en imports relativos bajo `node16`; no se ampliÃ³ el alcance del gateway.
- Rollback: para frontend, publicar la revisiÃ³n anterior de Cloudflare Pages; para backend, redeplegar la revisiÃ³n anterior de Functions con el artefacto portable. Esta correcciÃ³n no aplicÃ³ cambios de backend, migraciones ni despliegues.

### Unified Login Gateway - verificaciÃ³n live y logout - 2026-08-09

- Deploy frontend: Cloudflare Pages project `bptjersey`, production deployment `486fd9dd`, publicado en `https://bptjersey.pages.dev`; `/login` y `/admin` responden HTTP 200.
- Auth staging: la cuenta administrativa de prueba recibiÃ³ Ãºnicamente `academyId=demo-academy` y `role=administrator`; no se alteraron contraseÃ±a, email, verificaciÃ³n ni otros usuarios.
- VerificaciÃ³n manual: operador confirmÃ³ acceso de cliente a `/account`, cierre de sesiÃ³n con retorno al login y acceso administrativo con claims vÃ¡lidas a `/admin`.
- CorrecciÃ³n: el shell administrativo ahora muestra `Sign out`; el logout de cliente redirige a `/login?role=client&returnTo=/account`.
- QA posterior: suite unitaria `188/188`, lint global, typecheck web, Prettier especÃ­fico y `git diff --check` aprobados; build Next y E2E gateway `8/8` aprobados en la misma entrega.
- Rollback: restaurar el deployment anterior de Cloudflare Pages; no hubo cambios de Functions, Firestore ni migraciones.
- Estado: `revisiÃ³n`; producciÃ³n funcional publicada, sin verificaciÃ³n de compra porque catÃ¡logo, carrito y pagos permanecen fuera de alcance.

### T016 - Firestore Rules boundary - 2026-08-09

- Estado: `revisiÃ³n`; se cerrÃ³ la lectura directa de `academies/{academyId}/regyfitAccessRecords` para todos los roles y se mantuvo la proyecciÃ³n autorizada exclusivamente en Functions.
- TDD: se cambiÃ³ primero `qa/rules/regyfit-access-records.test.ts`; el focused emulator rojo fallÃ³ solo porque el owner `getDoc` todavÃ­a sucedÃ­a bajo la excepciÃ³n existente. DespuÃ©s se eliminÃ³ `isAcademyOwner` y el `allow get` positivo de `firestore.rules`.
- ImplementaciÃ³n: `firestore.rules` conserva `allow create, update, delete: if false` y el fallback global `allow read, write: if false`; `database.rules.json` permanece sin cambios con `.read=false` y `.write=false`; `apps/functions/src/regyfit/access-records.ts` y sus proyecciones permanecen sin cambios.
- QA focused: `node_modules/.bin/firebase.cmd emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --project rules qa/rules/regyfit-access-records.test.ts"` -> `4/4`; `node_modules/.bin/vitest.cmd run apps/functions/src/regyfit/access-records.test.ts` -> `13/13`.
- QA completo: `node_modules/.bin/firebase.cmd emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node node_modules/vitest/vitest.mjs run --project rules"` -> 3 archivos, `8/8`; solo fixtures sintÃ©ticos y emuladores locales.
- Shape/security: assertion de Rules/RTDB -> `rules-shape-ok`; no hay clÃ¡usulas positivas `allow get/read/list`, no hay lectura web directa de Regyfit y ningÃºn rol conserva write access. Los mensajes del emulator son Ãºnicamente denegaciones esperadas.
- RegresiÃ³n: `node_modules/.bin/vitest.cmd run --project web --project node` -> 29 archivos, `188/188`; `node_modules/.bin/tsc.cmd --noEmit -p apps/web/tsconfig.json` -> aprobado; `node_modules/.bin/eslint.cmd . --max-warnings 0` -> aprobado; Prettier de `qa/rules` -> aprobado; `git diff --check` -> sin salida.
- Datos/operaciones: no se modificaron documentos, Ã­ndices, migraciones, backups, staging o producciÃ³n; no se crearon usuarios, leyeron secretos, desplegÃ³ ni hizo commit. No requiere backup porque el cambio es solo textual de Rules/prueba.
- Rollback textual: restaurar la versiÃ³n anterior de `firestore.rules` y `qa/rules/regyfit-access-records.test.ts`; `database.rules.json` no requiere rollback ni restauraciÃ³n de datos.
- Concern: `node node_modules/prettier/bin/prettier.cjs --check tasks.md` mantiene el warning histÃ³rico de formato de `tasks.md`; no se reformateÃ³ el archivo completo para evitar cambios fuera de T016.

### T017 - MFA TOTP - 2026-08-09

- ImplementaciÃ³n histÃ³rica: T017 exigÃ­a exactamente `request.auth.token.firebase.sign_in_second_factor === "totp"`; quedÃ³ cancelada y sustituida por ADR-005, por lo que la autorizaciÃ³n actual valida Ãºnicamente autenticaciÃ³n, claims administrativos y alcance de academia.
- Web Auth: la boundary Firebase expone Ãºnicamente enrolamiento TOTP en memoria, assertion de enrolamiento/desafÃ­o, detecciÃ³n de `enrolledFactors` y `getIdTokenResult(user, true)`. El resolver MFA queda en memoria durante el login administrativo; no se usa SMS/Phone Auth.
- Gate/UI histÃ³rico: los componentes TOTP siguen disponibles para el flujo opt-in documentado, pero el `AdminGate` actual no exige enrolamiento ni desafÃ­o MFA.
- E2E histÃ³rico: esta tarea fue cancelada y sustituida por ADR-005; sus pruebas TOTP y el proyecto `t017-mfa-live` permanecen como material histÃ³rico/opt-in, no como requisito del panel actual.
- Seguridad: QR/URI, secreto y cÃ³digo se mantienen solo en memoria de Auth/componente; no se escriben en Firestore, RTDB, custom claims, localStorage, URLs de navegaciÃ³n, logs, reportes ni artefactos. No existe bypass pÃºblico ni cÃ³digo fijo. RecuperaciÃ³n requiere eliminar/re-enrolar el factor dedicado desde Firebase Auth por el operador.
- QA: `node_modules/.bin/vitest.cmd run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/regyfit/access-records.test.ts` -> `24/24`; boundary MFA -> `14/14`; provider/UI/login focused -> `17/17`; suite completa `node_modules/.bin/vitest.cmd run --project web --project node` -> `31 archivos, 203 pruebas`; typecheck web y QA -> exit 0; lint global -> exit 0; Prettier especÃ­fico -> todos pasan; build web normal y build E2E -> exit 0; Functions tsc directo -> exit 0; E2E admin sintÃ©tico -> `18/18` desktop/mÃ³vil; login gateway -> `8/8` desktop/mÃ³vil.
- Seguimiento del login: el commit publicado aÃºn convertÃ­a `auth/multi-factor-auth-required` en el mensaje genÃ©rico; el cambio local en `login-form.tsx` enruta ese error administrativo al desafÃ­o TOTP y conserva el resolver en memoria. Prueba enfocada -> `12/12`; suite completa -> `33 archivos, 205 pruebas`; typecheck web, lint, Prettier especÃ­fico, build Next y E2E login sintÃ©tico -> `8/8` desktop/mÃ³vil.
- Dependencias: `corepack pnpm audit --audit-level high` -> dos vulnerabilidades moderadas transitivas ya registradas, sin high/critical. `corepack pnpm --filter @bpt-jersey/functions build` no pudo completar porque pnpm intentÃ³ purgar `node_modules` sin TTY; el equivalente directo `tsc` pasÃ³ y no se cambiÃ³ la configuraciÃ³n para ocultar la limitaciÃ³n.
- Operaciones y secretos: no se desplegÃ³, migrÃ³, crearon usuarios, leyeron/escribieron secretos, modificÃ³ historial Git ni hizo commit. La verificaciÃ³n live real de Firebase/TOTP queda pendiente de una cuenta administrativa staging dedicada y cÃ³digo inyectado por el operador; el seguimiento local todavÃ­a no estÃ¡ publicado.
- Rollback: restaurar las revisiones anteriores de web/Functions; si se usa staging, retirar Ãºnicamente el factor TOTP de la cuenta dedicada en Firebase Auth. No hay migraciÃ³n de Firestore/RTDB ni backup de datos requerido.

### Task 4 - Members and reports fixes - 2026-08-11

- Alcance corregido: navegaciÃ³n admin sin hashes legacy y `aria-current` derivado de la ruta; `getMemberReportSummary` count-only con aggregate Firestore bounded; filtros web serializados con las 11 claves allowlisted; expiraciÃ³n de URL PDF ISO, futura y acotada; apertura de pestaÃ±a durante el gesto; export journal especÃ­fico y durable antes de R2; rate limit transaccional por academia/administrador; lÃ­mites de filas/tamaÃ±o; fallback seguro para Unicode en PDF; estados de tabla y counters separados.
- TDD rojo: focused web inicial -> 3 archivos, 11 pruebas fallidas por los contratos nuevos; focused Functions/PDF inicial -> 2 archivos, 5 pruebas fallidas, incluyendo la reproducciÃ³n `WinAnsi cannot encode` para CJK. No se modificÃ³ cÃ³digo productivo antes de observar estos fallos.
- TDD verde: `corepack pnpm exec vitest run --project web apps/web/src/lib/members-client.test.ts apps/web/src/app/admin/members/search/page.test.tsx apps/web/src/app/admin/page.test.tsx` -> 3 archivos, 21/21; `corepack pnpm exec vitest run --project node apps/functions/src/members/member-report-pdf.test.ts apps/functions/src/members/member-callables.test.ts` -> 2 archivos, 38/38.
- Suite inicial de la segunda ronda: `corepack pnpm test` -> 40 archivos, 277/277 pruebas aprobadas.
- Tipos, lint y build: `corepack pnpm typecheck` -> exit 0 en 6 workspaces; `corepack pnpm lint` -> exit 0 sin warnings; `corepack pnpm build` -> Functions y Next.js build estÃ¡tico exit 0, rutas `/admin`, `/admin/members/search` y `/admin/regyfit-access-records` prerenderizadas.
- Formato: Prettier especÃ­fico de los archivos modificados -> exit 0. `corepack pnpm format:check` -> exit 0 despuÃ©s de normalizar el artefacto generado `apps/web/next-env.d.ts`.
- Browser smoke: corrida normal sin flag E2E -> 2/4 aprobadas (homepage desktop/mÃ³vil) y 2 admin fallidas porque el build protegido queda signed-out sin `NEXT_PUBLIC_ADMIN_E2E`; despuÃ©s se actualizÃ³ el contrato de navegaciÃ³n y se ejecutÃ³ build sintÃ©tico local con `NEXT_PUBLIC_ADMIN_E2E=true`; `corepack pnpm --dir qa test:e2e:smoke` -> 4/4 desktop/mÃ³vil, sin errores de consola ni overflow.
- Seguridad y dependencias: revisiÃ³n sobre cambios sin secretos, PII en logs, URLs PDF construidas por cliente ni endpoints nuevos sin autorizaciÃ³n; rate limit server-side requerido en `MemberCallableServices`; URLs firmadas de upload/download validadas como HTTPS absolutas; clave de rate limit no ambigua; `corepack pnpm audit --audit-level high` -> sin high/critical, 2 moderadas transitivas ya registradas en `docs/security/dependency-risk-register.md` (`uuid` y `@opentelemetry/core`).
- Operaciones: no se leyeron secretos, no se modificÃ³ Git, no se desplegÃ³, no se migrÃ³ ni se accediÃ³ a staging/producciÃ³n. Concern residual: el aggregate Firestore y el rate limiter transaccional estÃ¡n cubiertos por adapters y tests inyectados, pero no se ejecutÃ³ una prueba contra un emulador Firestore especÃ­fico para esas dos operaciones en esta ronda.
- Tercera ronda: `MemberStore.list(academyId, limit)` exige un lÃ­mite; search usa `MAX_MEMBER_SEARCH_ROWS=10_000` y lee `limit(max+1)`, mientras reportes/PDF usan `MAX_MEMBER_REPORT_ROWS=2_000` y rechazan `resource-exhausted` antes de materializar/generar por encima del lÃ­mite. El codec y los offsets de paginaciÃ³n HMAC no cambiaron.
- TDD: focused inicial de esta ronda -> 2 archivos, 5 fallos esperados (overflow search/report y URLs signer invÃ¡lidas); focused verde -> `2 archivos, 47/47`.
- CorrecciÃ³n `noNumber`: `createFirestoreMemberStore.countByReport` usa la ruta bounded y `matchesMemberReport`, por lo que la ausencia real de `membershipNumber` equivale exactamente a `undefined`; no usa `where == null`.
- IntegraciÃ³n local: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"` -> `1 archivo, 4/4`, con documentos sintÃ©ticos aislados y limpieza explÃ­cita. Cubre `countByReport/noNumber`, rate limiter transaccional y aislamiento de tuplas, y journals Firestore de report export/import cleanup. La suite unitaria normal no incluye `qa/integration`.
- QA final: `corepack pnpm test` -> `40 archivos, 287/287`; `corepack pnpm test:rules` -> `4 archivos, 9/9` en la evidencia previa; `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check` y builds web/Functions -> exit 0. `corepack pnpm audit --audit-level high` -> 2 moderadas transitivas conocidas, sin high/critical.
- Incidentes de entorno: una ejecuciÃ³n paralela de las dos Emulator Suites chocÃ³ en puertos y fallÃ³; la repeticiÃ³n secuencial de `test:rules` pasÃ³. La integraciÃ³n emite un `MetadataLookupWarning` no fatal bajo el proyecto demo; no usa credenciales ni proyecto real.
- Estado: continÃºa en `revisiÃ³n`; no se marca `aprobada` ni se ejecutan Git, despliegues o migraciones.

#### Post-verificaciÃ³n de la regresiÃ³n temporal - 2026-08-12

- Hallazgo: dos aserciones de `page.test.tsx` consultaban el DOM con `getByRole` inmediatamente despuÃ©s de una actualizaciÃ³n React en `startTransition`; la llamada mock ya habÃ­a ocurrido, pero la fila todavÃ­a no estaba renderizada bajo la suite global.
- CorrecciÃ³n mÃ­nima: ambas aserciones usan `await screen.findByRole`, sin cambios en producciÃ³n ni debilitamiento del contrato accesible. RevisiÃ³n independiente: sin hallazgos.
- QA: `corepack pnpm test` -> 45 archivos, 364/364 pruebas; `corepack pnpm test:rules` -> 4 archivos, 9/9; integraciÃ³n Firestore con emulador local -> 1 archivo, 6/6; lint, typecheck, `format:check` y build normal -> exit 0.
- Browser QA: build local explÃ­cito con `NEXT_PUBLIC_ADMIN_E2E=true` y `corepack pnpm --dir qa test:e2e:smoke` -> 4/4 desktop/mÃ³vil; despuÃ©s se restaurÃ³ y verificÃ³ el build normal sin el flag. La corrida normal del smoke sobre el build protegido no se considera evidencia sintÃ©tica vÃ¡lida porque las rutas admin deben quedar signed-out sin ese flag.
- Seguridad: sin endpoints, secretos, PII, logs sensibles, permisos, migraciones ni despliegues nuevos. `corepack pnpm audit --audit-level high` conserva Ãºnicamente las 2 vulnerabilidades moderadas transitivas registradas; no hay high/critical.

### Visible administrative panel delivery - 2026-08-12

- Alcance aprobado por el operador: construir primero el panel administrativo visible completo,
  tomando la pÃ¡gina replicada como contrato de campos, filtros, acciones rÃ¡pidas y lenguaje visual.
  La tienda virtual queda para una fase posterior.
- EspecificaciÃ³n: `docs/superpowers/specs/2026-08-12-administrative-panel-visible-delivery-design.md`.
- Plan: `docs/superpowers/plans/2026-08-12-visible-administrative-panel-delivery.md`.
- ImplementaciÃ³n visible: `Overview`, `Members`, `Groups / Teams`, `Activities`, `Attendance`,
  `Reports`, `CRM` y `Finance` tienen rutas reales, navegaciÃ³n protegida por `AdminGate`, tablas,
  filtros, mÃ©tricas, estados y acciones de preview. Members conserva los 11 filtros y los campos
  replicados; Members add/search/import permanecen disponibles.
- Barra de acciones: el dashboard expone `Add new member`, `Search members`, `Groups / teams`,
  `Create / manage activities`, `Attendance`, `Finance` y `Reports` como enlaces navegables.
- Datos: `apps/web/src/app/admin/preview-data.ts` contiene Ãºnicamente fixtures sintÃ©ticos locales,
  marcados como `synthetic-preview`; no representan importaciÃ³n real ni datos del cliente.
- QA focused: primitivas, dashboard, Members, Groups, Activities, Attendance, Finance, Reports y
  CRM -> 10 archivos, 18/18 pruebas; typecheck -> exit 0.
- QA global: `corepack pnpm test` -> 54 archivos, 374/374 pruebas; `corepack pnpm lint` -> exit 0;
  `corepack pnpm typecheck` -> exit 0; `corepack pnpm format:check` -> exit 0; `corepack pnpm build`
  -> exit 0 con las rutas admin prerenderizadas.
- Browser QA: build explÃ­cito con `NEXT_PUBLIC_ADMIN_E2E=true` y
  `corepack pnpm --dir qa test:e2e:smoke` -> 4/4 desktop/mÃ³vil; sin errores de consola ni overflow.
  El build normal fue restaurado despuÃ©s. El servidor estÃ¡tico QA ahora responde correctamente a
  los sidecars metadata-only de Next sin convertirlos en falsos errores de recursos.
- Seguridad: no se aÃ±adieron endpoints pÃºblicos, secretos, PII real, pagos, importaciÃ³n PDF,
  migraciones ni despliegues. `corepack pnpm audit --audit-level high` conserva Ãºnicamente las 2
  vulnerabilidades moderadas transitivas registradas; no hay high/critical.
- RevisiÃ³n posterior: el claim tÃ©cnico `owner` es el Ãºnico autorizado para conceder o revocar
  accesos administrativos; la exportaciÃ³n de PII queda permitida sin restricciÃ³n adicional; las
  bÃºsquedas, reportes y contadores usan rate limiting durable por academia, administrador y
  operaciÃ³n, con scopes independientes para no bloquear los ocho contadores entre sÃ­.
- TDD de rate limiting: prueba roja -> las lecturas no consumÃ­an cupo; prueba verde -> focused
  `apps/functions/src/members/member-callables.test.ts` `67/67` y focused web/backend `73/73`.
- Estado: `revisiÃ³n`. El panel visible estÃ¡ listo para demostraciÃ³n con preview sintÃ©tico; la
  persistencia real de Groups, Activities, Attendance, Finance, Reports y CRM requiere una fase
  posterior de callables/Firestore y no debe presentarse como conectada todavÃ­a.

### T020A - Identidad visual y navegaciÃ³n Home - 2026-08-09

- ImplementaciÃ³n: `apps/web/public/bpt-jersey-logo.png` contiene el logo oficial y `apps/web/public/favicon.png` contiene el favicon separado. El logo se agregÃ³ al header pÃºblico, al panel izquierdo del login, al sidebar autenticado y como watermark de los estados de acceso admin. Los textos existentes `BPT Jersey` y `BPT / Jersey` se conservaron junto a los assets.
- NavegaciÃ³n: login, shell admin y acceso admin bloqueado exponen un enlace `Home` hacia `/`; la navegaciÃ³n pÃºblica conserva su `Home` hacia `#top`.
- Metadata: `layout.tsx` usa exclusivamente `favicon.png` para `icon`, `shortcut` y `apple`; el favicon no se renderiza como logo.
- Accesibilidad: alt del logo, foco visible, orden de tabulaciÃ³n actualizado para el nuevo Home y layout responsive desktop/mÃ³vil conservado.
- QA: focused branding `8/8`; suite unitaria completa `33 archivos, 205 pruebas`; `corepack pnpm lint` -> exit 0; `corepack pnpm typecheck` -> exit 0; Prettier especÃ­fico -> todos pasan; build web E2E -> exit 0; E2E sintÃ©tico con `NEXT_PUBLIC_ADMIN_E2E=true` -> `42/42` ejecutables aprobados y `11` live/opt-in omitidos sin credenciales.
- Seguridad: no se aÃ±adieron endpoints, dependencias, secretos, datos de usuarios ni permisos. Los assets son archivos estÃ¡ticos locales; el watermark no contiene informaciÃ³n operativa.
- Operaciones: no se desplegÃ³, migrÃ³, modificaron datos, leyeron secretos ni hicieron commits. Las rutas sintÃ©ticas actuales ya no requieren `adminTestMfa=verified`, en lÃ­nea con ADR-005.
- Rollback: retirar los dos assets y revertir los cambios de branding/metadata/tests; no requiere migraciÃ³n ni backup.
- Ajuste visual posterior: `apps/web/src/content/academy.ts` conserva el tÃ­tulo canÃ³nico con coma y aÃ±ade tres grupos de lÃ­nea; `apps/web/src/app/page.tsx` los renderiza como spans visuales con nombre accesible completo; `globals.css` ajusta el ritmo vertical, tracking y ancho responsive para evitar que la coma parezca un acento sobre la `D`.
- TDD/QA: contrato enfocado primero fallÃ³ por el tÃ­tulo local sin coma y la ausencia de `titleLines`; despuÃ©s pasÃ³ `4/4`. Suite unitaria completa `corepack pnpm test:unit` -> `33 archivos, 205 pruebas`; Prettier especÃ­fico, ESLint especÃ­fico y `tsc --noEmit -p apps/web/tsconfig.json` -> exit 0; build web -> exit 0; E2E homepage desktop/mÃ³vil -> `2/2`; captura visual desktop/mÃ³vil inspeccionada sin overflow horizontal ni errores de consola.
- RevisiÃ³n independiente: se reforzÃ³ el contrato exacto del nombre accesible, se aÃ±adiÃ³ la correspondencia `titleLines` -> `title`, se verificÃ³ la estructura de tres lÃ­neas en unitarias/E2E y cada span del hero dejÃ³ de heredar `overflow-wrap: anywhere`.
- Cierre de revisiÃ³n: cada grupo usa `white-space: nowrap` y el mÃ­nimo mÃ³vil baja a `2.6rem`; E2E comprueba que cada grupo conserva un Ãºnico rect fÃ­sico en desktop y mÃ³vil.
- Seguridad: solo se modificaron contenido pÃºblico, markup server-rendered y CSS; no hay endpoints, secretos, dependencias, permisos, datos ni integraciones nuevas. `corepack pnpm audit --audit-level high` conserva Ãºnicamente las dos vulnerabilidades moderadas transitivas ya registradas, sin hallazgos high/critical.
- Operaciones: no se desplegÃ³, migrÃ³, modificaron datos, leyeron secretos ni hicieron commits. Rollback: restaurar `page.tsx`, `globals.css`, `academy.ts` y sus contratos de prueba; no requiere migraciÃ³n ni backup.

### Responsive admin navigation drawer - 2026-08-12

- ImplementaciÃ³n: `AdminShell` conserva un sidebar desktop y aÃ±ade un drawer mÃ³vil con el logo
  oficial, secciÃ³n activa, botÃ³n de cierre, backdrop, `Escape`, cierre al seleccionar una ruta,
  `aria-expanded`, `aria-controls`, `aria-modal` y foco restaurado al control invocador. La
  navegaciÃ³n reutiliza los mismos `next/link` y permanece separada semÃ¡nticamente por viewport.
- Responsive/a11y: el sidebar desaparece bajo `48rem`; el drawer queda fijo bajo el header, con
  targets mÃ­nimos de `44px`, foco visible, `overflow-x: clip` heredado y reduced motion existente.
  El backdrop usa el nombre accesible distinto `Dismiss admin navigation` para evitar controles
  ambiguos.
- TDD/QA: regresiÃ³n inicial detectÃ³ dos fallos reales: foco automÃ¡tico en el montaje inicial y
  consulta ambigua de tres botones de cierre. CorrecciÃ³n mÃ­nima aplicada; focused
  `corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/layout.test.tsx`
  -> `2 archivos, 10/10`; suite completa `corepack pnpm test:unit` -> `56 archivos, 386/386`.
- Gates: `corepack pnpm typecheck` -> exit 0; `corepack pnpm format:check` -> exit 0; build web
  normal -> exit 0; ESLint especÃ­fico de los archivos TypeScript modificados -> exit 0. El lint
  global inspecciona ademÃ¡s un worktree ajeno (`.worktrees/admin-access-requests`) y falla por
  una advertencia preexistente fuera de este cambio; no se modificÃ³ ese worktree.
- Browser QA: build sintÃ©tico explÃ­cito con `NEXT_PUBLIC_ADMIN_E2E=true` y
  `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-shell.spec.ts --project=desktop-chromium --project=mobile-chromium`
  -> `3/3` ejecutables aprobados y `1` omitido por ser caso mÃ³vil en desktop. Verifica sidebar,
  drawer/logo/backdrop, `Escape`, foco skip-link, selecciÃ³n de Members, URL destino, overflow y
  ausencia de errores de consola. El harness estÃ¡tico conserva `adminTestRole` en rutas admin;
  no se alterÃ³ la protecciÃ³n de producciÃ³n.
- Seguridad: no se aÃ±adieron endpoints, secretos, PII real, acceso directo a Firestore ni
  dependencias. `corepack pnpm audit --audit-level high` conserva Ãºnicamente las 2 vulnerabilidades
  moderadas transitivas ya registradas, sin high/critical. No se versionaron PDFs ni artefactos QA.
- Estado: Task 2 queda en `revisiÃ³n` hasta aprobaciÃ³n explÃ­cita del operador. No se hicieron
  commits, push, despliegues, migraciones ni importaciones reales.

### Task 3 - ValidaciÃ³n de lote PDF real - 2026-08-12

- Discovery externo no versionado: se inspeccionaron los ocho PDFs en
  `F:\Proyectos\BPT Jersey\Varios` con `pdf-parse`; no se copiaron archivos, filas, nombres,
  campos, cookies ni credenciales al repositorio o a los logs. La extracciÃ³n inicial mostrÃ³ que
  el texto concatena columnas por coordenadas y elimina celdas vacÃ­as.
- CorrecciÃ³n TDD: prueba roja en `member-pdf-text.test.ts` por mÃ³dulo ausente; implementaciÃ³n
  mÃ­nima de `formatMemberPdfTextItems` que reconstruye las seis/siete columnas por anclas X y
  conserva vacÃ­os. RegresiÃ³n sintÃ©tica del layout -> `1/1`; parser existente + tÃ­tulos operativos
  -> `16/16`.
- Contrato observado: tÃ­tulos reales incluyen `ACTIVE MEMBERS`, `ATLETAS ATIVOS REGULARIZADOS`,
  `ATLETAS ATIVOS COM NÃšMERO DE SÃ“CIO`, `ATLETAS ATIVOS SEM NÃšMERO DE SÃ“CIO`, `INACTIVE MEMBERS`,
  `ATLETAS REGULARIZADOS`, `SUSPENSOS` y `TOTAL DE ATLETAS NA BASE DE DADOS`; algunos tÃ­tulos
  portugueses usan el encabezado inglÃ©s exportado. La allowlist de esa combinaciÃ³n quedÃ³ limitada
  a los tÃ­tulos observados y no relaja los tÃ­tulos histÃ³ricos genÃ©ricos.
- Preview local agregado, sin confirmaciÃ³n: 8/8 reportes parseados; pÃ¡ginas por archivo
  `3,3,1,4,3,3,1,7`; filas declaradas/parseadas `115/115`, `97/97`, `27/27`, `128/128`,
  `88/88`, `98/98`, `1/1`, `243/243`; total fuente `797`; resultado deduplicado `243`;
  duplicados `553`; conflictos `1`; filas sin nÃºmero de socio en el resultado deduplicado `96`.
- Seguridad: la extracciÃ³n permanece detrÃ¡s del callable autenticado existente, con validaciÃ³n de
  bytes PDF, lÃ­mites de filas y preview explÃ­cito; no se aÃ±aden endpoints, secretos, logs de PII,
  acceso directo browser-Firestore ni escritura automÃ¡tica. No se confirmÃ³ el lote, no se ejecutÃ³
  Firestore ni se tocÃ³ R2 real.
- QA del cambio: `corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-text.test.ts apps/functions/src/members/member-pdf-import.test.ts`
  -> `2 archivos, 16/16`; `corepack pnpm --filter @bpt-jersey/functions typecheck` -> exit 0;
  `corepack pnpm --filter @bpt-jersey/functions build` -> exit 0; ESLint especÃ­fico -> exit 0.
- Estado: parser/layout en `revisiÃ³n`; la confirmaciÃ³n de importaciÃ³n queda bloqueada hasta que el
  operador revise los agregados y el conflicto del preview, conforme al flujo aprobado. No se
  hicieron commits, push, despliegues, migraciones ni escrituras de datos.

#### ResoluciÃ³n aprobada de estado - 2026-08-12

- DecisiÃ³n del operador: el solapamiento de estado se resuelve con `suspended` prevaleciendo sobre
  `active`. La regla queda limitada a `membershipStatus`; discrepancias de identidad o campos
  personales continÃºan bloqueando la importaciÃ³n.
- TDD: prueba roja para la precedencia `active`/`suspended`; implementaciÃ³n mÃ­nima en
  `deduplicateMemberRows`; prueba verde `apps/functions/src/members/member-pdf-import.test.ts`
  -> `17/17`.
- Preview real regenerado sin PII: 8 reportes, `797` filas fuente, `243` canÃ³nicos, `554`
  duplicados, `0` conflictos, `96` sin nÃºmero de socio; estados finales `active=114`,
  `inactive=128`, `suspended=1`.
- QA: focused backend `5 archivos, 99/99`; suite global controlada
  `corepack pnpm exec vitest run --project web --project node --maxWorkers=1` -> `57 archivos,
389/389`; typecheck Functions y build Functions pasan; ESLint especÃ­fico pasa; audit mantiene
  solo las dos vulnerabilidades moderadas transitivas registradas.
- Hallazgo de entorno: la corrida paralela estÃ¡ndar tuvo timeout de workers y 11 errores no
  controlados; la repeticiÃ³n con un worker pasÃ³ completa. No se cambiÃ³ configuraciÃ³n ni se
  atribuyÃ³ el timeout al cÃ³digo.
- ProducciÃ³n: continÃºa bloqueada por el gate operativo: falta referencia verificable de backup
  reciente, restauraciÃ³n probada y `projectId` exacto. No se ejecutÃ³ callable real, confirmaciÃ³n,
  escritura Firestore, R2, despliegue ni migraciÃ³n.

### Real Member PDF Import - Task 4 - 2026-08-12

- Estado: `revisiÃ³n`; no se marca aprobada ni desplegada. La migraciÃ³n YAML queda en
  `status: dry-run-passed`; no afirma aplicaciÃ³n live.
- Seguridad: guards exactos para `staging/bptjersey-f5a25/demo-academy`, rechazo explÃ­cito de
  producciÃ³n/emulador en CLI, lÃ­mite de PDF de 10 MiB, lÃ­mites de filas/escrituras, validaciÃ³n de
  `importRunId`, tenant scope e idempotencia; rollback probado como planner-only y sin borrado.
  No se observaron hallazgos crÃ­ticos/high en los archivos revisados.
- Scan de artefactos: `glob **/*.pdf` y `glob **/*receipt*.json` dentro del checkout -> ningÃºn
  resultado. No se copiaron PDFs ni se persistiÃ³ receipt. `.env.example` y `apps/web/.env.local`
  existen, pero no fueron leÃ­dos; no hay secretos encontrados en runner, CLI o YAML. Los valores
  PII de tests son sintÃ©ticos y permanecen en fixtures/contratos de prueba.
- Unitarias: `corepack pnpm test` -> `59` archivos, `427/427` pruebas; warnings no fatales de
  `DEP0190` y sourcemaps temporales faltantes del fixture de deploy.
- Rules: `corepack pnpm test:rules` -> `4` archivos, `9/9`; solo emuladores demo y denegaciones
  esperadas en stderr.
- IntegraciÃ³n: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore
"node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts
qa/integration/member-pdf-import.test.ts"` -> `1` archivo, `6/6`; `MetadataLookupWarning` no fatal.
- Gates tÃ©cnicos: `corepack pnpm typecheck` -> exit 0; `corepack pnpm format:check` -> exit 0;
  `corepack pnpm build` -> Functions y Next exit 0. `corepack pnpm lint` -> exit 1 Ãºnicamente por
  warning preexistente en `.worktrees/admin-access-requests/.../admin-shell.tsx`, fuera de este cambio.
- Audit: `corepack pnpm audit --audit-level high` -> `2` vulnerabilidades moderadas conocidas,
  ninguna high/critical; permanecen en el registro existente.
- Browser: build sintÃ©tico con `NEXT_PUBLIC_ADMIN_E2E=true` + `corepack pnpm --dir qa test:e2e:smoke`
  -> `5/5` ejecutables, `1` omitido esperado; luego build normal restaurado y verificado. No hubo
  sesiÃ³n Auth live ni lectura live del panel.
- Dry-run real: CLI `--dry-run` contra la fuente aprobada -> `8` reportes, `797` filas fuente,
  `243` canÃ³nicos, `554` duplicados, `0` conflictos, `96` sin nÃºmero, estados `114/128/1`, hash
  `aa9340de9528c2a46f898667fe3e554beabbdba6b8c03ec02b8b757f0ab2fc4f`; coincidiÃ³ con YAML. No se
  usÃ³ `--confirm`, `--yes-confirm-staging`, Admin, Firestore staging ni producciÃ³n.
- VerificaciÃ³n final: rollback planner focused -> `1/1`; `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev'
diff --check` -> sin salida. No se modificÃ³ Git/configuraciÃ³n ni se hizo commit.
- Formato documental: `corepack pnpm exec prettier --check tasks.md
docs/data/migrations/member-pdf-import-run-2026-08-12.yaml
.superpowers/sdd/2026-08-12-real-member-pdf-import/task-4-report.md` -> warning histÃ³rico en
  `tasks.md`; no se reformateÃ³ el ledger completo para evitar cambios fuera de alcance.
- Gates residuales: backup staging verificado, restauraciÃ³n probada, confirmaciÃ³n explÃ­cita y
  cualquier staging apply/verification siguen pendientes; no ejecutar en esta tarea.

### T083 - Regyfit IBJJF Levels - 2026-08-18

- Alcance aprobado: inspeccionar en modo estrictamente read-only la jerarquÃ­a completa
  `Levels: JIU-JITSU - IBJJF`, incluyendo cada belt, sus stripes/niveles hijos, orden, edades,
  clases mÃ­nimas, dÃ­as mÃ­nimos y demÃ¡s caracterÃ­sticas observables; despuÃ©s recrear esa
  capacidad como una secciÃ³n nueva de BPT Jersey.
- Fuente funcional: los dos DOCX indicados por el operador continÃºan como ley funcional; Regyfit
  se usa Ãºnicamente para relevar la estructura detallada de niveles que los documentos no
  enumeran por completo.
- Seguridad: no se leerÃ¡n ni registrarÃ¡n credenciales, tokens, cookies, storage, datos de miembros
  ni valores personales. No se pulsarÃ¡n acciones de crear, editar, copiar, ordenar o eliminar.
- Tooling inicial, resuelto despuÃ©s: antes del cambio, `opencode mcp list` reportÃ³
  `playwright disabled`; la
  presencia del token de extensiÃ³n se comprobÃ³ sin mostrar ni leer su valor. Tras habilitar el
  servidor, un proceso nuevo de `opencode mcp list` reportÃ³ `playwright connected`. La sesiÃ³n
  activa en ese checkpoint todavÃ­a debÃ­a reiniciarse para incorporar las herramientas MCP y listar
  sus targets.
- QA inicial de configuraciÃ³n y ledger: `node --check Lista/Lista.js` -> exit 0; Prettier de
  `opencode.json` y `Lista/Lista.js` -> aprobado; VM de la lista -> 84 entradas/84 IDs Ãºnicos,
  `T083=bloqueada` en ese checkpoint histÃ³rico, fuente `tasks.md` y corte `2026-08-18`; parseo de
  `opencode.json` -> aprobado;
  `git diff --check` sobre los tres archivos -> salida vacÃ­a.
- DiagnÃ³stico de sesiÃ³n: despuÃ©s del primer reinicio, `playwright_browser_tabs` devolviÃ³ Ãºnicamente
  `about:blank`, sin el target autenticado de Regyfit. `npx @playwright/mcp@latest --help`
  confirmÃ³ que la conexiÃ³n a Chrome/Edge existente requiere `--extension`; se aÃ±adiÃ³ esa opciÃ³n a
  `opencode.json`. El hallazgo es de configuraciÃ³n, no de la sesiÃ³n Regyfit, y requiere recargar
  OpenCode antes de repetir el handshake.
- Incidente de credencial temporal: el primer listado de targets en modo extensiÃ³n incluyÃ³ el token
  efÃ­mero de control dentro de la URL de la pÃ¡gina de conexiÃ³n. Se detuvo la inspecciÃ³n antes de
  leer Regyfit, el operador desconectÃ³/reconectÃ³ la extensiÃ³n y rotÃ³ el token. NingÃºn valor se
  repitiÃ³ ni persistiÃ³ en el repositorio; el token anterior debe considerarse revocado.
- Handshake posterior a la rotaciÃ³n: `playwright_browser_find` localizÃ³ exactamente
  `Levels: JIU-JITSU - IBJJF` en el tabpanel `Levels`, sin enumerar URLs de conexiÃ³n ni ejecutar
  acciones mutantes. `T083` pasa a `en-progreso` para el inventario read-only.
- Discovery estructural: el DOM ya contenÃ­a toda la jerarquÃ­a, por lo que no fue necesario pulsar
  controles de expandir. Se identificaron 27 belts raÃ­z y 144 stripes hijos mediante texto y clases
  de relaciÃ³n; el editor de un nivel se abriÃ³ una vez en modo lectura y no se guardÃ³ ningÃºn cambio.
- Discovery de caracterÃ­sticas: el endpoint oficial read-only
  `GET /php8/admin/modulos/graduacoes/criar_nivel.php` se consultÃ³ con concurrencia mÃ¡xima 4 y
  devolviÃ³ Ãºnicamente criterios, paleta, stripe visual y habilidades seleccionadas. No se
  conservaron HTML, inputs ocultos, cÃ³digos de acciÃ³n, cookies, tokens ni datos personales.
- VerificaciÃ³n independiente: cuatro lotes de `43/43/43/42` suman 171 registros, con 27 parents,
  144 children, 0 IDs duplicados, 0 huÃ©rfanos y 0 errores materializados. Hay 15 niveles con
  habilidades, 11 habilidades Ãºnicas y 165 requisitos: rating 2 en 15 casos y rating 3 en 150.
- Discrepancias pendientes de decisiÃ³n: White adulto exige 2 meses + 30 dÃ­as en el parent, pero 2
  meses + 15 dÃ­as y una paleta distinta en sus cuatro stripes; `GREY AND WHITE BELT 7-8 and 8-10`
  limita parent e hijos a edad mÃ¡xima 8; White 4-7 no declara edad mÃ­nima; varios stripes White
  infantiles dejan de heredar habilidades a partir del quinto. Ninguna discrepancia se corrige por
  inferencia antes de confirmar la precedencia entre DOCX y Regyfit.
- Decisiones del operador: los DOCX prevalecen para edades, clases y tiempo; Regyfit aporta
  jerarquÃ­a, orden, colores y habilidades. A los 12 aÃ±os, Kids o Teens se asigna por head coach y
  Teens es la sugerencia. Los requisitos tÃ©cnicos se acumulan y las promociones nunca son
  automÃ¡ticas.
- Contrato aprobado: `BRIEF.md` consolida fuentes, catÃ¡logo y alcance del piloto; `STACK.md`
  documenta arquitectura, rutas, colecciones, versionado, permisos, fases, QA y gates de seguridad
  de Levels sin crear una especificaciÃ³n paralela.
- Inventario canÃ³nico: `docs/data/ibjjf-levels-observed.sanitized.json` contiene 171 definiciones,
  27 belts, 144 stripes y 11 habilidades, sin IDs Regyfit ni datos de sesiÃ³n. ValidaciÃ³n local: 0
  keys duplicadas, 0 huÃ©rfanos y hash de contenido
  `9b039b795f8178c42730ff567ef9283fb385895368115ac2621ce816a829835a` verificado. Los cuatro lotes
  temporales se eliminaron despuÃ©s de consolidar este Ãºnico artefacto.
- ProtecciÃ³n local: `.firebase-config/`, `.firebase-emulators/`, `.playwright-browsers/` y
  `.playwright-mcp/` quedaron ignorados sin inspeccionar su contenido, para impedir que estado de
  herramientas, binarios o una sesiÃ³n del navegador entren por accidente al repositorio.
- QA documental fresca: `node --check Lista/Lista.js` -> exit 0; VM del ledger -> 84 tareas, 84 IDs
  Ãºnicos, estados sincronizados, `T083=en-progreso` y separaciÃ³n de track roadmap/MVP; Prettier de
  `Lista/Lista.js`, `opencode.json` y el inventario -> aprobado; parseo de `opencode.json` ->
  aprobado; `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check` -> salida vacÃ­a.
- QA del inventario fresca: 171 definiciones, 27 belts, 144 stripes, 11 habilidades, 0 keys
  duplicadas y 0 huÃ©rfanos; SHA-256 recalculado sobre el payload sin `contentHash` coincide con
  `9b039b795f8178c42730ff567ef9283fb385895368115ac2621ce816a829835a`; `mutationsPerformed=false`.
- Seguridad documental: el escaneo de los archivos entregables no encontrÃ³ claves privadas, API
  keys, credenciales ni valores de token/cookie/password. No se ejecutaron mutaciones, migraciones,
  despliegues ni pruebas contra producciÃ³n.
- Estado vigente: `pendiente` para P5. El handshake, discovery, precedencia, inventario y diseÃ±o
  estÃ¡n cerrados; la guarda crÃ­tica `T084` ya no bloquea y Levels espera identidad/tatami canÃ³nicos.

### Evidencia de implementaciÃ³n T083 (2026-08-23)

- **Alcance e ImplementaciÃ³n:** RecreaciÃ³n e integraciÃ³n canÃ³nica completa del catÃ¡logo de niveles IBJJF como capacidad MVP obligatoria, segÃºn el plan maestro `docs/superpowers/plans/2026-08-19-t083-levels-catalog.md` y `implementation_plan.md` aprobado.
- **Inventario CanÃ³nico:** Exactamente 171 definiciones de nivel (27 belts, 144 stripes), 11 habilidades evaluadas y 165 requisitos de habilidades, unificando la precedencia de criterios DOCX (`ibjjf-levels-business-criteria.sanitized.json`) y la jerarquÃ­a/visuales observadas (`ibjjf-levels-observed.sanitized.json`).
- **Contratos de Dominio:** `packages/domain/src/levels/level-contracts.ts` con tipado inmutable y parsers exactos `parseLevelCatalogSource` y `parseLevelCatalogProjection`. Exportado en `./levels`. Pruebas unitarias de dominio `9/9` y contratos globales `11/11`.
- **Servicio y Persistencia Firestore:** `apps/functions/src/levels/` (`level-source.ts`, `level-service.ts`, `level-seed.ts`, `level-callables.ts`) implementando hash determinista SHA-256 (`sourceHash`), almacenamiento idempotente en `academies/{academyId}/levelSystems`, `levelDefinitions` y `levelRequirements`, guards anti-producciÃ³n y script CLI `seed-levels.mjs`.
- **IntegraciÃ³n Firestore Emulator:** `qa/integration/level-catalog.test.ts` verificado en emulador local (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`), comprobando seed, idempotencia por hash, consulta y rollback completo de versiÃ³n sin tocar otras academias.
- **LÃ­mites de Seguridad y Firestore Rules:** `firestore.rules` deniega acceso directo de clientes a colecciones de levels (`levelSystems`, `levelDefinitions`, `levelRequirements`). Verificado en `qa/rules/level-catalog-boundary.test.ts` con `56/56` pruebas pasando en 7 suites de reglas.
- **Acceso por Rol y Callable Protegido:** Callable `listLevelCatalog` con aislamiento estricto por tenant `actor.academyId` y allowlist de roles (`owner`, `administrator`, `headCoach`, `coach`, `guardian`, `adultStudent`).
- **Superficies UI (3 Vistas Distintas):**
  - Admin: `/admin/levels` con badge de mÃ©tricas, filtrado por tipo (All/Belts/Stripes), bÃºsqueda y tarjetas visuales SVG; enlace aÃ±adido a `AdminShell`.
  - Coach: `/coach/levels` protegido por `StaffAuthGate` para instructores.
  - Client / Alumnos: `/account/progress` protegido por `ClientAuthGate` con enlace directo desde `/account`.
  - Componente compartido `LevelsBrowser` accesible, responsive y sin controles de mutaciÃ³n/promociÃ³n prematura.
- **Pruebas E2E Playwright:** `qa/tests/levels-catalog.spec.ts` pasando `6/6` (desktop-chromium y mobile-chromium) sin console errors, sin page errors ni desbordamiento horizontal.
- **Quality Gates Completos:**
  - `corepack pnpm test:unit` -> 101 archivos, 739 pruebas pasadas limpiamente (exit 0).
  - `corepack pnpm test:rules` -> 7 archivos, 56 pruebas pasadas en Firebase Emulator (exit 0).
  - `corepack pnpm typecheck` -> 6/6 paquetes del workspace limpios (exit 0).
  - `corepack pnpm lint` -> 0 errores, 0 warnings (exit 0).
  - `corepack pnpm format:check` -> Todos los archivos cumplen con Prettier (exit 0).
  - `corepack pnpm audit --audit-level high` -> 0 vulnerabilidades high/critical (2 moderadas transitivas conocidas DR-001).
  - `git diff --check` -> Salida vacÃ­a, sin trailing whitespace ni errores de formato.
- **Estado de ProducciÃ³n:** Sin despliegue a producciÃ³n, sin migraciones productivas, sin APIs de pago nuevas. T083 pasa a estado `revisiÃ³n` para aprobaciÃ³n formal del operador.

### T085 - Dependencia y formatter - 2026-08-18

- RED reproducible: `corepack pnpm audit --audit-level high` reportÃ³ `nanoid@3.3.17` con severidad
  high (`GHSA-2v37-7h3g-55p8`) a travÃ©s de `postcss@8.5.23`; `corepack pnpm format:check` fallÃ³ en
  nueve JSON generados bajo `apps/graphify-out/cache`.
- Causa raÃ­z: `postcss` permite `nanoid ^3.3.16`, pero el lockfile conservaba `3.3.17`; pnpm 11 ya
  no lee `package.json#pnpm.overrides`. El primer intento se descartÃ³ al emitir pnpm esa advertencia,
  sin presentarlo como soluciÃ³n.
- CorrecciÃ³n mÃ­nima: override `nanoid: 3.3.18` en `pnpm-workspace.yaml`, lockfile regenerado y
  `**/graphify-out/` en `.prettierignore`. No se formatearon, borraron ni versionaron los grafos.
- GREEN: `corepack pnpm why nanoid` muestra una Ãºnica versiÃ³n `3.3.18`; audit reporta solo las dos
  moderadas ya conocidas y 0 high/critical; `corepack pnpm format:check` pasa.
- Estado: `revisiÃ³n`. No cambiÃ³ cÃ³digo funcional, no hubo deploy/migraciÃ³n y `T084` retoma el WIP.

### T084 - Guarda emulator-only del importador PDF - 2026-08-18

- Riesgo corregido: `bptjersey-f5a25` dejÃ³ de ser el `approvedProjectId` de un target llamado
  staging. Runner, receipt, rollback planner y CLI aceptan solo `emulator`, `demo-bpt-jersey` y
  `demo-academy`; confirm exige `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` y
  `--yes-confirm-emulator`.
- Datos del piloto: el CLI ya no acepta `F:\Proyectos\BPT Jersey\Varios`; exige
  `%TEMP%\bpt-member-pdf-fixtures`, rechaza roots symlink/junction y solo documenta fixtures
  sintÃ©ticos. El YAML productivo de 2026-08-12 permanece intacto como evidencia no reutilizable.
- TDD RED 1: runner focused -> 2 fallos/25 pass porque producciÃ³n era aceptada y la guarda de host
  no distinguÃ­a dry-run/confirm. RED 2 -> 7 fallos/21 pass al exigir la fuente temporal en vez de la
  ruta real. RED 3 -> 1 fallo/28 pass al reproducir el bypass por junction.
- GREEN focused: runner `29/29`; parser/servicio `36/36`. La suite completa posterior al cambio de
  dependencias pasÃ³ con `59` archivos y `441/441` pruebas.
- Gates: Rules `4` archivos/`9/9`; lint, typecheck de 6 workspaces, build Functions/Next (19 rutas),
  `format:check`, `node --check qa/scripts/import-member-pdfs.mjs` y `git diff --check` aprobaron.
  Audit: 0 high/critical y 2 moderadas conocidas.
- Seguridad/operaciones: errores genÃ©ricos sin PII, guardas antes de receipt/PDF/Admin, proyecto
  demo de Firebase y host loopback exacto. No se leyÃ³ la fuente real, no se ejecutÃ³ dry-run/confirm,
  no se inicializÃ³ Admin, no hubo escritura, migraciÃ³n, deploy, gasto ni acceso productivo.
- Rollback: cambio solo de cÃ³digo/configuraciÃ³n; restaurar runner, script y runbook previos. No hay
  rollback de datos porque no se ejecutÃ³ ninguna importaciÃ³n.
- Estado: `revisiÃ³n`. P0 queda tÃ©cnicamente cerrado y P1 abre `T014` como Ãºnico WIP.

### T014 - Auth email/password y Google emulator-only, sin MFA - 2026-08-18

- RevalidaciÃ³n: ADR-005 y `STACK.md` excluyen MFA del piloto, pero el gateway activo todavÃ­a
  convertÃ­a `auth/multi-factor-auth-required` en `AdminMfaChallenge`. AdemÃ¡s, Google local exigÃ­a un
  `EmulatorAuthAdapter` que ninguna ruta registraba, aunque el Auth Emulator ofrece el flujo IdP
  interactivo del SDK.
- TDD RED: focused inicial -> `2` archivos, `3` fallos esperados y `9` pruebas aprobadas. Google
  fallÃ³ con `Firebase emulator auth adapter is not configured`; email y Google renderizaron
  `Verify your authenticator` en lugar del error genÃ©rico.
- GREEN: `signInWithGoogle()` usa `signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider())`
  despuÃ©s de la guarda local ya existente; `/login` eliminÃ³ estado/imports/render MFA y sanitiza
  todos los fallos mediante `toAuthMessage`. Focused final -> `6` archivos, `40/40`.
- IntegraciÃ³n Auth Emulator: proyecto `demo-bpt-jersey`, loopback `127.0.0.1:9099`, `1` archivo y
  `2/2`. Se verificÃ³ alta/logout/login email-password y credencial Google con token JSON sintÃ©tico;
  usuarios/app se limpiaron y los procesos del emulador cerraron correctamente.
- QA global: `corepack pnpm test:unit` -> `59` archivos, `442/442`; `test:rules` -> `4` archivos,
  `9/9`; lint y typecheck de 6 workspaces -> exit 0; build Functions/Next -> 19 rutas estÃ¡ticas;
  `format:check` y `git diff --check` -> aprobados.
- Browser QA: la primera invocaciÃ³n incluÃ­a un `--` propagado al wrapper y ejecutÃ³ 51 tests sobre el
  build normal (`23` fallos administrativos esperables, `16` pass, `12` skip). `--list` confirmÃ³ la
  causa y el comando corregido seleccionÃ³ exactamente 8 casos: gateway desktop/Pixel 7 -> `8/8`;
  repeticiÃ³n `--repeat-each=5` -> `40/40`, sin consola, page errors u overflow.
- Seguridad: selector Administrator/Client sigue siendo solo contexto UX; `/admin` conserva claims
  - `academyId`; no existe registro admin. Sin endpoint, secreto, storage de resolver/token, retries,
    escritura, migraciÃ³n o deploy nuevos. Audit: 0 high/critical y 2 moderadas transitivas conocidas.
- Pruebas avanzadas: contrato SDK + emulador y casos de entorno/error aplicaron y pasaron. Carga no
  aplica a esta correcciÃ³n de boundary sin endpoint propio ni release; el flujo MFA histÃ³rico de
  `T017` permanece aislado y fuera de CI, no como evidencia del piloto.
- Rollback: restaurar `firebase-client.ts`, `login-form.tsx` y sus pruebas; no existe rollback de
  datos porque solo se usaron identidades sintÃ©ticas eliminadas del Auth Emulator.
- Estado: `revisiÃ³n`. `T014` queda tÃ©cnicamente cerrado; el siguiente WIP de P1 es revalidar `T015`
  contra la matriz completa de roles del MVP.

### P1 / T015 - Contrato de claims para los seis roles con mÃ­nimo privilegio

**Objetivo:** definir un contrato estricto y reutilizable para claims `academyId + role` de los seis
actores autenticados del MVP, conservando `owner`/`administrator` como Ãºnico subconjunto
administrativo. Esta tarea no concede roles desde el navegador ni crea provisioning prematuro para
coaches, tutores o adultos sin sus perfiles, relaciones y asignaciones canÃ³nicas.

**DecisiÃ³n aprobada por el operador el 2026-08-18:** las claims reconocen `owner`, `administrator`,
`headCoach`, `coach`, `guardian` y `adultStudent`. El provisioning existente continÃºa limitado a
owner/administrator; `T021`, `T022` y `T025` emitirÃ¡n los demÃ¡s roles cuando exista la evidencia de
perfil, relaciÃ³n familiar o asignaciÃ³n correspondiente.

**Archivos:**

- Modificar: `packages/domain/src/auth/admin-contracts.test.ts`
- Modificar: `packages/domain/src/auth/admin-contracts.ts`
- Modificar: `packages/domain/src/index.ts`
- Modificar: `apps/functions/src/auth/admin-authorization.ts`
- Modificar: `apps/functions/src/auth/admin-authorization.test.ts`
- Modificar: `apps/functions/src/auth/admin-provisioning.test.ts`
- Modificar al cerrar: `tasks.md` y `Lista/Lista.js`

**Interfaces que produce y conserva:**

```ts
type UserClaims = Readonly<{
  academyId: AcademyId;
  role: UserRole;
}>;

type AdminClaims = Readonly<{
  academyId: AcademyId;
  role: AdminRole;
}>;

function parseUserClaims(value: unknown): Result<UserClaims, ValidationIssue[]>;
function parseAdminClaims(value: unknown): Result<AdminClaims, ValidationIssue[]>;
```

`parseUserClaims` acepta exactamente `academyId` y `role`, rechaza campos propios/no enumerables
desconocidos y devuelve un valor congelado. `parseAdminClaims` reutiliza ese contrato y luego exige
`owner | administrator`; reconocer un rol nunca concede permisos por sÃ­ mismo. Las relaciones,
asignaciones, estado activo y propÃ³sito continÃºan siendo fronteras de sus mÃ³dulos propietarios.

- [x] **Paso 1 - RED: expresar el contrato exhaustivo de claims**

En `admin-contracts.test.ts`, importar `parseUserClaims` y aÃ±adir:

```ts
it("parses every academy-scoped MVP user role without granting admin access", () => {
  for (const role of userRoles) {
    const result = parseUserClaims({ academyId: "academy-demo", role });

    expect(result).toEqual({
      ok: true,
      value: { academyId: "academy-demo", role },
    });
    expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
  }

  for (const role of ["headCoach", "coach", "guardian", "adultStudent"] as const) {
    expect(parseAdminClaims({ academyId: "academy-demo", role }).ok).toBe(false);
  }
});

it("rejects malformed user claims and unknown fields", () => {
  expect(parseUserClaims({ academyId: "academy-demo", role: "minor" }).ok).toBe(false);
  expect(parseUserClaims({ academyId: " ", role: "guardian" }).ok).toBe(false);
  expect(
    parseUserClaims({ academyId: "academy-demo", role: "guardian", familyId: "family-1" }).ok,
  ).toBe(false);
});
```

- [x] **Paso 2 - verificar RED**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/auth/admin-contracts.test.ts
```

Resultado esperado: falla porque `parseUserClaims`/`UserClaims` todavÃ­a no existen.

Resultado real 2026-08-18: `1` archivo, `2` fallos esperados y `5` pruebas aprobadas. Ambos casos
fallaron con `parseUserClaims is not a function`; los contratos administrativos existentes
permanecieron verdes.

- [x] **Paso 3 - GREEN: implementar parser genÃ©rico y narrowing administrativo**

En `admin-contracts.ts`, validar con `Reflect.ownKeys`, `userRoles` y errores estructurados. El parser
administrativo consume el resultado genÃ©rico y aplica Ãºnicamente el narrowing:

```ts
export function parseAdminClaims(value: unknown): Result<AdminClaims, ValidationIssue[]> {
  const claims = parseUserClaims(value);
  if (!claims.ok) return claims;
  if (!administrativeRoles.includes(claims.value.role as AdminRole)) {
    return err([issue(["role"], "ADMIN_ROLE_INVALID")]);
  }

  return ok(
    Object.freeze({
      academyId: claims.value.academyId,
      role: claims.value.role as AdminRole,
    }),
  );
}
```

Exportar `parseUserClaims` y `UserClaims` desde `packages/domain/src/index.ts`. No modificar
`provisionAdminRoleWithServices`, `adminRoleSchema` ni el frontend: sus lÃ­mites owner/admin son
deliberados y deben seguir fail-closed.

- [x] **Paso 4 - verificar GREEN focused**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/auth/admin-contracts.test.ts packages/domain/src/contracts.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts
```

Resultado esperado: contrato genÃ©rico, exports, narrowing admin y provisioning pasan sin ampliar
autoridad.

Resultado real 2026-08-18: parser directo + entrypoint pÃºblico -> `2` archivos, `14/14`. El export
pÃºblico tuvo un RED separado (`parseUserClaims is not a function`) antes de restaurarse. Focused
completo posterior -> `4` archivos, `50/50`.

- [x] **Paso 5 - reforzar las pruebas negativas de elevaciÃ³n**

En `admin-authorization.test.ts`, comprobar que `requireAdminActor` rechaza por
`permission-denied` cada rol no administrativo. En `admin-provisioning.test.ts`, convertir el caso
aislado de `coach` en una tabla para `headCoach`, `coach`, `guardian` y `adultStudent`, verificando
que ninguna entrada llega a `setCustomUserClaims` ni persiste usuario/auditorÃ­a.

```ts
for (const role of ["headCoach", "coach", "guardian", "adultStudent"] as const) {
  expect(() =>
    requireAdminActor(requestWithAuth(`${role}-1`, { academyId: "academy-1", role })),
  ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
}
```

- [x] **Paso 6 - gates tÃ©cnicos, de seguridad y regresiÃ³n**

```powershell
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --audit-level high
corepack pnpm format:check
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

Revisar que solo Admin SDK/backend pueda escribir custom claims, que el selector visual no aparezca
en ningÃºn contrato de autoridad, que roles no administrativos sigan fuera de `AdminGate` y que no se
registren tokens/claims completos. No ejecutar provisioning, migraciÃ³n ni deploy.

- [x] **Paso 7 - autocrÃ­tica y cierre del WIP**

Registrar RED/GREEN/gates y la limitaciÃ³n intencional de lifecycle: `T021/T022/T025` siguen siendo
propietarias de emisiÃ³n/desactivaciÃ³n de roles no administrativos basada en datos canÃ³nicos. Si el
loop pasa, cambiar `T015` a `revisiÃ³n`, sincronizar `Lista/Lista.js` y abrir `T016` como siguiente WIP.
No hacer commit sin pedido explÃ­cito.

#### Evidencia de implementaciÃ³n T015 (2026-08-19)

- DecisiÃ³n humana: opciÃ³n 1 aprobada; claims reconoce `owner`, `administrator`, `headCoach`, `coach`,
  `guardian` y `adultStudent`, pero provisioning continÃºa limitado a owner/admin y los roles restantes
  solo podrÃ¡n emitirse desde `T021`, `T022` y `T025` con datos canÃ³nicos.
- RED del contrato: `admin-contracts.test.ts` fallÃ³ `2/7` antes de existir el parser; el RED
  independiente del entrypoint pÃºblico fallÃ³ con `parseUserClaims is not a function`.
- GREEN focused inicial: los cuatro archivos de contrato, autorizaciÃ³n y provisioning aprobaron
  `50/50`.
- AutocrÃ­tica de seguridad: la bÃºsqueda exhaustiva confirmÃ³ que `setCustomUserClaims()` solo aparece
  en provisioning backend y sus pruebas; roles no administrativos, claves desconocidas y claims
  exactas mantienen cobertura negativa.
- Hallazgo y reproducciÃ³n: provisioning preserva `mfaEnrolled` y `locale`, pero autorizaciÃ³n las
  rechazaba como custom claims desconocidas. El RED cruzado fallÃ³ `1/11` con
  `Administrative claims are required`; tras declarar solo esas dos claves como no autoritativas,
  autorizaciÃ³n y provisioning aprobaron `36/36`, incluido el rechazo de `tenantOverride`.
- Gates finales: unitarias `445/445`; Rules con emuladores demo `9/9`; lint, typecheck, build de 19
  rutas, formato y `git diff --check` aprobaron. Audit reportÃ³ 0 high/critical y las 2 moderadas
  transitivas ya conocidas.
- ClasificaciÃ³n: sin hallazgos crÃ­ticos o altos; no hubo migraciÃ³n, despliegue, operaciÃ³n productiva,
  gasto ni manejo de secretos. Carga y UI/E2E no aplican a esta frontera de contratos/autorizaciÃ³n.
- LimitaciÃ³n consciente: reconocer un rol no concede relaciones, asignaciones, propÃ³sito ni
  clasificaciÃ³n de datos; esas fronteras quedan para `T016`, y la emisiÃ³n de roles no administrativos
  permanece diferida a sus tareas de ciclo de vida.

### P1 / T016 - DiseÃ±o aprobado de autorizaciÃ³n backend y frontera Firebase

**Estado del diseÃ±o:** aprobado por el operador el 2026-08-19.

**Objetivo:** conservar Firestore y RTDB cerrados al SDK cliente y establecer una frontera backend
reutilizable que obligue a verificar tenant, actor activo, rol, propÃ³sito y alcance canÃ³nico antes de
cualquier acceso permitido. Esta tarea no habilita mÃ³dulos futuros ni convierte claims en permisos.

#### Decisiones aprobadas

- Firestore y RTDB mantienen `deny-by-default` total para acceso directo desde navegador, incluido
  owner y los datos propios de un usuario. Todo acceso permitido del MVP pasa por Cloud Functions.
- El cliente nunca envÃ­a roles, permisos, propÃ³sito autorizado ni hechos como `isGuardian` o
  `isAssigned`. Solo puede enviar identificadores de recursos previstos por el contrato; Functions
  valida la entrada, carga fuentes canÃ³nicas y construye los hechos de autorizaciÃ³n.
- Los servicios administrativos existentes no se amplÃ­an a roles no administrativos. La comprobaciÃ³n
  persistente de desactivaciÃ³n se conecta cuando `T025` implemente el lifecycle canÃ³nico; `T016`
  define y prueba el requisito sin inventar documentos ni estados.
- No se agregan colecciones, Ã­ndices, migraciones, datos persistentes ni excepciones positivas de
  Rules.
- `docs/data/firestore-data-model.md` conserva una frase obsoleta que permite `get` directo de
  Regyfit al owner. La implementaciÃ³n debe alinearla con la frontera Functions-only ya aplicada por
  Rules y aprobada en este diseÃ±o.

#### Arquitectura y componentes

- `packages/domain/src/authorization/access-policy.ts` serÃ¡ un evaluador puro y reutilizable. Define
  operaciones, clasificaciÃ³n, alcance requerido y decisiones tipadas `allow/deny`.
- Cada mÃ³dulo declara requisitos de acceso como constantes internas revisables; ninguna polÃ­tica se
  deriva de un payload del cliente. Los mÃ³dulos posteriores aportan sus permisos concretos y resolvers
  de fuentes canÃ³nicas conforme a la matriz de `T007`.
- El evaluador exige siempre coincidencia de `academyId`, actor activo y propÃ³sito no vacÃ­o definido
  por servidor. Cuando la polÃ­tica lo requiera, tambiÃ©n exige identidad propia, relaciÃ³n familiar
  vigente, asignaciÃ³n vigente o aprobaciÃ³n explÃ­cita.
- `apps/functions/src/auth/user-authorization.ts` extrae claims estrictas mediante el contrato de
  `T015` y construye un actor para los seis roles. `requireAdminActor()` conserva el narrowing
  `owner | administrator` y sus consumidores actuales siguen fail-closed.
- Las combinaciones no soportadas o sin evidencia suficiente se deniegan. El evaluador no consulta
  Firebase ni recibe objetos de SDK para que su polÃ­tica pueda probarse de forma determinista.

#### Flujo autorizado

1. Function autentica la solicitud y obtiene un `UserActor` desde claims exactas.
2. El handler valida identificadores y selecciona una polÃ­tica constante de su mÃ³dulo.
3. Un resolver backend carga el estado activo y, cuando corresponda, relaciÃ³n, asignaciÃ³n o evidencia
   de aprobaciÃ³n desde documentos canÃ³nicos del mismo tenant.
4. El handler construye hechos internos mÃ­nimos y llama al evaluador con un propÃ³sito constante de
   servidor.
5. Solo una decisiÃ³n `allow` permite continuar hacia Admin SDK; toda otra decisiÃ³n termina con
   `permission-denied` genÃ©rico.

#### Seguridad y errores

- Un cÃ³digo interno de denegaciÃ³n puede distinguir actor inactivo, tenant cruzado, propÃ³sito ausente,
  rol no permitido o alcance insuficiente para pruebas y observabilidad segura. Ese cÃ³digo no se
  devuelve al cliente ni autoriza registrar tokens, claims completos, relaciones o datos sensibles.
- El actor, la polÃ­tica y los hechos se tratan como valores inmutables. Las fechas de vigencia se
  evalÃºan contra un instante inyectado por servidor, no contra tiempo enviado por el cliente.
- Firestore prueba `get`, `list`, `create`, `update` y `delete` denegados en todas las colecciones
  canÃ³nicas para anÃ³nimo y los seis roles. RTDB prueba lectura y escritura denegadas en `presence`.
- La ausencia de una clÃ¡usula positiva de Rules es intencional: relaciÃ³n, asignaciÃ³n y propÃ³sito se
  evalÃºan en Functions, no se duplican parcialmente en Rules.

#### Estrategia de pruebas

- Unitarias de dominio: casos positivos sintÃ©ticos para alcance de academia, identidad propia,
  familia, asignaciÃ³n y aprobaciÃ³n; negativos para actor inactivo, tenant cruzado, propÃ³sito ausente,
  rol no permitido, relaciÃ³n expirada, asignaciÃ³n ajena y clasificaciÃ³n incompatible.
- Unitarias de Functions: anÃ³nimo, claims malformadas, claves extra/no enumerables, seis roles vÃ¡lidos
  y narrowing administrativo sin regresiÃ³n.
- Rules con emuladores demo: matriz negativa de todas las colecciones canÃ³nicas y RTDB, sin staging ni
  producciÃ³n y con fixtures sintÃ©ticos.
- Gates: focused RED/GREEN, suite unitaria completa, Rules, lint, typecheck, build, audit high, formato
  y `git diff --check`.

#### Fuera de alcance y rollback

- `T016` no implementa perfiles, relaciones, asignaciones, consentimientos, salud, documentos ni
  lifecycle de staff; esas responsabilidades permanecen en `T018` y `T021-T025`.
- No implementa permisos positivos de mÃ³dulos inexistentes, despliegues, migraciones, producciÃ³n,
  gasto, App Check ni cambios de retenciÃ³n/residencia bloqueados por `T011`.
- El rollback es textual: restaurar los contratos, adapters y pruebas anteriores. No requiere backup
  porque no se escriben ni transforman datos.

#### Criterio de aceptaciÃ³n

- NingÃºn rol ni usuario anÃ³nimo obtiene acceso directo por Firestore/RTDB.
- Los seis roles pueden convertirse en actores autenticados estrictos sin recibir autoridad implÃ­cita.
- El evaluador deniega por defecto y solo permite cuando polÃ­tica y hechos backend prueban tenant,
  actividad, propÃ³sito y alcance.
- Las pruebas negativas cubren colecciones canÃ³nicas, tenant, rol, relaciÃ³n y asignaciÃ³n; todos los
  gates pasan con evidencia real antes de mover `T016` a `revisiÃ³n`.

### P1 / T016 - Plan de implementaciÃ³n

> **Para ejecuciÃ³n agentic:** usar `subagent-driven-development` o `executing-plans` tarea por tarea.
> En esta sesiÃ³n la ejecuciÃ³n debe ser inline porque ya se alcanzÃ³ el mÃ¡ximo de subagentes. Cada paso
> usa checkboxes y conserva `T016` como Ãºnico WIP.

**Goal:** implementar una polÃ­tica de autorizaciÃ³n backend reutilizable para seis roles y demostrar
que ningÃºn cliente puede acceder directamente a datos canÃ³nicos de Firestore o RTDB.

**Architecture:** un evaluador puro en `packages/domain` recibe actor, requisito constante del mÃ³dulo,
recurso y hechos resueltos por backend. Un adapter de Functions convierte claims exactas en
`UserActorContext`; `requireAdminActor()` estrecha ese actor sin duplicar parsing. Firebase Rules no
obtiene permisos positivos y su matriz negativa se prueba exhaustivamente en emuladores demo.

**Tech Stack:** TypeScript, Vitest, Firebase Functions v2, Firebase Rules Unit Testing, Firestore y
Realtime Database Emulator.

#### Restricciones globales

- Firestore y RTDB permanecen cerrados al SDK cliente para anÃ³nimo y los seis roles.
- Claims, roles, propÃ³sitos, polÃ­ticas y hechos de autorizaciÃ³n nunca se aceptan desde el payload.
- Todo fallo es fail-closed; Functions solo expone `unauthenticated` o `permission-denied` genÃ©rico.
- No se crean perfiles, relaciones, asignaciones ni estados ficticios persistentes.
- No se agregan dependencias, colecciones, Ã­ndices, migraciones, secretos, despliegues ni operaciones
  sobre staging/producciÃ³n.
- Fixtures y emuladores usan exclusivamente datos sintÃ©ticos y el proyecto `demo-bpt-jersey`.
- Los permisos concretos de mÃ³dulos futuros permanecen en `T018` y `T021-T025`.
- No hacer commit, push o cambio de rama sin pedido explÃ­cito.

---

#### Task 1 - Evaluador puro de polÃ­tica y alcances

**Files:**

- Create: `packages/domain/src/authorization/access-policy.test.ts`
- Create: `packages/domain/src/authorization/access-policy.ts`
- Modify: `packages/domain/src/contracts.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.runtime.json`

**Interfaces:**

- Consumes: `UserActorContext`, `UserRole`, IDs branded y `Result` existentes.
- Produces:

```ts
type AccessOperation = "read" | "create" | "update" | "approve" | "export" | "delete";
type DataClassification = "Public" | "Internal" | "Confidential" | "Restricted";
type AccessScope = "academy" | "self" | "family" | "assignment" | "approval";

type AccessRequirement = Readonly<{
  operation: AccessOperation;
  classification: DataClassification;
  allowedRoles: readonly UserRole[];
  scope: AccessScope;
  purpose: string;
}>;

type AccessResource = Readonly<{
  resourceId: string;
  academyId: AcademyId;
  classification: DataClassification;
  subjectUserId?: UserId;
  familyId?: FamilyId;
  studentId?: StudentId;
  sessionId?: SessionId;
}>;

type ValidityWindow = Readonly<{ validFromMs: number; validToMs: number | null }>;
type FamilyAccessEvidence = ValidityWindow &
  Readonly<{
    status: "active" | "inactive";
    academyId: AcademyId;
    adultUserId: UserId;
    familyId: FamilyId;
    studentId: StudentId;
    operations: readonly AccessOperation[];
  }>;
type AssignmentAccessEvidence = ValidityWindow &
  Readonly<{
    status: "active" | "inactive";
    academyId: AcademyId;
    staffUserId: UserId;
    studentId?: StudentId;
    sessionId?: SessionId;
    operations: readonly AccessOperation[];
  }>;
type ApprovalAccessEvidence = ValidityWindow &
  Readonly<{
    status: "approved" | "pending" | "rejected";
    academyId: AcademyId;
    resourceId: string;
    operation: AccessOperation;
  }>;

type AccessFacts = Readonly<{
  actorActive: boolean;
  familyRelationship?: FamilyAccessEvidence;
  assignment?: AssignmentAccessEvidence;
  approval?: ApprovalAccessEvidence;
}>;

type AccessDenialReason =
  | "INVALID_CONTEXT"
  | "TENANT_MISMATCH"
  | "ACTOR_INACTIVE"
  | "PURPOSE_REQUIRED"
  | "ROLE_DENIED"
  | "CLASSIFICATION_MISMATCH"
  | "SELF_SCOPE_DENIED"
  | "FAMILY_SCOPE_DENIED"
  | "ASSIGNMENT_SCOPE_DENIED"
  | "APPROVAL_SCOPE_DENIED";

type AccessGrant = Readonly<{
  actor: UserActorContext;
  resourceId: string;
  operation: AccessOperation;
  classification: DataClassification;
  scope: AccessScope;
  purpose: string;
}>;

type AccessEvaluationInput = Readonly<{
  actor: UserActorContext;
  requirement: AccessRequirement;
  resource: AccessResource;
  facts: AccessFacts;
  nowMs: number;
}>;

function evaluateAccess(input: AccessEvaluationInput): Result<AccessGrant, AccessDenialReason>;
```

- [x] **Step 1 - escribir el RED del evaluador**

Crear factories tipadas e incluir ocho casos: academia, self, familia vigente, asignaciÃ³n vigente,
aprobaciÃ³n vigente, invariantes comunes, evidencia invÃ¡lida/expirada e inmutabilidad. El caso familiar
base debe ser equivalente a:

```ts
const result = evaluateAccess({
  actor: Object.freeze({
    kind: "user",
    academyId: "academy-1" as AcademyId,
    userId: "guardian-1" as UserId,
    role: "guardian",
  }),
  requirement: Object.freeze({
    operation: "read",
    classification: "Restricted",
    allowedRoles: Object.freeze(["guardian"] as const),
    scope: "family",
    purpose: "family profile access",
  }),
  resource: Object.freeze({
    resourceId: "student-1",
    academyId: "academy-1" as AcademyId,
    classification: "Restricted",
    familyId: "family-1" as FamilyId,
    studentId: "student-1" as StudentId,
  }),
  facts: Object.freeze({
    actorActive: true,
    familyRelationship: Object.freeze({
      status: "active",
      adultUserId: "guardian-1" as UserId,
      familyId: "family-1" as FamilyId,
      studentId: "student-1" as StudentId,
      operations: Object.freeze(["read"] as const),
      validFromMs: 100,
      validToMs: 300,
    }),
  }),
  nowMs: 200,
});

expect(result).toEqual({
  ok: true,
  value: {
    actor: expect.objectContaining({ userId: "guardian-1", role: "guardian" }),
    resourceId: "student-1",
    operation: "read",
    classification: "Restricted",
    scope: "family",
    purpose: "family profile access",
  },
});
expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
```

La tabla negativa debe comprobar cada `AccessDenialReason`, IDs familiares/asignados ajenos,
operaciÃ³n no incluida, `status` no activo/aprobado, `validFromMs > nowMs`, `validToMs <= nowMs`,
`nowMs` no finito y scope assignment sin `studentId` ni `sessionId`.

- [x] **Step 2 - ejecutar el RED**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/authorization/access-policy.test.ts packages/domain/src/contracts.test.ts
```

Expected: FAIL porque `authorization/access-policy` y sus exports todavÃ­a no existen; las pruebas
anteriores de `contracts.test.ts` permanecen verdes.

- [x] **Step 3 - implementar la decisiÃ³n mÃ­nima fail-closed**

Implementar primero las invariantes comunes en este orden: contexto numÃ©rico vÃ¡lido, tenant, actor
activo, propÃ³sito, rol y clasificaciÃ³n. DespuÃ©s resolver el scope con un `switch` exhaustivo:

```ts
export function evaluateAccess(
  input: AccessEvaluationInput,
): Result<AccessGrant, AccessDenialReason> {
  const { actor, requirement, resource, facts, nowMs } = input;
  if (!Number.isFinite(nowMs) || resource.resourceId.trim().length === 0) {
    return err("INVALID_CONTEXT");
  }
  if (actor.academyId !== resource.academyId) return err("TENANT_MISMATCH");
  if (!facts.actorActive) return err("ACTOR_INACTIVE");
  if (requirement.purpose.trim().length === 0) return err("PURPOSE_REQUIRED");
  if (!requirement.allowedRoles.includes(actor.role)) return err("ROLE_DENIED");
  if (requirement.classification !== resource.classification) {
    return err("CLASSIFICATION_MISMATCH");
  }

  const scopeAllowed = evaluateScope(input);
  if (!scopeAllowed.ok) return scopeAllowed;
  return ok(
    Object.freeze({
      actor,
      resourceId: resource.resourceId,
      operation: requirement.operation,
      classification: requirement.classification,
      scope: requirement.scope,
      purpose: requirement.purpose,
    }),
  );
}
```

`evaluateScope()` debe comparar `academyId` y todos los IDs aplicables, exigir la operaciÃ³n exacta y tratar la
ventana como `[validFromMs, validToMs)`. Scope `academy` no requiere evidencia adicional; `self`
exige `subjectUserId === actor.userId`; los otros scopes fallan con su razÃ³n especÃ­fica.

- [x] **Step 4 - publicar el contrato sin romper runtime**

Exportar constantes, funciÃ³n y tipos desde `packages/domain/src/index.ts`. AÃ±adir el subpath runtime:

```json
"./authorization/access-policy": {
  "types": "./src/authorization/access-policy.ts",
  "default": "./lib/authorization/access-policy.js"
}
```

En `contracts.test.ts`, importar desde el entrypoint pÃºblico y comprobar que `accessOperations`,
`dataClassifications`, `accessScopes`, `accessDenialReasons` y `evaluateAccess` existen y estÃ¡n
congelados cuando corresponda.

Incluir `src/authorization/access-policy.ts` en `tsconfig.runtime.json` para que el subpath default
exista en `lib` durante CI y el packaging de Functions.

- [x] **Step 5 - verificar GREEN focused**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/authorization/access-policy.test.ts packages/domain/src/contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
```

Expected: 2 archivos y 16 pruebas aprobadas; typecheck exit 0.

---

#### Task 2 - Adapter de actor para los seis roles y narrowing administrativo

**Files:**

- Create: `apps/functions/src/auth/user-authorization.test.ts`
- Create: `apps/functions/src/auth/user-authorization.ts`
- Modify: `apps/functions/src/auth/admin-authorization.ts`
- Verify: `apps/functions/src/auth/admin-authorization.test.ts`
- Verify: `apps/functions/src/auth/admin-provisioning.test.ts`

**Interfaces:**

- Consumes: `parseUserClaims()`, `parseAdminClaims()`, `evaluateAccess()`,
  `AccessEvaluationInput`, `AccessGrant`, `UserActorContext` y Firebase `CallableRequest`.
- Produces:

```ts
function requireUserActor(request: CallableRequest): UserActorContext;
function requireAuthorizedAccess(input: AccessEvaluationInput): AccessGrant;
```

- [x] **Step 1 - escribir el RED del adapter**

AÃ±adir ocho pruebas con request sintÃ©tico: anÃ³nimo, claims ausentes, los seis roles vÃ¡lidos y actor
congelado, claims estÃ¡ndar/perfil permitidas, clave custom desconocida y clave propia no enumerable.
AÃ±adir ademÃ¡s un grant vÃ¡lido y una denegaciÃ³n que demuestre que `requireAuthorizedAccess()` nunca
expone `AccessDenialReason`.
El contrato positivo debe iterar:

```ts
for (const role of userRoles) {
  const actor = requireUserActor(requestWithAuth(`${role}-1`, { academyId: "academy-1", role }));
  expect(actor).toEqual({
    kind: "user",
    userId: `${role}-1`,
    academyId: "academy-1",
    role,
  });
  expect(Object.isFrozen(actor)).toBe(true);
}
```

El caso de perfil permite Ãºnicamente claims estÃ¡ndar de Firebase mÃ¡s `mfaEnrolled` y `locale`; una
clave como `tenantOverride` debe producir `permission-denied`.

- [x] **Step 2 - ejecutar el RED**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/auth/user-authorization.test.ts apps/functions/src/auth/admin-authorization.test.ts
```

Expected: FAIL porque `requireUserActor` no existe; las 11 pruebas administrativas siguen mostrando
su estado independiente.

- [x] **Step 3 - extraer y validar claims una sola vez**

Mover la allowlist de token desde `admin-authorization.ts` a `user-authorization.ts` sin ampliarla.
Validar todas las keys con `Reflect.ownKeys`, proyectar solo `academyId + role`, usar
`parseUserClaims()` y devolver:

```ts
return Object.freeze({
  kind: "user" as const,
  userId: uid as UserId,
  academyId: claims.value.academyId,
  role: claims.value.role,
});
```

UID ausente produce `unauthenticated`; token o claims invÃ¡lidas producen `permission-denied`. No
incluir valores del token en mensajes o logs.

Implementar el mapper backend sin bifurcar por la razÃ³n interna:

```ts
export function requireAuthorizedAccess(input: AccessEvaluationInput): AccessGrant {
  const decision = evaluateAccess(input);
  if (!decision.ok) {
    throw new HttpsError("permission-denied", "Access is not permitted");
  }
  return decision.value;
}
```

- [x] **Step 4 - hacer que admin estreche el actor genÃ©rico**

`requireAdminActor()` llama a `requireUserActor()`, valida `{ academyId, role }` con
`parseAdminClaims()` y conserva exactamente su salida pÃºblica existente:

```ts
const actor = requireUserActor(request);
const claims = parseAdminClaims({ academyId: actor.academyId, role: actor.role });
if (!claims.ok) {
  throw new HttpsError("permission-denied", "Administrative claims are required");
}
return Object.freeze({
  uid: actor.userId,
  academyId: claims.value.academyId,
  role: claims.value.role,
});
```

No modificar `assertAcademyScope()`, `getRegyfitProjectionScope()` ni provisioning.

- [x] **Step 5 - verificar GREEN y no elevaciÃ³n**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/auth/user-authorization.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: 3 archivos y 44 pruebas aprobadas; los cuatro roles no administrativos siguen rechazados
por `requireAdminActor()` y provisioning no ejecuta mutaciones para ellos.

---

#### Task 3 - Matriz negativa exhaustiva de Firestore y RTDB

**Files:**

- Create: `qa/rules/client-data-boundary.test.ts`
- Verify unchanged: `firestore.rules`
- Verify unchanged: `database.rules.json`
- Verify: `qa/rules/default-deny.test.ts`
- Verify: `qa/rules/admin-members.test.ts`
- Verify: `qa/rules/regyfit-access-records.test.ts`

**Interfaces:**

- Consumes: las 30 subcolecciones canÃ³nicas de `docs/data/firestore-data-model.md` y las colecciones
  backend-only ya usadas por Functions.
- Produces: una prueba de caracterizaciÃ³n que bloquea cualquier permiso cliente futuro no diseÃ±ado.

- [x] **Step 1 - enumerar rutas y actores exactos**

Usar esta lista congelada, sin inferir nombres desde datos de prueba:

```ts
const canonicalCollections = Object.freeze([
  "users",
  "families",
  "students",
  "staff",
  "relationships",
  "locations",
  "programs",
  "classes",
  "sessions",
  "plans",
  "bookings",
  "attendance",
  "checkouts",
  "memberships",
  "invoices",
  "payments",
  "paymentEvents",
  "assessments",
  "skillProgress",
  "recognitions",
  "leads",
  "messages",
  "deliveryEvents",
  "healthProfiles",
  "safeguardingCases",
  "consents",
  "documents",
  "auditEvents",
  "exports",
  "regyfitAccessRecords",
] as const);

const academyBackendOnlyCollections = Object.freeze([
  "members",
  "memberImportOperations",
  "adminRoleLocks",
] as const);

const rootBackendOnlyCollections = Object.freeze([
  "memberReportExports",
  "memberReportRateLimits",
  "memberImportSessions",
  "memberImportCleanupJournal",
  "memberImportPreviews",
] as const);

const actorCases = Object.freeze([
  { name: "anonymous", uid: null, claims: undefined },
  { name: "owner", uid: "owner-1", claims: { academyId, role: "owner" } },
  { name: "administrator", uid: "administrator-1", claims: { academyId, role: "administrator" } },
  { name: "headCoach", uid: "head-coach-1", claims: { academyId, role: "headCoach" } },
  { name: "coach", uid: "coach-1", claims: { academyId, role: "coach" } },
  { name: "guardian", uid: "guardian-1", claims: { academyId, role: "guardian" } },
  { name: "adultStudent", uid: "adult-1", claims: { academyId, role: "adultStudent" } },
] as const);
```

- [x] **Step 2 - sembrar solo fixtures sintÃ©ticos con Rules desactivadas**

Para cada colecciÃ³n canÃ³nica/backend de academia crear
`academies/demo-academy/{collection}/synthetic-1`; para cada colecciÃ³n backend raÃ­z crear
`{collection}/synthetic-1`, siempre con `{ academyId: "demo-academy", synthetic: true }`. Crear
tambiÃ©n el documento raÃ­z de academia y `academies/demo-academy/presence/session-1/student-1` en
RTDB. Limpiar ambos emuladores entre casos.

- [x] **Step 3 - probar todas las operaciones por actor**

Para cada uno de los siete actores, negar raÃ­z de academia y, en cada colecciÃ³n canÃ³nica o
backend-only, estas cinco operaciones:

```ts
await assertFails(getDoc(existing));
await assertFails(getDocs(collection(firestore, `academies/${academyId}/${name}`)));
await assertFails(setDoc(candidate, { academyId, synthetic: true }));
await assertFails(updateDoc(existing, { synthetic: false }));
await assertFails(deleteDoc(existing));
```

Negar tambiÃ©n `get()` y `set()` en el path RTDB de presencia. Usar `it.each(actorCases)` con timeout
explÃ­cito de 120 segundos por actor para que el volumen de assertions no se confunda con flakiness.

- [x] **Step 4 - ejecutar la caracterizaciÃ³n Rules**

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,database "node node_modules/vitest/vitest.mjs run --project rules qa/rules/client-data-boundary.test.ts"
```

Expected: 1 archivo y 7 pruebas aprobadas contra las Rules actuales. Este paso es una caracterizaciÃ³n,
no se debilitan Rules artificialmente para fabricar un RED; los RED conductuales estÃ¡n en Tasks 1 y 2.

- [x] **Step 5 - confirmar que producciÃ³n Rules no necesita cambios**

Usar la herramienta `grep` sobre `firestore.rules` con el patrÃ³n `allow\s+` y comprobar que cada
match termina en `if false;`; buscar en `database.rules.json` el patrÃ³n
`"\.(read|write)"\s*:\s*true`.

Expected: Firestore solo muestra clÃ¡usulas `if false;` y RTDB no muestra matches. Si aparece una
clÃ¡usula positiva, detener `T016` como hallazgo crÃ­tico; no adaptar la prueba para aceptarla.

---

#### Task 4 - Reconciliar contratos documentales y ledger visual

**Files:**

- Modify: `docs/data/firestore-data-model.md:53-70`
- Modify: `docs/superpowers/specs/2026-08-09-t016-firestore-rules-boundary-design.md:1-12`
- Modify: `Lista/Lista.js`
- Modify at close: `tasks.md`

**Interfaces:**

- Consumes: la decisiÃ³n Functions-only aprobada el 2026-08-19.
- Produces: documentaciÃ³n sin una excepciÃ³n directa obsoleta para owner y estado visual sincronizado.

- [x] **Step 1 - corregir el contrato Regyfit obsoleto**

Reemplazar la frase de `get` directo owner por el contrato vigente: backend/import es Ãºnico escritor;
Rules deniega todos los accesos directos; owner obtiene la proyecciÃ³n restricted con IP solo mediante
Function; administrator obtiene la proyecciÃ³n safe sin IP; los otros cuatro roles no acceden.

- [x] **Step 2 - marcar el diseÃ±o histÃ³rico como ampliado**

Conservar su evidencia histÃ³rica y aÃ±adir al encabezado:

```md
**Estado:** ampliado por el diseÃ±o P1/T016 aprobado en `tasks.md` el 2026-08-19.

Este documento conserva la decisiÃ³n Functions-only para Regyfit. El contrato reutilizable de actor,
polÃ­tica, relaciÃ³n, asignaciÃ³n y propÃ³sito vive en el ledger canÃ³nico `tasks.md`.
```

Reemplazar la lÃ­nea de estado anterior; no conservar simultÃ¡neamente `Pendiente de revisiÃ³n final del
operador`.

- [x] **Step 3 - sincronizar el estado parcial de Lista**

Mantener `T016` como `en-progreso` y actualizar su evidencia a: diseÃ±o aprobado, evaluador/adapter en
implementaciÃ³n y matriz Rules negativa en verificaciÃ³n. No cambiar otro ID todavÃ­a.

- [x] **Step 4 - verificar contradicciones documentales y formato especÃ­fico**

Usar `grep` con el patrÃ³n
`permit a direct complete-document|get directo solo|allow get.*owner` sobre ambos documentos y
ejecutar:

```powershell
corepack pnpm exec prettier --check packages/domain/src/authorization apps/functions/src/auth qa/rules docs/data/firestore-data-model.md docs/superpowers/specs/2026-08-09-t016-firestore-rules-boundary-design.md Lista/Lista.js
```

Expected: la bÃºsqueda no encuentra una concesiÃ³n owner directa; Prettier aprueba todos los paths
especÃ­ficos.

---

#### Task 5 - AutocrÃ­tica, gates y cierre de T016

**Files:**

- Review: todos los archivos de Tasks 1-4
- Modify if packaging requires the new subpath: `apps/functions/src/deploy-runtime.ts`
- Test: `apps/functions/src/deploy-runtime.test.ts`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

**Interfaces:**

- Consumes: implementaciÃ³n y evidencia completa de T016.
- Produces: `T016` en `revisiÃ³n` y `T019` como siguiente Ãºnico WIP de P1.

- [x] **Step 1 - ejecutar self-critique de seguridad**

Invocar `self-critique-loop` y `security-baseline`. Usar `grep` para buscar
`setCustomUserClaims|requireUserActor|requireAdminActor|evaluateAccess` en `apps/functions` y
`packages/domain`, y `console\.(log|info|debug)|logger\.(info|debug)` en los archivos modificados.

Solo backend escribe claims; no hay tokens/claims/hechos completos en logs; `requireAdminActor()`
rechaza los cuatro roles no administrativos; ninguna decisiÃ³n `allow` omite actividad, tenant,
propÃ³sito, rol, clasificaciÃ³n o scope.

- [x] **Step 2 - ejecutar focused final**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/authorization/access-policy.test.ts packages/domain/src/contracts.test.ts apps/functions/src/auth/user-authorization.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts
```

Expected: 5 archivos y 62 pruebas aprobadas tras los RED adicionales del `self-critique-loop`.

- [x] **Step 3 - ejecutar todos los gates desde el cÃ³digo final**

```powershell
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --audit-level high
corepack pnpm format:check
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

Expected: 0 fallos de pruebas/lint/tipos/build/formato/diff y 0 vulnerabilidades high/critical. Las 2
moderadas transitivas conocidas pueden permanecer registradas si el audit no cambia.

- [x] **Step 4 - revisar rendimiento y QA avanzado proporcional**

La matriz Rules debe terminar dentro del timeout explÃ­cito sin retries. UI/E2E, accesibilidad y carga
HTTP son N/A porque no cambia frontend ni se publica endpoint; contratos, entradas hostiles, tenant
cruzado, relaciones/asignaciones expiradas y Rules sÃ­ aplican y deben constar en evidencia.

- [x] **Step 5 - cerrar el ledger sin operaciÃ³n productiva**

Registrar RED/GREEN, conteos reales, hallazgos y limitaciones en `tasks.md`; mover `T016` a `revisiÃ³n`,
abrir `T019` como Ãºnico `en-progreso` y sincronizar `Lista/Lista.js`. Validar 86 IDs Ãºnicos y estados
coincidentes. No desplegar, migrar, crear usuarios, tocar secretos ni hacer commit.

#### Evidencia de implementaciÃ³n T016 (2026-08-19)

- DecisiÃ³n humana: Firestore y RTDB permanecen totalmente cerrados al SDK cliente; toda autorizaciÃ³n
  positiva del MVP pasa por Functions. Los mÃ³dulos futuros aportan polÃ­ticas constantes y resolvers
  canÃ³nicos, nunca roles, propÃ³sitos o hechos enviados por el cliente.
- RED de dominio: el nuevo contrato fallÃ³ porque `access-policy` y sus exports no existÃ­an; las 7
  pruebas previas del entrypoint permanecieron verdes. GREEN inicial: evaluador + entrypoint `16/16` y
  typecheck domain aprobado.
- RED de Functions: `user-authorization` no existÃ­a y las 11 pruebas admin previas permanecieron
  verdes. GREEN: actor estricto para seis roles, errores genÃ©ricos y narrowing administrativo
  aprobaron `44/44`; el runtime domain se aÃ±adiÃ³ a `tsconfig.runtime.json` para resolver el subpath en
  CI/deploy.
- Rules: caracterizaciÃ³n focused `7/7` en 10,88 s. Recorre anÃ³nimo y seis roles contra documento raÃ­z,
  30 colecciones canÃ³nicas, 3 colecciones backend-only bajo academia, 5 colecciones backend-only raÃ­z
  y presencia RTDB; niega `get`, `list`, `create`, `update`, `delete`, lectura y escritura. Las Rules
  productivas no cambiaron y todas sus clÃ¡usulas Firestore continÃºan en `if false;`; RTDB sigue
  `.read/.write=false`.
- Hallazgos de autocrÃ­tica corregidos con RED/GREEN: evidencia de relaciÃ³n/asignaciÃ³n/aprobaciÃ³n de
  otra academia podÃ­a reutilizar IDs coincidentes; `actorActive` aceptaba un valor truthy no booleano;
  claims de autoridad heredadas del prototipo podÃ­an proyectarse. Ahora cada evidencia exige
  `academyId`, actividad exige `=== true` y `academyId/role` deben ser propiedades propias.
- Hallazgo de packaging: la primera suite global quedÃ³ `463/464` porque el preparador de deploy no
  reescribÃ­a el nuevo subpath. Se aÃ±adiÃ³ un RED especÃ­fico, el mapping a
  `domain/authorization/access-policy.js` y se eliminÃ³ un import runtime raÃ­z accidental del test;
  packaging final `2/2` y focused de autorizaciÃ³n final `62/62`.
- Gates finales: unitarias `61` archivos, `464/464`; Rules `5` archivos, `16/16`; lint, typecheck de 6
  workspaces, build Functions/Next de 19 rutas, formato y `git diff --check` aprobaron. Audit reportÃ³ 0
  high/critical y las 2 moderadas transitivas conocidas.
- Pruebas avanzadas: contrato domain/Functions/deploy, entradas hostiles, tenant cruzado, ventanas
  expiradas, claims extra/no enumerables/heredadas y matriz Firebase aplicaron y pasaron. La suite
  Rules terminÃ³ en 13,36 s sin retries, muy por debajo del timeout de 120 s. UI/E2E, accesibilidad y
  carga HTTP son N/A porque no cambiÃ³ frontend ni se publicÃ³ endpoint.
- Seguridad/operaciones: sin hallazgos crÃ­ticos o altos abiertos, dependencias nuevas, secretos, logs
  sensibles, migraciones, escrituras productivas, despliegues, gastos o commits. El estado persistente
  de desactivaciÃ³n y los permisos positivos concretos permanecen en `T025` y sus mÃ³dulos propietarios.
- Gap de capacidad: ninguno; TDD, debugging sistemÃ¡tico, security baseline, pruebas contractuales y
  emuladores cubrieron los hallazgos. El siguiente Ãºnico WIP de P1 es `T019`.

### P1 / T019 - DiseÃ±o aprobado de audit log append-only

**Estado del diseÃ±o:** aprobado por el operador el 2026-08-19.

**Objetivo:** consolidar los eventos administrativos, de importaciÃ³n de miembros y de importaciÃ³n
Regyfit detrÃ¡s de un contrato estricto y un Ãºnico adapter create-only. `auditEvents` registra cambios
sensibles completados; no se convierte en telemetrÃ­a de intentos, timeline de UI ni payload histÃ³rico.

#### Decisiones aprobadas

- T019 centraliza y migra los tres escritores actuales. No deja un contrato nuevo junto a writers
  paralelos con esquemas distintos.
- El audit log canÃ³nico persiste solo cambios sensibles completados y atÃ³micos. Fallos y denegaciones
  quedan fuera de Firestore y pertenecen a la telemetrÃ­a de seguridad de `T055`.
- Los metadatos forman una uniÃ³n discriminada estricta por `action`; no existe un campo `metadata`
  abierto ni JSON arbitrario.
- No se implementan lectura, endpoint, exportaciÃ³n o UI de auditorÃ­a. El rol de auditor independiente
  continÃºa fuera del MVP y cualquier lectura futura exige una tarea y autorizaciÃ³n propias.
- No se aplica migraciÃ³n ni se reescriben eventos existentes.

#### Contrato de dominio

El envelope comÃºn conserva el modelo plano ya persistido:

```ts
type AuditEventDraft = Readonly<{
  academyId: AcademyId;
  actorId: UserId | SystemActorId;
  targetRef: string;
  purpose: string;
  correlationId: CorrelationId;
}> &
  (
    | Readonly<{ action: "admin.role.granted" | "admin.role.revoked" }>
    | Readonly<{
        action: "member.import.confirmed";
        imported: number;
        updated: number;
        conflicts: number;
        sourceHash: string;
        reportKeys: readonly MemberReportKey[];
      }>
    | Readonly<{
        action: "regyfit.access.imported";
        importRunId: string;
        moduleKey: string;
        sourceRoute: string;
        recordCount: number;
        contentSha256: string;
      }>
  );
```

- `targetRef` debe comenzar exactamente con `academies/{academyId}/`; una referencia cross-tenant se
  rechaza aunque los demÃ¡s IDs coincidan.
- Acciones, campos y variantes son exactos. Conteos son enteros no negativos; hashes son SHA-256
  lowercase; strings tienen lÃ­mites explÃ­citos y `reportKeys` reutiliza el contrato existente.
- `moduleKey` usa un identificador acotado y `sourceRoute` es una ruta relativa acotada sin query,
  fragmento, credenciales ni URL absoluta.
- Admin role no aÃ±ade email, display name, claims, rol previo/nuevo ni otro payload personal. `action`
  y `targetRef` identifican la operaciÃ³n mÃ­nima.
- El draft nunca contiene `auditEventId`, `occurredAt`, `result` ni `schemaVersion`; el adapter es su
  Ãºnico propietario.

#### Adapter create-only y atomicidad

- `apps/functions/src/audit/audit-writer.ts` valida el draft y materializa exactamente:
  `auditEventId`, envelope/variante, `occurredAt: FieldValue.serverTimestamp()`,
  `result: "completed"` y `schemaVersion: 1`.
- La API transaccional solo permite `create`. No expone `set`, `update`, `delete` ni merge sobre
  `auditEvents`.
- Admin provisioning y member import reservan una referencia automÃ¡tica server-owned y crean el
  evento en la misma transacciÃ³n que el cambio sensible.
- En admin provisioning, la atomicidad cubre documento canÃ³nico, audit event y lock en Firestore. La
  custom claim de Firebase Auth permanece bajo la compensaciÃ³n fail-closed ya existente si esa
  transacciÃ³n falla; no se afirma atomicidad distribuida inexistente.
- Regyfit conserva el ID determinista server-owned `regyfit-access-{runId}`. Primera ejecuciÃ³n crea;
  replay idÃ©ntico es no-op; un evento distinto con el mismo ID falla sin sobrescribir.
- Para comparar un replay Regyfit se usan solo los campos estables validados. Se tolera el documento
  legacy equivalente sin `auditEventId`/`occurredAt`; cualquier otro campo ausente, extra o distinto
  falla. Los eventos nuevos siempre reciben ambos campos.
- Se elimina `writeImportAuditEvent`, writer genÃ©rico exportado pero sin consumidor productivo.

#### Seguridad y errores

- Un draft invÃ¡lido falla antes de cualquier escritura. Un error en la operaciÃ³n sensible revierte
  la transacciÃ³n y no deja un evento huÃ©rfano.
- Colisiones automÃ¡ticas fallan; colisiones deterministas solo admiten replay exacto. Ninguna ruta
  convierte una colisiÃ³n en update.
- No se registran nombres, emails, telÃ©fonos, tokens, claims, IP, secretos, payloads completos ni
  snapshots before/after. Conteos, hashes e IDs opacos son la evidencia mÃ¡xima permitida.
- Firestore Rules continÃºa negando toda lectura y escritura cliente de `auditEvents`; Functions/Admin
  SDK es el Ãºnico writer y debe pasar por este adapter.

#### Estrategia de pruebas

- Dominio: una variante vÃ¡lida por acciÃ³n y negativos por acciÃ³n desconocida, campos extra/de otra
  variante, tenant cruzado, strings fuera de lÃ­mites, conteos invÃ¡lidos, hashes invÃ¡lidos y
  `reportKeys` desconocidos.
- Adapter: prueba que materializa campos server-owned y usa `transaction.create`; el doble no ofrece
  APIs de mutaciÃ³n de eventos.
- Writers migrados: admin/member prueban evento atÃ³mico y mÃ­nimo; Regyfit prueba create inicial,
  replay exacto, replay legacy compatible, colisiÃ³n distinta y concurrencia/idempotencia.
- IntegraciÃ³n emulator: un evento por operaciÃ³n/replay, ausencia de PII y Rules negativas intactas.
- Gates: focused RED/GREEN, integraciÃ³n, unitarias completas, Rules, lint, typecheck, build, audit
  high, formato y `git diff --check`.

#### Fuera de alcance y rollback

- Sin auditorÃ­a de fallos/denegaciones, lectura owner, rol auditor, UI, exportaciÃ³n, retenciÃ³n,
  archivado, firma criptogrÃ¡fica o hash chain. `T011`, `T053` y `T055` conservan esas decisiones.
- Sin migraciÃ³n, backup o write productivo. El rollback es de cÃ³digo: restaurar writers previos; los
  eventos nuevos conservan el envelope compatible y no requieren transformaciÃ³n.

#### Criterio de aceptaciÃ³n

- Todos los writers actuales consumen el contrato central y no queda escritura directa productiva a
  `auditEvents` fuera del adapter.
- Cada cambio sensible completado crea exactamente un evento dentro de su transacciÃ³n; un replay
  idempotente no duplica ni reescribe.
- Eventos invÃ¡lidos, cross-tenant, con PII/campos extra o colisiÃ³n distinta fallan closed.
- Rules, integraciÃ³n y gates globales pasan con evidencia real antes de mover `T019` a `revisiÃ³n`.

### P1 / T019 - Plan de implementaciÃ³n

> **Para ejecuciÃ³n agentic:** usar `subagent-driven-development` o `executing-plans` tarea por tarea.
> En esta sesiÃ³n la ejecuciÃ³n es inline porque ya se alcanzÃ³ el mÃ¡ximo de subagentes. Cada paso usa
> checkboxes y conserva `T019` como Ãºnico WIP.

**Goal:** reemplazar los tres esquemas/writers actuales por un contrato discriminado y un adapter
create-only que mantenga atomicidad, mÃ­nimo payload e idempotencia Regyfit compatible.

**Architecture:** `packages/domain` valida drafts sin campos server-owned. Un adapter pequeÃ±o de
Functions materializa y crea eventos dentro de la transacciÃ³n del mÃ³dulo; admin y member usan IDs
automÃ¡ticos, Regyfit usa ID determinista y compara replays estables. No se aÃ±ade reader, callable ni
UI.

**Tech Stack:** TypeScript, Vitest, Firebase Admin Firestore transactions, Firebase Emulator Suite y
contratos `Result` existentes.

#### Restricciones globales

- Solo eventos `completed`; fallos/denegaciones pertenecen a `T055` y no escriben `auditEvents`.
- NingÃºn draft contiene `auditEventId`, `occurredAt`, `result` o `schemaVersion`.
- NingÃºn cliente envÃ­a acciones, propÃ³sito, actor, tenant, referencias o metadata de auditorÃ­a.
- No nombres, emails, telÃ©fonos, IP, tokens, claims, secretos, payloads completos ni snapshots.
- `targetRef` y toda evidencia pertenecen al mismo `academyId`; cross-tenant falla closed.
- Solo `transaction.create`; no update/delete/merge sobre eventos.
- Sin lectura/UI/export, dependencias nuevas, migraciones, writes productivos o despliegues.
- Fixtures exclusivamente sintÃ©ticos y emuladores `demo-bpt-jersey`.
- No hacer commit/push de T019 sin pedido explÃ­cito posterior.

---

#### Task 1 - Contrato discriminado de audit drafts

**Files:**

- Create: `packages/domain/src/audit/audit-event.test.ts`
- Create: `packages/domain/src/audit/audit-event.ts`
- Modify: `packages/domain/src/contracts.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.runtime.json`

**Interfaces:**

- Consumes: IDs branded, `MemberReportKey`, `memberReportKeys`, `Result` y `ValidationIssue`.
- Produces:

```ts
const auditActions = Object.freeze([
  "admin.role.granted",
  "admin.role.revoked",
  "member.import.confirmed",
  "regyfit.access.imported",
] as const);

type AuditAction = (typeof auditActions)[number];
type AuditEventDraft = Readonly<{
  academyId: AcademyId;
  actorId: UserId | SystemActorId;
  targetRef: string;
  purpose: string;
  correlationId: CorrelationId;
}> &
  (
    | Readonly<{ action: "admin.role.granted" | "admin.role.revoked" }>
    | Readonly<{
        action: "member.import.confirmed";
        imported: number;
        updated: number;
        conflicts: number;
        sourceHash: string;
        reportKeys: readonly MemberReportKey[];
      }>
    | Readonly<{
        action: "regyfit.access.imported";
        importRunId: string;
        moduleKey: string;
        sourceRoute: string;
        recordCount: number;
        contentSha256: string;
      }>
  );

function parseAuditEventDraft(value: unknown): Result<AuditEventDraft, ValidationIssue[]>;
```

- [x] **Step 1 - escribir el RED del contrato**

Crear ocho casos con expectativas literales: ambos admin actions, member vÃ¡lido, Regyfit vÃ¡lido,
common fields invÃ¡lidos, tenant cruzado, mezcla/extra de variantes y metadata invÃ¡lida. Ejemplo:

```ts
expect(
  parseAuditEventDraft({
    academyId: "academy-1",
    actorId: "admin-1",
    action: "member.import.confirmed",
    targetRef: "academies/academy-1/members",
    purpose: "confirmed member PDF import",
    correlationId: "operation-1",
    imported: 2,
    updated: 1,
    conflicts: 0,
    sourceHash: "a".repeat(64),
    reportKeys: ["total"],
  }),
).toEqual({
  ok: true,
  value: {
    academyId: "academy-1",
    actorId: "admin-1",
    action: "member.import.confirmed",
    targetRef: "academies/academy-1/members",
    purpose: "confirmed member PDF import",
    correlationId: "operation-1",
    imported: 2,
    updated: 1,
    conflicts: 0,
    sourceHash: "a".repeat(64),
    reportKeys: ["total"],
  },
});
```

Los negativos incluyen: objeto con prototype custom, symbol/non-enumerable extra, `targetRef` de otra
academia, action desconocida, email/rawRecord/ip extra, conteo negativo/fraccional, hash no lowercase,
`reportKeys` desconocido/duplicado, `moduleKey` fuera de `^[A-Za-z0-9._-]+$` y `sourceRoute` absoluta
o con `?`/`#`/segmento `..`.

- [x] **Step 2 - ejecutar el RED**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts packages/domain/src/contracts.test.ts
```

Expected: FAIL porque `audit/audit-event` y sus exports no existen; contratos previos permanecen
verdes.

- [x] **Step 3 - implementar parser exacto e inmutable**

Usar `Reflect.ownKeys`, objeto con `Object.prototype`, sets exactos por action y errores estructurados.
Aplicar lÃ­mites: IDs 128, `targetRef` 512, purpose/correlation/source route 256, import/module 128,
SHA-256 `/^[a-f0-9]{64}$/`, conteos enteros no negativos y route
`/^\/[A-Za-z0-9._/-]+$/` sin `//`, `/../` ni `/./`. Devolver una copia congelada y congelar
`reportKeys`.

- [x] **Step 4 - publicar el contrato para source y runtime**

Exportar valores/tipos desde `src/index.ts`, aÃ±adir a `package.json`:

```json
"./audit": {
  "types": "./src/audit/audit-event.ts",
  "default": "./lib/audit/audit-event.js"
}
```

Incluir `src/audit/audit-event.ts` en `tsconfig.runtime.json`. En `contracts.test.ts` comprobar que
`auditActions` estÃ¡ congelado, contiene exactamente cuatro acciones y `parseAuditEventDraft` estÃ¡
disponible desde el entrypoint pÃºblico.

- [x] **Step 5 - verificar GREEN domain/runtime**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts packages/domain/src/contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
corepack pnpm --filter @bpt-jersey/domain build:runtime
```

Expected: 2 archivos/17 pruebas y ambos comandos TypeScript aprobados.

---

#### Task 2 - Adapter create-only y compatibilidad de replay

**Files:**

- Create: `apps/functions/src/audit/audit-writer.test.ts`
- Create: `apps/functions/src/audit/audit-writer.ts`
- Modify: `apps/functions/src/deploy-runtime.test.ts`
- Modify: `apps/functions/src/deploy-runtime.ts`

**Interfaces:**

- Consumes: `AuditEventDraft`, `parseAuditEventDraft`, `FieldValue.serverTimestamp()`.
- Produces:

```ts
type AuditDocumentReference = Readonly<{ id: string }>;
type AuditCreateTransaction<Reference> = Readonly<{
  create: (ref: Reference, data: Readonly<Record<string, unknown>>) => unknown;
}>;

function appendAuditEventInTransaction<Reference extends AuditDocumentReference>(
  transaction: AuditCreateTransaction<Reference>,
  ref: Reference,
  draft: AuditEventDraft,
): void;

function matchesAuditEventReplay(
  stored: unknown,
  eventId: string,
  draft: AuditEventDraft,
  options?: Readonly<{ allowLegacyMissingGeneratedFields?: boolean }>,
): boolean;
```

- [x] **Step 1 - escribir RED del writer**

AÃ±adir seis casos: materializaciÃ³n exacta/create Ãºnico, draft invÃ¡lido antes de create, evento moderno
idÃ©ntico, legacy Regyfit sin `auditEventId/occurredAt`, mismatch/extra rechazado y ausencia de API de
mutaciÃ³n. El doble solo implementa `create` y captura:

```ts
expect(created).toEqual({
  ref: { id: "audit-1" },
  data: expect.objectContaining({
    auditEventId: "audit-1",
    action: "admin.role.granted",
    result: "completed",
    schemaVersion: 1,
    occurredAt: expect.anything(),
  }),
});
```

- [x] **Step 2 - ejecutar RED**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/audit/audit-writer.test.ts apps/functions/src/deploy-runtime.test.ts
```

Expected: FAIL porque writer y mapping runtime `@bpt-jersey/domain/audit` no existen.

- [x] **Step 3 - implementar create y replay strict**

`appendAuditEventInTransaction()` vuelve a parsear el draft, lanza `HttpsError("invalid-argument")`
sin filtrar issues y llama exactamente una vez a `transaction.create`. `matchesAuditEventReplay()`:

1. exige objeto plano y `result === "completed"`, `schemaVersion === 1`;
2. si existen, exige `auditEventId === eventId` y `occurredAt` definido;
3. permite ausencia de ambos solo con `allowLegacyMissingGeneratedFields === true`;
4. extrae Ãºnicamente keys estables, las parsea y compara literalmente con el draft;
5. rechaza cualquier key adicional.

- [x] **Step 4 - integrar packaging deploy**

AÃ±adir mapping:

```ts
"@bpt-jersey/domain/audit": "../../domain/audit/audit-event.js"
```

Extender `deploy-runtime.test.ts` con import y expectativa del nuevo subpath.

- [x] **Step 5 - verificar GREEN writer/packaging**

```powershell
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm exec vitest run --project node apps/functions/src/audit/audit-writer.test.ts apps/functions/src/deploy-runtime.test.ts
```

Expected: writer y packaging completo aprobados; ningÃºn import workspace queda en el layout copiado.

---

#### Task 3 - Migrar auditorÃ­a de provisioning administrativo

**Files:**

- Modify: `apps/functions/src/auth/admin-provisioning.test.ts`
- Modify: `apps/functions/src/auth/admin-provisioning.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**

- Consumes: `appendAuditEventInTransaction()` y `AuditEventDraft`.
- Removes: `AuditEventMetadata`, `auditEventSchema`, `writeImportAuditEvent` y su export pÃºblico.

- [x] **Step 1 - escribir RED de admin create-only**

Modificar el fake `SyntheticTransaction` para distinguir `create` de `set`. Probar grant/revoke con
evento mÃ­nimo, `create` exactamente una vez y sin email/displayName/claims. Probar que una colisiÃ³n de
audit ref aborta documento de usuario/lock y activa la compensaciÃ³n Auth existente. Eliminar el test
del writer genÃ©rico no usado; el nuevo contrato lo sustituye.

- [x] **Step 2 - ejecutar RED admin**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/auth/admin-provisioning.test.ts
```

Expected: FAIL porque provisioning todavÃ­a usa `transaction.set` y exporta el writer legacy.

- [x] **Step 3 - migrar la transacciÃ³n**

AÃ±adir `create` a las interfaces/fakes transaccionales y reemplazar `auditDocument()` por:

```ts
appendAuditEventInTransaction(transaction, auditRef, {
  academyId: actor.academyId as AcademyId,
  actorId: actor.uid as UserId,
  action: action === "grant" ? "admin.role.granted" : "admin.role.revoked",
  targetRef: `academies/${actor.academyId}/users/${targetUid}`,
  purpose: "administrative role management",
  correlationId: `${actor.uid}:${targetUid}:${auditRef.id}` as CorrelationId,
});
```

Mantener user doc/lock en la misma transacciÃ³n y no cambiar compensaciÃ³n, fencing o provisioning.
Eliminar type/schema/function legacy y sus exports de `src/index.ts`.

- [x] **Step 4 - verificar GREEN y regresiÃ³n de Auth**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/user-authorization.test.ts
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: todos los casos pasan; roles no administrativos siguen sin mutaciÃ³n y grant/revoke conserva
compensaciÃ³n fail-closed.

---

#### Task 4 - Migrar member import y Regyfit idempotente

**Files:**

- Modify: `apps/functions/src/members/member-service.ts`
- Modify: `apps/functions/src/regyfit/access-import.test.ts`
- Modify: `apps/functions/src/regyfit/access-import.ts`
- Modify: `qa/integration/firestore-adapters.test.ts`
- Create: `qa/integration/audit-writer.test.ts`

**Interfaces:**

- Consumes: `appendAuditEventInTransaction()` y `matchesAuditEventReplay()`.
- Preserves: `MemberImportWriteResult`, `ImportReceipt` y todos los paths/idempotency keys actuales.

- [x] **Step 1 - escribir RED member/Regyfit**

En integraciÃ³n member exigir un evento con envelope server-owned, fields de variante, sin `fullName`,
email o records. En Regyfit aÃ±adir:

- evento nuevo con `auditEventId` y `occurredAt`;
- replay exacto sin duplicado;
- replay legacy tras eliminar solo esos dos campos;
- colisiÃ³n al cambiar purpose/hash/extra field;
- ningÃºn overwrite de la colisiÃ³n.

- [x] **Step 2 - ejecutar RED focused**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/regyfit/access-import.test.ts
```

Expected: FAIL porque Regyfit todavÃ­a materializa/usa `transaction.set` directamente.

- [x] **Step 3 - migrar member import**

Reemplazar `transaction.create(auditReference, {...})` por el adapter con draft
`member.import.confirmed`; conservar operation record en la misma transacciÃ³n y su referencia al
`auditEventId`. No mover report keys, source hash o conteos fuera de la variante.

- [x] **Step 4 - migrar Regyfit sin romper replay legacy**

Construir un draft una vez. Si snapshot no existe, usar `appendAuditEventInTransaction`; si existe,
usar `matchesAuditEventReplay(existing, ref.id, draft, { allowLegacyMissingGeneratedFields: true })`.
Mismatch llama `fail("Import conflicts with existing audit data")`. Nunca usar `set` para audit.

- [x] **Step 5 - probar concurrencia/idempotencia en Firestore Emulator**

El nuevo `qa/integration/audit-writer.test.ts` abre dos transacciones concurrentes sobre
`academies/demo-academy/auditEvents/regyfit-access-concurrent-1`; cada una lee snapshot y usa el
adapter/matcher. Ambas promesas resuelven y queda un documento. Repetir con draft distinto y exigir
rechazo sin mutaciÃ³n.

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/audit-writer.test.ts qa/integration/firestore-adapters.test.ts"
```

Expected: integraciÃ³n aprobada con fixtures sintÃ©ticos, un evento por correlaciÃ³n y cero PII.

- [x] **Step 6 - verificar GREEN focused completo**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts apps/functions/src/audit/audit-writer.test.ts apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/regyfit/access-import.test.ts apps/functions/src/members/member-service.test.ts
```

Expected: todos los contratos y writers migrados pasan sin cambiar respuestas pÃºblicas.

---

#### Task 5 - DocumentaciÃ³n, autocrÃ­tica, gates y cierre

**Files:**

- Modify: `docs/data/firestore-data-model.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`
- Review: todos los archivos de Tasks 1-4

**Interfaces:**

- Consumes: implementaciÃ³n completa T019.
- Produces: `T019` en `revisiÃ³n` y `T018` como siguiente Ãºnico WIP de P1.

- [x] **Step 1 - documentar contrato final y compatibilidad**

Actualizar la fila/secciÃ³n `auditEvents`: cuatro actions actuales, campos server-owned, create-only,
legacy Regyfit tolerado solo en replay, sin reader/UI y sin migraciÃ³n. No prometer hash chain,
retenciÃ³n o auditor independiente.

- [x] **Step 2 - ejecutar self-critique de seguridad**

Invocar `self-critique-loop` y `security-baseline`. Usar `grep` para localizar `auditEvents` y verificar
que toda creaciÃ³n productiva pasa por `appendAuditEventInTransaction`; no debe existir
`transaction.set/update/delete` ni `.set()` directo sobre audit refs. Revisar que logs/tests no copian
PII y que Rules sigue default-deny.

- [x] **Step 3 - ejecutar focused e integraciÃ³n final**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts apps/functions/src/audit/audit-writer.test.ts apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/regyfit/access-import.test.ts apps/functions/src/members/member-service.test.ts apps/functions/src/deploy-runtime.test.ts
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/audit-writer.test.ts qa/integration/firestore-adapters.test.ts"
```

Evidence: focused unit tests `75/75`; integraciÃ³n Firestore Emulator `8/8`; domain/runtime y Functions typecheck aprobados; packaging portable aprobado. La ejecuciÃ³n directa sin emulador respondiÃ³ `PERMISSION_DENIED` y se repitiÃ³ correctamente mediante `firebase emulators:exec`.

- [x] **Step 4 - ejecutar gates globales**

```powershell
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --audit-level high
corepack pnpm format:check
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

Evidence: `test:unit` `63 archivos/481 pruebas`; Rules Emulator `5 archivos/16 pruebas`; lint, typecheck, build, audit, format y `git diff --check` aprobados. `pnpm audit --audit-level high` reporta Ãºnicamente `2 moderate` transitivas conocidas.

- [x] **Step 5 - cerrar ledger sin operaciÃ³n productiva**

Registrar RED/GREEN, integraciÃ³n, hallazgos y limitaciones; `T019` queda en `revisiÃ³n`, `T018`
queda como siguiente WIP de P1 y permanece `pendiente` hasta completar sus fundamentos, y
`Lista/Lista.js` conserva 86 IDs Ãºnicos sincronizados. Se
conservaron `opencode.json` y artefactos excluidos sin stage. No se migrÃ³, desplegÃ³, crearon
usuarios, tocaron secretos ni hizo commit/push.

### ReconciliaciÃ³n documental - 2026-08-21

- `tasks.md` se confirmÃ³ como fuente canÃ³nica y `Lista/Lista.js` se alineÃ³ con sus estados actuales:
  `T019`, `T021` y `T022` quedan en `revisiÃ³n`; `T018` permanece `pendiente` porque sus
  fundamentos todavÃ­a no estÃ¡n completos.
- VerificaciÃ³n: `node --check Lista/Lista.js` pasÃ³ sin errores. No se modificÃ³ runtime, no se
  ejecutaron migraciones ni despliegues, y no se accediÃ³ a datos productivos.

### T008/T009 - Reconciliaciï¿½n DOCX real - 2026-08-25

- Se revisaron en modo solo lectura F:\Proyectos\BPT Jersey\Varios\BPT-memberships.docx y F:\Proyectos\BPT Jersey\Varios\BPTJ FUNCTIONS APP.docx con extracciï¿½n de pï¿½rrafos y tablas.
- Se confirmaron como reales el catï¿½logo de 10 planes/precios, Town/West, reglas de booking/capacidad/PAYG/under-18 y el baseline de stripes; no se promovieron a producciï¿½n ni a fixtures nuevas.
- Se conservaron como (f) ï¿½nicamente los datos ausentes: timezone, horarios concretos, instructores, capacidades por clase, billing/freeze/overdue/trial, refunds/discounts y proveedor.
- Se registrï¿½ la contradicciï¿½n Miro/oficina para claims de no-show y la tensiï¿½n entre comparaciï¿½n de estudiantes del DOCX y el lï¿½mite de safeguarding actual. T008/T009 siguen en revisiï¿½n.

### T055 - verify:mvp local - 2026-08-25

- Se aï¿½adiï¿½ scripts/verify-mvp.mjs y el comando raï¿½z pnpm verify:mvp para ejecutar format:check, lint, typecheck, build, unitarias, Rules y E2E smoke en el piloto sintï¿½tico.
- Resultado de ejecucion: la primera corrida evidencio que el smoke normal no podia autorizar la shell sin NEXT_PUBLIC_ADMIN_E2E.
- Correccion: verify:mvp ahora conserva la build normal y ejecuta build:e2e-synthetic con NEXT_PUBLIC_ADMIN_E2E=true antes del smoke, sin habilitar datos reales ni Auth productivo.
- Reejecucion completa: format:check, lint, typecheck, build normal, unitarias 154/1066, Rules 8/64, build:e2e-synthetic y E2E smoke 5 pasan y 1 se omite. T055 pasa a revision para el piloto sintetico; T011 y carga/live-staging siguen pendientes.
- Carga sintetica local: 240 solicitudes a concurrencia 24 sobre /, /admin, /admin/members y /account; 0 fallos, p50 31 ms, p95 41 ms, p99 47 ms, max 49 ms. Este resultado no sustituye carga de Firebase, red ni staging.

### T008/T009/T055 - Aprobacion de alcance sintetico - 2026-08-25

- El operador aprobo continuar con el alcance sintetico usando los datos fuente reales solo como reglas de referencia y valores ficticios marcados como (f) en Emulator/staging aislado.
- T008 y T009 quedan aprobadas unicamente para ese piloto; no fijan horarios reales, capacidades, reconocimiento real, safeguarding final ni politica comercial productiva.
- T055 pasa de bloqueada a revision por gates locales verdes. T011 continua bloqueada y la carga live/staging real sigue pendiente; no hay despliegue, migracion ni datos reales.

### T010 - Paquete sintï¿½tico de proveedor - 2026-08-25

- Se creï¿½ docs/operations/payment-provider-decision-packet.md con tres candidatos ficticios, checkout alojado, webhooks firmados, lï¿½mites de costo y plantilla de respuesta.
- Los nombres, tarifas, rangos y capacidades estï¿½n marcados como sintï¿½ticos; no prueban disponibilidad en Jersey ni sustituyen una cotizaciï¿½n, tï¿½rminos de datos o aprobaciï¿½n del operador.
- Cost-intelligence: no existe cuenta ni gasto; alertas de facturaciï¿½n no configuradas. Antes de activaciï¿½n se requiere techo mensual, alerta, propietario de escalamiento y rollback documentado.
- Estado: T010 continï¿½a bloqueada. No se crearon credenciales, endpoints, adaptadores, webhooks, checkout, migraciones ni llamadas externas.

- Autocrï¿½tica T010: Prettier de tasks.md, Lista.js, STACK.md y el paquete; node --check Lista/Lista.js; git diff --check; escaneo de secretos sin coincidencias; reconciliaciï¿½n ledger=87/lista=87/unique=87/divergences=0. pnpm audit conserva 0 high/critical y 2 moderadas preexistentes. No aplica prueba de rendimiento a este cambio documental y no se activï¿½ ningï¿½n proveedor.

### T011 - Paquete de decisiÃ³n preparado - 2026-08-21

- Se creÃ³ `docs/operations/t011-retention-residency-deletion-decision-packet.md` con el inventario
  de categorÃ­as, responsables, decisiones de retenciÃ³n/residencia/borrado/restauraciÃ³n y controles
  provisionales del piloto. Se aÃ±adieron referencias pÃºblicas del JOIC para registro, DPIA,
  principios, derechos y transferencias. No fija plazos, regiones, bases legales ni afirma
  cumplimiento.
- `T011` permanece `bloqueada`; `T023` permanece `bloqueada` y `T018` permanece `pendiente` hasta
  que el operador y la asesorÃ­a aplicable a Jersey registren una decisiÃ³n aprobada. No hubo cambios
  de runtime, migraciones, borrado destructivo, escrituras productivas ni despliegues. VerificaciÃ³n:
  `node --check Lista/Lista.js` y `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check`
  pasaron.

### T025 - DiseÃ±o preparado - 2026-08-21

- El operador aprobÃ³ `docs/superpowers/specs/2026-08-21-t025-staff-lifecycle-design.md` y su plan
  `docs/superpowers/plans/2026-08-21-t025-staff-lifecycle-plan.md`. El diseÃ±o cubre contratos,
  lifecycle, disponibilidad, asignaciones tenant-scoped y sincronizaciÃ³n fail-closed de claims.
- `T025` permanece en `revisiÃ³n`; no se iniciÃ³ implementaciÃ³n, no se cambiÃ³ el WIP de P1 y no se
  agregaron colecciones, Rules, migraciones, claims reales ni datos productivos.

### T025 - Inicio de ejecuciÃ³n controlada - 2026-08-21

- Por decisiÃ³n del operador, `T025` pasa a `en-progreso` como WIP tÃ©cnico independiente mientras
  `T018`/`T023`/`T024` permanecen detenidas por el gate externo de `T011`. Esta desviaciÃ³n del orden
  nominal de P1 queda limitada al lifecycle de coaches/staff y no desbloquea ninguna tarea dependiente.
- La ejecuciÃ³n seguirÃ¡ el plan TDD aprobado, sin producciÃ³n, migraciones, datos reales, salud,
  safeguarding, pagos, retenciÃ³n, residencia ni borrado destructivo.
- Task 1 del plan completada: se aÃ±adieron `StaffProfile`, `StaffRoleAssignment` y
  `StaffAvailabilityWindow`, parsers estrictos con allowlists, validaciÃ³n de timezone IANA,
  ventanas locales, roles `headCoach`/`coach`, estados active/inactive y fail-closed ante
  prototipos o getters hostiles. Se publicaron los exports raÃ­z y el subpath `@bpt-jersey/domain/staff`.
- Evidencia TDD: el RED focalizado fallÃ³ por el mÃ³dulo inexistente; despuÃ©s GREEN pasÃ³ con `14/14`
  pruebas focalizadas. TambiÃ©n pasaron `corepack pnpm --filter @bpt-jersey/domain typecheck`,
  `corepack pnpm --filter @bpt-jersey/domain build:runtime`, la regresiÃ³n Node completa (`47` archivos,
  `478` pruebas), Prettier en los archivos nuevos y `git diff --check`. Los warnings del test Node
  son la deprecaciÃ³n de subprocess y sourcemaps faltantes del layout temporal de deploy; no hubo
  fallos. Rules, UI, claims reales, migraciones y producciÃ³n siguen sin tocarse; los handlers de
  Task 3 existen como implementaciÃ³n provisional pendiente del gate de seguridad.
- Task 2 del plan completada: se aÃ±adiÃ³ `apps/functions/src/staff/staff-service.ts` con altas idempotentes
  mediante `requestId`, actualizaciÃ³n de rol, activaciÃ³n/desactivaciÃ³n soft, disponibilidad y
  asignaciones tenant-scoped. Las transacciones leen y validan usuarios/targets antes de escribir,
  fallan cerradas ante overflow, usan IDs hash scoped sin colisiones por concatenaciÃ³n, revocan derivados
  al desactivar y generan auditorÃ­a `staff.*` sin PII.
- Evidencia adicional: `apps/functions/src/staff/staff-service.test.ts` (`7` pruebas), auditorÃ­a y
  runtime cubiertos dentro de la regresiÃ³n Node (`48` archivos, `486` pruebas), typecheck/build de
  Domain y Functions, Prettier y `git diff --check` pasan. `corepack pnpm audit` deja solo dos
  vulnerabilidades moderadas transitorias de `firebase-tools` (`uuid` y `@opentelemetry/core`), sin
  vulnerabilidades high/critical. Callables, Rules, UI, claims reales, Emulator E2E y producciÃ³n siguen
  pendientes de Tasks 3-4.
- Task 3 pasÃ³ a revisiÃ³n tÃ©cnica: los handlers admin-only sincronizan Ãºnicamente roles no
  administrativos, comparten el lock `academies/{academyId}/adminRoleLocks/{uid}` con
  `admin-provisioning`, rechazan claims cross-tenant o administrativos malformados, y aplican
  compensaciÃ³n fail-closed con claims sin `role`, perfil inactivo y lock `compensating` cuando la
  recuperaciÃ³n no es segura. Se aÃ±adieron pruebas de lock compartido, cuarentena, claims malformados
  y carrera Auth sin sobrescribir cambios externos. Task 3 focalizada: `37/37`; revisiÃ³n tÃ©cnica sin
  hallazgos P1/P2. Task 4 (Rules, Emulator E2E y UI) sigue pendiente; no se habilita producciÃ³n.
- Evidencia final de esta iteraciÃ³n: `corepack pnpm test` pasÃ³ con `88` archivos y `675` pruebas;
  `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`, build runtime de
  Domain y build de Functions pasaron. `corepack pnpm audit` mantiene Ãºnicamente dos vulnerabilidades
  moderadas transitivas de `firebase-tools` (`uuid` y `@opentelemetry/core`), sin high/critical.
- Fix Round 2 de Task 4B: el replacement de availability y assignments valida todos los documentos
  existentes, incluidos los inactivos, con forma exacta, tenant, `active`, `updatedAt` e ID hash
  canÃ³nico antes de escribir. La regresiÃ³n RED resolvÃ­a `[]` para un documento inactivo malformed;
  GREEN pasÃ³ `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts
apps/functions/src/staff/staff-callables.test.ts` con `29/29`, incluyendo IDs no canÃ³nicos y
  comprobaciÃ³n de no escritura. TambiÃ©n pasaron web `4/4`, typechecks de Functions/Web/QA y Prettier
  focused. Sin migraciones, producciÃ³n, secretos ni cambios Git; T025 sigue `en-progreso` pendiente
  del cierre de Tasks 4C/4D y aprobaciÃ³n humana.

### Evidencia Task 4C - UI y E2E de staff (2026-08-21)

- Se aÃ±adiÃ³ `/admin/staff` con tabla segura de `staffKey`, rol y estado; creaciÃ³n, actualizaciÃ³n de
  rol, activaciÃ³n/desactivaciÃ³n, replacement de availability y replacement de assignments usan solo
  `apps/web/src/lib/staff-client.ts`. Se actualizÃ³ la navegaciÃ³n del shell y CSS responsive/foco sin
  dependencias nuevas ni acceso directo a Firebase desde React.
- Unitarias focalizadas: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/staff/page.test.tsx
apps/web/src/app/admin/page.test.tsx apps/web/src/lib/staff-client.test.ts` pasÃ³ `3` archivos y
  `21/21` pruebas. Cubre loading, vacÃ­o, proyecciÃ³n segura, error genÃ©rico, create/update/deactivate,
  availability/assignment, labels, owner/administrator, campos no filtrados, pending y restauraciÃ³n
  de foco.
- Gates: `corepack pnpm lint`, `corepack pnpm typecheck` y Prettier focused pasaron. El build local
  `NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build` generÃ³ `/admin/staff`.
- E2E sintÃ©tico local, sin credenciales ni endpoints productivos: `staff-management.spec.ts` pasÃ³
  `5/5` desktop Chromium y `5/5` mobile Chromium. El comando exacto solicitado
  `NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm test:e2e -- --grep staff-management` ejecutÃ³ `63` casos
  por el wrapper que reenvÃ­a el separador `--`: `49` pasaron, `12` quedaron skipped por suites live/opt-in,
  y `2` fallaron en `admin-auth.spec.ts` mobile porque el test exige visible el footer lateral que el
  shell responsive oculta. Los `10` casos de staff pasaron dentro de esa corrida.
- AutocrÃ­tica: sin hallazgos crÃ­ticos/high nuevos, secretos, PII en logs, acceso cliente directo,
  migraciones, producciÃ³n, dependencias o commits. Permanecen como concerns transversales las dos
  vulnerabilidades moderadas transitivas registradas en DR-001 y el rate limiting pendiente.
- Reporte completo: `.superpowers/sdd/2026-08-21-t025-staff-lifecycle-plan/task-4c-report.md`.

### Evidencia follow-up Task 4C P2/P3 - 2026-08-22

- Se corrigio el trap de foco del drawer movil, el contraste del focus-visible y la accesibilidad de
  validaciones staff. Se cubren limpieza de exito obsoleto, `aria-invalid`, `aria-describedby` y
  foco al primer campo invalido.
- El cliente mantiene allowlists estrictas; se ampliaron pruebas para respuestas extra en create,
  update, activation y assignments. El harness E2E usa dos perfiles, selecciona por `staffKey`,
  rechaza claves desconocidas y aserta cero requests directos a Firestore/RTDB.
- RED/GREEN focalizado: `24/24`; regresion completa `corepack pnpm test:unit`: `90` archivos,
  `701/701`; lint, typecheck, Prettier focused y build web con `NEXT_PUBLIC_ADMIN_E2E=true` pasan.
- E2E dirigido con `qa/run-e2e.mjs`: desktop `5/5`, mobile `5/5`. Auth Emulator existente:
  `2/2` (email/password y Google sintetico) con el proyecto de integracion correcto. Sin secretos,
  produccion, migraciones, dependencias nuevas ni commits.
- T025 sigue `en-progreso` pendiente de cierre de Task 4D y aprobacion humana; esta evidencia no
  habilita produccion ni claims reales.

### Inicio follow-up Auth Emulator Task 4C - 2026-08-22

- Alcance aprobado: anadir seed QA de Auth Emulator, login email/password browser real y cobertura
  desktop/mobile sin `NEXT_PUBLIC_ADMIN_E2E`, manteniendo el E2E sintetico como cobertura complementaria.
- Restricciones: sin produccion, credenciales reales, dependencias nuevas, Git ni commits. El seed
  debe rechazar cualquier host de Auth que no sea el emulador local.

### Cierre tÃ©cnico y evidencia de verificaciÃ³n T025 - 2026-08-22

- Se completÃ³ el plan `docs/superpowers/plans/2026-08-21-t025-staff-lifecycle-plan.md` y el follow-up `docs/superpowers/plans/2026-08-22-t025-task-4c-auth-emulator-e2e.md`.
- Tasks 1-4 verificadas Ã­ntegramente:
  - Task 1: Contratos de dominio (`StaffProfile`, `StaffRoleAssignment`, `StaffAvailabilityWindow`) con parsers estrictos, allowlists, timezone IANA y validaciÃ³n de objetos planos fail-closed.
  - Task 2: Servicio Firestore transaccional (`apps/functions/src/staff/staff-service.ts`) con IDs deterministas por hash, tenant scope, desactivaciÃ³n soft sin borrado fÃ­sico, `requestId` idempotente y log de auditorÃ­a sin PII.
  - Task 3: Callables protegidos (`apps/functions/src/staff/staff-callables.ts`) con sincronizaciÃ³n de custom claims para `headCoach`/`coach`, lock concurrente compartido con `admin-provisioning` y compensaciÃ³n fail-closed.
  - Task 4A: Firestore Security Rules (`qa/rules/staff-data-boundary.test.ts`) con default-deny estricto (`50/50` pruebas de reglas pasando) e integraciÃ³n Firestore Emulator (`qa/integration/staff-emulator.test.ts`).
  - Task 4B: Safe projection y cliente React (`apps/web/src/lib/staff-client.ts`) que rechaza campos extra antes de pasar a la UI.
  - Task 4C: UI en `/admin/staff` (`apps/web/src/app/admin/staff/page.tsx`), tests unitarios React (`21/21`), E2E sintÃ©tico Playwright (`10/10` desktop y mÃ³vil) y suite Auth Emulator real (`qa/tests/staff-auth-emulator.spec.ts`, `2/2` desktop y mÃ³vil con seed QA `qa/scripts/seed-auth-emulator.mjs`).
  - Task 4D: Gates globales ejecutados con Ã©xito total:
    - Unitarias/integraciÃ³n: `corepack pnpm test:unit` -> 90 archivos, 701 pruebas pasadas.
    - Security Rules: `corepack pnpm test:rules` -> 6 archivos, 50 pruebas pasadas.
    - Linting: `corepack pnpm lint` -> 0 errores / 0 warnings.
    - Typecheck: `corepack pnpm typecheck` -> 6 proyectos de workspace limpios.
    - Formatting: `corepack pnpm format:check` -> OK.
    - Audit: `corepack pnpm audit --audit-level high` -> 0 high / 0 critical (2 moderadas transitivas documentadas en DR-001).
    - Git diff: `git diff --check` -> OK.
- Estado: `T025` pasa a `revisiÃ³n` en `tasks.md` y `Lista/Lista.js`. No es aprobaciÃ³n de producciÃ³n ni habilita escrituras o claims reales. Sin migraciones, secretos, dependencias nuevas, despliegues ni commits.

### Evidencia T047 - Safeguarding de avisos de menores (2026-08-23)

- Backend: `apps/functions/src/announcements/announcement-callables.ts` resuelve Ãºnicamente el estudiante canÃ³nico activo del tenant y sus relaciones guardian activas; rechaza guardian cruzado, estudiante adulto y payloads/IDs invÃ¡lidos. Solo el guardian puede marcar su aviso como leÃ­do; el alumno adulto recibe una lista vacÃ­a.
- Persistencia: `apps/functions/src/announcements/announcement-service.ts` valida IDs antes de construir paths Firestore/in-memory. Se aÃ±adiÃ³ el mapping de deploy para `@bpt-jersey/domain/announcements` en `apps/functions/src/deploy-runtime.ts`; no hubo migraciÃ³n ni escritura en producciÃ³n.
- Portal: `apps/web/src/app/account/guardian-notices.tsx` consume el callable, no renderiza `minorStudentId`, ofrece estado de carga/error/vacÃ­o y marcado de lectura; se cubrieron pruebas de regresiÃ³n y estilos accesibles.
- VerificaciÃ³n: `corepack pnpm test:unit` -> 111 archivos, 919/919; `corepack pnpm test:rules` -> 8 archivos, 63/63; `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build` y `git diff --check` pasan. Prettier focused de todos los archivos modificados pasa.
- Browser: gateway cliente `tests/login-gateway.spec.ts` -> 8/8 desktop/mÃ³vil. El smoke global quedÃ³ 3 fallos conocidos del shell admin protegido sin `NEXT_PUBLIC_ADMIN_E2E`; homepage 2/2, y no afecta `/account` ni T047.
- Seguridad: `corepack pnpm audit --audit-level high` -> 0 high/critical; permanecen 2 vulnerabilidades moderate transitivas del baseline. El `format:check` global sigue seÃ±alando cinco archivos preexistentes no modificados fuera de T047; el alcance modificado estÃ¡ formateado.
- Estado: `T047` pasa a `aprobada` para el alcance tÃ©cnico del piloto; no habilita producciÃ³n ni datos reales.

### Evidencia T048 - Recordatorios in-app de pagos y asistencia (2026-08-23)

- Contrato: \`packages/domain/src/reminders/reminder-contracts.ts\` genera recordatorios derivados y fail-closed para saldo/deuda de pagos y ausencias recientes; no crea persistencia, migraciÃ³n ni duplicaciÃ³n del estado canÃ³nico.
- Audiencia y seguridad: \`apps/functions/src/reminders/reminder-callables.ts\` permite Ãºnicamente \`guardian\` y \`adultStudent\`, resuelve el tenant/familia/estudiante desde las fuentes canÃ³nicas y rechaza payloads no nulos, roles no autorizados y audiencias no resolubles. La respuesta no expone IDs internos.
- Portal: \`/account\` incorpora \`apps/web/src/app/account/client-reminders.tsx\`, con estados de carga, error y vacÃ­o; \`apps/web/src/lib/reminders-client.ts\` valida la allowlist antes de renderizar.
- VerificaciÃ³n: pruebas focalizadas \`13/13\`; \`corepack pnpm test:unit\` -> 115 archivos, 930 pruebas pasadas; \`corepack pnpm test:rules\` termina con cÃ³digo 0; \`corepack pnpm typecheck\`, \`corepack pnpm lint\`, \`corepack pnpm build\` y \`git diff --check\` pasan; Prettier focalizado pasa.
- Browser y dependencias: gateway cliente \`tests/login-gateway.spec.ts\` -> 8/8 desktop/mÃ³vil. \`corepack pnpm audit --audit-level high\` -> 0 high/critical; permanecen 2 vulnerabilidades moderate transitivas del baseline.
- LimitaciÃ³n explÃ­cita: esta primera versiÃ³n es on-demand y todavÃ­a no incluye marcado persistente de leÃ­do; no se aplicÃ³ despliegue ni migraciÃ³n.
- Estado: `T048` pasa a `aprobada` para el alcance tÃ©cnico del piloto; no habilita producciÃ³n ni datos reales.

### Evidencia T046 - Email/SMS e historial externo (2026-08-23)

- Contrato: packages/domain/src/delivery/delivery-contracts.ts valida canal, destinatario, plantilla, variables, tenant y fechas; email exige formato de correo y SMS E.164. El historial excluye destinatario, variables, cuerpo, tokens y credenciales.
- Backend: apps/functions/src/delivery/delivery-service.ts ofrece ExternalDeliveryProvider, historial Firestore/in-memory tenant-scoped, idempotencia por deliveryId, mÃ¡ximo de 3 intentos y backoff acotado solo para fallos retryable. El proveedor unconfigured registra skipped/provider_unconfigured sin red ni gasto.
- Empaquetado y documentaciÃ³n: se aÃ±adiÃ³ el mapping @bpt-jersey/domain/delivery en apps/functions/src/deploy-runtime.ts; el alcance, secretos, degradaciÃ³n y costo quedan documentados en docs/email-sms-delivery.md y STACK.md. No se seleccionÃ³ proveedor real ni se activaron credenciales.
- Seguridad: firestore.rules conserva default-deny para deliveryEvents; no hay endpoint pÃºblico, logs de destinatarios/variables ni secretos hardcodeados. La comunicaciÃ³n a menores sigue requiriendo la polÃ­tica de tutor antes de una activaciÃ³n real.
- VerificaciÃ³n: contract/service tests focalizados 7/7; corepack pnpm test:unit -> 117 archivos, 937 pruebas pasadas; deploy-runtime 2/2; corepack pnpm typecheck, corepack pnpm lint, corepack pnpm build, Prettier focused y git diff --check pasan; corepack pnpm audit --audit-level high -> 0 high/critical y 2 moderate transitivas del baseline.
- LimitaciÃ³n explÃ­cita: la integraciÃ³n con un proveedor real, sus credenciales, alertas de gasto, opt-in/preferencias y orquestaciÃ³n de destinatarios quedan pendientes de decisiÃ³n post-piloto; no se hizo llamada externa, despliegue ni migraciÃ³n.
- Estado: T046 pasa a aprobada únicamente para el alcance tecnico/sintetico; no habilita envio externo real ni produccion.

### Evidencia T052 - Reportes de progreso, reconocimiento y assessment coverage (2026-08-23)

- Contrato y cÃ¡lculo: `packages/domain/src/levels/level-contracts.ts` agrega un reporte agregado sin identificadores de estudiantes con alumnos activos, cobertura de evaluaciones, candidatos de reconocimiento, elegibilidad de promociÃ³n, desglose por nivel y cobertura por skill; el cÃ¡lculo es zero-safe y no duplica estudiantes.
- Backend: `apps/functions/src/levels/progress-report-callables.ts` expone `getProgressReport` solo a `owner`, `administrator`, `headCoach` y `coach`, acepta Ãºnicamente payload nulo y toma el tenant del actor. `progress-report-service.ts` filtra membresÃ­as activas y rechaza registros cruzados antes de combinar asistencia y evaluaciones.
- Portal: `/admin/reports` incorpora un panel live responsive. `apps/web/src/lib/levels-client.ts` valida una allowlist estricta de la respuesta antes de renderizar; la UI solo muestra agregados y no nombres, correos ni IDs.
- VerificaciÃ³n: pruebas focalizadas T052 19/19; `corepack pnpm test:unit` -> 121 archivos, 946 pruebas pasadas; typecheck, lint, build, Prettier focalizado de cÃ³digo y `Lista/Lista.js`, y `git diff --check` pasan; el Markdown completo conserva diferencias histÃ³ricas de formato fuera del alcance.
- QA y lÃ­mites: se cubrieron rol no autorizado, autenticaciÃ³n, payload invÃ¡lido, aislamiento tenant, respuesta malformada, estado de error/reintento, catÃ¡logo vacÃ­o y ausencia de identificadores. Es una proyecciÃ³n on-demand; no agrega persistencia, migraciÃ³n, despliegue ni acceso cliente directo a Firestore.
- Estado: `T052` pasa a `aprobada` para el alcance tÃ©cnico del piloto; no habilita producciÃ³n ni datos reales.

### Evidencia T054 - Backup y restauraciÃ³n (2026-08-23)

- Contrato y seguridad: `apps/functions/src/data/backup-contracts.ts` define allowlist tenant-scoped, manifest versionado, conteos, checksum SHA-256, retenciÃ³n provisional y rutas internas; `backup-service.ts` rechaza cruces de `academyId`, IDs invÃ¡lidos, duplicados y campos de secretos. Auth/RTDB presence/credenciales/tokens/card data quedan fuera.
- Frontera operativa: `backup-callables.ts` limita creaciÃ³n/verificaciÃ³n/preparaciÃ³n a `owner`/`administrator`, exige App Check y rechaza payloads/rutas arbitrarias. El adaptador productivo queda fail-closed hasta aprobar almacenamiento privado, cifrado, ACL, residencia y retenciÃ³n.
- ReversiÃ³n: `restore-runbook.md` documenta backup verificado, token exacto `RESTORE:{operationId}`, captura rollback previa, apply aislado y parada ante fallo. `runTenantRestoreRehearsal` prueba apply â†’ error sintÃ©tico â†’ rollback.
- VerificaciÃ³n: unitarias focalizadas 6/6; suite completa `corepack pnpm test:unit` -> 123 archivos, 952 pruebas pasadas; Firestore Emulator rehearsal 1/1; E2E safety desktop/mobile 2/2; Rules cÃ³digo 0; typecheck, lint, build, Prettier focalizado y `git diff --check` pasan.
- Seguridad y costos: `corepack pnpm audit --audit-level high` -> 0 high/critical; permanecen 2 vulnerabilidades moderate transitivas del baseline. No hubo backup/restore real, migraciÃ³n, despliegue ni gasto externo.
- Estado: `T054` pasa a `revisiÃ³n`; no es aprobaciÃ³n de producciÃ³n.

### RevalidaciÃ³n tÃ©cnica T054 - Backup y restauraciÃ³n (2026-08-24)

- Pruebas: vitest focalizado de backup-service y backup-callables pasÃ³ 2 archivos / 6 pruebas; rehearsal aislado con Firestore Emulator pasÃ³ 1 archivo / 1 prueba (apply -> error sintÃ©tico -> rollback); E2E backup-restore pasÃ³ 2/2 en desktop y mÃ³vil.
- Gates estÃ¡ticos: typecheck de @bpt-jersey/functions, ESLint focalizado, Prettier focalizado y git diff --check pasan.
- Seguridad: la revisiÃ³n focalizada no encontrÃ³ logs, evaluaciÃ³n dinÃ¡mica, HTML peligroso ni secretos; las coincidencias de accessToken estÃ¡n confinadas al validador y a la prueba negativa. El servicio productivo continÃºa unavailable/fail-closed.
- Entorno y lÃ­mites: el rehearsal usÃ³ proyecto demo y puerto aislado del Emulator; no hubo backup/restore real, datos reales, migraciÃ³n, despliegue ni gasto externo. RetenciÃ³n, cifrado, ACL, residencia y eliminaciÃ³n productivas siguen pendientes de T011/T018.

### Evidencia T055 - QA release candidate y correccion responsive (2026-08-23)

- Correccion: `apps/web/src/app/admin/admin-shell.tsx` muestra el rol autorizado tambien en el encabezado visible en movil; `qa/tests/admin-auth.spec.ts` verifica el texto exacto para `owner` y `administrator`.
- Gates: `corepack pnpm test:unit` -> 123 archivos, 952 pruebas pasadas; `corepack pnpm test:rules` -> 8 archivos, 63 pruebas pasadas; `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build`, auditoria sin high/critical y `git diff --check` pasan. Prettier focalizado del alcance modificado pasa.
- Browser: `NEXT_PUBLIC_ADMIN_E2E=true node qa/run-e2e.mjs` -> 77 tests, 63 pasados y 14 omitidos por depender de Auth/staging o ser opt-in; desktop y movil pasan, incluyendo owner, administrator, coach, guardian y adultStudent. La prueba enfocada de autenticacion queda 14/14.
- Rendimiento local: build web medido en 6,26 s; `apps/web/out` en 185 archivos y 2,59 MB. No equivale a una prueba de carga ni a una medicion de staging.
- Limites: el smoke normal sin `NEXT_PUBLIC_ADMIN_E2E` mantiene los 3 fallos conocidos del shell administrativo protegido; el `format:check` global conserva tres archivos preexistentes fuera de este alcance; no hay Auth/staging real, prueba de carga completa ni despliegue.
- Estado: `T055` permanece en `revision`; `T056` permanece `pendiente`. No se habilita produccion.

### Evidencia T055 - Revalidacion de gates (2026-08-24)

- Formato y diff: corepack pnpm format:check y git diff --check pasan despuÃ©s de formatear tres archivos del alcance de announcements/safeguarding.
- Gates locales: corepack pnpm test:unit -> 123 archivos, 952 pruebas pasadas; corepack pnpm test:rules -> 8 archivos, 63 pruebas pasadas usando configuraciÃ³n temporal local; corepack pnpm typecheck y corepack pnpm lint pasan.
- Build: NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build pasa con acceso temporal de red para descargar las fuentes requeridas por Next.js.
- Browser: NEXT_PUBLIC_ADMIN_E2E=true node qa/run-e2e.mjs pasa 63 casos y omite 14 escenarios live/staging u opt-in; el bloqueo local ERR_NETWORK_ACCESS_DENIED de apis.google.com desaparece al ejecutar la misma suite con red aprobada. No se usaron credenciales de producciÃ³n.
- Auditoria: corepack pnpm audit --audit-level high no pudo consultar el endpoint de advisories por restricciÃ³n de red; la Ãºltima evidencia disponible conserva 0 high/critical y 2 vulnerabilidades moderate transitivas documentadas en DR-001.
- Limitaciones: no se ejecutÃ³ prueba de carga completa ni validaciÃ³n live/staging; T018, T023 y T024 siguen pendientes o bloqueadas por T011. T055 permanece en revision, T056 en pendiente, sin despliegue ni migraciÃ³n.

### T011 - Ruta segura de piloto documentada - 2026-08-24

- Se aÃ±adiÃ³ a `docs/operations/t011-retention-residency-deletion-decision-packet.md` una ruta de avance separada de la autorizaciÃ³n de producciÃ³n.
- Alcance propuesto: contratos, adapters, UI y pruebas de T023/T024 Ãºnicamente con emuladores/staging aislado y datos sintÃ©ticos o sanitizados.
- Los caminos de producciÃ³n para salud/soporte, waivers y documentos privados quedan fail-closed mientras T011 siga bloqueada: sin escrituras, importaciones, subidas ni lecturas de datos reales.
- T023 conserva los lÃ­mites de mÃ­nimo dato ya especificados; T024 puede validar autorizaciÃ³n de objetos privados, URLs firmadas, expiraciÃ³n, hashes y rollback con fixtures.
- No se cambiÃ³ el estado de T011, T018, T023 ni T024. Antes de datos reales o despliegue se requiere confirmaciÃ³n explÃ­cita del operador y la revisiÃ³n aplicable en Jersey, con matriz fechada de retenciÃ³n, residencia, transferencias, borrado, backups y restauraciÃ³n.

### Evidencia T023/T024 - ImplementaciÃ³n tÃ©cnica de piloto - 2026-08-24

- T023: se aÃ±adieron contratos de dominio con vocabulario cerrado (none, mobility, sensory, communication, supervision), conditionSummary mÃ¡ximo 1000, staffReferenceLabel mÃ¡ximo 25, fechas y allowlists exactas.
- T023: health-service.ts implementa tenant scoping, relaciÃ³n guardian vigente, asignaciÃ³n coach fail-closed, solicitudes Ãºnicas pending, aprobaciÃ³n atÃ³mica, desactivaciÃ³n sin hard delete y proyecciones sin referencia staff para guardian.
- T023: los callables de lectura/escritura y revisiÃ³n requieren autenticaciÃ³n/rol y estÃ¡n bloqueados salvo BPT_SYNTHETIC_PILOT=true.
- T024: se aÃ±adieron contrato y adaptador de documentos privados para waiver PDF: object key tenant-scoped, URL de subida/descarga de 600 s, hash SHA-256, tamaÃ±o declarado, finalizaciÃ³n, autorizaciÃ³n guardian/admin y revocaciÃ³n no destructiva.
- T024: los callables de upload/finalize/download/revoke estÃ¡n bloqueados fuera del piloto sintÃ©tico; R2 usa el cliente existente y no se crearon buckets ni se leyeron credenciales de producciÃ³n.
- Runtime: los nuevos subpaths se registraron en packages/domain/tsconfig.runtime.json y apps/functions/src/deploy-runtime.ts; la prueba de empaquetado runtime pasa.
- VerificaciÃ³n real: corepack pnpm test:unit -> 129 archivos, 966/966; corepack pnpm typecheck -> pasa en los 6 proyectos; corepack pnpm lint -> pasa; corepack pnpm format:check -> pasa; git diff --check -> pasa; pruebas focalizadas T023/T024 -> 6 archivos, 14/14; deploy-runtime.test.ts -> 2/2.
- AutocrÃ­tica: no hay acceso directo por Firestore Rules, no se exponen actores/IDs de solicitudes a guardian, la autorizaciÃ³n precede la lectura restringida, y las URLs R2 se emiten fuera de transacciones. No hay migraciÃ³n, despliegue, datos reales ni gasto externo.
- Estado: T023 y T024 pasan a revisiÃ³n Ãºnicamente para el alcance tÃ©cnico de piloto. No son aprobaciÃ³n de producciÃ³n; T011 y T018 permanecen abiertos para datos reales, retenciÃ³n, residencia, borrado, consentimiento y waiver final.

### Evidencia T023 - UI de familia del piloto - 2026-08-24

- Se aÃ±adiÃ³ apps/web/src/lib/health-client.ts como frontera callable tipada: valida proyecciones redacted, allowlist de cÃ³digos, IDs de entrada y normaliza errores sin filtrar detalles del backend.
- Se aÃ±adiÃ³ apps/web/src/app/account/family/health-support-panel.tsx dentro de la vista familiar: muestra Ãºnicamente soporte mÃ­nimo operacional, estado de revisiÃ³n y contexto permitido; permite solicitar y cancelar cambios mediante callables, sin acceso directo a Firestore.
- La UI no renderiza studentId, requestId, academyId ni staffReferenceLabel en el DOM; los identificadores permanecen en la frontera de datos/acciones.
- UX: estados loading/empty/error, mensajes seguros, controles de teclado, foco visible, diseÃ±o responsive, y respeto de prefers-reduced-motion, siguiendo la identidad visual existente en STACK.md.
- VerificaciÃ³n real posterior a la UI: corepack pnpm typecheck pasa en los 6 proyectos; corepack pnpm lint pasa; corepack pnpm format:check pasa; git diff --check pasa; suite unitaria completa: 131 archivos y 971/971 pruebas; pruebas focalizadas UI/cliente: 3 archivos y 8/8.
- Estado: T023 continÃºa en revisiÃ³n Ãºnicamente para el alcance tÃ©cnico del piloto sintÃ©tico. No se habilitÃ³ producciÃ³n ni se modificaron Rules, migraciones, datos reales o secretos.

### Evidencia T023 - revisiÃ³n administrativa del piloto - 2026-08-24

- Se ampliÃ³ apps/web/src/lib/health-client.ts con la proyecciÃ³n administrativa estricta, alta/ediciÃ³n de perfiles, lectura bajo demanda y reviewHealthProfileChangeRequest para aprobar o rechazar cambios.
- Se aÃ±adiÃ³ apps/web/src/app/admin/families/health-support-admin-panel.tsx e integraciÃ³n en la familia guardada de /admin/families. El panel permite abrir revisiÃ³n, crear/editar soporte mÃ­nimo, conservar staffReferenceLabel solo en el contexto administrativo y decidir solicitudes guardian.
- La UI evita renderizar studentId, requestId, academyId y campos de auditorÃ­a; las acciones sensibles permanecen detrÃ¡s de los callables protegidos por rol y por BPT_SYNTHETIC_PILOT.
- VerificaciÃ³n real: suite enfocada del flujo familiar/administrativo 5 archivos, 14/14; suite completa 133 archivos, 976/976; typecheck en los 6 proyectos, lint y format:check pasan; no hubo migraciones, despliegues, secretos ni datos reales.
- Estado: T023 continÃºa en revisiÃ³n Ãºnicamente para el alcance tÃ©cnico del piloto sintÃ©tico. La activaciÃ³n productiva sigue bloqueada por T011/T018.

### Evidencia T023 - cierre tÃ©cnico del piloto sintÃ©tico - 2026-08-24

- T023 queda **tÃ©cnicamente resuelta y permanece en revisiÃ³n del operador Ãºnicamente para el alcance del piloto sintÃ©tico**. No autoriza producciÃ³n, datos reales, migraciones, despliegue ni gasto externo.
- CorrecciÃ³n aplicada en apps/functions/src/health/health-service.ts: todas las lecturas de la transacciÃ³n de guardado ocurren antes de la escritura, evitando transacciones invÃ¡lidas en Firestore.
- VerificaciÃ³n real: corepack pnpm test:unit -> 133 archivos, 976/976; Rules focalizadas en Firestore Emulator -> 1 archivo, 4/4; integraciÃ³n Firestore Emulator -> 1 archivo, 1/1; corepack pnpm typecheck, lint y format:check pasan.
- Cobertura del piloto: autorizaciÃ³n por tenant/rol, relaciÃ³n guardian vigente, proyecciÃ³n guardian redacted, aprobaciÃ³n administrativa atÃ³mica, rechazo de accesos no relacionados y bloqueo de lecturas/escrituras directas por Rules.
- T023 permanece en revisiÃ³n tÃ©cnica del piloto; T011 permanece bloqueada y T018 pendiente. La activaciÃ³n productiva de salud/soporte continÃºa cerrada hasta resolver ambos gates.

### Evidencia T024 - endurecimiento y validaciÃ³n del piloto privado - 2026-08-24

- Se endureciÃ³ apps/functions/src/documents/private-document-service.ts: solo menores activos pueden iniciar/finalizar un waiver y una descarga guardian exige relaciÃ³n activa, vigente en tiempo y dentro del tenant.
- Se endureciÃ³ packages/domain/src/documents/document-contracts.ts: objectKey debe coincidir exactamente con academy, student y documentId; se mantienen PDF-only, lÃ­mite de 10 MiB, hash SHA-256 y timestamps estrictos.
- VerificaciÃ³n real: corepack pnpm test:unit -> 133 archivos, 979/979; pruebas focalizadas T024 -> 4 archivos, 20/20; integraciÃ³n Firestore Emulator con R2 sintÃ©tico -> 1 archivo, 1/1; Rules directas de salud/documentos -> 4/4; corepack pnpm typecheck, lint y format:check pasan.
- La integraciÃ³n cubre URL de subida sintÃ©tica, finalizaciÃ³n con hash/tamaÃ±o, descarga guardian autorizada, rechazo de guardian no relacionado y revocaciÃ³n no destructiva. No se usÃ³ bucket R2 real, credenciales, datos reales, migraciÃ³n ni despliegue.
- T024 permanece en revisiÃ³n tÃ©cnica del piloto. El cierre productivo sigue bloqueado por T011/T018 y por las decisiones de residencia, retenciÃ³n y borrado.

### Evidencia T055 - reconciliaciÃ³n del QA tras T023/T024 - 2026-08-24

- La nueva cobertura del piloto privado y de salud se incorpora al control de calidad: la suite unitaria completa queda en 133 archivos y 979/979 pruebas; las Rules focalizadas de salud/documentos pasan 4/4; la integraciÃ³n Firestore/R2 sintÃ©tica de T024 pasa 1/1.
- Typecheck, lint, format:check, git diff --check y el chequeo sintÃ¡ctico de Lista/Lista.js pasan en el alcance revalidado.
- La suite completa test:rules pasÃ³ en Firebase Emulator: 8 archivos y 64 pruebas; los PERMISSION_DENIED observados corresponden a aserciones negativas esperadas.
- Esto actualiza la evidencia tÃ©cnica del release candidate, pero no completa T055: siguen pendientes la carga completa, las validaciones live/staging, la revisiÃ³n del operador y los escenarios dependientes de T018. T055 permanece en revisiÃ³n y no habilita producciÃ³n.

### Evidencia T055 - baseline de rendimiento sintÃ©tico - 2026-08-24

- Se midiÃ³ buildSessionOperationalView con 1.000 reservas, 500 asistencias y 250 check-outs sintÃ©ticos durante 25 iteraciones: mediana 0,579 ms, p95 1,533 ms y mÃ¡ximo 2,088 ms.
- El reporte reproducible queda en docs/operations/t055-performance-baseline.md. No se aplicÃ³ optimizaciÃ³n especulativa: la mediciÃ³n no muestra cuello de botella en la proyecciÃ³n pura.
- RevalidaciÃ³n de Rules: corepack pnpm test:rules â†’ 8 archivos, 64/64 pruebas, cÃ³digo de salida 0. La prueba se ejecutÃ³ con Firebase Emulator y sin datos reales.
- El resultado no sustituye carga de Firebase, red, navegador o staging; T055 continÃºa en revisiÃ³n con esas validaciones pendientes y sin habilitar producciÃ³n.

### AprobaciÃ³n tÃ©cnica T047/T048/T052 - 2026-08-24

- T047: safeguarding tenant-scoped para avisos de menores, proyecciÃ³n sin identificador interno del menor, Rules y E2E verificados.
- T048: recordatorios derivados on-demand con audiencia tenant-scoped, allowlist y gates verdes; sin persistencia adicional.
- T052: reporte agregado staff-only con aislamiento tenant, allowlist, ausencia de identificadores y pruebas focalizadas 19/19.
- Estas aprobaciones son tÃ©cnicas y de alcance piloto; no habilitan producciÃ³n, canales externos, datos reales, migraciones ni sustituyen T011/T018.

### AprobaciÃ³n tÃ©cnica T049 - dashboard operativo diario - 2026-08-24

- ImplementaciÃ³n: buildDailyOperationsDashboard ordena snapshots y elimina roster; el store Firestore/in-memory compone sesiones, reservas, asistencia y check-out desde las fuentes canÃ³nicas.
- Seguridad: callable getDailyOperationsDashboard exige actor autenticado con rol owner/administrator/headCoach/coach, conserva academyId del actor, valida el rango ISO y rechaza consultas mayores a 24 horas. La UI solo renderiza mÃ©tricas operativas; no expone identificadores de estudiantes ni roster.
- QA: pruebas focalizadas dominio 66/66, callable 13/13 y UI 2/2; suite unitaria completa 134 archivos/983 pruebas; typecheck, build de Functions, lint, formato y git diff --check pasan. E2E sintÃ©tico completo: 63 pasaron, 14 omitidos por live/staging u opt-in, 0 fallos con red permitida.
- Alcance: aprobada tÃ©cnicamente para el piloto con datos sintÃ©ticos/emulador; no habilita producciÃ³n, datos reales, migraciones, staging ni resuelve T011/T018. T050/T051/T053 siguen en revisiÃ³n.

### AprobaciÃ³n tÃ©cnica T051 - reportes operativos agregados - 2026-08-24

- ImplementaciÃ³n: `packages/domain/src/reports/operational-report.ts`, `apps/functions/src/reports/` y `apps/web/src/app/admin/reports/operational-report-card.tsx` conectan estudiantes, asistencia, membresÃ­as y finanzas manuales GBP desde las colecciones canÃ³nicas existentes, sin crear esquema ni persistencia adicional.
- Contrato y seguridad: `getOperationalReport` exige `owner` o `administrator`, deriva `academyId` del actor, rechaza payloads extra y rangos mayores a 31 dÃ­as, falla cerrado ante registros cruzados y devuelve Ãºnicamente agregados sin nombres, correos ni IDs. El cliente valida allowlist, coherencia de subtotales y coincidencia exacta del rango solicitado.
- Pruebas avanzadas: contratos entre dominio/backend/web, roles negativos, payload malicioso, tenant mismatch, respuesta inconsistente, ausencia de identificadores y E2E sintÃ©tico de filtro/desktop/mÃ³vil. La carga real y el punto de quiebre de Firestore permanecen en T055.
- VerificaciÃ³n: `corepack pnpm test:unit` -> 139 archivos y 998/998 pruebas; `corepack pnpm test:rules` -> 8 archivos y 64/64; E2E completo -> 65/65 ejecutadas y 14 omitidas por live/staging u opt-in; build web sintÃ©tico, build de Functions, typecheck, lint, format:check y `git diff --check` pasan. `pnpm audit --audit-level high` reporta 0 high/critical y conserva 2 moderate transitivas del baseline.
- RegresiÃ³n corregida: el runtime desplegable vuelve a exportar los callables operativos de T049 y ahora prueba `getDailyOperationsDashboard`, `recordCheckout` y `getOperationalReport`; los fixtures E2E de shell/familias quedaron sincronizados con las superficies conectadas actuales.
- Alcance: `T051` queda aprobada tÃ©cnicamente para el piloto sintÃ©tico. Esto desbloquea tÃ©cnicamente `T053`, pero no habilita producciÃ³n, datos reales, migraciones, despliegue ni resuelve T011/T018; staging y carga completa siguen pendientes.

### AprobaciÃ³n tÃ©cnica T053 - exportaciÃ³n agregada autorizada y auditable - 2026-08-24

- Alcance: `prepareAggregateReportExport` entrega Ãºnicamente `operational_and_progress_aggregates`, compuesto por las proyecciones agregadas ya autorizadas de T051/T052. Exige `owner` o `administrator`, deriva tenant y destinatario del actor, acepta tres propÃ³sitos cerrados, reutiliza el rango mÃ¡ximo de 31 dÃ­as y falla cerrado fuera de `BPT_SYNTHETIC_PILOT=true`. Perfiles, nombres, correos, documentos, salud, safeguarding, consentimientos, evidencias de pago e IDs fuente quedan excluidos.
- ImplementaciÃ³n: el dominio genera CSV determinista con neutralizaciÃ³n de fÃ³rmulas y lÃ­mite UTF-8 de 64 KiB. El servicio calcula SHA-256 y, antes de devolver bytes, crea en una misma transacciÃ³n el journal `exports` y el evento append-only `report.export.prepared`; el archivo se entrega inline y nunca se persiste en Firestore o R2. La UI de Reports permite propÃ³sito/rango y descarga mediante Blob con nombre allowlisted.
- Seguridad y datos: claims/path/tenant/actor se validan antes del rate limit; referencias desviadas cross-tenant, payloads extra, destinatario arbitrario, salida sobredimensionada, reloj/contador malformado y respuestas inconsistentes fallan cerrado. `exportRateLimits` conserva un contador Restricted por tenant/actor, mÃ¡ximo 5 solicitudes/5 minutos; Rules niegan acceso directo a `exports`, `auditEvents` y `exportRateLimits`. El cambio de esquema es aditivo, sin migraciÃ³n ni write productivo; rollback documentado en `docs/data/firestore-data-model.md`.
- QA: pruebas focalizadas de contrato, auditorÃ­a, servicio, callable/rate limit, cliente y UI -> 40/40; suite unitaria completa -> 143 archivos y 1019/1019 pruebas; Rules completas -> 8 archivos y 64/64 en emuladores con puertos aislados para no interferir con otro workspace; E2E completo -> 65 pasadas y 14 live/staging/opt-in omitidas, incluyendo descarga CSV desktop/mÃ³vil y ausencia de IDs/PII. Build web sintÃ©tico, build de dominio/Functions, runtime desplegable, typecheck, lint, format:check y `git diff --check` pasan. `pnpm audit --audit-level high` conserva 2 moderate transitivas y 0 high/critical.
- Alcance operativo: T053 queda aprobada tÃ©cnicamente solo para el piloto sintÃ©tico/emulador. No habilita datos reales, producciÃ³n, migraciones, despliegue ni almacenamiento de exports; T011/T018, carga live/staging de T055 y la confirmaciÃ³n explÃ­cita del operador siguen bloqueando producciÃ³n.

### AprobaciÃ³n tÃ©cnica T050 - dashboard financiero conectado - 2026-08-24

- ImplementaciÃ³n: proyecciÃ³n read-only sobre las colecciones canÃ³nicas de T033/T037/T038 (`memberships`, `invoices` y `payments`), sin colecciÃ³n, migraciÃ³n, write ni estado duplicado. La UI entrega mÃ©tricas GBP, saldos, pagos recientes y una ventana fija de renovaciones de 30 dÃ­as con loading, error, retry, refresh y filtros responsive.
- Seguridad: `getFinancialDashboard` exige identidad verificada y rol activo `owner` o `administrator`, deriva `academyId` del actor y limita cada fuente a 5.000 documentos. Relaciones cross-tenant, huÃ©rfanas, duplicadas, estados financieros incoherentes, sobreasignaciÃ³n, overflow, payloads extra y respuestas con campos no allowlisted fallan cerrado. La respuesta excluye nombres, correos, family/student/membership IDs, mÃ©todo de pago, referencias del proveedor, datos de tarjeta y auditorÃ­a.
- QA: contratos y vertical focalizada 28/28; suite unitaria completa 147 archivos y 1036/1036; Rules completas 8 archivos y 64/64; E2E T050 2/2 y E2E completo 67/67, con 14 escenarios live/staging/opt-in omitidos. Typecheck, lint, format:check, builds de dominio/Functions/web sintÃ©tica y normal, y `git diff --check` pasan. Audit: 0 high/critical y 2 moderate transitivas del baseline.
- Hallazgos corregidos: coherencia entre mÃ©tricas y filas visibles, plan IDs cerrados, claves de filas estables y ciclo de loading compatible con React 19. Alcance Ãºnicamente sintÃ©tico/emulador; no habilita cobros automÃ¡ticos, datos reales, staging, despliegue ni producciÃ³n. T011/T018 mantienen el bloqueo productivo.

### AprobaciÃ³n tÃ©cnica T086 - aislamiento de red E2E y Google Auth diferido - 2026-08-24

- DiagnÃ³stico reproducido: las pruebas genÃ©ricas de autorizaciÃ³n cargaban el callable real `getDailyOperationsDashboard`, y `getAuth` inicializaba de forma anticipada `apis.google.com/js/api.js` aun para sesiones desconectadas.
- CorrecciÃ³n: Firebase Auth conserva el mismo orden de persistencia pero se inicializa sin resolver OAuth; `browserPopupRedirectResolver` se entrega explÃ­citamente solo al ejecutar Google sign-in. La fixture de autorizaciÃ³n responde al dashboard diario con un contrato sintÃ©tico exacto, sin ocultar otras peticiones inesperadas.
- VerificaciÃ³n: prueba Auth 5/5, gates focalizados desktop/mÃ³vil 28/28, suite unitaria 147/1036 y E2E completa 67/67 con 14 omisiones live/staging. No se cambiaron credenciales, roles, claims, emuladores ni destinos de producciÃ³n.

### T087 - ReconciliaciÃ³n de ledger y Lista - 2026-08-25

- El operador aprobÃ³ explÃ­citamente T023 y T024 Ãºnicamente para el piloto sintÃ©tico. Datos reales, producciÃ³n, R2 productivo, migraciones y despliegues continÃºan bloqueados por T011/T018 y los gates de entorno.
- Se corrigieron 21 divergencias de estado entre `tasks.md` y `Lista/Lista.js`; los 87 IDs Ãºnicos de la lista visual reflejan ahora el ledger canÃ³nico.
- Se separaron dependencias de implementaciÃ³n tÃ©cnica de los gates operativos/productivos: T008 y T009 conservan decisiones configurables, T011 conserva el gate de datos reales, T080 conserva T054 como gate de cualquier apply y T055 quedÃ³ `bloqueada` en ese corte; las revalidaciones posteriores la dejaron en `revisiÃ³n` para el piloto sintÃ©tico, sin habilitar producciÃ³n.
- VerificaciÃ³n: comparaciÃ³n automÃ¡tica de estados -> 0 divergencias; auditorÃ­a de dependencias -> 0 tareas aprobadas con dependencias abiertas; `node --check Lista/Lista.js`, `corepack pnpm exec prettier --check Lista/Lista.js` y `git diff --check` pasan.
- ReconciliaciÃ³n correctiva 2026-08-27: se cerró la fila Markdown de T056 y se alineó la evidencia visible de T055 en Lista/Lista.js con el ledger actual (159/1082, Rules 64/64, p95 82 ms, runtime 2/2); node --check Lista/Lista.js, Prettier de Lista/Lista.js, comprobación estructural de T056 y git diff --check pasan. El chequeo global de Prettier de tasks.md continúa fallando igual que en HEAD por formato histórico fuera de este alcance.
- Estado: T087 `aprobada`; T018 pasa a `en-progreso` como Ãºnico WIP. No hubo acceso a secretos, datos productivos, migraciones, despliegues ni gasto externo.

### Evidencia T018 - waiver versionado y registro de aceptaciÃ³n - 2026-08-25

- Dominio y persistencia: contrato Zod estricto para una versiÃ³n publicada por academia, cuatro clÃ¡usulas fijas (`photoVideo`, `medicalTreatment`, `hygiene`, `dataProtection`), hash SHA-256, superseded/withdrawn sin sobrescribir contenido, consentimiento determinista por estudiante/versiÃ³n y revocaciÃ³n no destructiva. Firestore Rules niega todo acceso cliente directo a `waiverVersions`, `consents` y `documents`.
- AutorizaciÃ³n y evidencia: guardian exige relaciÃ³n canÃ³nica activa y estudiante menor; `adultStudent` exige perfil adulto vinculado al actor. La firma escrita debe coincidir con el nombre del usuario autenticado. El servidor genera el PDF exacto, lo guarda en R2 privado, enlaza documento/consentimiento de forma transaccional, elimina objetos huÃ©rfanos ante fallo y solo entrega URL firmada de 600 s tras revalidar y auditar el acceso.
- Superficies: callables administrativos y de cliente fail-closed salvo `BPT_SYNTHETIC_PILOT=true`; `/admin/waivers` exige confirmar que el texto fue revisado y no incluye plantilla legal; `/account/waiver` permite aceptar las cuatro decisiones, descargar evidencia y revocar. Se aÃ±adiÃ³ navegaciÃ³n y retorno de autenticaciÃ³n accesibles y responsive.
- AutocrÃ­tica: se corrigieron deduplicaciÃ³n de sujetos, validaciÃ³n de la proyecciÃ³n final, proyecciÃ³n administrativa mÃ­nima, auditorÃ­a de descarga sensible, asociaciÃ³n accesible de errores, estabilidad del test UI y empaquetado desplegable de `@bpt-jersey/domain/consents`. No quedaron hallazgos crÃ­ticos/high.
- VerificaciÃ³n real: `corepack pnpm test:unit` -> 154 archivos y 1066/1066; `corepack pnpm test:rules` -> 8 archivos y 64/64; Firestore Emulator T018 -> 1/1; Playwright `@waiver` -> 4/4 desktop/mÃ³vil; build completo, typecheck de 6 proyectos, lint, Prettier y `git diff --check` pasan.
- Seguridad residual: `pnpm audit --prod` reporta 0 high/critical y 1 moderate transitive (`uuid@9.0.1` vÃ­a Firebase Admin/Google Cloud Storage opcional), sin uso directo en BPT ni en el flujo R2 de T018.
- Estado y lÃ­mites: T018 pasa a `revisiÃ³n` solo para el piloto sintÃ©tico. No existe texto legal final en las fuentes del proyecto; producciÃ³n, datos reales, migraciones y despliegue siguen bloqueados por T011, por la revisiÃ³n/aprobaciÃ³n legal del operador y por los gates de T055. No se usaron secretos, datos productivos ni servicios externos con gasto.

### AprobaciÃ³n tÃ©cnica T018/T054 - 2026-08-25

- El operador confirmÃ³ explÃ­citamente la aprobaciÃ³n de T018 y T054 Ãºnicamente para el piloto sintÃ©tico. Ambas pasan de `revisiÃ³n` a `aprobada` en el ledger y en Lista.
- La aprobaciÃ³n de T018 cubre la implementaciÃ³n y evidencia tÃ©cnica ya verificada; no aporta ni aprueba texto legal final, polÃ­tica de retenciÃ³n/residencia/borrado, datos reales o activaciÃ³n productiva.
- La aprobaciÃ³n de T054 cubre el contrato y rehearsal local de backupâ†’restoreâ†’rollback; no autoriza backups, restauraciones, migraciones ni applies productivos.
- T055 permanece bloqueada. Sus dependencias tecnicas T018/T054 quedan cerradas, pero siguen abiertos T008, T009 y T011; ademas faltan carga y validaciones live/staging.

### T043/T044 - CRM sintetico backend/UI - 2026-08-26

- Se implementaron contratos de dominio, store in-memory y Firestore tenant-scoped, transiciones de pipeline y timeline idempotente con fallo cerrado ante duplicados conflictivos.
- Se implementaron cinco callables protegidos por `requireUserActor`: crear, listar, actualizar, transicionar y leer timeline. Owner/administrator escriben; owner/administrator/headCoach leen; headCoach queda restringido a sus leads.
- La vista `/admin/crm` mantiene fixtures sintéticos por defecto y solo consulta callables cuando `NEXT_PUBLIC_CRM_BACKEND=true`; no activa datos reales, comunicaciones externas, migraciones ni despliegue.
- Evidencia: pruebas CRM focalizadas 10/10, `corepack pnpm --filter @bpt-jersey/functions typecheck`, `corepack pnpm --filter @bpt-jersey/web typecheck`, suite completa 157 archivos/1076 pruebas, `verify:mvp`, escaneo sin secretos y auditoría sin high/critical (moderadas preexistentes).
- Estado: T043/T044 quedan aprobadas únicamente para el alcance tecnico/sintetico; no habilitan produccion, migraciones, live/staging real ni comunicaciones externas.

### Aprobacion tecnica T055 - piloto sintetico - 2026-08-28

- Reconciliacion: los gates locales actuales pasan con verify:mvp, 159/1082 pruebas unitarias, Rules 64/64, carga sintetica de 240 solicitudes a concurrencia 24 sin fallos (p95 82 ms), runtime desplegable 2/2, secret scan sin coincidencias y audit sin high/critical.
- El smoke E2E sintetico pasa 5 casos y omite 1 escenario dependiente de live/staging; no se usaron credenciales, datos productivos, migraciones, despliegues ni gasto externo.
- Estado: T055 queda aprobada unicamente para el piloto sintetico. T011, la carga live/staging y la validacion productiva siguen pendientes; no se autoriza produccion.

### Evidencia T057 - Checklist post-piloto - 2026-08-26

- Se actualizo `docs/operations/t057-post-pilot-production-checklist.md` con el gate local mas reciente: `verify:mvp` completo, 157/1076 unitarias, Rules 64/64, carga sintetica p95 32 ms, runtime desplegable 2/2, secret scan sin coincidencias y audit sin high/critical.
- El checklist conserva controles explicitamente pendientes: firma del acta T056, decision T011, staging real, costos/alertas, CI/CD protegido y autorizacion explicita del operador.
- Estado: T057 pasa a `revision`; no autoriza T058, despliegue, migracion, uso de datos reales ni gasto externo.

### Evidencia T034 - Adaptador provider-independent sintetico - 2026-08-28

- Dominio: packages/domain/src/payments/payment-contracts.ts define request/response estrictos para checkout hosted, solo GBP, sin datos de tarjeta, URLs HTTPS y fallos normalizados.
- Backend: apps/functions/src/payments/payment-service.ts ofrece proveedor unconfigured, almacenamiento in-memory y adapter con idempotencia tenant-scoped, single-flight concurrente y fallo cerrado ante respuestas invalidas.
- Revalidacion: pruebas focalizadas 6/6; typecheck de @bpt-jersey/domain y @bpt-jersey/functions pasan; ESLint y Prettier del alcance pasan. La evidencia previa conserva verify:mvp 159/159 archivos, 1082/1082 tests, Rules 64/64, carga 240/240 (p95 82 ms) y E2E 5 passed/1 skipped.
- Seguridad y costos: no se manejan tarjetas ni PII de pago, no hay llamadas externas ni secretos, y el costo comprometido es USD 0/mes mientras el proveedor permanece unconfigured.
- Estado: T034 pasa a aprobada �nicamente para el alcance tecnico/sintetico. T010 sigue bloqueada; T035/T036, proveedor real, credenciales, cobro, migracion y produccion permanecen pendientes.

### Evidencia T088 - Catalogo canonico de Levels visible en admin - 2026-08-28

- Causa: `/admin/levels` invocaba siempre `listLevelCatalog`; el preview estatico no tiene por que tener la Function desplegada ni `academies/{academyId}/levelSystems` sembrado, por lo que ocultaba el catalogo sanitizado que ya formaba parte de T083.
- Correccion: `getLevelCatalog` usa por defecto los JSON canonicos sanitizados, los valida con `parseLevelCatalogSource` y `parseLevelCatalogProjection`, y conserva el backend como opt-in exacto mediante `NEXT_PUBLIC_LEVELS_BACKEND=true`. El modo conectado no cae silenciosamente al bundle si Firebase falla.
- RED/GREEN y contrato: la nueva prueba fallo primero porque el cliente seguia invocando Firebase; despues pasaron 17/17 pruebas focalizadas. La suite completa paso 165 archivos y 1122/1122 pruebas; Rules paso 8 archivos y 64/64 con JDK 21.
- Navegador: E2E completo paso 71 escenarios y omitio 14 live/staging/opt-in; el gate final focalizado paso 2/2 en desktop y mobile, con 171 levels, 27 belts, 144 stripes, 11 skills, busqueda/filtros, cero solicitudes a Functions/Firestore/RTDB y sin overflow.
- Seguridad: no se agregaron endpoints, writes, permisos, PII, credenciales ni datos productivos. El escaneo del diff no encontro prefijos de secretos; `pnpm audit --prod --audit-level high` reporto 0 high/critical y 1 moderate transitiva del baseline.
- Gates: lint completo, typecheck de 6 proyectos, build completo y build E2E, Prettier del alcance y `git diff --check` pasan. `verify:mvp` global no pudo superar su primer gate porque `packages/domain/src/attendance/offline-contracts.test.ts`, sin cambios frente a HEAD y fuera de T088, ya incumple Prettier; los gates restantes se ejecutaron por separado. No se ejecuto carga nueva porque T088 no cambia servicios ni writes.
- Estado: T088 queda en `revision` para el preview local/sanitizado. No hubo despliegue, migracion, seed de Firestore, datos reales ni gasto externo.

#### Reanudacion de cierre T088 - 2026-08-28

- El operador solicito cerrar correctamente T088. La tarea vuelve a `en-progreso` como unico WIP.
- Alcance de correccion: normalizar el archivo preexistente `packages/domain/src/attendance/offline-contracts.test.ts` que bloqueaba `verify:mvp`, repetir revision Next/React, seguridad y QA, y reconciliar `tasks.md` con `Lista/Lista.js` antes de aprobar.

#### Cierre aprobado T088 - 2026-08-28

- Correccion de calidad: se normalizo el test preexistente que bloqueaba Prettier; su suite focalizada paso 6/6.
- Revision Next/React: los imports JSON estaticos son analizables por el bundler y el backend queda condicionado por una bandera publica explicita; no se detectaron defectos funcionales ni cambios de permisos, endpoints o writes.
- Seguridad: verify:mvp deja de heredar DEBUG a Firebase para impedir volcados del entorno; 13 valores del log local generado fueron redactados y la repeticion no reprodujo el volcado. El secret scan del diff dio 0 coincidencias y pnpm audit --prod --audit-level high dio 0 high/critical y 1 moderate del baseline.
- QA global: verify:mvp paso formato, lint, typecheck de 6 proyectos, build de 28 rutas, 165 archivos/1122 pruebas unitarias, Rules 8 archivos/64 pruebas con JDK 21, build E2E, carga sintetica 240/240 con 0 fallos (p95 27 ms) y smoke E2E 5 passed/1 skipped esperado.
- QA focalizada: Playwright paso 2/2 en desktop y mobile para las 171 definiciones, filtros por belt/kind y busqueda.
- Estado: T088 queda aprobada para el preview local/sanitizado. No hubo despliegue, migracion, seed de Firestore, datos reales, credenciales productivas ni gasto externo.

### Revalidacion T057 - 2026-08-28

- Se actualizo el checklist con la evidencia fresca del cierre T088 y verify:mvp: 165/1122 unitarias, Rules 64/64, carga 240/240 con p95 27 ms, smoke 5 passed/1 skipped esperado, Playwright T088 2/2 y audit 0 high/critical.
- Deploy-checklist bloquea el avance productivo: T011 sigue sin decision legal/operativa, no existe staging real validado, el rollback solo esta ensayado con Emulator, falta CD con environment protegido y aprobacion manual, y no hay presupuesto/alertas ni autorizacion explicita para T058.
- Estado: T057 permanece en revision y T058 pendiente. No hubo despliegue, migracion, datos reales, credenciales productivas ni gasto.

### Continuacion T057 - T011 y staging sintetico - 2026-08-28

- T011: se revalidaron la ley vigente y guias oficiales JOIC sobre registro, principios/bases, datos de categoria especial, retencion, controller/processor, DPIA y transferencias. El paquete ahora contiene 10 inputs obligatorios y no propone plazos, regiones o bases inventadas.
- Staging: se documento una ruta manual y reversible con proyecto Firebase separado, preview Cloudflare protegido y datos solo sinteticos. Se preservan demo-bpt-jersey para Emulator y bptjersey-f5a25 exclusivamente para produccion.
- Guardas: no crear Firestore antes de aprobar su region irreversible; no habilitar Functions/Blaze antes de aprobar billing, presupuesto y alertas; no almacenar secretos en chat/Git/logs; no automatizar CD antes de una corrida manual limpia.
- Validacion local: rutas internas presentes, 89 IDs sincronizados, T011 bloqueada y T057 en revision sin divergencias; sintaxis de Lista y diff check pasan.
- Estado: T057 vuelve a revision documental. T011 permanece bloqueada y T058 pendiente. No hubo proyecto cloud, alias staging, credenciales, datos reales, migracion, despliegue ni gasto.

### Continuacion T057 - roles T011 no designados - 2026-08-28

- El operador confirmo que no hay decision owner de la academia ni reviewer Jersey designados; ambos estados quedaron registrados explicitamente en el paquete T011.
- Se creo `docs/operations/t011-reviewer-engagement-brief.md` con alcance, entregables, criterios de seleccion, limites y borradores separados para solicitar cotizacion a un asesor y orientacion procedimental a JOIC.
- Ruta elegida: un asesor/DPO con experiencia Jersey debe revisar las decisiones especificas; JOIC queda como fuente complementaria de proceso. La autoaprobacion sin revisor se descarta por menores, datos de salud y transferencias.
- Gate A de staging permanece bloqueado. No se contacto a terceros, no se aprovisiono cloud, no se compartieron datos/credenciales y no se autorizo gasto, migracion o despliegue.
- Autocritica de seguridad: el diff no agrega endpoints, entradas, dependencias o integraciones; `.gitignore` esta presente, el escaneo focalizado encontro 0 secretos y `.firebaserc` conserva `demo-bpt-jersey` sin alias staging. No hay hallazgos criticos/high.
- QA real: `node --check Lista/Lista.js` y Prettier focalizado pasan; reconciliacion -> 88 IDs unicos en tasks/Lista, 76 filas con estado y 0 divergencias; 6/6 rutas presentes y `git diff --check` pasa. Carga, contratos entre servicios y E2E no aplican porque no cambio runtime ni infraestructura.
- Estado: T011 `bloqueada`, T057 `revision` y T058 `pendiente`.

### Checkpoint T057 - integracion T060/T063 para commit y push - 2026-08-30

- Limite versionable: 59 archivos modificados y 10 nuevos, todos dentro del corte T060 de ofertas
  FIFO/booking transaccional, sus invariantes de finanzas/backup/runtime/Rules/UI/QA, el cierre
  fail-closed T063 y la evidencia T057. No se detectaron marcadores de conflicto ni artefactos
  temporales versionables; `.firebase-functions` y reportes locales permanecen ignorados.
- Git: `main`, `origin/main` local y la consulta remota read-only coincidieron en
  `620d6c7d3b9315b6a93df2bd080e70cf536ab6bd`. Se creo `feat/t060-waitlist-offers` desde ese punto y
  el corte funcional quedo en `6eef74d` (`feat(schedule): add transactional waitlist offers`), con
  66 archivos y `git diff --cached --check` limpio. La evidencia operativa se conserva en un commit
  separado antes de publicar la branch para CI/PR; no hacer push directo a `main`.
- QA vigente: `verify:mvp` pasa formato, lint, typecheck, build de 31 rutas, 174 archivos/1217
  unitarias, 10 archivos/78 Rules, carga sintetica 240/240 sin fallos (p95 40 ms) y smoke E2E 5/5
  con 1 omision esperada. Integracion T063 Firestore 2/2; T060 conserva 20/20 integraciones y E2E
  real 6/6 sin retries.
- Artefacto y seguridad: build local de Functions exit 0, manifiesto sin dependencias workspace y
  runtime 3/3. Secret scan acotado 0 coincidencias; audit 2 moderate y 0 high/critical. La advertencia
  Windows `DEP0190` usa argumentos internos estaticos y no aparece en el runner Linux de CI; queda
  como deuda de tooling no bloqueante, sin entrada externa.
- Decision: T057 vuelve a `revision` y no queda WIP activo. El commit funcional esta creado y el
  operador autorizo publicar la branch para ejecutar CI y revision; no es recomendable desplegar.
  T011, staging real, rollback
  productivo, presupuestos/alertas, CD protegido y autorizacion T058 siguen bloqueando produccion.

### T057 - rollback de Cloudflare Pages por release parcial - 2026-08-30

- El push de `aac9e0c` a `main` ejecuto CI #47 y la integracion Git externa de Cloudflare Pages
  publico automaticamente el frontend en produccion como deployment
  `18fa3560-9d6e-4ea7-8636-2f75736dc7fe`. CI y el check de Pages terminaron `success`.
- El bundle publico apuntaba a `bptjersey-f5a25`, mientras el workflow versionado no contiene
  despliegue de Firebase Functions ni Firestore Rules. Se trato como release parcial; no se
  probaron flujos autenticados con credenciales productivas ni se asumio compatibilidad backend.
- El operador autorizo explicitamente revertir `18fa3560` a
  `34b8ba2c-3e31-495a-b439-dc73500e84de`, correspondiente a `620d6c7`. El preflight confirmo
  origen y target exactos, entorno `production`, build exitoso y permiso `Pages Write`.
- El endpoint oficial de rollback respondio `success`; la verificacion posterior confirmo
  `34b8ba2c` como deployment canonico. El alias productivo coincide con su HTML; smoke sin cache:
  `/`, `/login` y `/account/waitlist` responden `200`, y `/admin/waitlists` vuelve a `404`.
- El rollback no modifico commits, ramas, Functions, Rules, Firestore, RTDB, R2 ni datos.
- El operador eligio conservar el comportamiento anterior: `production_branch=main` y
  `production_deployments_enabled=true`. La API ya coincidia con esa decision y no se realizo una
  escritura redundante. Cada push remoto a `main` desplegara Pages; esta seleccion de configuracion
  no sustituye la autorizacion explicita de cada release exigida por T058.
- Estado: T057 permanece `revision`, T058 `pendiente` y T011 `bloqueada`. El rollback restaura
  coherencia operativa, pero no satisface los gates faltantes de produccion.

### Checkpoint T089 - guarda explicita del proyecto productivo Regyfit - 2026-08-31

- Hallazgo: el importador PDF de T084 si esta limitado a `target=emulator`, proyecto
  `demo-bpt-jersey` y host loopback exacto. Sin embargo, la ruta local de importacion Regyfit aun
  acepta `target=staging` con confirmacion y su detector generico de nombres productivos no reconoce
  el ID real `bptjersey-f5a25`.
- Alcance: registrar el ID productivo conocido en una denylist explicita, rechazarlo antes de toda
  lectura o escritura, agregar regresiones directas y de cero acceso al store, y reconciliar
  `STACK.md`, `tasks.md` y `Lista/Lista.js`.
- Fuera de alcance: ejecutar el importador, leer la fuente privada, usar credenciales, conectar red,
  modificar datos, migrar, desplegar, cambiar Cloudflare/Firebase o reescribir la evidencia historica
  de una importacion ya ejecutada.
- Reversion: retirar la constante y las regresiones nuevas; no existe estado remoto ni dato que
  revertir. T089 pasa a `en-progreso` como unico WIP y bloquea abrir otro slice funcional hasta que
  la autocritica de seguridad y QA quede verde.

### Evidencia T089 - guarda productiva Regyfit - 2026-08-31

- RED reproducible: las pruebas nuevas fallaron 3 casos y pasaron 19 porque
  `bptjersey-f5a25` podia atravesar la etiqueta `staging`; la integracion alcanzo una lectura del
  root antes de fallar por otra condicion.
- Correccion: denylist explicita del proyecto productivo por argumento, `GCLOUD_PROJECT` y
  `FIREBASE_CONFIG`; allowlist positiva de staging vacia hasta disponer de un proyecto separado;
  la guarda se ejecuta antes de leer la fuente o Firestore.
- Regresion focal: 2 archivos y 23/23 pruebas pasan, incluidos cero lecturas/escrituras, las tres
  fuentes de project ID y un nombre de staging plausible no aprobado.
- Gate global con JDK 21 solo para el proceso: `verify:mvp` pasa formato, lint, typecheck, build,
  174 archivos/1220 pruebas unitarias, Rules 78/78, carga sintetica 240/240 sin fallos (p95 30 ms)
  y smoke E2E 5/5 con 1 omision esperada.
- Seguridad: escaneo acotado de los 8 archivos modificados sin firmas de secretos ni asignaciones
  aparentes de credenciales. Audit: 0 high, 0 critical y las 2 moderadas transitivas ya registradas
  en DR-001 (`uuid` por Firebase/Google y `@opentelemetry/core` solo por Firebase CLI).
- Autocritica: no se agregaron dependencias, endpoints, red, credenciales, gasto, acceso a datos,
  migracion ni despliegue. No se leyeron ni modificaron los 10 documentos historicos. T089 queda en
  `revision`; T057 sigue en `revision`, T058 `pendiente` y T011 `bloqueada`.
- Hallazgo separado no expuesto hoy: el adaptador base de pagos no esta conectado al runtime, pero
  T061 debe comparar el payload canonico al reutilizar una clave de idempotencia antes de seleccionar
  o habilitar cualquier proveedor. T061 conserva dependencias T010/T034/T035 y estado `pendiente`.

### Reanudacion T062 - productor interno auditado de alertas - 2026-08-31

- Autorizacion explicita del operador para el corte exacto recomendado; T062 pasa a `en-progreso`
  como unico WIP. Depende de T019/T029/T033, ya aprobadas. Es un servicio backend interno sin
  callable publico ni scheduler productivo.
- Fuentes: proyecciones minimas y acotadas de `students`, `memberships` y `attendance` dentro de una
  sola academia. Se validan tenant, referencias, fechas y limites antes de escribir; no se leen ni
  persisten nombres, contactos, notas, IDs financieros ni texto libre.
- Reglas: solo estudiantes activos con membership `trial`/`active` vigente. La politica permanece
  inyectada; los valores 14 dias de inactividad, 30 de lookback, 2 no-shows y 14 de expiracion son
  fixtures sinteticos, no una decision productiva. Una alta reciente sin asistencia usa el inicio de
  membership como baseline y no genera `attendance_gap` prematuro.
- Idempotencia: una corrida se identifica por fecha UTC y hash de entrada minima. Replay identico
  queda unchanged; replay divergente falla cerrado. Antes del GREEN se corrige la identidad de alerta
  para que IDs con `:`/`__` no colisionen, el binding kind/student/day y la atomicidad del store in-memory.
- Persistencia y auditoria: el lote maximo de 200 alertas y un unico evento create-only
  `retention.alerts.generated` se validan por completo y se escriben en una sola transaccion. Las
  correcciones de asistencia se ignoran y se usa solo el registro canonico ya actualizado.
- Criterios de aceptacion: TDD RED/GREEN para limites + 1, tenant mismatch, referencias invalidas,
  membership reciente/antigua, correcciones, colisiones, replay igual/divergente y cero writes ante
  conflicto; unitarias, contrato de auditoria, Firestore Emulator, Rules/regresion y gate global.
- Fuera de alcance: asignar, snoozear, cerrar o borrar alertas; App Check/rate limit nuevos; CRM
  externo, email/SMS, proveedor, contactos, datos reales, credenciales, gasto, migracion, scheduler,
  despliegue o produccion. La reversion retira productor/accion auditada; no limpia datos remotos.

### Evidencia T062 - productor interno auditado de alertas - 2026-08-31

- Implementacion: productor DI-only sin export runtime, endpoint, trigger ni scheduler; carga
  proyecciones minimas tenant-scoped de memberships `trial`/`active`, estudiantes activos y
  attendance, con limites 200/5000 y politica inyectada sin defaults productivos.
- Integridad: dia UTC canonico, IDs v2 length-prefixed, hash SHA-256 estable, baseline por inicio de
  membership y exclusion de asistencia anterior; attendance exige `sessionId`, `studentId`,
  `schemaVersion: "1"` e identidad canonica, y las correcciones opacas apuntan al registro canonico.
- Persistencia: maximo 200 alertas y un evento create-only `retention.alerts.generated` se validan
  y escriben atomicamente. Replay exacto converge; replay divergente, documento alterado o auditoria
  preexistente inconsistente fallan cerrado sin escrituras parciales.
- TDD/autocritica: los RED reprodujeron colisiones/tiempo, atomicidad, modulo ausente, limite global,
  asistencia previa a membership, identidad canonica, inclusion de trial, nombre de accion y contrato
  publico. La reauditoria final reporta 0 critical, 0 high y 0 moderate remanentes.
- Verificacion focal: T062 49/49 mas contrato publico 12/12 (61/61); Firestore Emulator 5/5;
  Rules especifica 7/7; typecheck Domain/Functions/QA y `git diff --check` pasan.
- Gate global final con JDK 21 solo para el proceso: `corepack pnpm verify:mvp` pasa formato, lint,
  typecheck, build de 31 rutas, 175 archivos/1237 unitarias, Rules 78/78, carga sintetica 240/240
  sin fallos (p95 31 ms) y smoke E2E 5/5 con 1 omision esperada. Un intento previo detecto la
  expectativa publica obsoleta; otro tuvo 1 fallo transitorio de carga que paso aislado y en la
  corrida final completa.
- Seguridad: escaneo acotado de 17 archivos sin firmas de secretos; audit 0 high/critical y 2
  moderadas transitivas preexistentes registradas en DR-001. No se agregaron dependencias, PII, red,
  credenciales, gasto, migracion, datos reales, despliegue ni estado remoto.
- Riesgos/gates: `studentReference` aun es el `studentId` interno opaco y debe pseudonimizarse antes
  de datos reales; zona Europe/Jersey, cierre/cleanup, App Check, rate limit y politica T011/T057
  permanecen abiertos. T062 vuelve a `revision`; no queda WIP activo ni autorizacion productiva.
