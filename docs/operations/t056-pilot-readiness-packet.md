# T056 — Paquete de preparación del piloto controlado

Estado: borrador operativo; no constituye aprobación del piloto ni autorización de producción.

Fecha de preparación: 2026-08-24

## Alcance fijo

El piloto debe ejecutarse únicamente con datos sintéticos o sanitizados, emuladores o staging aislado, pagos manuales y avisos in-app. No se habilitan datos reales, R2 productivo, email/SMS real, cobros online, importaciones productivas ni despliegue de producción.

## Checklist de ejecución

| Control | Evidencia esperada | Estado |
| --- | --- | --- |
| Guardas de entorno | Runtime fail-closed fuera del piloto sintético | Verificado en tareas relacionadas |
| Identidad y roles | Flujos owner, administrator, head coach, coach, guardian y adultStudent | Verificado sintéticamente; repetir en acta |
| Familias y perfiles | Adultos, menores, guardianes y relaciones activas | Verificado; repetir con fixture controlado |
| Agenda y asistencia | Clase, booking, check-in, puntualidad, no-show y corrección auditada | Verificado; repetir con fixture controlado |
| Child check-out | Recogida autorizada, independencia y override de staff con nota | Verificado; repetir con fixture controlado |
| Finanzas | Pagos manuales, facturas, recibos, balance y restricciones por deuda | Verificado; sin proveedor online |
| Avisos | Publicación, visibilidad por guardian y lectura in-app | Verificado; sin canal externo |
| Salud/soporte | Proyección mínima, acceso restringido y revisión administrativa | Verificado en piloto sintético; T011 mantiene el gate productivo |
| Documentos privados | URL firmada sintética, hash, expiración, revocación y autorización guardian | Verificado en piloto sintético; T011/T018 mantienen el gate productivo |
| Backups | Rehearsal Emulator apply → fallo sintético → rollback | Verificado; sin backup productivo |
| QA de release | Unitarias, typecheck, lint, formato, Rules completas 8/64, E2E y baseline local | Parcial; carga live/staging pendiente |

## Registro que debe completar el operador

- Fecha y ventana del piloto:
- Entorno aislado utilizado:
- Fixture o dataset sintético utilizado:
- Responsable operativo:
- Roles que ejecutaron cada flujo:
- Incidencias y severidad:
- Evidencia adjunta por control:
- Criterio de salida y decisión del operador:

## Bloqueos explícitos

T011 y T018 se mantienen para el cierre: no se deben rellenar con valores inferidos ni convertir este borrador en una aprobación legal, de retención, residencia, consentimiento o waiver. T055 tampoco se considera aprobado mientras falten sus validaciones pendientes.

## Ensayo E2E sintético — 2026-08-24

- Comando: NEXT_PUBLIC_ADMIN_E2E=true node qa/run-e2e.mjs.
- Hallazgo previo: las fixtures genéricas permitían dos intentos de red externa —el dashboard diario y la infraestructura OAuth de Google—; T086 los aisló sin relajar las aserciones de salud del navegador.
- Repetición focalizada de autenticación/gates: 28/28 pasados. Repetición completa aislada: 67 pasados, 14 omitidos por live/staging u opt-in y 0 fallos.
- Los artefactos HTML y capturas quedan en qa/reports/ y test-results/, fuera de versionado.
- El resultado sirve como ensayo del piloto; antes de aprobar T056 se debe repetir en el entorno aislado aprobado por el operador y completar las validaciones live/staging pendientes.

## Decisión final

Este documento queda listo para ser completado durante la ejecución controlada. La aprobación de T056 requiere un acta fechada del operador con las evidencias y los hallazgos resueltos; hasta entonces permanece `pendiente` en `tasks.md`.
