# tasks.md - BPT Jersey Academy Platform

Estados: `pendiente` -> `en-progreso` -> `revisión` -> `aprobada` -> `desplegada`; `bloqueada` cuando requiere una decisión o evidencia externa.

Cada tarea con impacto en código debe pasar el ciclo completo de autocrítica Nivel 3: seguridad, pruebas relevantes, evidencia y rendimiento cuando corresponda.

El alcance vinculante del piloto es el de `BRIEF.md` y `STACK.md` revisado el 2026-08-18. Los IDs
históricos se conservan para no perder trazabilidad; las filas marcadas post-piloto no bloquean
`T056` y se reubicarán al convertir las fases aprobadas en el plan atómico de implementación.

## M0 - Fundaciones y decisiones operativas

| ID   | Tarea atómica                                                                          | Depende de | Estado    | Evidencia de salida                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T001 | Inicializar Git y el monorepo pnpm (`apps/web`, `apps/functions`, `packages/*`, `qa/`) | -          | aprobada  | `pnpm install --frozen-lockfile --offline` y listado de 7 workspaces pasan; audit sin vulnerabilidades                                                                                                                         |
| T002 | Configurar TypeScript estricto, lint, formato y comandos raíz                          | T001       | aprobada  | `pnpm lint`, `pnpm typecheck` y `pnpm format:check` pasan                                                                                                                                                                      |
| T003 | Configurar Vitest, Testing Library y convenciones de pruebas                           | T002       | aprobada  | Vitest + RTL: 2 archivos/2 pruebas aprobados                                                                                                                                                                                   |
| T004 | Configurar Firebase CLI, proyectos/emuladores dev y archivos de entorno sin secretos   | T001       | aprobada  | Auth/Firestore/RTDB emulators + 3 Rules tests pasan                                                                                                                                                                            |
| T005 | Configurar Playwright, proyectos por viewport y artefactos no versionados              | T002       | aprobada  | E2E smoke desktop/móvil 2/2 y estabilidad 10/10 pasan                                                                                                                                                                          |
| T006 | Crear CI inicial con lint, tipos, unitarias, Rules y E2E smoke                         | T003,T005  | aprobada  | Pipeline CI verde en `main` (run 31142117581)                                                                                                                                                                                  |
| T007 | Documentar clasificación de datos, amenazas y matriz preliminar de acceso              | -          | aprobada  | Documento revisado sin gaps críticos                                                                                                                                                                                           |
| T008 | Confirmar horarios concretos, capacidades y reglas comerciales todavía configurables   | -          | bloqueada | Paquete de decisión `docs/operations/academy-configuration-decision-packet.md`; Town/West y catálogo aprobados en `BRIEF.md`; faltan confirmaciones operativas, horarios, capacidades y políticas de freeze/descuentos/refunds |
| T009 | Confirmar criterios y ponderaciones de evaluación/reconocimiento                       | -          | bloqueada | Aprobación de head coach                                                                                                                                                                                                       |
| T010 | Seleccionar proveedor de pagos disponible en Jersey para post-piloto                   | -          | bloqueada | ADR y costos aprobados; no bloquea pagos manuales ni `T056`                                                                                                                                                                    |
| T011 | Confirmar política de retención, residencia y borrado con asesoría aplicable a Jersey  | -          | bloqueada | Política aprobada                                                                                                                                                                                                              |

## M1 - Identidad, autorización y auditoría

| ID   | Tarea atómica                                                                  | Depende de     | Estado    | Evidencia de salida                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------ | -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T012 | Definir módulos de dominio, contratos base y errores tipados                   | T002,T007      | aprobada  | Pruebas unitarias de contratos                                                                                                                                      |
| T013 | Diseñar colecciones, índices, invariantes y plan de migraciones Firestore/RTDB | T007,T008      | aprobada  | Modelo, rollback, fixture, índices y gate final documentados                                                                                                        |
| T014 | Implementar Auth email/password y Google con emulador                          | T004,T084      | aprobada  | Google usa el popup SDK conectado al Auth Emulator; email/Google y login sin MFA revalidados con unitarias, integración local y E2E responsive; aprobada 2026-08-23 |
| T015 | Implementar roles y custom claims con mínimo privilegio                        | T013,T014      | aprobada  | Parser exacto para seis roles, compatibilidad administrativa y gates globales aprobados sin ampliar provisioning; aprobada 2026-08-23                               |
| T016 | Implementar Firestore/RTDB Rules y pruebas de aislamiento por rol/familia      | T013,T015      | aprobada  | Evaluador fail-closed, actor de seis roles, matriz Firebase exhaustiva y packaging verificados con gates globales; aprobada 2026-08-23                              |
| T017 | Implementar MFA obligatorio para owner/admin                                   | T014,T015      | cancelada | Sustituida por el rediseño administrativo aprobado el 2026-08-11, sin MFA                                                                                           |
| T018 | Implementar consentimiento versionado y registro de aceptación                 | T016,T021-T024 | pendiente | Waiver único versionado, PDF firmado, aceptación/revocación y UI de registro; se ejecuta después de sus fundamentos                                                 |
| T019 | Implementar audit log append-only para cambios sensibles                       | T012,T013,T016 | aprobada  | Contrato discriminado, adapter create-only, tres writers migrados, replay Regyfit moderno/legacy, integración Firestore y gates documentados; aprobada 2026-08-23   |

## M2 - Familias, estudiantes y personal

| ID    | Tarea atómica                                                                                                                             | Depende de     | Estado    | Evidencia de salida                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T020  | Construir design tokens, shell responsive y navegación accesible por rol                                                                  | T002,T015      | aprobada  | Shell responsive, navegación por rol y QA teclado/móvil documentados; aprobada 2026-08-23                                                                                                                                     |
| T020A | Integrar identidad visual oficial: logo en home, login, shell admin y acceso requerido; favicon solo como favicon; añadir navegación Home | T002,T017,T020 | aprobada  | Assets verificados, metadata/favicon, textos de marca conservados, rutas Home, responsive y visual QA desktop/móvil; aprobada 2026-08-23                                                                                      |
| T021  | Implementar perfiles de adultos, menores y tutores                                                                                        | T016,T020      | aprobada  | Domain 7/7, store 3/3, callables 4/4, web client/UI 12/12, suite completa 500/500, Rules 16/16, Firestore Emulator 8/8, lint/typecheck/build/formato, smoke E2E 5/5 y auditoría sin críticos; aprobada 2026-08-23             |
| T022  | Implementar familias multi-child, contactos y relaciones autorizadas                                                                      | T021           | aprobada  | Tasks 1-6 verificadas; suite `533/533`, Rules `23/23`, lint/typecheck/build/formato/diff pasan; E2E `2/2`; audit sin high/critical; aprobada 2026-08-23                                                                       |
| T023  | Implementar datos médicos/soporte con acceso restringido                                                                                  | T021,T011      | bloqueada | Spec reconciliada con `BPTJ FUNCTIONS APP.docx`: condición operacional max 1000 y etiqueta staff max 25; implementación bloqueada hasta resolver T011                                                                         |
| T024  | Implementar documentos y waivers privados en R2 con URLs firmadas                                                                         | T016,T021,T023 | pendiente | Subida y acceso privado del PDF firmado del waiver; evidencia, hash, permisos y expiración probados                                                                                                                           |
| T025  | Implementar cuentas, roles, disponibilidad y asignaciones de coaches/staff                                                                | T015,T020      | aprobada  | Tasks 1-4 verificadas; suite unitaria 90/90 y 701/701; Rules 6/6 y 50/50; Emulator integration 9/9; UI /admin/staff y E2E sintético 10/10; Auth Emulator E2E 2/2 con login real; audit sin high/critical; aprobada 2026-08-23 |

## M2A - Levels IBJJF MVP

| ID   | Tarea atómica                                           | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T083 | Recrear catálogo completo y sección MVP de Levels IBJJF | T025,T072,T084 | aprobada | Tasks 1-5 completadas; 171 definiciones, 27 belts, 144 stripes, 11 habilidades, 165 requisitos; unitarias 101/101 (739 pass); Rules 7/7 (56 pass); Emulator 1/1; E2E 6/6; audit sin high/critical; aprobada 2026-08-23 |

## M3 - Agenda, reservas y asistencia

| ID   | Tarea atómica                                                                         | Depende de     | Estado   | Evidencia de salida                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T026 | Implementar grupos, currículo, clases recurrentes, seminarios y sesiones únicas       | T008,T013,T025 | aprobada | Contratos de dominio 27/27, generador determinístico de sesiones con soporte DST Europe/Jersey, store 6/6, callables protegidos 6/6, UI admin groups/activities 4/4, client 7/7, suite completa 788/788 en 105 archivos; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                           |
| T027 | Implementar elegibilidad, capacidad, roster, booking, mínimo y cancelación a una hora | T021,T026      | aprobada | Contratos y evaluador multicriterio 44/44, store transaccional de capacidad atómica/idempotencia 9/9, callables RBAC 8/8, client 8/8, suite completa 811/811 en 105 archivos; corte de 1h y quórum mínimo validados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                               |
| T028 | Implementar QR/PIN/name search/manual check-in                                        | T022,T027      | aprobada | Contratos de check-in y 4 métodos 54/54, store de asistencia e idempotencia 10/10, callables protegidos RBAC 9/9, client 9/9, suite completa 824/824 en 105 archivos; puntualidad (attended/late) y reglas de seguridad verificadas; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                               |
| T029 | Implementar puntualidad, asistencia, no-show y correcciones auditadas                 | T019,T028      | aprobada | Contratos y parsers de corrección 58/58, store con correctionOf inmutable y reconciliación de no-shows 12/12, callables RBAC 10/10, client 9/9, deploy runtime 2/2, suite completa 831/831 en 105 archivos; eventos de auditoría registrados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                      |
| T030 | Implementar child check-out y autorización de recogida                                | T022,T029      | aprobada | Contratos y parsers de checkout 64/64, 3 métodos (authorizedAdult, independentRelease, staffOverride con notas), store con validación de asistencia previa e idempotencia 13/13, callables RBAC 11/11, client 10/10, deploy runtime 2/2, suite completa 840/840 en 105 archivos; eventos de auditoría registrados; typecheck/build/lint/format pasan; aprobada 2026-08-23 |
| T031 | Implementar vista operativa en vivo sin duplicar la fuente canónica                   | T029,T030      | aprobada | Proyección pura agregada 65/65, store unificado sin estado duplicado 14/14, callable RBAC 12/12, client 11/11, deploy runtime 2/2, suite completa 844/844 en 105 archivos; consistencia y quórum en vivo verificados; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                                                              |

## M4 - Membresías y pagos

| ID   | Tarea atómica                                                                          | Depende de | Estado    | Evidencia de salida                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------- | ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T032 | Implementar catálogo y reglas base de planes/membresías                                | T013       | aprobada  | Tasks 1-6 verificadas; suite `572/572`, Rules `30/30`, lint/typecheck/build/formato/diff pasan; audit sin high/critical; aprobada 2026-08-23          |
| T033 | Implementar lifecycle de membresía: trial, active, paused, overdue, cancelled          | T032       | aprobada  | Lifecycle completo, múltiples suites verdes, gates sin high/critical; aprobada 2026-08-23                                                             |
| T034 | Implementar adaptador provider-independent de pagos post-piloto                        | T010,T012  | pendiente | Contract tests del adaptador; fuera del piloto manual                                                                                                 |
| T035 | Implementar hosted checkout y suscripciones post-piloto sin datos crudos de tarjeta    | T034       | pendiente | Flujo sandbox aprobado; fuera del piloto manual                                                                                                       |
| T036 | Implementar webhooks post-piloto firmados, idempotentes y tolerantes a reintentos      | T019,T035  | pendiente | Repetición/desorden no duplica cargos; fuera del piloto manual                                                                                        |
| T037 | Implementar pagos manuales, facturas, recibos, balances, deuda PAYG y refunds manuales | T019,T033  | aprobada  | Suite completa `629/629`, Rules `44/44`, domain/store/callables/audit verdes; audit sin high/critical; aprobada 2026-08-23                            |
| T038 | Vincular estado manual de pago/membresía y restricciones por deuda                     | T037       | aprobada  | Suite `650/650`, Rules `35/35`, policy/service/Emulator verdes; integración PAYG `1750 -> 0` verificada; audit sin high/critical; aprobada 2026-08-23 |

## M5 - Progreso y reconocimiento

| ID   | Tarea atómica                                                                   | Depende de          | Estado   | Evidencia de salida                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T039 | Implementar evaluaciones 1-5, notas basadas en evidencia y visibilidad familiar | T009,T021,T025,T083 | aprobada | Contratos y parsers de evaluación 14/14, store con agregación y auditoría 7/7, callables RBAC con visibilidad familiar 10/10, client 5/5, deploy runtime 2/2, suite completa 858/858 en 105 archivos; escala 1-5 y 11 habilidades vinculadas; typecheck/build/lint/format pasan; aprobada 2026-08-23                                                               |
| T040 | Implementar skill checklist y resumen completo de progreso                      | T039                | aprobada | Contratos y pure builder buildStudentProgressSummary 16/16, store aggregations 8/8, callables RBAC con visibilidad familiar 12/12, client 6/6, deploy runtime 2/2, suite completa 864/864 en 105 archivos; checklist técnico, clases, horas y elegibilidad no automática probados; typecheck/build/lint/format pasan; aprobada 2026-08-23                          |
| T041 | Implementar rachas y generación explicable de candidatos de reconocimiento      | T029,T039           | aprobada | Contratos y pure functions calculateAttendanceStreak/generateRecognitionCandidates 21/21, store methods 9/9, callables RBAC 16/16, client 8/8, deploy runtime 2/2, suite completa 876/876 en 105 archivos; rachas, pausas médicas justificadas y cola explicable de candidatos para el Head Coach probados; typecheck/build/lint/format pasan; aprobada 2026-08-23 |
| T042 | Implementar revisión/aprobación exclusiva del head coach                        | T015,T041           | aprobada | Contratos y parsers de graduación/promoción 25/25, store con actualización de perfil y auditoría 10/10, callables RBAC headCoach/owner 18/18, client 9/9, deploy runtime 2/2, suite completa 884/884 en 105 archivos; regla de oro de aprobación humana formal, registro inmutable y trazabilidad probados; typecheck/build/lint/format pasan; aprobada 2026-08-23 |

## M6 - Avisos y safeguarding; CRM post-piloto

| ID   | Tarea atómica                                                         | Depende de     | Estado    | Evidencia de salida                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------- | -------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T043 | Implementar pipeline CRM, owner, next action y tareas post-piloto     | T021,T025      | pendiente | Transiciones y filtros probados; no bloquea `T056`                                                                                                                                                                                                                                                                                                               |
| T044 | Implementar timeline CRM automático post-piloto                       | T019,T043      | pendiente | Eventos relevantes aparecen una vez; no bloquea `T056`                                                                                                                                                                                                                                                                                                           |
| T045 | Implementar announcements y mensajes in-app de academia/clase         | T025,T026      | aprobada  | Contratos y parsers de anuncios 7/7, store en Firestore e in-memory con soporte readBy y auditoría 4/4, callables RBAC staff/client 3/3, client 4/4, deploy runtime 2/2, suite completa 902/902 en 109 archivos; canales academy/class/group, estados draft/published/archived y lectura in-app probados; typecheck/build/lint/format pasan; aprobada 2026-08-23 |
| T046 | Implementar email/SMS e historial externo de entrega post-piloto      | T045           | pendiente | Contract tests del proveedor; no bloquea `T056`                                                                                                                                                                                                                                                                                                                  |
| T047 | Aplicar safeguarding a avisos de menores visibles al tutor            | T022,T045      | en-progreso | Iniciada 2026-08-23; diseño y contratos de safeguarding para avisos de menores, visibilidad exclusiva para el tutor familiar y bloqueo de canales privados en curso |
| T048 | Implementar recordatorios in-app de pagos y seguimiento de asistencia | T029,T038,T045 | pendiente | Reglas, audiencia y resolución probadas                                                                                                                                                                                                                                                                                                                          |

## M7 - Dashboard, reportes y cierre del MVP

| ID   | Tarea atómica                                                              | Depende de                                        | Estado    | Evidencia de salida                                                                                  |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| T049 | Implementar dashboard diario de clases, asistencia y child check-out       | T031                                              | revisión  | Panel visible con preview sintético; persistencia canónica real pendiente                            |
| T050 | Implementar dashboard financiero, balances y renovaciones                  | T038                                              | revisión  | Panel financiero visible en preview; persistencia real pendiente                                     |
| T051 | Implementar reportes de students, attendance, memberships y revenue manual | T029,T038                                         | revisión  | Informes y exportes de miembros visibles/probados; conjunto del piloto pendiente                     |
| T052 | Implementar reportes de progreso, reconocimiento y assessment coverage     | T042                                              | pendiente | Filtros y privacidad probados                                                                        |
| T053 | Implementar exportación de datos autorizada y auditable                    | T019,T051,T052                                    | revisión  | Exportación PDF de miembros con límites, rate limit y cleanup probada; exportación general pendiente |
| T054 | Configurar backups, restauración y runbook de rollback                     | T013,T024                                         | pendiente | Restauración de staging demostrada                                                                   |
| T055 | Ejecutar carga, contratos, seguridad, accesibilidad y E2E completo por rol | T018,T019,T021-T033,T037-T042,T045,T047-T054,T083 | revisión  | Unitarias, Rules, integración y E2E sintético documentadas; QA completo por rol y release pendientes |
| T056 | Ejecutar piloto con datos controlados y corregir hallazgos                 | T055                                              | pendiente | Acta de piloto aprobada                                                                              |
| T057 | Preparar checklist post-piloto de producción, monitoreo, costos y rollback | T056                                              | pendiente | Gates de despliegue completos; no forma parte de la aceptación de `T056`                             |
| T058 | Desplegar a producción con confirmación explícita del operador             | T057                                              | pendiente | Deployment verificado y rollback disponible; fuera del piloto                                        |
| T059 | Cerrar proyecto: capability-gap-analysis y registrar `LECCIONES.md`        | T058                                              | pendiente | Lección registrada después de producción; fuera del piloto                                           |

