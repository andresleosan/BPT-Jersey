# T057 Post-Pilot Production Checklist

Estado: revision tecnica; commit/push a branch para CI/PR recomendado, sin autorizar despliegue,
migracion ni uso de datos reales.

## Objetivo

Preparar los controles posteriores al piloto antes de cualquier decision de produccion. T056 cuenta ahora
con un acta fechada y T011 debe resolverse antes de aprobar este checklist.

## Gates

| Control                           | Evidencia actual                                                                                                                                                                                                          | Estado                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| T056 acta del piloto              | Acta aprobada en `docs/operations/t056-pilot-operator-acta-draft.md`; piloto sintetico con 71 pasaron, 14 omitidos por live/staging u opt-in y 0 fallos                                                                   | Aprobada unicamente para piloto sintetico |
| T055 QA tecnico                   | verify:mvp local: 174 archivos/1217 pruebas, Rules 78/78, carga sintetica 240 solicitudes con 0 fallos y p95 40 ms, E2E smoke 5 pasan/1 omitida esperada                                                                  | Aprobada unicamente para piloto sintetico |
| Runtime desplegable               | Artefacto Functions reconstruido con exit 0; manifiesto sin dependencias workspace y prueba de runtime 3/3                                                                                                                | Verificado localmente                     |
| Seguridad                         | Secret scan acotado sin coincidencias; audit 0 high/critical y 2 moderate del baseline; Firebase no hereda DEBUG en verify:mvp                                                                                            | Verificado para piloto                    |
| T011 retencion/residencia/borrado | Decision owner y reviewer confirmados como no designados el 2026-08-28; paquete de seleccion/consulta listo en docs/operations/t011-reviewer-engagement-brief.md; faltan controller, registro JOIC y decisiones aprobadas | Bloqueado                                 |
| Backup y rollback                 | Rehearsal Emulator apply -> fallo sintetico -> rollback y runbook documentados                                                                                                                                            | Verificado solo en piloto                 |
| Staging real                      | Contrato en docs/operations/t057-synthetic-staging-contract.md; proyecto separado, region irreversible, billing, Access y cuentas siguen sin crear/aprobar                                                                | Pendiente                                 |
| Costos y alertas                  | T010 mantiene shortlist documentada en docs/operations/payment-provider-decision-packet.md; no hay proveedor seleccionado, presupuesto ni alertas productivas aprobadas                                                   | Pendiente                                 |
| CI/CD y entornos                  | CI ejecuta calidad, Rules, build y smoke; no existe CD, GitHub Environment protegido, aprobacion manual automatizada ni artefacto de release/rollback reproducible                                                        | Pendiente                                 |
| Browser QA                        | Piloto sintetico completo: 71 pasan/14 omitidos live-staging-opt-in; T060 Auth+Functions+Firestore Emulator 6/6 desktop/mobile sin retries; no existe corrida autenticada contra staging real                             | Revision                                  |
| Source control                    | Rama `feat/t060-waitlist-offers` creada desde `620d6c7`; commit funcional `6eef74d` con 66 archivos y diff check limpio; evidencia operativa separada para el commit final de trazabilidad                                | Listo para push y CI/PR                   |

## Criterio de salida

T057 solo podra pasar a aprobada cuando T056 conserve el acta aprobada, T011 este aprobada, exista staging
especifico verificado, el backup/rollback sea aplicable al release, costos/alertas esten definidos y
el operador confirme explicitamente el despliegue. Ningun control se satisface con datos inventados.

## Rollback minimo

- Release web: volver a la revision anterior de Pages.
- Functions: restaurar la revision anterior del artefacto desplegable.
- Datos: no aplicar migraciones sin backup verificado, recibo de alcance y rollback probado.
- Ante fallo de un gate: detener el release y conservar la evidencia; no corregir manualmente en produccion.

## Proximo paso

Publicar `feat/t060-waitlist-offers` para ejecutar CI y revision por PR. El corte funcional esta en
`6eef74d` (`feat(schedule): add transactional waitlist offers`) y la evidencia operativa queda en un
commit separado. No hacer push directo a `main` como sustituto de la revision y no desplegar desde
esa branch.

En paralelo operativo, usar docs/operations/t011-reviewer-engagement-brief.md para designar al
decision owner y contratar o nombrar al reviewer de T011. Gate A sigue bloqueado y no se prepara el
proyecto Firebase staging hasta registrar ambos responsables y aprobar la region; Functions ademas
exige billing con presupuesto/alertas. Despues se ejecutan los gates A-E de
docs/operations/t057-synthetic-staging-contract.md y se repite el checklist. T058 no se considera
mientras cualquiera de estos controles siga abierto.

## Checkpoint de integracion 2026-08-30

- `main`, su upstream local y `origin/main` consultado en vivo coinciden en
  `620d6c7d3b9315b6a93df2bd080e70cf536ab6bd`.
- El corte contiene 69 archivos: 59 modificados y 10 nuevos. Todos corresponden a waitlist/ofertas,
  booking y capacidad transaccionales, aislamiento financiero, backup/runtime, UI, Rules, QA,
  cierre fail-closed T063 y documentacion del checkpoint.
- La carpeta generada `.firebase-functions`, logs, reportes y resultados de Playwright siguen
  ignorados. No hay marcadores de conflicto ni secretos detectados.
- El warning Windows `DEP0190` proviene del shim `corepack.cmd` con argumentos internos estaticos;
  no recibe input externo y el CI Linux no activa `shell: true`. Se registra como deuda de tooling,
  no como bloqueo critical/high del corte.
- Conclusion: commit y push de branch para CI/PR recomendados. Merge, staging y produccion requieren
  sus gates independientes; este checkpoint no satisface T011 ni autoriza T058.

## Revalidacion 2026-08-28

- Las cinco condiciones de deploy-checklist no estan satisfechas para produccion: T057 no tiene aprobacion final, no existe staging real validado, el rollback solo fue ensayado con Emulator, no hay CD protegido y no existe confirmacion explicita de T058.
- T011 sigue bloqueada por decisiones de retencion, residencia, borrado y asesoria aplicable a Jersey.
- T010 conserva shortlist de proveedor, pero no hay seleccion, onboarding, presupuesto ni alertas productivas.
- Resultado: mantener T057 en revision y T058 pendiente. El proximo paso seguro es completar T011 y definir un staging sintetico dedicado; no desplegar.
