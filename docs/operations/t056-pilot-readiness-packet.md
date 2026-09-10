# T056 â€” Paquete de preparaciÃ³n del piloto controlado

Estado: borrador operativo; no constituye aprobaciÃ³n del piloto ni autorizaciÃ³n de producciÃ³n.

Fecha de preparaciÃ³n: 2026-08-24

## Alcance fijo

El piloto debe ejecutarse Ãºnicamente con datos sintÃ©ticos o sanitizados, emuladores o staging aislado, pagos manuales y avisos in-app. No se habilitan datos reales, R2 productivo, email/SMS real, cobros online, importaciones productivas ni despliegue de producciÃ³n.

## Checklist de ejecuciÃ³n

| Control             | Evidencia esperada                                                                                                          | Estado                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Guardas de entorno  | Runtime fail-closed fuera del piloto sintÃ©tico                                                                              | Verificado en tareas relacionadas                                                                              |
| Identidad y roles   | Flujos owner, administrator, head coach, coach, guardian y adultStudent                                                     | Verificado sintÃ©ticamente; repetir en acta                                                                     |
| Familias y perfiles | Adultos, menores, guardianes y relaciones activas                                                                           | Verificado; repetir con fixture controlado                                                                     |
| Agenda y asistencia | Clase, booking, check-in, puntualidad, no-show y correcciÃ³n auditada                                                        | Verificado; repetir con fixture controlado                                                                     |
| Child check-out     | Recogida autorizada, independencia y override de staff con nota                                                             | Verificado; repetir con fixture controlado                                                                     |
| Finanzas            | Pagos manuales, facturas, recibos, balance y restricciones por deuda                                                        | Verificado; sin proveedor online                                                                               |
| Avisos              | PublicaciÃ³n, visibilidad por guardian y lectura in-app                                                                      | Verificado; sin canal externo                                                                                  |
| Salud/soporte       | ProyecciÃ³n mÃ­nima, acceso restringido y revisiÃ³n administrativa                                                             | Verificado en piloto sintÃ©tico; T011 mantiene el gate productivo                                               |
| Documentos privados | URL firmada sintÃ©tica, hash, expiraciÃ³n, revocaciÃ³n y autorizaciÃ³n guardian                                                 | Verificado y aprobado para piloto sintÃ©tico; T011 y el texto/revisiÃ³n legal final mantienen el gate productivo |
| Backups             | Rehearsal Emulator apply â†’ fallo sintÃ©tico â†’ rollback                                                                       | Verificado; sin backup productivo                                                                              |
| QA de release       | Unitarias 154/1066, typecheck, lint, formato, Rules completas 8/64, integraciÃ³n waiver 1/1, E2E waiver 4/4 y baseline local | Parcial; verify:mvp y carga sintetica local pasan; T008/T009 aprobadas solo para piloto sintetico; T011 y carga live/staging pendientes                                 |

## Registro que debe completar el operador

- Fecha y ventana del piloto:
- Entorno aislado utilizado:
- Fixture o dataset sintÃ©tico utilizado:
- Responsable operativo:
- Roles que ejecutaron cada flujo:
- Incidencias y severidad:
- Evidencia adjunta por control:
- Criterio de salida y decisiÃ³n del operador:

## Bloqueos explÃ­citos

T018 estÃ¡ aprobada Ãºnicamente para el piloto sintÃ©tico. T011 y el texto/revisiÃ³n legal final se mantienen para el cierre productivo: no se deben rellenar con valores inferidos ni convertir este borrador en una aprobaciÃ³n legal, de retenciÃ³n, residencia, consentimiento o waiver. T055 tampoco se considera aprobado mientras falten sus decisiones y validaciones pendientes.

## Ensayo E2E sintÃ©tico â€” 2026-08-24

- Comando: NEXT_PUBLIC_ADMIN_E2E=true node qa/run-e2e.mjs.
- Hallazgo previo: las fixtures genÃ©ricas permitÃ­an dos intentos de red externa â€”el dashboard diario y la infraestructura OAuth de Googleâ€”; T086 los aislÃ³ sin relajar las aserciones de salud del navegador.
- RepeticiÃ³n focalizada de autenticaciÃ³n/gates: 28/28 pasados. RepeticiÃ³n completa aislada: 67 pasados, 14 omitidos por live/staging u opt-in y 0 fallos.
- Los artefactos HTML y capturas quedan en qa/reports/ y test-results/, fuera de versionado.
- El resultado sirve como ensayo del piloto; antes de aprobar T056 se debe repetir en el entorno aislado aprobado por el operador y completar las validaciones live/staging pendientes.

## DecisiÃ³n final

Este documento queda listo para ser completado durante la ejecuciÃ³n controlada. La aprobaciÃ³n de T056 requiere un acta fechada del operador con las evidencias y los hallazgos resueltos; hasta entonces permanece en `revision` en `tasks.md`.


## Ensayo E2E sintetico - 2026-08-25

- Comando: NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --dir qa test:e2e.
- Resultado: 71 pasaron, 14 omitidos por live/staging u opt-in y 0 fallos. La ejecucion uso el servidor estatico local y fixtures sinteticas; no se usaron datos reales.
- Estado: T056 pasa a revision tecnica; falta el acta fechada del operador y siguen pendientes T011 y las validaciones live/staging.