## v2 - post-lanzamiento

- T060 - Booking avanzado, waitlists, créditos y reservas recurrentes; el corte básico de una hora
  ya pertenece a `T027`.
- T061 - Retries, grace periods, proration, promos y workflows de freeze/cancel.
- T062 - Retention alerts y CRM automation.
- T063 - Parent/adult self-service ampliado.
- T064 - Notificaciones externas y automatizadas completas; los avisos in-app básicos pertenecen a
  `T045` y `T048`.
- T065 - Offline attendance con sincronización y resolución de conflictos.
- T066 - Biblioteca técnica adicional posterior a las 11 habilidades del catálogo MVP, lesson planning
  avanzado y automatizaciones de promoción; el catálogo completo MVP y la aprobación humana pertenecen
  al piloto y no se pueden diferir.

## v3 - crecimiento y escala

- T067 - Goals, achievements y resúmenes familiares ampliados; las rachas básicas pertenecen a
  `T041`.
- T068 - Apps nativas iOS/Android.
- T069 - Comunidad moderada.
- T070 - Referrals, privadas, competencias y retail; los seminarios operativos pertenecen a `T026`.
- T071 - Analytics, IA asistida, multi-academia, white label y SaaS.

### Evidencia de implementación T022 (2026-08-19)

- Ledger: T022 pasó de `pendiente` a `en-progreso` antes de tocar código; se ejecuta inline según
  `docs/superpowers/plans/2026-08-19-t022-family-relationships-plan.md` y la spec aprobada.
- RED de Task 1: `corepack pnpm exec vitest run --project node packages/domain/src/families/family-contracts.test.ts packages/domain/src/profiles/profile-contracts.test.ts`
  falló de forma esperada porque `family-contracts` no existía; los 7 tests de perfiles previos pasaron.
- GREEN focused: el mismo conjunto ampliado con `packages/domain/src/contracts.test.ts` pasó `24/24`.
  Cubre enums congelados, familia, relación guardian, borrador de menor, `familyId` opcional, allowlists
  exactas, fechas, IDs, permisos duplicados, campos prohibidos, símbolos, propiedades no enumerables y
  prototipos.
- Implementación: se añadieron `packages/domain/src/families/family-contracts.ts`, sus exports
  source/runtime y la extensión opcional `familyId` en `StudentProfile`; no se crean Auth accounts ni
  claims y el borrador no acepta autoridad clínica, financiera, progreso ni `userId`.
- Gates de Task 1: `corepack pnpm --filter @bpt-jersey/domain typecheck` pasó; `corepack pnpm --filter @bpt-jersey/domain build:runtime`
  pasó; Prettier focused pasó; `git diff --check` focused pasó.
- Autocrítica de seguridad: no hay endpoints, integraciones, secretos ni logs nuevos; las entradas se
  validan como objetos planos con `Reflect.ownKeys`, allowlists exactas, IDs acotados y fechas ISO;
  las salidas se clonan y congelan. Sin hallazgos críticos abiertos. UI/E2E, Rules, rendimiento y
  auditoría de dependencias no aplican todavía a esta unidad; quedan para las tareas del plan.
- Estado: T022 permanece `en-progreso`; Task 1 queda verificada internamente. Task 2 se ejecutó sin
  migración ni I/O productivo y su siguiente acción es el cierre de callables en Task 3.
- Task 2 RED: `corepack pnpm exec vitest run --project node apps/functions/src/families/family-service.test.ts`
  falló de forma esperada porque `family-service` no existía.
- Task 2 GREEN: el focused de store pasó `8/8`; cubre creación atómica multi-child, tutor/Auth existente,
  tenant, colisiones, preservación del envelope, lookup staff/guardian, reasignación de tutor, bajas y
  proyección guardian redacted.
- Store: `apps/functions/src/families/family-service.ts` limita paths a `academies/{academyId}`, lee
  documentos y queries antes de escribir, usa `transaction.create/set`, deriva `minor`, mantiene un único
  tutor, genera relationship IDs deterministas y no elimina documentos.
- Gates Task 2: `corepack pnpm --filter @bpt-jersey/functions typecheck`, Prettier focused y
  `git diff --check` focused pasaron. No se ejecutó aún Emulator: corresponde a Task 4.
- Autocrítica Task 2: errores fail-closed para Auth ausente, tenant distinto, documentos inválidos,
  duplicados y relaciones guardian ambiguas; no hay logs ni datos sensibles añadidos. Rollback de esta
  unidad es revertir código; no hubo migración, backup requerido, staging, producción ni deploy.
- Task 2 deja como siguiente unidad escribir RED para `apps/functions/src/families/family-callables.test.ts`
  y proteger las operaciones con claims/roles y payloads exactos; esa unidad quedó cubierta por Task 3.
- Task 3 RED: `corepack pnpm exec vitest run --project node apps/functions/src/families/family-callables.test.ts`
  falló de forma esperada porque los handlers no existían.
- Task 3 GREEN y regresiones: focused `18/18` en callables, autorización de usuario y deploy runtime;
  Functions typecheck pasó. La primera corrida detectó imports raíz no portables en el nuevo código;
  se corrigieron usando `@bpt-jersey/domain/families` y `@bpt-jersey/domain/profiles`, y el runtime
  portable final pasó sin imports workspace residuales. El harness imprime warnings de Node/sourcemaps
  no bloqueantes de la prueba existente.
- Callables: `createFamily`, `getFamily` y `updateFamily` derivan actor/tenant, aceptan solo owner/admin
  para escritura, guardian solo puede leer con payload `null`, rechazan authority fields y mapean errores
  internos a mensajes públicos genéricos; no hay logging de payloads.
- Gates Task 3: `corepack pnpm --filter @bpt-jersey/functions typecheck`, Prettier focused y
  `git diff --check` focused pasaron. No se desplegó ni se inicializó una operación productiva.
- Task 3 dejó como siguiente acción añadir integración Firestore Emulator y la matriz explícita
  deny-by-default de `families`/`relationships`; esa unidad quedó cubierta por Task 4.
- Task 4: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,auth
"node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts
qa/integration/family-adapters.test.ts qa/integration/firestore-adapters.test.ts"` pasó `9/9`.
  Auth/Firestore Emulator verificó creación staff de dos menores, envelope, lectura guardian redacted,
  guardian cruzado, reasignación, desactivación y duplicado de tutor.
- Rules: `corepack pnpm test:rules` pasó `23/23` en 5 archivos; la matriz explícita de `families` y
  `relationships` cubre get/list/create/update/delete para anónimo, owner, administrator, headCoach,
  coach, guardian y adultStudent. Las Rules siguen deny-by-default; los warnings de permission_denied
  son la salida esperada de las pruebas negativas.
- Índice: `firestore.indexes.json` añade únicamente la consulta `relationships` por `adultUserId` y
  `status`; no se aplicó a producción. Rollback definido como retirar esa entrada antes de cualquier
  despliegue futuro.
- Autocrítica Task 4: el Emulator descubrió y corrigió el uso de objetos simulados como queries; el
  adapter ahora construye `collection().where().limit()` real y conserva dobles unitarios. Sin hallazgos
  críticos, migración, secretos, datos productivos ni deploy.
- Task 4 dejó como siguiente acción escribir RED para `family-client` y las páginas staff/guardian en
  Task 5; esa unidad quedó cubierta por Task 5.
- Task 5 RED: el focused web falló porque `family-client` y las páginas `/admin/families` y
  `/account/family` no existían.
- Task 5 GREEN: `corepack pnpm exec vitest run --project web apps/web/src/lib/family-client.test.ts
apps/web/src/app/admin/families/page.test.tsx apps/web/src/app/account/family/page.test.tsx
apps/web/src/app/account/page.test.tsx apps/web/src/lib/login-flow.test.ts` pasó `17/17`.
- Web: el cliente callable sanitiza payloads, valida proyecciones staff/guardian con allowlists exactas
  y mensajes seguros; la UI staff admite tutor y múltiples menores con validación/foco/estado de doble
  envío; guardian es lectura sin IDs internos, relaciones, acciones de escritura ni campos restringidos.
- Gates web: `corepack pnpm --filter @bpt-jersey/web typecheck` pasó; Prettier focused pasó. El build
  estático con `NEXT_PUBLIC_ADMIN_E2E=true` generó `/admin/families` y `/account/family`.
- Browser QA: `corepack pnpm --dir qa test:e2e --grep "@family"` con `NEXT_PUBLIC_ADMIN_E2E=true`
  pasó `2/2` (desktop Chromium y mobile Chromium), staff multi-child mockeado, consola limpia y sin
  overflow horizontal. Guardian queda cubierto por RTL y la integración Auth/Firestore; no se creó un
  bypass de autenticación para E2E.
- Autocrítica Task 5: no hay acceso Firestore directo en navegador, secretos, PII en logs ni respuesta
  de autoridad visible; labels, foco, alertas, targets y reduced motion siguen el DNA existente.
- Task 6: `docs/data/firestore-data-model.md` documenta `families`, `relationships`, `familyId` de
  menores, ownership `owner`/`administrator`, proyección guardian redacted, límites de permisos, Rules
  deny-by-default, índice `adultUserId ASC, status ASC` y rollback aditivo retirando la entrada antes
  de cualquier despliegue.
- Regresión global: la primera `corepack pnpm test` detectó dos aserciones históricas de navegación que
  esperaban 9 enlaces después de añadir `Families`; se actualizaron a la ruta y total 10, y la suite
  final pasó `74` archivos y `533/533` pruebas.
- Gates finales: `corepack pnpm test` pasó `533/533`; `corepack pnpm test:rules` pasó `5` archivos y
  `23/23` en Emulator; `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`,
  `corepack pnpm format:check` y `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check`
  pasaron. El check de formato requirió formatear `qa/tests/family-relationships.spec.ts`.
- Seguridad final: callables con Auth/tenant/rol, allowlists exactas y errores públicos seguros; no hay
  secretos, endpoints sin autorización, acceso cliente directo, PII en logs ni migraciones/despliegues.
  `corepack pnpm audit --audit-level high` reporta `0` high/critical y las dos moderadas transitivas
  ya registradas en `docs/security/dependency-risk-register.md` (`uuid@9.0.1` y
  `@opentelemetry/core@1.30.1`, DR-001).
- Estado: T022 pasa a `revisión`; no se ejecutaron migraciones, despliegues ni commits. La aprobación
  final queda separada de esta verificación técnica.

### Evidencia de implementación T032 (2026-08-19)

- El ledger conserva T032 en `en-progreso` hasta que los gates finales de Task 6
  pasen; Task 5 actualiza la fila canónica de `plans` sin modificar runtime,
  UI, pagos, membresías lifecycle, migraciones, despliegue ni Git.
- Task 1: focused `11/11` y regresión de dominio `98/98`; se corrigió la
  validación de getters hostiles.
- Task 2: store `15/15`, runtime deploy `2/2` y typecheck; se corrigieron
  seed/get/runtime, preservación del envelope y la superficie de activación.
- Task 3: callables `13/13`, regresión aislada `31/31` y typecheck; se añadió el
  comando explícito `activatePlan` sin hacer editable `active` en `savePlan`.
- Task 4: integración Firestore/Auth Emulator `4/4`; cada caso individual
  `1` pasado (`idempotently`, `lifecycle`, `isolates`, `documents`); Rules
  `30/30`; typecheck y formato pasaron. Se corrigió el read-before-write de
  Firestore y se aislaron las pruebas de integración/envelope.
- La reconciliación documental conserva los diez `planId`/valores exactos de
  `BPT-memberships.docx` y `BRIEF.md`, precios en peniques GBP, PAYG por sesión,
  ownership tenant-scoped, proyección pública solo activa, activación explícita,
  desactivación blanda, acceso directo deny-by-default, sin índice compuesto y
  rollback de seed solo en Emulator/staging.
- No hubo commits, migraciones, escrituras productivas, despliegues, llamadas a
  pagos ni cambios de configuración de Git. El reporte de Task 5 queda en
  `.superpowers/sdd/2026-08-19-t032-membership-catalog-plan/task-5-report.md`.
- Task 6: `corepack pnpm test` pasó `77` archivos y `572/572` pruebas; `corepack
pnpm test:rules` pasó `5` archivos y `30/30` pruebas. `corepack pnpm lint`,
  `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm format:check`
  y `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` pasaron.
- Seguridad final: callables con Auth/rol/tenant, allowlists exactas, proyecciones
  redacted y Rules deny-by-default; no hay secretos, PII en logs, pagos,
  migraciones, despliegues ni integraciones nuevas. `corepack pnpm audit
--audit-level high` conserva solo `2` moderadas transitivas (`uuid` y
  `@opentelemetry/core`) registradas en DR-001; no hay high/critical. La
  protección de abuso/rate limit de catálogo queda como control transversal para
  el gate de endpoints del proyecto, no como una falsa afirmación de que T032 lo
  resolvió.
- T032 pasa a `revisión`; queda pendiente aprobación formal. No se ejecutó commit.

### Evidencia T033 Task 3 (2026-08-19)

- RED: `corepack pnpm exec vitest run --project node apps/functions/src/memberships/membership-service.test.ts` falló de forma esperada porque `membership-service.js` no existía.
- GREEN: el focused final inicial pasó `8/8`; cubre creación `trial`/`active`, referencias same-tenant y relación activa, plan inactivo, estudiante desconocido, familia cruzada, tenant isolation, unicidad current, todas las transiciones válidas, transición inválida/terminal, retry idempotente, `endsAt`, envelope, drafts de auditoría, ausencia de efectos financieros y mapeo seguro de errores del adapter.
- Store: `apps/functions/src/memberships/membership-service.ts` usa transacciones read-before-write sobre `memberships`, `families`, `students`, `plans` y `relationships`; valida contratos T033/T032, limita el scope por tenant/familia/estudiante/membresía, preserva referencias/envelope, deja `cancelled` terminal y agrega `membership.created`/`membership.status.changed` con `appendAuditEventInTransaction`.
- Gates de Task 3: `corepack pnpm --filter @bpt-jersey/functions typecheck` y Prettier focused pasaron. `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` focused no reportó errores; solo warnings de conversión LF/CRLF de Git.
- Autocrítica de seguridad: sin secretos, logs, datos financieros, proveedores, pagos, deuda, invoices, receipts, migraciones, despliegues o writes productivos; errores de transacción no exponen mensajes crudos. Sin hallazgos críticos abiertos.
- Estado: T033 permanece `en-progreso`; Task 4 de callables, Task 5 de Emulator/Rules y Task 6 de documentación/gates completos quedan pendientes. No se hizo commit ni se modificó configuración de Git.

### Fix report de revisión T033 Task 3 (2026-08-19)

- `transitionMembership` ahora valida `familyIds`, `studentIds` y `membershipIds` después de leer y validar el registro, antes de devolverlo o escribirlo.
- `storedFamily`, `storedStudent` y `storedPlan` comparan sus IDs internos con el ID esperado del documento; los checks de tenant permanecen activos.
- La consulta de unicidad por `studentId` ya no usa límite; detecta una membresía vigente después de `101` documentos históricos cancelados sin duplicar estados.
- El fake transaccional falla ante cualquier lectura posterior a la primera escritura; la creación prueba explícitamente que el flujo read-before-write no dispara esa guardia.
- El retry same-state comprueba que no genera writes ni auditoría.
- El focused corregido pasó `9/9`; T033 permanece `en-progreso` porque callables, Emulator/Rules y gates finales siguen fuera de esta Task 3.

### Evidencia final T033 Task 6 (2026-08-19)

- El contrato canónico documenta exactamente los campos `membershipId`, `academyId`, `familyId`,
  `studentId`, `planId`, `status`, `startsAt`, `endsAt`, `nextBillingAt`, `schemaVersion`,
  `createdAt`, `createdBy`, `updatedAt` y `updatedBy`; referencias same-tenant, la tabla completa
  de estados, la unicidad de una sola membresía current y el historial terminal `cancelled`.
- La documentación fija guardian/adultStudent en creación `trial` dentro de su alcance, owner/admin
  para creación y transiciones, coach/headCoach denegados, Functions/Auth/tenant/scopes,
  payloads server-owned, auditoría `membership.created`/`membership.status.changed` create-only con
  campos generados por servidor y redacción sin PII, precios, pagos o deuda.
- También fija Rules browser deny-by-default, que T033 no añade compound indexes, la separación
  T037/T038 para deuda/finanzas manuales, T034-T036 para providers, y rollback solo en Emulator o
  staging aislado mediante cleanup o estado `cancelled`.
- Evidencia exacta acumulada: Task 1 lifecycle focused `8/8` y domain regression `106/106`; Task 2
  audit `12/12`, writer `7/7`, domain `110/110`; Task 3 store `9/9`, contracts/audit `20/20`;
  Task 4 callables `11/11`, regression `36/36`; Task 5 Emulator `6/6`, Rules `37/37`, unit `32/32`.
- Correcciones reconciliadas: lifecycle runtime mapping/draft status; audit getter snapshot y
  contracts expectation; store scope, internal IDs, uniqueness, read-before-write y audit retry;
  callable family-active, date payload y transición inválida real.
- Se conserva T033 en `revisión`, no `aprobada`: las pruebas y gates técnicos pasan, pero esta
  verificación no equivale a aprobación de producción. No se hicieron commits, migraciones, writes
  productivos, deployments, pagos, deuda ni cambios de configuración Git.
- Preocupaciones residuales: `corepack pnpm audit --audit-level high` conserva las dos moderadas
  transitivas de DR-001 (`uuid` y `@opentelemetry/core`), sin high/critical; el rate-limit/protección
  contra abuso sigue siendo un control transversal pendiente y no queda resuelto por T033.

### T037 - Inicio de implementación (2026-08-19)

- Diseño aprobado por el operador: facturas como fuente canónica, pagos manuales append-only en
  efecto, balance/deuda derivados y sin colecciones `balances`/`debts`.
- Autorización aprobada: owner/administrator escriben; guardian/adultStudent solo leen su alcance;
  headCoach/coach quedan denegados.
- El alcance de esta tarea excluye refunds por falta de política aprobada, providers, checkout,
  webhooks, UI, bloqueo de reservas, producción y migraciones.
- T037 pasa a `en-progreso`; la evidencia de cada ciclo RED/GREEN y la autocrítica se agregará aquí
  antes de moverla a `revisión`.

### T038 - Inicio de implementación (2026-08-19)

- Diseño aprobado por el operador: `trial`/`active` permiten solo con deuda PAYG derivada en cero;
  `paused`/`overdue`/`cancelled` deniegan siempre; pagar la deuda restaura el permiso sin cambiar
  automáticamente el estado de membresía.
- La implementación será un guard puro de dominio y un servicio backend read-only que compone
  `MembershipStore` con `FinanceStore`; T027 consumirá el resultado cuando existan bookings.
- El alcance excluye writes de booking, UI, callable, colecciones de restricciones, migraciones,
  deploys, producción, proveedores y cambios automáticos de membresía.
- T038 pasó a `en-progreso` antes de tocar código y siguió el plan TDD
  `docs/superpowers/plans/2026-08-19-t038-financial-access-plan.md`.
- Domain policy: `packages/domain/src/finance/financial-access.ts` y sus pruebas; focused `8/8`,
  suite domain `126/126`, typecheck, runtime build, Prettier e import del subpath
  `@bpt-jersey/domain/finance/access` pasan. `trial`/`active` con deuda cero permiten; deuda
  positiva deniega; `paused`/`overdue`/`cancelled` deniegan siempre; entradas hostiles fallan cerrado.
- Backend read-only: `apps/functions/src/finance/financial-access-service.ts` y sus pruebas;
  focused service/domain `21/21` (`13` service + `8` domain), Functions typecheck y Prettier pasan. Valida tenant/identidad,
  deriva familia/estudiante desde membership y no escribe ni expone payloads financieros.
- Emulator: `qa/integration/financial-access.test.ts`; Firestore Emulator `1/1`, con guardia
  `FIRESTORE_EMULATOR_HOST`, deuda PAYG `1750 -> 0` en dos invoices, recuperación `ALLOWED`, membership sin mutar,
  colecciones de restricciones ausentes y aislamiento cross-tenant.
- Gates finales: `corepack pnpm test` secuencial `85/85` archivos y `650/650` tests; lint,
  typecheck, build, format, audit high y `git diff --check` pasan. Rules requiere Firestore,
  Auth y RTDB; corregido el comando, `35/35` pasan con warnings `permission_denied` esperados.
- Seguridad: sin hallazgos nuevos high/critical; no hay endpoints, secretos, proveedores, writes
  productivos, migraciones ni colecciones nuevas. DR-001 mantiene dos moderadas transitivas y el
  rate limit transversal sigue pendiente. T038 queda en `revisión`, no aprobada ni desplegada.

## Tareas complementarias integradas desde la evidencia del proyecto

Estas tareas no reemplazan las tareas MVP numeradas. Registran trabajo posterior que existía en
la evidencia, pero no tenía un ID propio en el backlog. `tasks.md` conserva el estado oficial y
la evidencia; `Lista/Lista.js` debe reflejar esta sección sin crear tareas fuera de este archivo.

| ID   | Tarea atómica                                                                                | Depende de     | Estado   | Evidencia de salida                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| T072 | Ejecutar descubrimiento estructural read-only de Regyfit                                     | T007,T013      | aprobada | Manifiesto sanitizado, contratos y Playwright offline 2/2; aprobada 2026-08-23                                                  |
| T073 | Implementar autorización, locks y provisioning administrativo de Regyfit                     | T015,T016      | aprobada | Locks renovables, fencing, recuperación y compensación fail-closed; 32 focused y 83 suite; aprobada 2026-08-23                  |
| T074 | Construir shell y panel read-only administrativo de Regyfit                                  | T020,T015      | aprobada | Shell responsive, proyecciones owner/safe, filtros, foco, 24 E2E sintéticos; aprobada 2026-08-23                                |
| T075 | Implementar importer Regyfit idempotente y aplicar lote aprobado                             | T073,T074      | aprobada | Importer protegido, dry-run e importación de 10 registros verificada; aprobada 2026-08-23                                       |
| T076 | Publicar callable protegido de registros Regyfit                                             | T074,T075      | aprobada | Callable v2, smoke 403 sin identidad verificado; aprobada 2026-08-23                                                            |
| T077 | Implementar gateway unificado de login, logout y acceso administrativo                       | T014,T015      | aprobada | Email/Google, destinos allowlisted, logout, E2E sintético documentados; aprobada 2026-08-23                                     |
| T078 | Entregar panel administrativo visible con preview sintético                                  | T020,T021      | aprobada | Overview, Members, Groups, Activities, Attendance, Reports, CRM y Finance; QA 374/374; aprobada 2026-08-23                      |
| T079 | Implementar operaciones de miembros, informes y exportación PDF protegida                    | T021,T024,T053 | aprobada | Callables, límites, rate limit, export journal, PDF Unicode, integración Firestore; QA 427/427; aprobada 2026-08-23             |
| T080 | Validar lote real de PDFs de miembros y planificar importación                               | T079,T054      | aprobada | 8 reportes, 243 canónicos, 0 conflictos, dry-run aprobado; aprobada 2026-08-23                                                  |
| T081 | Implementar navegación responsive administrativa y tablas ordenables                         | T020,T078      | aprobada | Drawer móvil, foco, responsive, ordenación y E2E desktop/móvil; aprobada 2026-08-23                                             |
| T082 | Establecer sincronización permanente entre `tasks.md` y `Lista/`                             | T001           | aprobada | Regla persistente añadida a `AGENTS.md`, Copilot y `MASTER_PROMPT.md`; 83 entradas únicas sincronizadas y `Lista.js` verificado |
| T084 | Impedir que el importador de PDFs trate producción como staging y limitar writes al emulador | T080,T085      | aprobada | Runner/CLI emulator-only, fuente sintética temporal, symlinks rechazados y gates globales verdes; aprobada 2026-08-23           |
| T085 | Fijar `nanoid >=3.3.18` y excluir caches Graphify del formatter                              | T002           | aprobada | `nanoid@3.3.18`, audit sin high/critical y formato global verde; aprobada 2026-08-23                                            |

## Plan de implementación del MVP aprobado

> **Para workers agentic:** usar `subagent-driven-development` o `executing-plans` al ejecutar
> cada fase. Cada cambio funcional sigue RED -> GREEN -> REFACTOR, autocrítica y evidencia fresca.

**Objetivo:** reemplazar previews por un MVP persistente y verificable en emuladores o staging
separado, sin nuevas escrituras o despliegues productivos.

**Arquitectura:** se extiende el monolito modular existente. Los contratos viven en
`packages/domain`, los comandos autorizados y adapters Firestore en `apps/functions`, los clientes
Firebase y UI responsive en `apps/web`, y los gates Rules/integración/E2E en `qa`. Firestore sigue
siendo canónico; RTDB solo puede almacenar presencia efímera.

**Stack:** TypeScript 6.0.3, Zod 4.4.3, Next.js 16.3.0, React 19.2.8, Firebase Admin/Functions,
Vitest 4.1.10, Firebase Emulator Suite y Playwright 1.61.1.

### Restricciones globales

- UI, mensajes y contenido visible: inglés; documentación interna: español.
- `bptjersey-f5a25` es producción y no puede ser alias de local, emulator o staging.
- Piloto: datos sintéticos/sanitizados, pagos manuales, avisos in-app y ninguna dependencia de
  proveedor de pago/email/SMS.
- Toda entrada externa usa schema Zod estricto y `safeParse`; el backend deriva tenant, actor,
  timestamps, estados sensibles e IDs no deterministas.
- Menores no tienen cuenta, comparación pública ni comunicación privada con coaches.
- Belts, stripes y reconocimientos son propuestas hasta aprobación humana del head coach.
- WCAG 2.2 AA: teclado, foco visible/no oculto, labels, errores anunciados, targets >=24px,
  reduced motion y desktop/mobile sin overflow.
- No se crea una segunda fuente de verdad, una capa genérica anticipada ni compatibilidad retroactiva
  sin un consumidor real.
- No hay commit, migración, deploy ni gasto sin la autorización específica que corresponda.

### Orden de ejecución

| Fase | Orden WIP=1                                                                            | Salida verificable                                                                                                                |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| P0   | `T085 -> T084`                                                                         | Toolchain sin high advisories; importaciones productivas imposibles y dry-run/confirm solo contra emulador loopback.              |
| P1   | `T014 -> T015 -> T016 -> T019 -> T021 -> T022 -> T023 -> T024 -> T018 -> T025 -> T083` | Auth/Rules/auditoría revalidados; registro DOCX, waiver, staff y catálogo completo de Levels persistentes.                        |
| P2   | `T032 -> T033 -> T037 -> T038`                                                         | Catálogo Town/West, lifecycle, pagos manuales y deuda PAYG.                                                                       |
| P3   | `T008 -> T026 -> T027`                                                                 | Configuración aprobada; grupos, currículo, clases/seminarios, booking, mínimo y cancelación.                                      |
| P4   | `T028 -> T029 -> T030 -> T031`                                                         | Check-in/out, puntualidad, asistencia y vista operativa canónica.                                                                 |
| P5   | `T009 -> T039 -> T040 -> T041 -> T042`                                                 | Criterios aprobados, skills, evaluaciones, rachas y promociones/reconocimientos revisados sobre el catálogo Levels ya disponible. |
| P6   | `T020 -> T045 -> T047 -> T048 -> T049 -> T050 -> T051 -> T052 -> T053`                 | Portales por rol, avisos internos, dashboards, reportes y exports autorizados.                                                    |
| P7   | `T054 -> T055 -> T056`                                                                 | Restauración, `verify:mvp`, E2E por rol y acta del piloto.                                                                        |

### Trazabilidad obligatoria de los DOCX

Los dos DOCX son fuentes funcionales vinculantes. Una fila solo se considera cubierta cuando su tarea
responsable tiene implementación, pruebas y evidencia; `Lista/Lista.js` debe reflejar estos vínculos.

| Requisito                                                       | Fuente                                             | Tareas responsables | Criterio de entrega MVP                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `FUN-REG-01` datos del participante, sede y preferencia horaria | `BPTJ FUNCTIONS APP.docx`                          | `T021`              | Registro de nombre, fecha de nacimiento, teléfono, email, sede y preferencia de mañana/tarde/noche.                  |
| `FUN-REG-02` tutor legal, menor y contacto de emergencia        | `BPTJ FUNCTIONS APP.docx` + waiver                 | `T022`              | Tutor legal vinculado, relación, teléfono, alternativo y uso en nombre del menor.                                    |
| `FUN-REG-03` condiciones, lesiones, alergias y medicación       | `BPTJ FUNCTIONS APP.docx` + waiver                 | `T023`              | Campo restringido de máximo 1000 caracteres, aviso administrativo y acceso negativo por rol.                         |
| `FUN-WVR-01` waiver único, cláusulas y aceptación               | waiver compartido por el operador                  | `T018`              | Texto versionado, aceptación, revocación, renovación, foto/video, tratamiento médico, higiene y protección de datos. |
| `FUN-WVR-02` PDF firmado como evidencia                         | waiver compartido por el operador                  | `T024`              | PDF firmado subido a R2 privado con hash, firmante, versión, timestamp de servidor y permisos.                       |
| `FUN-CLASS-01` sedes, grupos, currículo, clases y seminarios    | `BPTJ FUNCTIONS APP.docx` + memberships            | `T008,T026`         | Town/West, recurrencia, capacidad, currículo y seminarios disponibles para el piloto.                                |
| `FUN-BOOK-01` mínimo, cancelación y aviso de clase              | `BPTJ FUNCTIONS APP.docx`                          | `T027,T045`         | Mínimo de cuatro una hora antes, override superior del coach y aviso in-app de cancelación.                          |
| `FUN-CHECK-01` QR, manual, distancia y asistencia               | `BPTJ FUNCTIONS APP.docx`                          | `T028,T029`         | QR/manual, señal de 50 metros, cash de coach, puntualidad, no-show y correcciones auditadas.                         |
| `FUN-PROG-01` catálogo completo, habilidades y belts            | `BPTJ FUNCTIONS APP.docx` + inventario Regyfit     | `T083`              | Las 171 definiciones, 27 belts, 144 stripes y 11 habilidades están disponibles dentro del MVP.                       |
| `FUN-PROG-02` horas, clases, rachas, conducta y promociones     | `BPTJ FUNCTIONS APP.docx`                          | `T039-T042`         | Progreso calculado, conducta menor de 16, candidatos explicables y aprobación exclusiva del head coach.              |
| `MEM-01` catálogo, precios y accesos Town/West                  | `BPT-memberships.docx`                             | `T032,T033`         | Todos los planes y accesos del documento, sin omitir Kids, Teens, Adults ni Open Mats.                               |
| `MEM-02` PAYG, cash, deuda y bloqueo de reserva                 | `BPTJ FUNCTIONS APP.docx` + `BPT-memberships.docx` | `T037,T038`         | Pago manual, factura/recibo, doble cobro de deuda pendiente y recuperación de acceso.                                |

Cada fase recibe aquí su bloque de archivos/interfaces/pasos antes de tocar su código. Este corte
just-in-time evita duplicar un plan especulativo para siete subsistemas y mantiene `tasks.md` como
única fuente de verdad.

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

La validación acepta ausencia de host solo para `dry-run`. `confirm` exige exactamente
`127.0.0.1:8080`; rechaza `localhost`, hosts remotos, producción, `staging`, proyectos desconocidos
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

Resultado esperado: falla porque el contrato actual acepta producción como `staging` y la guarda no
distingue `dry-run` de `confirm`.

- [x] **Paso 3 - GREEN: aplicar el contrato mínimo emulator-only**

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
inmediatamente después del parseo, antes de leer el receipt o construir el plan:

```ts
const input = parseMemberPdfImportCliArguments(argv);
validateMemberPdfImportCliEnvironment(input.mode, io.firestoreEmulatorHost);
```

El script pasa el host al runner y no inicializa Admin hasta que target, host, receipt y
confirmación hayan pasado:

```js
await runMemberPdfImportCli(process.argv.slice(2), createApplyServices(), {
  firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
  readReceipt,
  writeReceipt: async (path, content) =>
    writeFile(path, `${content}\n`, { encoding: "utf8", flag: "wx" }),
});
```

- [x] **Paso 4 - verificar GREEN y regresiones focused**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts
corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-service.test.ts
```

Resultado esperado: todos los tests pasan; dry-run no llama `apply`/Admin y confirm solo llega a
`apply` con proyecto demo + host loopback + receipt fresca + confirmación explícita.

- [x] **Paso 5 - actualizar el runbook sin reescribir evidencia histórica**

Añadir a `docs/data/migrations/README.md` una advertencia fechada que declare
`member-pdf-import-run-2026-08-12.yaml` como evidencia histórica no reutilizable, prohíba tomar su
label `staging-allowlist` como autorización y documente el comando emulator-only. No modificar el
YAML histórico ni ejecutar importación.

- [x] **Paso 6 - gates técnicos y de seguridad**

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm build
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

Además, buscar en runner/script cualquier allowlist productiva o flag viejo. La coincidencia del ID
productivo solo es válida en pruebas negativas o documentación histórica.

- [x] **Paso 7 - autocrítica y cierre del WIP**

Revisar autorización previa a I/O, errores sin datos, ausencia de credenciales/logs, dependencia de
host exacto, idempotencia y rollback. Registrar comandos/resultados en la evidencia de `T084`, pasar
`T084` a `revisión`, desbloquear `T083` y sincronizar `Lista/Lista.js`. No crear commit sin pedido
explícito.

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
`NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` y `NEXT_PUBLIC_FIREBASE_ENV=local`. Después,
`signInWithGoogle()` usa siempre `signInWithPopup(auth, new GoogleAuthProvider())`: el SDK dirige ese
mismo flujo a la página IdP local del emulador. `LoginRole` continúa siendo contexto UX; `/admin`
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

En `login-form.test.tsx`, reemplazar el caso que espera un desafío TOTP por dos casos
email/Google que entregan `auth/multi-factor-auth-required` y exigen un error genérico, manteniendo
visible el formulario y sin renderizar `Verify your authenticator`.

- [x] **Paso 2 - verificar RED**

```powershell
corepack pnpm exec vitest run --project web apps/web/src/lib/firebase-client.test.ts apps/web/src/app/login/login-form.test.tsx
```

Resultado esperado: fallos específicos porque Google local intenta usar el adapter huérfano y el
login administrativo todavía renderiza `AdminMfaChallenge`.

Resultado real 2026-08-18: `2` archivos, `3` fallos esperados y `9` pruebas aprobadas. Google falló
con `Firebase emulator auth adapter is not configured`; email y Google no encontraron el alert
genérico porque ambos renderizaron `Verify your authenticator`.

- [x] **Paso 3 - GREEN: aplicar la corrección mínima**

En `firebase-client.ts`, eliminar `EmulatorAuthAdapter`, `emulatorAuthAdapter` y
`registerFirebaseEmulatorAuthAdapter`; mantener la conexión local fail-closed de
`getFirebaseAuth()` y delegar Google directamente:

```ts
export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
}
```

En `login-form.tsx`, eliminar el import/tipo `MultiFactorError`, las operaciones pending/resolver,
`isMfaRequiredError`, el estado `mfaError` y el render de `AdminMfaChallenge`. Todos los errores de
Firebase, incluido `auth/multi-factor-auth-required`, pasan por `toAuthMessage` sin código, email,
token ni detalle de infraestructura. Los artefactos aislados de la cancelada `T017` no se conectan
al gateway ni se ejecutan.

- [x] **Paso 4 - verificar GREEN focused**

```powershell
corepack pnpm exec vitest run --project web apps/web/src/lib/firebase-client.test.ts apps/web/src/lib/auth-client.test.ts apps/web/src/lib/login-flow.test.ts apps/web/src/app/login/login-form.test.tsx apps/web/src/lib/client-auth.test.tsx apps/web/src/lib/admin-auth.test.tsx
```

Resultado esperado: todas las pruebas focused pasan; Google usa popup después de conectar el
emulador y MFA-required queda sanitizado sin reemplazar el formulario.

Resultado real 2026-08-18: `6` archivos y `40/40` pruebas focused aprobadas. El primer intento GREEN
detectó un constructor mock inválido (`11/12`); se corrigió el doble para reflejar la clase del SDK y
la repetición quedó limpia.

- [x] **Paso 5 - integración real con Auth Emulator**

Crear `qa/integration/auth-emulator.test.ts` con usuarios sintéticos únicos. Probar
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
Emulator confirmó alta/login email-password y credencial Google sintética; después cerró sus
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

Además, buscar imports/referencias MFA dentro de `apps/web/src/app/login`; no debe quedar ninguno.
La suite histórica `T017_MFA_*` permanece fuera de CI y no cuenta como evidencia del piloto.

- [x] **Paso 7 - autocrítica y cierre del WIP**

Aplicar `security-baseline`, verificando entorno local exacto, separación selector/claims, ausencia
de registro administrativo, errores genéricos, no persistencia de credenciales/tokens y ningún
acceso productivo. Registrar RED/GREEN/gates y limitaciones aquí, pasar `T014` a `revisión` y
sincronizar `Lista/Lista.js`. No crear usuarios fuera del emulador, no desplegar y no hacer commit.

## Regla permanente de continuidad y sincronización

Esta regla aplica a cualquier sesión, fecha, plataforma o agente, aunque se pierda el chat:

1. Antes de trabajar, leer `BRIEF.md`, `STACK.md` y `tasks.md`; `tasks.md` es el ledger recuperable y la fuente oficial del estado.
2. Todo cambio de código, documentación, prueba, configuración, diseño o despliegue debe pertenecer a una tarea existente de `tasks.md`.
3. Si el trabajo no tiene tarea, crear primero una tarea con ID único, alcance, dependencias, estado `pendiente` y evidencia esperada; después comenzar el trabajo.
4. Al iniciar una tarea, cambiarla a `en-progreso` y registrar la fecha, el alcance y el plan o especificación relacionado.
5. Al terminar una unidad de trabajo, actualizar inmediatamente la fila y añadir debajo la evidencia real: archivos, comandos, resultados, limitaciones, riesgos y rollback cuando corresponda.
6. No marcar `aprobada` solo porque exista código o una especificación: exige pruebas reales, revisión de seguridad y aprobación humana cuando el flujo lo requiera.
7. Si hay implementación o pruebas, pero falta aprobación, usar `revisión`; si falta una decisión externa, usar `bloqueada`; si no hay trabajo real, usar `pendiente`.
8. Actualizar `tasks.md` antes de actualizar `Lista/Lista.js`; la lista visual solo puede representar tareas, estados y evidencias que estén registradas aquí.
9. `Lista/Lista.js`, `Lista.html` y `Lista.css` deben actualizarse en el mismo cambio lógico que `tasks.md`; no se permite dejar el panel visual con datos inventados o atrasados.
10. Al comenzar una nueva sesión, revisar el último estado de `tasks.md`, los cambios del workspace y la evidencia reciente antes de continuar; no depender de la memoria del chat.
11. Antes de cerrar la sesión, verificar que no existan cambios de código sin tarea, estados desactualizados o evidencia ausente; dejar la siguiente acción escrita en `tasks.md`.

## Evidencia del ciclo de autocrítica

### T082 - 2026-08-13

- Implementación: regla permanente de continuidad añadida a `AGENTS.md`, `.github/copilot-instructions.md` y `.cronos/MASTER_PROMPT.md`; `tasks.md` queda definido como ledger persistente y fuente única de verdad entre sesiones.
- Sincronización: `Lista/Lista.js` declara `sourceLedger: "tasks.md"`, representa 83 entradas únicas, incluye `T072-T082` y conserva los estados reconciliados del ledger.
- QA: `node --check Lista/Lista.js` -> exit 0; VM global -> `entries=83`, `uniqueIds=83`, `sourceLedger=tasks.md`, `T072-T082 PASS`, estados esperados PASS; controles de panel, checklist, filtros y expandir/contraer global verificados en la corrida de Task 9.
- Formato: `git diff --check -- tasks.md AGENTS.md .github/copilot-instructions.md .cronos/MASTER_PROMPT.md Lista/Lista.js Lista/Lista.html Lista/Lista.css` -> salida vacía, exit 0.
- Seguridad y operaciones: no se leyeron secretos, no se modificaron datos, no se desplegó, no se migró y no se ejecutaron operaciones destructivas.
- Estado: `T082` pasa a `aprobada` porque la regla, la reconciliación y la verificación tienen evidencia real. La publicación en GitHub continúa sujeta a un commit autorizado.

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
- Reconciliación 2026-08-18: los dos DOCX vinculantes y las decisiones del operador sustituyen para
  el piloto los precios, sedes y reglas provisionales `(f)`. `BRIEF.md` contiene el catálogo
  Town/West y `STACK.md` las fases P0-P7; proveedor, CRM, email/SMS y producción quedan post-piloto.
- Pendiente vigente: confirmar horarios/capacidades configurables y políticas de freeze,
  descuentos y refunds. Esto bloquea sus reglas específicas, no el catálogo base de `T032`.
- Preparación autónoma 2026-08-19: se creó `docs/operations/academy-configuration-decision-packet.md`
  con los valores aprobados, hechos públicos no reconciliados y el conjunto mínimo de decisiones
  operativas. `T008` queda `bloqueada` hasta confirmación de la academia; no se modificaron fixtures,
  contratos, Rules, índices ni valores productivos, y ningún placeholder `(f)` fue promovido.
- Revisión DOCX 2026-08-19: `BPTJ FUNCTIONS APP.docx` sí fija el corte de una hora, la penalización
  Town de GBP 15, el mínimo de cuatro reservas y la capacidad configurable al crear la clase;
  `BPT-memberships.docx` sí fija el catálogo, precios, accesos y límites semanales. El paquete fue
  corregido para no pedir confirmación de esas reglas ya vinculantes; quedan abiertas solo las
  decisiones que los DOCX no fijan.

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

### Responsive admin navigation drawer - 2026-08-12

- Implementación: `AdminShell` conserva un sidebar desktop y añade un drawer móvil con el logo
  oficial, sección activa, botón de cierre, backdrop, `Escape`, cierre al seleccionar una ruta,
  `aria-expanded`, `aria-controls`, `aria-modal` y foco restaurado al control invocador. La
  navegación reutiliza los mismos `next/link` y permanece separada semánticamente por viewport.
- Responsive/a11y: el sidebar desaparece bajo `48rem`; el drawer queda fijo bajo el header, con
  targets mínimos de `44px`, foco visible, `overflow-x: clip` heredado y reduced motion existente.
  El backdrop usa el nombre accesible distinto `Dismiss admin navigation` para evitar controles
  ambiguos.
- TDD/QA: regresión inicial detectó dos fallos reales: foco automático en el montaje inicial y
  consulta ambigua de tres botones de cierre. Corrección mínima aplicada; focused
  `corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/layout.test.tsx`
  -> `2 archivos, 10/10`; suite completa `corepack pnpm test:unit` -> `56 archivos, 386/386`.
- Gates: `corepack pnpm typecheck` -> exit 0; `corepack pnpm format:check` -> exit 0; build web
  normal -> exit 0; ESLint específico de los archivos TypeScript modificados -> exit 0. El lint
  global inspecciona además un worktree ajeno (`.worktrees/admin-access-requests`) y falla por
  una advertencia preexistente fuera de este cambio; no se modificó ese worktree.
- Browser QA: build sintético explícito con `NEXT_PUBLIC_ADMIN_E2E=true` y
  `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-shell.spec.ts --project=desktop-chromium --project=mobile-chromium`
  -> `3/3` ejecutables aprobados y `1` omitido por ser caso móvil en desktop. Verifica sidebar,
  drawer/logo/backdrop, `Escape`, foco skip-link, selección de Members, URL destino, overflow y
  ausencia de errores de consola. El harness estático conserva `adminTestRole` en rutas admin;
  no se alteró la protección de producción.
- Seguridad: no se añadieron endpoints, secretos, PII real, acceso directo a Firestore ni
  dependencias. `corepack pnpm audit --audit-level high` conserva únicamente las 2 vulnerabilidades
  moderadas transitivas ya registradas, sin high/critical. No se versionaron PDFs ni artefactos QA.
- Estado: Task 2 queda en `revisión` hasta aprobación explícita del operador. No se hicieron
  commits, push, despliegues, migraciones ni importaciones reales.

### Task 3 - Validación de lote PDF real - 2026-08-12

- Discovery externo no versionado: se inspeccionaron los ocho PDFs en
  `F:\Proyectos\BPT Jersey\Varios` con `pdf-parse`; no se copiaron archivos, filas, nombres,
  campos, cookies ni credenciales al repositorio o a los logs. La extracción inicial mostró que
  el texto concatena columnas por coordenadas y elimina celdas vacías.
- Corrección TDD: prueba roja en `member-pdf-text.test.ts` por módulo ausente; implementación
  mínima de `formatMemberPdfTextItems` que reconstruye las seis/siete columnas por anclas X y
  conserva vacíos. Regresión sintética del layout -> `1/1`; parser existente + títulos operativos
  -> `16/16`.
- Contrato observado: títulos reales incluyen `ACTIVE MEMBERS`, `ATLETAS ATIVOS REGULARIZADOS`,
  `ATLETAS ATIVOS COM NÚMERO DE SÓCIO`, `ATLETAS ATIVOS SEM NÚMERO DE SÓCIO`, `INACTIVE MEMBERS`,
  `ATLETAS REGULARIZADOS`, `SUSPENSOS` y `TOTAL DE ATLETAS NA BASE DE DADOS`; algunos títulos
  portugueses usan el encabezado inglés exportado. La allowlist de esa combinación quedó limitada
  a los títulos observados y no relaja los títulos históricos genéricos.
- Preview local agregado, sin confirmación: 8/8 reportes parseados; páginas por archivo
  `3,3,1,4,3,3,1,7`; filas declaradas/parseadas `115/115`, `97/97`, `27/27`, `128/128`,
  `88/88`, `98/98`, `1/1`, `243/243`; total fuente `797`; resultado deduplicado `243`;
  duplicados `553`; conflictos `1`; filas sin número de socio en el resultado deduplicado `96`.
- Seguridad: la extracción permanece detrás del callable autenticado existente, con validación de
  bytes PDF, límites de filas y preview explícito; no se añaden endpoints, secretos, logs de PII,
  acceso directo browser-Firestore ni escritura automática. No se confirmó el lote, no se ejecutó
  Firestore ni se tocó R2 real.
- QA del cambio: `corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-text.test.ts apps/functions/src/members/member-pdf-import.test.ts`
  -> `2 archivos, 16/16`; `corepack pnpm --filter @bpt-jersey/functions typecheck` -> exit 0;
  `corepack pnpm --filter @bpt-jersey/functions build` -> exit 0; ESLint específico -> exit 0.
- Estado: parser/layout en `revisión`; la confirmación de importación queda bloqueada hasta que el
  operador revise los agregados y el conflicto del preview, conforme al flujo aprobado. No se
  hicieron commits, push, despliegues, migraciones ni escrituras de datos.

#### Resolución aprobada de estado - 2026-08-12

- Decisión del operador: el solapamiento de estado se resuelve con `suspended` prevaleciendo sobre
  `active`. La regla queda limitada a `membershipStatus`; discrepancias de identidad o campos
  personales continúan bloqueando la importación.
- TDD: prueba roja para la precedencia `active`/`suspended`; implementación mínima en
  `deduplicateMemberRows`; prueba verde `apps/functions/src/members/member-pdf-import.test.ts`
  -> `17/17`.
- Preview real regenerado sin PII: 8 reportes, `797` filas fuente, `243` canónicos, `554`
  duplicados, `0` conflictos, `96` sin número de socio; estados finales `active=114`,
  `inactive=128`, `suspended=1`.
- QA: focused backend `5 archivos, 99/99`; suite global controlada
  `corepack pnpm exec vitest run --project web --project node --maxWorkers=1` -> `57 archivos,
389/389`; typecheck Functions y build Functions pasan; ESLint específico pasa; audit mantiene
  solo las dos vulnerabilidades moderadas transitivas registradas.
- Hallazgo de entorno: la corrida paralela estándar tuvo timeout de workers y 11 errores no
  controlados; la repetición con un worker pasó completa. No se cambió configuración ni se
  atribuyó el timeout al código.
- Producción: continúa bloqueada por el gate operativo: falta referencia verificable de backup
  reciente, restauración probada y `projectId` exacto. No se ejecutó callable real, confirmación,
  escritura Firestore, R2, despliegue ni migración.

### Real Member PDF Import - Task 4 - 2026-08-12

- Estado: `revisión`; no se marca aprobada ni desplegada. La migración YAML queda en
  `status: dry-run-passed`; no afirma aplicación live.
- Seguridad: guards exactos para `staging/bptjersey-f5a25/demo-academy`, rechazo explícito de
  producción/emulador en CLI, límite de PDF de 10 MiB, límites de filas/escrituras, validación de
  `importRunId`, tenant scope e idempotencia; rollback probado como planner-only y sin borrado.
  No se observaron hallazgos críticos/high en los archivos revisados.
- Scan de artefactos: `glob **/*.pdf` y `glob **/*receipt*.json` dentro del checkout -> ningún
  resultado. No se copiaron PDFs ni se persistió receipt. `.env.example` y `apps/web/.env.local`
  existen, pero no fueron leídos; no hay secretos encontrados en runner, CLI o YAML. Los valores
  PII de tests son sintéticos y permanecen en fixtures/contratos de prueba.
- Unitarias: `corepack pnpm test` -> `59` archivos, `427/427` pruebas; warnings no fatales de
  `DEP0190` y sourcemaps temporales faltantes del fixture de deploy.
- Rules: `corepack pnpm test:rules` -> `4` archivos, `9/9`; solo emuladores demo y denegaciones
  esperadas en stderr.
- Integración: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore
"node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts
qa/integration/member-pdf-import.test.ts"` -> `1` archivo, `6/6`; `MetadataLookupWarning` no fatal.
- Gates técnicos: `corepack pnpm typecheck` -> exit 0; `corepack pnpm format:check` -> exit 0;
  `corepack pnpm build` -> Functions y Next exit 0. `corepack pnpm lint` -> exit 1 únicamente por
  warning preexistente en `.worktrees/admin-access-requests/.../admin-shell.tsx`, fuera de este cambio.
- Audit: `corepack pnpm audit --audit-level high` -> `2` vulnerabilidades moderadas conocidas,
  ninguna high/critical; permanecen en el registro existente.
- Browser: build sintético con `NEXT_PUBLIC_ADMIN_E2E=true` + `corepack pnpm --dir qa test:e2e:smoke`
  -> `5/5` ejecutables, `1` omitido esperado; luego build normal restaurado y verificado. No hubo
  sesión Auth live ni lectura live del panel.
- Dry-run real: CLI `--dry-run` contra la fuente aprobada -> `8` reportes, `797` filas fuente,
  `243` canónicos, `554` duplicados, `0` conflictos, `96` sin número, estados `114/128/1`, hash
  `aa9340de9528c2a46f898667fe3e554beabbdba6b8c03ec02b8b757f0ab2fc4f`; coincidió con YAML. No se
  usó `--confirm`, `--yes-confirm-staging`, Admin, Firestore staging ni producción.
- Verificación final: rollback planner focused -> `1/1`; `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev'
diff --check` -> sin salida. No se modificó Git/configuración ni se hizo commit.
- Formato documental: `corepack pnpm exec prettier --check tasks.md
docs/data/migrations/member-pdf-import-run-2026-08-12.yaml
.superpowers/sdd/2026-08-12-real-member-pdf-import/task-4-report.md` -> warning histórico en
  `tasks.md`; no se reformateó el ledger completo para evitar cambios fuera de alcance.
- Gates residuales: backup staging verificado, restauración probada, confirmación explícita y
  cualquier staging apply/verification siguen pendientes; no ejecutar en esta tarea.

### T083 - Regyfit IBJJF Levels - 2026-08-18

- Alcance aprobado: inspeccionar en modo estrictamente read-only la jerarquía completa
  `Levels: JIU-JITSU - IBJJF`, incluyendo cada belt, sus stripes/niveles hijos, orden, edades,
  clases mínimas, días mínimos y demás características observables; después recrear esa
  capacidad como una sección nueva de BPT Jersey.
- Fuente funcional: los dos DOCX indicados por el operador continúan como ley funcional; Regyfit
  se usa únicamente para relevar la estructura detallada de niveles que los documentos no
  enumeran por completo.
- Seguridad: no se leerán ni registrarán credenciales, tokens, cookies, storage, datos de miembros
  ni valores personales. No se pulsarán acciones de crear, editar, copiar, ordenar o eliminar.
- Tooling inicial, resuelto después: antes del cambio, `opencode mcp list` reportó
  `playwright disabled`; la
  presencia del token de extensión se comprobó sin mostrar ni leer su valor. Tras habilitar el
  servidor, un proceso nuevo de `opencode mcp list` reportó `playwright connected`. La sesión
  activa en ese checkpoint todavía debía reiniciarse para incorporar las herramientas MCP y listar
  sus targets.
- QA inicial de configuración y ledger: `node --check Lista/Lista.js` -> exit 0; Prettier de
  `opencode.json` y `Lista/Lista.js` -> aprobado; VM de la lista -> 84 entradas/84 IDs únicos,
  `T083=bloqueada` en ese checkpoint histórico, fuente `tasks.md` y corte `2026-08-18`; parseo de
  `opencode.json` -> aprobado;
  `git diff --check` sobre los tres archivos -> salida vacía.
- Diagnóstico de sesión: después del primer reinicio, `playwright_browser_tabs` devolvió únicamente
  `about:blank`, sin el target autenticado de Regyfit. `npx @playwright/mcp@latest --help`
  confirmó que la conexión a Chrome/Edge existente requiere `--extension`; se añadió esa opción a
  `opencode.json`. El hallazgo es de configuración, no de la sesión Regyfit, y requiere recargar
  OpenCode antes de repetir el handshake.
- Incidente de credencial temporal: el primer listado de targets en modo extensión incluyó el token
  efímero de control dentro de la URL de la página de conexión. Se detuvo la inspección antes de
  leer Regyfit, el operador desconectó/reconectó la extensión y rotó el token. Ningún valor se
  repitió ni persistió en el repositorio; el token anterior debe considerarse revocado.
- Handshake posterior a la rotación: `playwright_browser_find` localizó exactamente
  `Levels: JIU-JITSU - IBJJF` en el tabpanel `Levels`, sin enumerar URLs de conexión ni ejecutar
  acciones mutantes. `T083` pasa a `en-progreso` para el inventario read-only.
- Discovery estructural: el DOM ya contenía toda la jerarquía, por lo que no fue necesario pulsar
  controles de expandir. Se identificaron 27 belts raíz y 144 stripes hijos mediante texto y clases
  de relación; el editor de un nivel se abrió una vez en modo lectura y no se guardó ningún cambio.
- Discovery de características: el endpoint oficial read-only
  `GET /php8/admin/modulos/graduacoes/criar_nivel.php` se consultó con concurrencia máxima 4 y
  devolvió únicamente criterios, paleta, stripe visual y habilidades seleccionadas. No se
  conservaron HTML, inputs ocultos, códigos de acción, cookies, tokens ni datos personales.
- Verificación independiente: cuatro lotes de `43/43/43/42` suman 171 registros, con 27 parents,
  144 children, 0 IDs duplicados, 0 huérfanos y 0 errores materializados. Hay 15 niveles con
  habilidades, 11 habilidades únicas y 165 requisitos: rating 2 en 15 casos y rating 3 en 150.
- Discrepancias pendientes de decisión: White adulto exige 2 meses + 30 días en el parent, pero 2
  meses + 15 días y una paleta distinta en sus cuatro stripes; `GREY AND WHITE BELT 7-8 and 8-10`
  limita parent e hijos a edad máxima 8; White 4-7 no declara edad mínima; varios stripes White
  infantiles dejan de heredar habilidades a partir del quinto. Ninguna discrepancia se corrige por
  inferencia antes de confirmar la precedencia entre DOCX y Regyfit.
- Decisiones del operador: los DOCX prevalecen para edades, clases y tiempo; Regyfit aporta
  jerarquía, orden, colores y habilidades. A los 12 años, Kids o Teens se asigna por head coach y
  Teens es la sugerencia. Los requisitos técnicos se acumulan y las promociones nunca son
  automáticas.
- Contrato aprobado: `BRIEF.md` consolida fuentes, catálogo y alcance del piloto; `STACK.md`
  documenta arquitectura, rutas, colecciones, versionado, permisos, fases, QA y gates de seguridad
  de Levels sin crear una especificación paralela.
- Inventario canónico: `docs/data/ibjjf-levels-observed.sanitized.json` contiene 171 definiciones,
  27 belts, 144 stripes y 11 habilidades, sin IDs Regyfit ni datos de sesión. Validación local: 0
  keys duplicadas, 0 huérfanos y hash de contenido
  `9b039b795f8178c42730ff567ef9283fb385895368115ac2621ce816a829835a` verificado. Los cuatro lotes
  temporales se eliminaron después de consolidar este único artefacto.
- Protección local: `.firebase-config/`, `.firebase-emulators/`, `.playwright-browsers/` y
  `.playwright-mcp/` quedaron ignorados sin inspeccionar su contenido, para impedir que estado de
  herramientas, binarios o una sesión del navegador entren por accidente al repositorio.
- QA documental fresca: `node --check Lista/Lista.js` -> exit 0; VM del ledger -> 84 tareas, 84 IDs
  únicos, estados sincronizados, `T083=en-progreso` y separación de track roadmap/MVP; Prettier de
  `Lista/Lista.js`, `opencode.json` y el inventario -> aprobado; parseo de `opencode.json` ->
  aprobado; `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check` -> salida vacía.
- QA del inventario fresca: 171 definiciones, 27 belts, 144 stripes, 11 habilidades, 0 keys
  duplicadas y 0 huérfanos; SHA-256 recalculado sobre el payload sin `contentHash` coincide con
  `9b039b795f8178c42730ff567ef9283fb385895368115ac2621ce816a829835a`; `mutationsPerformed=false`.
- Seguridad documental: el escaneo de los archivos entregables no encontró claves privadas, API
  keys, credenciales ni valores de token/cookie/password. No se ejecutaron mutaciones, migraciones,
  despliegues ni pruebas contra producción.
- Estado vigente: `pendiente` para P5. El handshake, discovery, precedencia, inventario y diseño
  están cerrados; la guarda crítica `T084` ya no bloquea y Levels espera identidad/tatami canónicos.

### Evidencia de implementación T083 (2026-08-23)

- **Alcance e Implementación:** Recreación e integración canónica completa del catálogo de niveles IBJJF como capacidad MVP obligatoria, según el plan maestro `docs/superpowers/plans/2026-08-19-t083-levels-catalog.md` y `implementation_plan.md` aprobado.
- **Inventario Canónico:** Exactamente 171 definiciones de nivel (27 belts, 144 stripes), 11 habilidades evaluadas y 165 requisitos de habilidades, unificando la precedencia de criterios DOCX (`ibjjf-levels-business-criteria.sanitized.json`) y la jerarquía/visuales observadas (`ibjjf-levels-observed.sanitized.json`).
- **Contratos de Dominio:** `packages/domain/src/levels/level-contracts.ts` con tipado inmutable y parsers exactos `parseLevelCatalogSource` y `parseLevelCatalogProjection`. Exportado en `./levels`. Pruebas unitarias de dominio `9/9` y contratos globales `11/11`.
- **Servicio y Persistencia Firestore:** `apps/functions/src/levels/` (`level-source.ts`, `level-service.ts`, `level-seed.ts`, `level-callables.ts`) implementando hash determinista SHA-256 (`sourceHash`), almacenamiento idempotente en `academies/{academyId}/levelSystems`, `levelDefinitions` y `levelRequirements`, guards anti-producción y script CLI `seed-levels.mjs`.
- **Integración Firestore Emulator:** `qa/integration/level-catalog.test.ts` verificado en emulador local (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`), comprobando seed, idempotencia por hash, consulta y rollback completo de versión sin tocar otras academias.
- **Límites de Seguridad y Firestore Rules:** `firestore.rules` deniega acceso directo de clientes a colecciones de levels (`levelSystems`, `levelDefinitions`, `levelRequirements`). Verificado en `qa/rules/level-catalog-boundary.test.ts` con `56/56` pruebas pasando en 7 suites de reglas.
- **Acceso por Rol y Callable Protegido:** Callable `listLevelCatalog` con aislamiento estricto por tenant `actor.academyId` y allowlist de roles (`owner`, `administrator`, `headCoach`, `coach`, `guardian`, `adultStudent`).
- **Superficies UI (3 Vistas Distintas):**
  - Admin: `/admin/levels` con badge de métricas, filtrado por tipo (All/Belts/Stripes), búsqueda y tarjetas visuales SVG; enlace añadido a `AdminShell`.
  - Coach: `/coach/levels` protegido por `StaffAuthGate` para instructores.
  - Client / Alumnos: `/account/progress` protegido por `ClientAuthGate` con enlace directo desde `/account`.
  - Componente compartido `LevelsBrowser` accesible, responsive y sin controles de mutación/promoción prematura.
- **Pruebas E2E Playwright:** `qa/tests/levels-catalog.spec.ts` pasando `6/6` (desktop-chromium y mobile-chromium) sin console errors, sin page errors ni desbordamiento horizontal.
- **Quality Gates Completos:**
  - `corepack pnpm test:unit` -> 101 archivos, 739 pruebas pasadas limpiamente (exit 0).
  - `corepack pnpm test:rules` -> 7 archivos, 56 pruebas pasadas en Firebase Emulator (exit 0).
  - `corepack pnpm typecheck` -> 6/6 paquetes del workspace limpios (exit 0).
  - `corepack pnpm lint` -> 0 errores, 0 warnings (exit 0).
  - `corepack pnpm format:check` -> Todos los archivos cumplen con Prettier (exit 0).
  - `corepack pnpm audit --audit-level high` -> 0 vulnerabilidades high/critical (2 moderadas transitivas conocidas DR-001).
  - `git diff --check` -> Salida vacía, sin trailing whitespace ni errores de formato.
- **Estado de Producción:** Sin despliegue a producción, sin migraciones productivas, sin APIs de pago nuevas. T083 pasa a estado `revisión` para aprobación formal del operador.

### T085 - Dependencia y formatter - 2026-08-18

- RED reproducible: `corepack pnpm audit --audit-level high` reportó `nanoid@3.3.17` con severidad
  high (`GHSA-2v37-7h3g-55p8`) a través de `postcss@8.5.23`; `corepack pnpm format:check` falló en
  nueve JSON generados bajo `apps/graphify-out/cache`.
- Causa raíz: `postcss` permite `nanoid ^3.3.16`, pero el lockfile conservaba `3.3.17`; pnpm 11 ya
  no lee `package.json#pnpm.overrides`. El primer intento se descartó al emitir pnpm esa advertencia,
  sin presentarlo como solución.
- Corrección mínima: override `nanoid: 3.3.18` en `pnpm-workspace.yaml`, lockfile regenerado y
  `**/graphify-out/` en `.prettierignore`. No se formatearon, borraron ni versionaron los grafos.
- GREEN: `corepack pnpm why nanoid` muestra una única versión `3.3.18`; audit reporta solo las dos
  moderadas ya conocidas y 0 high/critical; `corepack pnpm format:check` pasa.
- Estado: `revisión`. No cambió código funcional, no hubo deploy/migración y `T084` retoma el WIP.

### T084 - Guarda emulator-only del importador PDF - 2026-08-18

- Riesgo corregido: `bptjersey-f5a25` dejó de ser el `approvedProjectId` de un target llamado
  staging. Runner, receipt, rollback planner y CLI aceptan solo `emulator`, `demo-bpt-jersey` y
  `demo-academy`; confirm exige `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` y
  `--yes-confirm-emulator`.
- Datos del piloto: el CLI ya no acepta `F:\Proyectos\BPT Jersey\Varios`; exige
  `%TEMP%\bpt-member-pdf-fixtures`, rechaza roots symlink/junction y solo documenta fixtures
  sintéticos. El YAML productivo de 2026-08-12 permanece intacto como evidencia no reutilizable.
- TDD RED 1: runner focused -> 2 fallos/25 pass porque producción era aceptada y la guarda de host
  no distinguía dry-run/confirm. RED 2 -> 7 fallos/21 pass al exigir la fuente temporal en vez de la
  ruta real. RED 3 -> 1 fallo/28 pass al reproducir el bypass por junction.
- GREEN focused: runner `29/29`; parser/servicio `36/36`. La suite completa posterior al cambio de
  dependencias pasó con `59` archivos y `441/441` pruebas.
- Gates: Rules `4` archivos/`9/9`; lint, typecheck de 6 workspaces, build Functions/Next (19 rutas),
  `format:check`, `node --check qa/scripts/import-member-pdfs.mjs` y `git diff --check` aprobaron.
  Audit: 0 high/critical y 2 moderadas conocidas.
- Seguridad/operaciones: errores genéricos sin PII, guardas antes de receipt/PDF/Admin, proyecto
  demo de Firebase y host loopback exacto. No se leyó la fuente real, no se ejecutó dry-run/confirm,
  no se inicializó Admin, no hubo escritura, migración, deploy, gasto ni acceso productivo.
- Rollback: cambio solo de código/configuración; restaurar runner, script y runbook previos. No hay
  rollback de datos porque no se ejecutó ninguna importación.
- Estado: `revisión`. P0 queda técnicamente cerrado y P1 abre `T014` como único WIP.

### T014 - Auth email/password y Google emulator-only, sin MFA - 2026-08-18

- Revalidación: ADR-005 y `STACK.md` excluyen MFA del piloto, pero el gateway activo todavía
  convertía `auth/multi-factor-auth-required` en `AdminMfaChallenge`. Además, Google local exigía un
  `EmulatorAuthAdapter` que ninguna ruta registraba, aunque el Auth Emulator ofrece el flujo IdP
  interactivo del SDK.
- TDD RED: focused inicial -> `2` archivos, `3` fallos esperados y `9` pruebas aprobadas. Google
  falló con `Firebase emulator auth adapter is not configured`; email y Google renderizaron
  `Verify your authenticator` en lugar del error genérico.
- GREEN: `signInWithGoogle()` usa `signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider())`
  después de la guarda local ya existente; `/login` eliminó estado/imports/render MFA y sanitiza
  todos los fallos mediante `toAuthMessage`. Focused final -> `6` archivos, `40/40`.
- Integración Auth Emulator: proyecto `demo-bpt-jersey`, loopback `127.0.0.1:9099`, `1` archivo y
  `2/2`. Se verificó alta/logout/login email-password y credencial Google con token JSON sintético;
  usuarios/app se limpiaron y los procesos del emulador cerraron correctamente.
- QA global: `corepack pnpm test:unit` -> `59` archivos, `442/442`; `test:rules` -> `4` archivos,
  `9/9`; lint y typecheck de 6 workspaces -> exit 0; build Functions/Next -> 19 rutas estáticas;
  `format:check` y `git diff --check` -> aprobados.
- Browser QA: la primera invocación incluía un `--` propagado al wrapper y ejecutó 51 tests sobre el
  build normal (`23` fallos administrativos esperables, `16` pass, `12` skip). `--list` confirmó la
  causa y el comando corregido seleccionó exactamente 8 casos: gateway desktop/Pixel 7 -> `8/8`;
  repetición `--repeat-each=5` -> `40/40`, sin consola, page errors u overflow.
- Seguridad: selector Administrator/Client sigue siendo solo contexto UX; `/admin` conserva claims
  - `academyId`; no existe registro admin. Sin endpoint, secreto, storage de resolver/token, retries,
    escritura, migración o deploy nuevos. Audit: 0 high/critical y 2 moderadas transitivas conocidas.
- Pruebas avanzadas: contrato SDK + emulador y casos de entorno/error aplicaron y pasaron. Carga no
  aplica a esta corrección de boundary sin endpoint propio ni release; el flujo MFA histórico de
  `T017` permanece aislado y fuera de CI, no como evidencia del piloto.
- Rollback: restaurar `firebase-client.ts`, `login-form.tsx` y sus pruebas; no existe rollback de
  datos porque solo se usaron identidades sintéticas eliminadas del Auth Emulator.
- Estado: `revisión`. `T014` queda técnicamente cerrado; el siguiente WIP de P1 es revalidar `T015`
  contra la matriz completa de roles del MVP.

### P1 / T015 - Contrato de claims para los seis roles con mínimo privilegio

**Objetivo:** definir un contrato estricto y reutilizable para claims `academyId + role` de los seis
actores autenticados del MVP, conservando `owner`/`administrator` como único subconjunto
administrativo. Esta tarea no concede roles desde el navegador ni crea provisioning prematuro para
coaches, tutores o adultos sin sus perfiles, relaciones y asignaciones canónicas.

**Decisión aprobada por el operador el 2026-08-18:** las claims reconocen `owner`, `administrator`,
`headCoach`, `coach`, `guardian` y `adultStudent`. El provisioning existente continúa limitado a
owner/administrator; `T021`, `T022` y `T025` emitirán los demás roles cuando exista la evidencia de
perfil, relación familiar o asignación correspondiente.

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
`owner | administrator`; reconocer un rol nunca concede permisos por sí mismo. Las relaciones,
asignaciones, estado activo y propósito continúan siendo fronteras de sus módulos propietarios.

- [x] **Paso 1 - RED: expresar el contrato exhaustivo de claims**

En `admin-contracts.test.ts`, importar `parseUserClaims` y añadir:

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

Resultado esperado: falla porque `parseUserClaims`/`UserClaims` todavía no existen.

Resultado real 2026-08-18: `1` archivo, `2` fallos esperados y `5` pruebas aprobadas. Ambos casos
fallaron con `parseUserClaims is not a function`; los contratos administrativos existentes
permanecieron verdes.

- [x] **Paso 3 - GREEN: implementar parser genérico y narrowing administrativo**

En `admin-contracts.ts`, validar con `Reflect.ownKeys`, `userRoles` y errores estructurados. El parser
administrativo consume el resultado genérico y aplica únicamente el narrowing:

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
`provisionAdminRoleWithServices`, `adminRoleSchema` ni el frontend: sus límites owner/admin son
deliberados y deben seguir fail-closed.

- [x] **Paso 4 - verificar GREEN focused**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/auth/admin-contracts.test.ts packages/domain/src/contracts.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts
```

Resultado esperado: contrato genérico, exports, narrowing admin y provisioning pasan sin ampliar
autoridad.

Resultado real 2026-08-18: parser directo + entrypoint público -> `2` archivos, `14/14`. El export
público tuvo un RED separado (`parseUserClaims is not a function`) antes de restaurarse. Focused
completo posterior -> `4` archivos, `50/50`.

- [x] **Paso 5 - reforzar las pruebas negativas de elevación**

En `admin-authorization.test.ts`, comprobar que `requireAdminActor` rechaza por
`permission-denied` cada rol no administrativo. En `admin-provisioning.test.ts`, convertir el caso
aislado de `coach` en una tabla para `headCoach`, `coach`, `guardian` y `adultStudent`, verificando
que ninguna entrada llega a `setCustomUserClaims` ni persiste usuario/auditoría.

```ts
for (const role of ["headCoach", "coach", "guardian", "adultStudent"] as const) {
  expect(() =>
    requireAdminActor(requestWithAuth(`${role}-1`, { academyId: "academy-1", role })),
  ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
}
```

- [x] **Paso 6 - gates técnicos, de seguridad y regresión**

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
en ningún contrato de autoridad, que roles no administrativos sigan fuera de `AdminGate` y que no se
registren tokens/claims completos. No ejecutar provisioning, migración ni deploy.

- [x] **Paso 7 - autocrítica y cierre del WIP**

Registrar RED/GREEN/gates y la limitación intencional de lifecycle: `T021/T022/T025` siguen siendo
propietarias de emisión/desactivación de roles no administrativos basada en datos canónicos. Si el
loop pasa, cambiar `T015` a `revisión`, sincronizar `Lista/Lista.js` y abrir `T016` como siguiente WIP.
No hacer commit sin pedido explícito.

#### Evidencia de implementación T015 (2026-08-19)

- Decisión humana: opción 1 aprobada; claims reconoce `owner`, `administrator`, `headCoach`, `coach`,
  `guardian` y `adultStudent`, pero provisioning continúa limitado a owner/admin y los roles restantes
  solo podrán emitirse desde `T021`, `T022` y `T025` con datos canónicos.
- RED del contrato: `admin-contracts.test.ts` falló `2/7` antes de existir el parser; el RED
  independiente del entrypoint público falló con `parseUserClaims is not a function`.
- GREEN focused inicial: los cuatro archivos de contrato, autorización y provisioning aprobaron
  `50/50`.
- Autocrítica de seguridad: la búsqueda exhaustiva confirmó que `setCustomUserClaims()` solo aparece
  en provisioning backend y sus pruebas; roles no administrativos, claves desconocidas y claims
  exactas mantienen cobertura negativa.
- Hallazgo y reproducción: provisioning preserva `mfaEnrolled` y `locale`, pero autorización las
  rechazaba como custom claims desconocidas. El RED cruzado falló `1/11` con
  `Administrative claims are required`; tras declarar solo esas dos claves como no autoritativas,
  autorización y provisioning aprobaron `36/36`, incluido el rechazo de `tenantOverride`.
- Gates finales: unitarias `445/445`; Rules con emuladores demo `9/9`; lint, typecheck, build de 19
  rutas, formato y `git diff --check` aprobaron. Audit reportó 0 high/critical y las 2 moderadas
  transitivas ya conocidas.
- Clasificación: sin hallazgos críticos o altos; no hubo migración, despliegue, operación productiva,
  gasto ni manejo de secretos. Carga y UI/E2E no aplican a esta frontera de contratos/autorización.
- Limitación consciente: reconocer un rol no concede relaciones, asignaciones, propósito ni
  clasificación de datos; esas fronteras quedan para `T016`, y la emisión de roles no administrativos
  permanece diferida a sus tareas de ciclo de vida.

### P1 / T016 - Diseño aprobado de autorización backend y frontera Firebase

**Estado del diseño:** aprobado por el operador el 2026-08-19.

**Objetivo:** conservar Firestore y RTDB cerrados al SDK cliente y establecer una frontera backend
reutilizable que obligue a verificar tenant, actor activo, rol, propósito y alcance canónico antes de
cualquier acceso permitido. Esta tarea no habilita módulos futuros ni convierte claims en permisos.

#### Decisiones aprobadas

- Firestore y RTDB mantienen `deny-by-default` total para acceso directo desde navegador, incluido
  owner y los datos propios de un usuario. Todo acceso permitido del MVP pasa por Cloud Functions.
- El cliente nunca envía roles, permisos, propósito autorizado ni hechos como `isGuardian` o
  `isAssigned`. Solo puede enviar identificadores de recursos previstos por el contrato; Functions
  valida la entrada, carga fuentes canónicas y construye los hechos de autorización.
- Los servicios administrativos existentes no se amplían a roles no administrativos. La comprobación
  persistente de desactivación se conecta cuando `T025` implemente el lifecycle canónico; `T016`
  define y prueba el requisito sin inventar documentos ni estados.
- No se agregan colecciones, índices, migraciones, datos persistentes ni excepciones positivas de
  Rules.
- `docs/data/firestore-data-model.md` conserva una frase obsoleta que permite `get` directo de
  Regyfit al owner. La implementación debe alinearla con la frontera Functions-only ya aplicada por
  Rules y aprobada en este diseño.

#### Arquitectura y componentes

- `packages/domain/src/authorization/access-policy.ts` será un evaluador puro y reutilizable. Define
  operaciones, clasificación, alcance requerido y decisiones tipadas `allow/deny`.
- Cada módulo declara requisitos de acceso como constantes internas revisables; ninguna política se
  deriva de un payload del cliente. Los módulos posteriores aportan sus permisos concretos y resolvers
  de fuentes canónicas conforme a la matriz de `T007`.
- El evaluador exige siempre coincidencia de `academyId`, actor activo y propósito no vacío definido
  por servidor. Cuando la política lo requiera, también exige identidad propia, relación familiar
  vigente, asignación vigente o aprobación explícita.
- `apps/functions/src/auth/user-authorization.ts` extrae claims estrictas mediante el contrato de
  `T015` y construye un actor para los seis roles. `requireAdminActor()` conserva el narrowing
  `owner | administrator` y sus consumidores actuales siguen fail-closed.
- Las combinaciones no soportadas o sin evidencia suficiente se deniegan. El evaluador no consulta
  Firebase ni recibe objetos de SDK para que su política pueda probarse de forma determinista.

#### Flujo autorizado

1. Function autentica la solicitud y obtiene un `UserActor` desde claims exactas.
2. El handler valida identificadores y selecciona una política constante de su módulo.
3. Un resolver backend carga el estado activo y, cuando corresponda, relación, asignación o evidencia
   de aprobación desde documentos canónicos del mismo tenant.
4. El handler construye hechos internos mínimos y llama al evaluador con un propósito constante de
   servidor.
5. Solo una decisión `allow` permite continuar hacia Admin SDK; toda otra decisión termina con
   `permission-denied` genérico.

#### Seguridad y errores

- Un código interno de denegación puede distinguir actor inactivo, tenant cruzado, propósito ausente,
  rol no permitido o alcance insuficiente para pruebas y observabilidad segura. Ese código no se
  devuelve al cliente ni autoriza registrar tokens, claims completos, relaciones o datos sensibles.
- El actor, la política y los hechos se tratan como valores inmutables. Las fechas de vigencia se
  evalúan contra un instante inyectado por servidor, no contra tiempo enviado por el cliente.
- Firestore prueba `get`, `list`, `create`, `update` y `delete` denegados en todas las colecciones
  canónicas para anónimo y los seis roles. RTDB prueba lectura y escritura denegadas en `presence`.
- La ausencia de una cláusula positiva de Rules es intencional: relación, asignación y propósito se
  evalúan en Functions, no se duplican parcialmente en Rules.

#### Estrategia de pruebas

- Unitarias de dominio: casos positivos sintéticos para alcance de academia, identidad propia,
  familia, asignación y aprobación; negativos para actor inactivo, tenant cruzado, propósito ausente,
  rol no permitido, relación expirada, asignación ajena y clasificación incompatible.
- Unitarias de Functions: anónimo, claims malformadas, claves extra/no enumerables, seis roles válidos
  y narrowing administrativo sin regresión.
- Rules con emuladores demo: matriz negativa de todas las colecciones canónicas y RTDB, sin staging ni
  producción y con fixtures sintéticos.
- Gates: focused RED/GREEN, suite unitaria completa, Rules, lint, typecheck, build, audit high, formato
  y `git diff --check`.

#### Fuera de alcance y rollback

- `T016` no implementa perfiles, relaciones, asignaciones, consentimientos, salud, documentos ni
  lifecycle de staff; esas responsabilidades permanecen en `T018` y `T021-T025`.
- No implementa permisos positivos de módulos inexistentes, despliegues, migraciones, producción,
  gasto, App Check ni cambios de retención/residencia bloqueados por `T011`.
- El rollback es textual: restaurar los contratos, adapters y pruebas anteriores. No requiere backup
  porque no se escriben ni transforman datos.

#### Criterio de aceptación

- Ningún rol ni usuario anónimo obtiene acceso directo por Firestore/RTDB.
- Los seis roles pueden convertirse en actores autenticados estrictos sin recibir autoridad implícita.
- El evaluador deniega por defecto y solo permite cuando política y hechos backend prueban tenant,
  actividad, propósito y alcance.
- Las pruebas negativas cubren colecciones canónicas, tenant, rol, relación y asignación; todos los
  gates pasan con evidencia real antes de mover `T016` a `revisión`.

### P1 / T016 - Plan de implementación

> **Para ejecución agentic:** usar `subagent-driven-development` o `executing-plans` tarea por tarea.
> En esta sesión la ejecución debe ser inline porque ya se alcanzó el máximo de subagentes. Cada paso
> usa checkboxes y conserva `T016` como único WIP.

**Goal:** implementar una política de autorización backend reutilizable para seis roles y demostrar
que ningún cliente puede acceder directamente a datos canónicos de Firestore o RTDB.

**Architecture:** un evaluador puro en `packages/domain` recibe actor, requisito constante del módulo,
recurso y hechos resueltos por backend. Un adapter de Functions convierte claims exactas en
`UserActorContext`; `requireAdminActor()` estrecha ese actor sin duplicar parsing. Firebase Rules no
obtiene permisos positivos y su matriz negativa se prueba exhaustivamente en emuladores demo.

**Tech Stack:** TypeScript, Vitest, Firebase Functions v2, Firebase Rules Unit Testing, Firestore y
Realtime Database Emulator.

#### Restricciones globales

- Firestore y RTDB permanecen cerrados al SDK cliente para anónimo y los seis roles.
- Claims, roles, propósitos, políticas y hechos de autorización nunca se aceptan desde el payload.
- Todo fallo es fail-closed; Functions solo expone `unauthenticated` o `permission-denied` genérico.
- No se crean perfiles, relaciones, asignaciones ni estados ficticios persistentes.
- No se agregan dependencias, colecciones, índices, migraciones, secretos, despliegues ni operaciones
  sobre staging/producción.
- Fixtures y emuladores usan exclusivamente datos sintéticos y el proyecto `demo-bpt-jersey`.
- Los permisos concretos de módulos futuros permanecen en `T018` y `T021-T025`.
- No hacer commit, push o cambio de rama sin pedido explícito.

---

#### Task 1 - Evaluador puro de política y alcances

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

Crear factories tipadas e incluir ocho casos: academia, self, familia vigente, asignación vigente,
aprobación vigente, invariantes comunes, evidencia inválida/expirada e inmutabilidad. El caso familiar
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
operación no incluida, `status` no activo/aprobado, `validFromMs > nowMs`, `validToMs <= nowMs`,
`nowMs` no finito y scope assignment sin `studentId` ni `sessionId`.

- [x] **Step 2 - ejecutar el RED**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/authorization/access-policy.test.ts packages/domain/src/contracts.test.ts
```

Expected: FAIL porque `authorization/access-policy` y sus exports todavía no existen; las pruebas
anteriores de `contracts.test.ts` permanecen verdes.

- [x] **Step 3 - implementar la decisión mínima fail-closed**

Implementar primero las invariantes comunes en este orden: contexto numérico válido, tenant, actor
activo, propósito, rol y clasificación. Después resolver el scope con un `switch` exhaustivo:

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

`evaluateScope()` debe comparar `academyId` y todos los IDs aplicables, exigir la operación exacta y tratar la
ventana como `[validFromMs, validToMs)`. Scope `academy` no requiere evidencia adicional; `self`
exige `subjectUserId === actor.userId`; los otros scopes fallan con su razón específica.

- [x] **Step 4 - publicar el contrato sin romper runtime**

Exportar constantes, función y tipos desde `packages/domain/src/index.ts`. Añadir el subpath runtime:

```json
"./authorization/access-policy": {
  "types": "./src/authorization/access-policy.ts",
  "default": "./lib/authorization/access-policy.js"
}
```

En `contracts.test.ts`, importar desde el entrypoint público y comprobar que `accessOperations`,
`dataClassifications`, `accessScopes`, `accessDenialReasons` y `evaluateAccess` existen y están
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

Añadir ocho pruebas con request sintético: anónimo, claims ausentes, los seis roles válidos y actor
congelado, claims estándar/perfil permitidas, clave custom desconocida y clave propia no enumerable.
Añadir además un grant válido y una denegación que demuestre que `requireAuthorizedAccess()` nunca
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

El caso de perfil permite únicamente claims estándar de Firebase más `mfaEnrolled` y `locale`; una
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

UID ausente produce `unauthenticated`; token o claims inválidas producen `permission-denied`. No
incluir valores del token en mensajes o logs.

Implementar el mapper backend sin bifurcar por la razón interna:

```ts
export function requireAuthorizedAccess(input: AccessEvaluationInput): AccessGrant {
  const decision = evaluateAccess(input);
  if (!decision.ok) {
    throw new HttpsError("permission-denied", "Access is not permitted");
  }
  return decision.value;
}
```

- [x] **Step 4 - hacer que admin estreche el actor genérico**

`requireAdminActor()` llama a `requireUserActor()`, valida `{ academyId, role }` con
`parseAdminClaims()` y conserva exactamente su salida pública existente:

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

- [x] **Step 5 - verificar GREEN y no elevación**

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

- Consumes: las 30 subcolecciones canónicas de `docs/data/firestore-data-model.md` y las colecciones
  backend-only ya usadas por Functions.
- Produces: una prueba de caracterización que bloquea cualquier permiso cliente futuro no diseñado.

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

- [x] **Step 2 - sembrar solo fixtures sintéticos con Rules desactivadas**

Para cada colección canónica/backend de academia crear
`academies/demo-academy/{collection}/synthetic-1`; para cada colección backend raíz crear
`{collection}/synthetic-1`, siempre con `{ academyId: "demo-academy", synthetic: true }`. Crear
también el documento raíz de academia y `academies/demo-academy/presence/session-1/student-1` en
RTDB. Limpiar ambos emuladores entre casos.

- [x] **Step 3 - probar todas las operaciones por actor**

Para cada uno de los siete actores, negar raíz de academia y, en cada colección canónica o
backend-only, estas cinco operaciones:

```ts
await assertFails(getDoc(existing));
await assertFails(getDocs(collection(firestore, `academies/${academyId}/${name}`)));
await assertFails(setDoc(candidate, { academyId, synthetic: true }));
await assertFails(updateDoc(existing, { synthetic: false }));
await assertFails(deleteDoc(existing));
```

Negar también `get()` y `set()` en el path RTDB de presencia. Usar `it.each(actorCases)` con timeout
explícito de 120 segundos por actor para que el volumen de assertions no se confunda con flakiness.

- [x] **Step 4 - ejecutar la caracterización Rules**

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,database "node node_modules/vitest/vitest.mjs run --project rules qa/rules/client-data-boundary.test.ts"
```

Expected: 1 archivo y 7 pruebas aprobadas contra las Rules actuales. Este paso es una caracterización,
no se debilitan Rules artificialmente para fabricar un RED; los RED conductuales están en Tasks 1 y 2.

- [x] **Step 5 - confirmar que producción Rules no necesita cambios**

Usar la herramienta `grep` sobre `firestore.rules` con el patrón `allow\s+` y comprobar que cada
match termina en `if false;`; buscar en `database.rules.json` el patrón
`"\.(read|write)"\s*:\s*true`.

Expected: Firestore solo muestra cláusulas `if false;` y RTDB no muestra matches. Si aparece una
cláusula positiva, detener `T016` como hallazgo crítico; no adaptar la prueba para aceptarla.

---

#### Task 4 - Reconciliar contratos documentales y ledger visual

**Files:**

- Modify: `docs/data/firestore-data-model.md:53-70`
- Modify: `docs/superpowers/specs/2026-08-09-t016-firestore-rules-boundary-design.md:1-12`
- Modify: `Lista/Lista.js`
- Modify at close: `tasks.md`

**Interfaces:**

- Consumes: la decisión Functions-only aprobada el 2026-08-19.
- Produces: documentación sin una excepción directa obsoleta para owner y estado visual sincronizado.

- [x] **Step 1 - corregir el contrato Regyfit obsoleto**

Reemplazar la frase de `get` directo owner por el contrato vigente: backend/import es único escritor;
Rules deniega todos los accesos directos; owner obtiene la proyección restricted con IP solo mediante
Function; administrator obtiene la proyección safe sin IP; los otros cuatro roles no acceden.

- [x] **Step 2 - marcar el diseño histórico como ampliado**

Conservar su evidencia histórica y añadir al encabezado:

```md
**Estado:** ampliado por el diseño P1/T016 aprobado en `tasks.md` el 2026-08-19.

Este documento conserva la decisión Functions-only para Regyfit. El contrato reutilizable de actor,
política, relación, asignación y propósito vive en el ledger canónico `tasks.md`.
```

Reemplazar la línea de estado anterior; no conservar simultáneamente `Pendiente de revisión final del
operador`.

- [x] **Step 3 - sincronizar el estado parcial de Lista**

Mantener `T016` como `en-progreso` y actualizar su evidencia a: diseño aprobado, evaluador/adapter en
implementación y matriz Rules negativa en verificación. No cambiar otro ID todavía.

- [x] **Step 4 - verificar contradicciones documentales y formato específico**

Usar `grep` con el patrón
`permit a direct complete-document|get directo solo|allow get.*owner` sobre ambos documentos y
ejecutar:

```powershell
corepack pnpm exec prettier --check packages/domain/src/authorization apps/functions/src/auth qa/rules docs/data/firestore-data-model.md docs/superpowers/specs/2026-08-09-t016-firestore-rules-boundary-design.md Lista/Lista.js
```

Expected: la búsqueda no encuentra una concesión owner directa; Prettier aprueba todos los paths
específicos.

---

#### Task 5 - Autocrítica, gates y cierre de T016

**Files:**

- Review: todos los archivos de Tasks 1-4
- Modify if packaging requires the new subpath: `apps/functions/src/deploy-runtime.ts`
- Test: `apps/functions/src/deploy-runtime.test.ts`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

**Interfaces:**

- Consumes: implementación y evidencia completa de T016.
- Produces: `T016` en `revisión` y `T019` como siguiente único WIP de P1.

- [x] **Step 1 - ejecutar self-critique de seguridad**

Invocar `self-critique-loop` y `security-baseline`. Usar `grep` para buscar
`setCustomUserClaims|requireUserActor|requireAdminActor|evaluateAccess` en `apps/functions` y
`packages/domain`, y `console\.(log|info|debug)|logger\.(info|debug)` en los archivos modificados.

Solo backend escribe claims; no hay tokens/claims/hechos completos en logs; `requireAdminActor()`
rechaza los cuatro roles no administrativos; ninguna decisión `allow` omite actividad, tenant,
propósito, rol, clasificación o scope.

- [x] **Step 2 - ejecutar focused final**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/authorization/access-policy.test.ts packages/domain/src/contracts.test.ts apps/functions/src/auth/user-authorization.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts
```

Expected: 5 archivos y 62 pruebas aprobadas tras los RED adicionales del `self-critique-loop`.

- [x] **Step 3 - ejecutar todos los gates desde el código final**

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

La matriz Rules debe terminar dentro del timeout explícito sin retries. UI/E2E, accesibilidad y carga
HTTP son N/A porque no cambia frontend ni se publica endpoint; contratos, entradas hostiles, tenant
cruzado, relaciones/asignaciones expiradas y Rules sí aplican y deben constar en evidencia.

- [x] **Step 5 - cerrar el ledger sin operación productiva**

Registrar RED/GREEN, conteos reales, hallazgos y limitaciones en `tasks.md`; mover `T016` a `revisión`,
abrir `T019` como único `en-progreso` y sincronizar `Lista/Lista.js`. Validar 86 IDs únicos y estados
coincidentes. No desplegar, migrar, crear usuarios, tocar secretos ni hacer commit.

#### Evidencia de implementación T016 (2026-08-19)

- Decisión humana: Firestore y RTDB permanecen totalmente cerrados al SDK cliente; toda autorización
  positiva del MVP pasa por Functions. Los módulos futuros aportan políticas constantes y resolvers
  canónicos, nunca roles, propósitos o hechos enviados por el cliente.
- RED de dominio: el nuevo contrato falló porque `access-policy` y sus exports no existían; las 7
  pruebas previas del entrypoint permanecieron verdes. GREEN inicial: evaluador + entrypoint `16/16` y
  typecheck domain aprobado.
- RED de Functions: `user-authorization` no existía y las 11 pruebas admin previas permanecieron
  verdes. GREEN: actor estricto para seis roles, errores genéricos y narrowing administrativo
  aprobaron `44/44`; el runtime domain se añadió a `tsconfig.runtime.json` para resolver el subpath en
  CI/deploy.
- Rules: caracterización focused `7/7` en 10,88 s. Recorre anónimo y seis roles contra documento raíz,
  30 colecciones canónicas, 3 colecciones backend-only bajo academia, 5 colecciones backend-only raíz
  y presencia RTDB; niega `get`, `list`, `create`, `update`, `delete`, lectura y escritura. Las Rules
  productivas no cambiaron y todas sus cláusulas Firestore continúan en `if false;`; RTDB sigue
  `.read/.write=false`.
- Hallazgos de autocrítica corregidos con RED/GREEN: evidencia de relación/asignación/aprobación de
  otra academia podía reutilizar IDs coincidentes; `actorActive` aceptaba un valor truthy no booleano;
  claims de autoridad heredadas del prototipo podían proyectarse. Ahora cada evidencia exige
  `academyId`, actividad exige `=== true` y `academyId/role` deben ser propiedades propias.
- Hallazgo de packaging: la primera suite global quedó `463/464` porque el preparador de deploy no
  reescribía el nuevo subpath. Se añadió un RED específico, el mapping a
  `domain/authorization/access-policy.js` y se eliminó un import runtime raíz accidental del test;
  packaging final `2/2` y focused de autorización final `62/62`.
- Gates finales: unitarias `61` archivos, `464/464`; Rules `5` archivos, `16/16`; lint, typecheck de 6
  workspaces, build Functions/Next de 19 rutas, formato y `git diff --check` aprobaron. Audit reportó 0
  high/critical y las 2 moderadas transitivas conocidas.
- Pruebas avanzadas: contrato domain/Functions/deploy, entradas hostiles, tenant cruzado, ventanas
  expiradas, claims extra/no enumerables/heredadas y matriz Firebase aplicaron y pasaron. La suite
  Rules terminó en 13,36 s sin retries, muy por debajo del timeout de 120 s. UI/E2E, accesibilidad y
  carga HTTP son N/A porque no cambió frontend ni se publicó endpoint.
- Seguridad/operaciones: sin hallazgos críticos o altos abiertos, dependencias nuevas, secretos, logs
  sensibles, migraciones, escrituras productivas, despliegues, gastos o commits. El estado persistente
  de desactivación y los permisos positivos concretos permanecen en `T025` y sus módulos propietarios.
- Gap de capacidad: ninguno; TDD, debugging sistemático, security baseline, pruebas contractuales y
  emuladores cubrieron los hallazgos. El siguiente único WIP de P1 es `T019`.

### P1 / T019 - Diseño aprobado de audit log append-only

**Estado del diseño:** aprobado por el operador el 2026-08-19.

**Objetivo:** consolidar los eventos administrativos, de importación de miembros y de importación
Regyfit detrás de un contrato estricto y un único adapter create-only. `auditEvents` registra cambios
sensibles completados; no se convierte en telemetría de intentos, timeline de UI ni payload histórico.

#### Decisiones aprobadas

- T019 centraliza y migra los tres escritores actuales. No deja un contrato nuevo junto a writers
  paralelos con esquemas distintos.
- El audit log canónico persiste solo cambios sensibles completados y atómicos. Fallos y denegaciones
  quedan fuera de Firestore y pertenecen a la telemetría de seguridad de `T055`.
- Los metadatos forman una unión discriminada estricta por `action`; no existe un campo `metadata`
  abierto ni JSON arbitrario.
- No se implementan lectura, endpoint, exportación o UI de auditoría. El rol de auditor independiente
  continúa fuera del MVP y cualquier lectura futura exige una tarea y autorización propias.
- No se aplica migración ni se reescriben eventos existentes.

#### Contrato de dominio

El envelope común conserva el modelo plano ya persistido:

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
  rechaza aunque los demás IDs coincidan.
- Acciones, campos y variantes son exactos. Conteos son enteros no negativos; hashes son SHA-256
  lowercase; strings tienen límites explícitos y `reportKeys` reutiliza el contrato existente.
- `moduleKey` usa un identificador acotado y `sourceRoute` es una ruta relativa acotada sin query,
  fragmento, credenciales ni URL absoluta.
- Admin role no añade email, display name, claims, rol previo/nuevo ni otro payload personal. `action`
  y `targetRef` identifican la operación mínima.
- El draft nunca contiene `auditEventId`, `occurredAt`, `result` ni `schemaVersion`; el adapter es su
  único propietario.

#### Adapter create-only y atomicidad

- `apps/functions/src/audit/audit-writer.ts` valida el draft y materializa exactamente:
  `auditEventId`, envelope/variante, `occurredAt: FieldValue.serverTimestamp()`,
  `result: "completed"` y `schemaVersion: 1`.
- La API transaccional solo permite `create`. No expone `set`, `update`, `delete` ni merge sobre
  `auditEvents`.
- Admin provisioning y member import reservan una referencia automática server-owned y crean el
  evento en la misma transacción que el cambio sensible.
- En admin provisioning, la atomicidad cubre documento canónico, audit event y lock en Firestore. La
  custom claim de Firebase Auth permanece bajo la compensación fail-closed ya existente si esa
  transacción falla; no se afirma atomicidad distribuida inexistente.
- Regyfit conserva el ID determinista server-owned `regyfit-access-{runId}`. Primera ejecución crea;
  replay idéntico es no-op; un evento distinto con el mismo ID falla sin sobrescribir.
- Para comparar un replay Regyfit se usan solo los campos estables validados. Se tolera el documento
  legacy equivalente sin `auditEventId`/`occurredAt`; cualquier otro campo ausente, extra o distinto
  falla. Los eventos nuevos siempre reciben ambos campos.
- Se elimina `writeImportAuditEvent`, writer genérico exportado pero sin consumidor productivo.

#### Seguridad y errores

- Un draft inválido falla antes de cualquier escritura. Un error en la operación sensible revierte
  la transacción y no deja un evento huérfano.
- Colisiones automáticas fallan; colisiones deterministas solo admiten replay exacto. Ninguna ruta
  convierte una colisión en update.
- No se registran nombres, emails, teléfonos, tokens, claims, IP, secretos, payloads completos ni
  snapshots before/after. Conteos, hashes e IDs opacos son la evidencia máxima permitida.
- Firestore Rules continúa negando toda lectura y escritura cliente de `auditEvents`; Functions/Admin
  SDK es el único writer y debe pasar por este adapter.

#### Estrategia de pruebas

- Dominio: una variante válida por acción y negativos por acción desconocida, campos extra/de otra
  variante, tenant cruzado, strings fuera de límites, conteos inválidos, hashes inválidos y
  `reportKeys` desconocidos.
- Adapter: prueba que materializa campos server-owned y usa `transaction.create`; el doble no ofrece
  APIs de mutación de eventos.
- Writers migrados: admin/member prueban evento atómico y mínimo; Regyfit prueba create inicial,
  replay exacto, replay legacy compatible, colisión distinta y concurrencia/idempotencia.
- Integración emulator: un evento por operación/replay, ausencia de PII y Rules negativas intactas.
- Gates: focused RED/GREEN, integración, unitarias completas, Rules, lint, typecheck, build, audit
  high, formato y `git diff --check`.

#### Fuera de alcance y rollback

- Sin auditoría de fallos/denegaciones, lectura owner, rol auditor, UI, exportación, retención,
  archivado, firma criptográfica o hash chain. `T011`, `T053` y `T055` conservan esas decisiones.
- Sin migración, backup o write productivo. El rollback es de código: restaurar writers previos; los
  eventos nuevos conservan el envelope compatible y no requieren transformación.

#### Criterio de aceptación

- Todos los writers actuales consumen el contrato central y no queda escritura directa productiva a
  `auditEvents` fuera del adapter.
- Cada cambio sensible completado crea exactamente un evento dentro de su transacción; un replay
  idempotente no duplica ni reescribe.
- Eventos inválidos, cross-tenant, con PII/campos extra o colisión distinta fallan closed.
- Rules, integración y gates globales pasan con evidencia real antes de mover `T019` a `revisión`.

### P1 / T019 - Plan de implementación

> **Para ejecución agentic:** usar `subagent-driven-development` o `executing-plans` tarea por tarea.
> En esta sesión la ejecución es inline porque ya se alcanzó el máximo de subagentes. Cada paso usa
> checkboxes y conserva `T019` como único WIP.

**Goal:** reemplazar los tres esquemas/writers actuales por un contrato discriminado y un adapter
create-only que mantenga atomicidad, mínimo payload e idempotencia Regyfit compatible.

**Architecture:** `packages/domain` valida drafts sin campos server-owned. Un adapter pequeño de
Functions materializa y crea eventos dentro de la transacción del módulo; admin y member usan IDs
automáticos, Regyfit usa ID determinista y compara replays estables. No se añade reader, callable ni
UI.

**Tech Stack:** TypeScript, Vitest, Firebase Admin Firestore transactions, Firebase Emulator Suite y
contratos `Result` existentes.

#### Restricciones globales

- Solo eventos `completed`; fallos/denegaciones pertenecen a `T055` y no escriben `auditEvents`.
- Ningún draft contiene `auditEventId`, `occurredAt`, `result` o `schemaVersion`.
- Ningún cliente envía acciones, propósito, actor, tenant, referencias o metadata de auditoría.
- No nombres, emails, teléfonos, IP, tokens, claims, secretos, payloads completos ni snapshots.
- `targetRef` y toda evidencia pertenecen al mismo `academyId`; cross-tenant falla closed.
- Solo `transaction.create`; no update/delete/merge sobre eventos.
- Sin lectura/UI/export, dependencias nuevas, migraciones, writes productivos o despliegues.
- Fixtures exclusivamente sintéticos y emuladores `demo-bpt-jersey`.
- No hacer commit/push de T019 sin pedido explícito posterior.

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

Crear ocho casos con expectativas literales: ambos admin actions, member válido, Regyfit válido,
common fields inválidos, tenant cruzado, mezcla/extra de variantes y metadata inválida. Ejemplo:

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
Aplicar límites: IDs 128, `targetRef` 512, purpose/correlation/source route 256, import/module 128,
SHA-256 `/^[a-f0-9]{64}$/`, conteos enteros no negativos y route
`/^\/[A-Za-z0-9._/-]+$/` sin `//`, `/../` ni `/./`. Devolver una copia congelada y congelar
`reportKeys`.

- [x] **Step 4 - publicar el contrato para source y runtime**

Exportar valores/tipos desde `src/index.ts`, añadir a `package.json`:

```json
"./audit": {
  "types": "./src/audit/audit-event.ts",
  "default": "./lib/audit/audit-event.js"
}
```

Incluir `src/audit/audit-event.ts` en `tsconfig.runtime.json`. En `contracts.test.ts` comprobar que
`auditActions` está congelado, contiene exactamente cuatro acciones y `parseAuditEventDraft` está
disponible desde el entrypoint público.

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

Añadir seis casos: materialización exacta/create único, draft inválido antes de create, evento moderno
idéntico, legacy Regyfit sin `auditEventId/occurredAt`, mismatch/extra rechazado y ausencia de API de
mutación. El doble solo implementa `create` y captura:

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
4. extrae únicamente keys estables, las parsea y compara literalmente con el draft;
5. rechaza cualquier key adicional.

- [x] **Step 4 - integrar packaging deploy**

Añadir mapping:

```ts
"@bpt-jersey/domain/audit": "../../domain/audit/audit-event.js"
```

Extender `deploy-runtime.test.ts` con import y expectativa del nuevo subpath.

- [x] **Step 5 - verificar GREEN writer/packaging**

```powershell
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm exec vitest run --project node apps/functions/src/audit/audit-writer.test.ts apps/functions/src/deploy-runtime.test.ts
```

Expected: writer y packaging completo aprobados; ningún import workspace queda en el layout copiado.

---

#### Task 3 - Migrar auditoría de provisioning administrativo

**Files:**

- Modify: `apps/functions/src/auth/admin-provisioning.test.ts`
- Modify: `apps/functions/src/auth/admin-provisioning.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**

- Consumes: `appendAuditEventInTransaction()` y `AuditEventDraft`.
- Removes: `AuditEventMetadata`, `auditEventSchema`, `writeImportAuditEvent` y su export público.

- [x] **Step 1 - escribir RED de admin create-only**

Modificar el fake `SyntheticTransaction` para distinguir `create` de `set`. Probar grant/revoke con
evento mínimo, `create` exactamente una vez y sin email/displayName/claims. Probar que una colisión de
audit ref aborta documento de usuario/lock y activa la compensación Auth existente. Eliminar el test
del writer genérico no usado; el nuevo contrato lo sustituye.

- [x] **Step 2 - ejecutar RED admin**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/auth/admin-provisioning.test.ts
```

Expected: FAIL porque provisioning todavía usa `transaction.set` y exporta el writer legacy.

- [x] **Step 3 - migrar la transacción**

Añadir `create` a las interfaces/fakes transaccionales y reemplazar `auditDocument()` por:

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

Mantener user doc/lock en la misma transacción y no cambiar compensación, fencing o provisioning.
Eliminar type/schema/function legacy y sus exports de `src/index.ts`.

- [x] **Step 4 - verificar GREEN y regresión de Auth**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/user-authorization.test.ts
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: todos los casos pasan; roles no administrativos siguen sin mutación y grant/revoke conserva
compensación fail-closed.

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

En integración member exigir un evento con envelope server-owned, fields de variante, sin `fullName`,
email o records. En Regyfit añadir:

- evento nuevo con `auditEventId` y `occurredAt`;
- replay exacto sin duplicado;
- replay legacy tras eliminar solo esos dos campos;
- colisión al cambiar purpose/hash/extra field;
- ningún overwrite de la colisión.

- [x] **Step 2 - ejecutar RED focused**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/regyfit/access-import.test.ts
```

Expected: FAIL porque Regyfit todavía materializa/usa `transaction.set` directamente.

- [x] **Step 3 - migrar member import**

Reemplazar `transaction.create(auditReference, {...})` por el adapter con draft
`member.import.confirmed`; conservar operation record en la misma transacción y su referencia al
`auditEventId`. No mover report keys, source hash o conteos fuera de la variante.

- [x] **Step 4 - migrar Regyfit sin romper replay legacy**

Construir un draft una vez. Si snapshot no existe, usar `appendAuditEventInTransaction`; si existe,
usar `matchesAuditEventReplay(existing, ref.id, draft, { allowLegacyMissingGeneratedFields: true })`.
Mismatch llama `fail("Import conflicts with existing audit data")`. Nunca usar `set` para audit.

- [x] **Step 5 - probar concurrencia/idempotencia en Firestore Emulator**

El nuevo `qa/integration/audit-writer.test.ts` abre dos transacciones concurrentes sobre
`academies/demo-academy/auditEvents/regyfit-access-concurrent-1`; cada una lee snapshot y usa el
adapter/matcher. Ambas promesas resuelven y queda un documento. Repetir con draft distinto y exigir
rechazo sin mutación.

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/audit-writer.test.ts qa/integration/firestore-adapters.test.ts"
```

Expected: integración aprobada con fixtures sintéticos, un evento por correlación y cero PII.

- [x] **Step 6 - verificar GREEN focused completo**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts apps/functions/src/audit/audit-writer.test.ts apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/regyfit/access-import.test.ts apps/functions/src/members/member-service.test.ts
```

Expected: todos los contratos y writers migrados pasan sin cambiar respuestas públicas.

---

#### Task 5 - Documentación, autocrítica, gates y cierre

**Files:**

- Modify: `docs/data/firestore-data-model.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`
- Review: todos los archivos de Tasks 1-4

**Interfaces:**

- Consumes: implementación completa T019.
- Produces: `T019` en `revisión` y `T018` como siguiente único WIP de P1.

- [x] **Step 1 - documentar contrato final y compatibilidad**

Actualizar la fila/sección `auditEvents`: cuatro actions actuales, campos server-owned, create-only,
legacy Regyfit tolerado solo en replay, sin reader/UI y sin migración. No prometer hash chain,
retención o auditor independiente.

- [x] **Step 2 - ejecutar self-critique de seguridad**

Invocar `self-critique-loop` y `security-baseline`. Usar `grep` para localizar `auditEvents` y verificar
que toda creación productiva pasa por `appendAuditEventInTransaction`; no debe existir
`transaction.set/update/delete` ni `.set()` directo sobre audit refs. Revisar que logs/tests no copian
PII y que Rules sigue default-deny.

- [x] **Step 3 - ejecutar focused e integración final**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts apps/functions/src/audit/audit-writer.test.ts apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/regyfit/access-import.test.ts apps/functions/src/members/member-service.test.ts apps/functions/src/deploy-runtime.test.ts
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/audit-writer.test.ts qa/integration/firestore-adapters.test.ts"
```

Evidence: focused unit tests `75/75`; integración Firestore Emulator `8/8`; domain/runtime y Functions typecheck aprobados; packaging portable aprobado. La ejecución directa sin emulador respondió `PERMISSION_DENIED` y se repitió correctamente mediante `firebase emulators:exec`.

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

Evidence: `test:unit` `63 archivos/481 pruebas`; Rules Emulator `5 archivos/16 pruebas`; lint, typecheck, build, audit, format y `git diff --check` aprobados. `pnpm audit --audit-level high` reporta únicamente `2 moderate` transitivas conocidas.

- [x] **Step 5 - cerrar ledger sin operación productiva**

Registrar RED/GREEN, integración, hallazgos y limitaciones; `T019` queda en `revisión`, `T018`
queda como siguiente WIP de P1 y permanece `pendiente` hasta completar sus fundamentos, y
`Lista/Lista.js` conserva 86 IDs únicos sincronizados. Se
conservaron `opencode.json` y artefactos excluidos sin stage. No se migró, desplegó, crearon
usuarios, tocaron secretos ni hizo commit/push.

### Reconciliación documental - 2026-08-21

- `tasks.md` se confirmó como fuente canónica y `Lista/Lista.js` se alineó con sus estados actuales:
  `T019`, `T021` y `T022` quedan en `revisión`; `T018` permanece `pendiente` porque sus
  fundamentos todavía no están completos.
- Verificación: `node --check Lista/Lista.js` pasó sin errores. No se modificó runtime, no se
  ejecutaron migraciones ni despliegues, y no se accedió a datos productivos.

### T011 - Paquete de decisión preparado - 2026-08-21

- Se creó `docs/operations/t011-retention-residency-deletion-decision-packet.md` con el inventario
  de categorías, responsables, decisiones de retención/residencia/borrado/restauración y controles
  provisionales del piloto. Se añadieron referencias públicas del JOIC para registro, DPIA,
  principios, derechos y transferencias. No fija plazos, regiones, bases legales ni afirma
  cumplimiento.
- `T011` permanece `bloqueada`; `T023` permanece `bloqueada` y `T018` permanece `pendiente` hasta
  que el operador y la asesoría aplicable a Jersey registren una decisión aprobada. No hubo cambios
  de runtime, migraciones, borrado destructivo, escrituras productivas ni despliegues. Verificación:
  `node --check Lista/Lista.js` y `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check`
  pasaron.

### T025 - Diseño preparado - 2026-08-21

- El operador aprobó `docs/superpowers/specs/2026-08-21-t025-staff-lifecycle-design.md` y su plan
  `docs/superpowers/plans/2026-08-21-t025-staff-lifecycle-plan.md`. El diseño cubre contratos,
  lifecycle, disponibilidad, asignaciones tenant-scoped y sincronización fail-closed de claims.
- `T025` permanece en `revisión`; no se inició implementación, no se cambió el WIP de P1 y no se
  agregaron colecciones, Rules, migraciones, claims reales ni datos productivos.

### T025 - Inicio de ejecución controlada - 2026-08-21

- Por decisión del operador, `T025` pasa a `en-progreso` como WIP técnico independiente mientras
  `T018`/`T023`/`T024` permanecen detenidas por el gate externo de `T011`. Esta desviación del orden
  nominal de P1 queda limitada al lifecycle de coaches/staff y no desbloquea ninguna tarea dependiente.
- La ejecución seguirá el plan TDD aprobado, sin producción, migraciones, datos reales, salud,
  safeguarding, pagos, retención, residencia ni borrado destructivo.
- Task 1 del plan completada: se añadieron `StaffProfile`, `StaffRoleAssignment` y
  `StaffAvailabilityWindow`, parsers estrictos con allowlists, validación de timezone IANA,
  ventanas locales, roles `headCoach`/`coach`, estados active/inactive y fail-closed ante
  prototipos o getters hostiles. Se publicaron los exports raíz y el subpath `@bpt-jersey/domain/staff`.
- Evidencia TDD: el RED focalizado falló por el módulo inexistente; después GREEN pasó con `14/14`
  pruebas focalizadas. También pasaron `corepack pnpm --filter @bpt-jersey/domain typecheck`,
  `corepack pnpm --filter @bpt-jersey/domain build:runtime`, la regresión Node completa (`47` archivos,
  `478` pruebas), Prettier en los archivos nuevos y `git diff --check`. Los warnings del test Node
  son la deprecación de subprocess y sourcemaps faltantes del layout temporal de deploy; no hubo
  fallos. Rules, UI, claims reales, migraciones y producción siguen sin tocarse; los handlers de
  Task 3 existen como implementación provisional pendiente del gate de seguridad.
- Task 2 del plan completada: se añadió `apps/functions/src/staff/staff-service.ts` con altas idempotentes
  mediante `requestId`, actualización de rol, activación/desactivación soft, disponibilidad y
  asignaciones tenant-scoped. Las transacciones leen y validan usuarios/targets antes de escribir,
  fallan cerradas ante overflow, usan IDs hash scoped sin colisiones por concatenación, revocan derivados
  al desactivar y generan auditoría `staff.*` sin PII.
- Evidencia adicional: `apps/functions/src/staff/staff-service.test.ts` (`7` pruebas), auditoría y
  runtime cubiertos dentro de la regresión Node (`48` archivos, `486` pruebas), typecheck/build de
  Domain y Functions, Prettier y `git diff --check` pasan. `corepack pnpm audit` deja solo dos
  vulnerabilidades moderadas transitorias de `firebase-tools` (`uuid` y `@opentelemetry/core`), sin
  vulnerabilidades high/critical. Callables, Rules, UI, claims reales, Emulator E2E y producción siguen
  pendientes de Tasks 3-4.
- Task 3 pasó a revisión técnica: los handlers admin-only sincronizan únicamente roles no
  administrativos, comparten el lock `academies/{academyId}/adminRoleLocks/{uid}` con
  `admin-provisioning`, rechazan claims cross-tenant o administrativos malformados, y aplican
  compensación fail-closed con claims sin `role`, perfil inactivo y lock `compensating` cuando la
  recuperación no es segura. Se añadieron pruebas de lock compartido, cuarentena, claims malformados
  y carrera Auth sin sobrescribir cambios externos. Task 3 focalizada: `37/37`; revisión técnica sin
  hallazgos P1/P2. Task 4 (Rules, Emulator E2E y UI) sigue pendiente; no se habilita producción.
- Evidencia final de esta iteración: `corepack pnpm test` pasó con `88` archivos y `675` pruebas;
  `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`, build runtime de
  Domain y build de Functions pasaron. `corepack pnpm audit` mantiene únicamente dos vulnerabilidades
  moderadas transitivas de `firebase-tools` (`uuid` y `@opentelemetry/core`), sin high/critical.
- Fix Round 2 de Task 4B: el replacement de availability y assignments valida todos los documentos
  existentes, incluidos los inactivos, con forma exacta, tenant, `active`, `updatedAt` e ID hash
  canónico antes de escribir. La regresión RED resolvía `[]` para un documento inactivo malformed;
  GREEN pasó `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts
apps/functions/src/staff/staff-callables.test.ts` con `29/29`, incluyendo IDs no canónicos y
  comprobación de no escritura. También pasaron web `4/4`, typechecks de Functions/Web/QA y Prettier
  focused. Sin migraciones, producción, secretos ni cambios Git; T025 sigue `en-progreso` pendiente
  del cierre de Tasks 4C/4D y aprobación humana.

### Evidencia Task 4C - UI y E2E de staff (2026-08-21)

- Se añadió `/admin/staff` con tabla segura de `staffKey`, rol y estado; creación, actualización de
  rol, activación/desactivación, replacement de availability y replacement de assignments usan solo
  `apps/web/src/lib/staff-client.ts`. Se actualizó la navegación del shell y CSS responsive/foco sin
  dependencias nuevas ni acceso directo a Firebase desde React.
- Unitarias focalizadas: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/staff/page.test.tsx
apps/web/src/app/admin/page.test.tsx apps/web/src/lib/staff-client.test.ts` pasó `3` archivos y
  `21/21` pruebas. Cubre loading, vacío, proyección segura, error genérico, create/update/deactivate,
  availability/assignment, labels, owner/administrator, campos no filtrados, pending y restauración
  de foco.
- Gates: `corepack pnpm lint`, `corepack pnpm typecheck` y Prettier focused pasaron. El build local
  `NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build` generó `/admin/staff`.
- E2E sintético local, sin credenciales ni endpoints productivos: `staff-management.spec.ts` pasó
  `5/5` desktop Chromium y `5/5` mobile Chromium. El comando exacto solicitado
  `NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm test:e2e -- --grep staff-management` ejecutó `63` casos
  por el wrapper que reenvía el separador `--`: `49` pasaron, `12` quedaron skipped por suites live/opt-in,
  y `2` fallaron en `admin-auth.spec.ts` mobile porque el test exige visible el footer lateral que el
  shell responsive oculta. Los `10` casos de staff pasaron dentro de esa corrida.
- Autocrítica: sin hallazgos críticos/high nuevos, secretos, PII en logs, acceso cliente directo,
  migraciones, producción, dependencias o commits. Permanecen como concerns transversales las dos
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

### Cierre técnico y evidencia de verificación T025 - 2026-08-22

- Se completó el plan `docs/superpowers/plans/2026-08-21-t025-staff-lifecycle-plan.md` y el follow-up `docs/superpowers/plans/2026-08-22-t025-task-4c-auth-emulator-e2e.md`.
- Tasks 1-4 verificadas íntegramente:
  - Task 1: Contratos de dominio (`StaffProfile`, `StaffRoleAssignment`, `StaffAvailabilityWindow`) con parsers estrictos, allowlists, timezone IANA y validación de objetos planos fail-closed.
  - Task 2: Servicio Firestore transaccional (`apps/functions/src/staff/staff-service.ts`) con IDs deterministas por hash, tenant scope, desactivación soft sin borrado físico, `requestId` idempotente y log de auditoría sin PII.
  - Task 3: Callables protegidos (`apps/functions/src/staff/staff-callables.ts`) con sincronización de custom claims para `headCoach`/`coach`, lock concurrente compartido con `admin-provisioning` y compensación fail-closed.
  - Task 4A: Firestore Security Rules (`qa/rules/staff-data-boundary.test.ts`) con default-deny estricto (`50/50` pruebas de reglas pasando) e integración Firestore Emulator (`qa/integration/staff-emulator.test.ts`).
  - Task 4B: Safe projection y cliente React (`apps/web/src/lib/staff-client.ts`) que rechaza campos extra antes de pasar a la UI.
  - Task 4C: UI en `/admin/staff` (`apps/web/src/app/admin/staff/page.tsx`), tests unitarios React (`21/21`), E2E sintético Playwright (`10/10` desktop y móvil) y suite Auth Emulator real (`qa/tests/staff-auth-emulator.spec.ts`, `2/2` desktop y móvil con seed QA `qa/scripts/seed-auth-emulator.mjs`).
  - Task 4D: Gates globales ejecutados con éxito total:
    - Unitarias/integración: `corepack pnpm test:unit` -> 90 archivos, 701 pruebas pasadas.
    - Security Rules: `corepack pnpm test:rules` -> 6 archivos, 50 pruebas pasadas.
    - Linting: `corepack pnpm lint` -> 0 errores / 0 warnings.
    - Typecheck: `corepack pnpm typecheck` -> 6 proyectos de workspace limpios.
    - Formatting: `corepack pnpm format:check` -> OK.
    - Audit: `corepack pnpm audit --audit-level high` -> 0 high / 0 critical (2 moderadas transitivas documentadas en DR-001).
    - Git diff: `git diff --check` -> OK.
- Estado: `T025` pasa a `revisión` en `tasks.md` y `Lista/Lista.js`. No es aprobación de producción ni habilita escrituras o claims reales. Sin migraciones, secretos, dependencias nuevas, despliegues ni commits.
