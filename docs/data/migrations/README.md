# Runbook de migraciones Firestore/RTDB

## Estado y alcance

Este documento es el runbook operativo de migraciones definido por `T013`, Task 3. Es un
contrato para migraciones posteriores; no es una migracion ejecutable ni registra una migracion
ya aplicada.

- Firestore Standard es la fuente canonica bajo `academies/{academyId}`.
- RTDB solo contiene presencia efimera bajo
  `academies/{academyId}/presence/{sessionId}/{studentId}`. Nunca reconstruye Firestore.
- Las colecciones, los campos, los limites de tenant, los IDs deterministas y las invariantes
  se toman de `docs/data/firestore-data-model.md` y
  `docs/adr/ADR-004-firestore-aggregate-boundaries.md`.
- Los valores `(f)` y las decisiones `Pending approval` de `T008` son fixtures o placeholders,
  no restricciones productivas.
- `T008` sigue `pendiente`; `T009`, `T010` y `T011` siguen bloqueadas segun `tasks.md`. Este
  runbook no resuelve ninguna de esas dependencias.

**Limite de esta tarea:** Task 3 no aplica migraciones, no ejecuta `up`, `down`, compensaciones,
backups ni restauraciones, no aprueba staging o produccion y no toca datos productivos. No se
considera que T013 haya migrado datos.

## Reglas no negociables

1. Toda migracion tiene un registro completo, un `up` y un `downOrRestore` antes de cualquier
   escritura.
2. El entorno debe ser exactamente `emulator`, `staging` o `production`. Un valor vacio,
   ausente o desconocido detiene el proceso antes de escribir.
3. Toda migracion empieza con dry-run. Un dry-run verde no sustituye un backup, una prueba de
   restauracion ni la aprobacion requerida.
4. Las escrituras son aditivas, acotadas, observables e idempotentes. Las correcciones de datos
   existentes conservan historial y auditoria.
5. `DROP`, `TRUNCATE`, cambios de tipo con perdida de datos y borrado manual desde consola estan
   prohibidos en el flujo normal. No se habilita una excepcion sin backup verificado, evidencia
   de auditoria y aprobacion explicita del operador.
6. Ningun secreto, credencial, payload completo de proveedor, numero de tarjeta, dato medico o
   narrativa de safeguarding aparece en registros, fixtures, referencias de backup o mensajes de
   error.
7. Un fallo detiene el checkpoint actual. No se reintenta a ciegas ni se reabren escrituras hasta
   completar la reversa y reconciliar los conteos.

## Registro obligatorio de migracion

Cada migracion debe tener un registro inmutable y revisable antes de ejecutarse. Los siguientes
campos son obligatorios: `migrationId`, `modelVersion`, `author`, `createdAt`, `scope`, `up`,
`downOrRestore`, `verificationQueries`, `backupReference` y `operatorApproval`.

La siguiente plantilla muestra la forma minima. Los valores entre `<...>` deben reemplazarse por
datos concretos; no se deben dejar comodines en un registro aprobado.

```yaml
migrationId: "<unique-migration-id>"
modelVersion: "<model-contract-version>"
author: "<human-or-service-identity>"
createdAt: "<UTC-ISO-8601-timestamp>"
scope:
  environment: "emulator | staging | production"
  projectId: "<explicit-firebase-project-id>"
  academyIds:
    - "<explicit-academy-id>"
  collections:
    - "<direct-subcollection-under-academies>"
  expectedDocumentCounts:
    "<collection>": "<count-or-recorded-inventory-reference>"
  exclusions:
    - "<out-of-scope-collection-or-field>"
up:
  mode: "dry-run-then-apply"
  description: "<bounded-additive-change>"
  preconditions:
    - "<precondition-and-evidence-reference>"
  checkpointPlan:
    - "<ordered-checkpoint-description>"
downOrRestore:
  strategy: "<idempotent-compensation-or-verified-restore>"
  trigger: "<failure-or-approved-reversal-condition>"
  procedure: "<exact-reversal-reference>"
verificationQueries:
  - id: "<stable-query-id>"
    description: "<query-and-expected-invariant>"
    expected: "<expected-result>"
backupReference:
  reference: "<verified-backup-export-or-emulator-fixture-reference>"
  scope: "<collections-and-academies-covered>"
  verifiedAt: "<UTC-ISO-8601-timestamp>"
  restorationEvidence: "<staging-restore-test-reference-or-emulator-fixture-evidence>"
operatorApproval:
  status: "not-required | pending | approved | rejected"
  approvedBy: "<operator-identity-or-null>"
  approvedAt: "<UTC-ISO-8601-timestamp-or-null>"
  approvedScope: "<exact-environment-academies-and-migration-id-or-null>"
```

### Semantica de los campos

- `migrationId`: identificador unico e inmutable. Repetir el mismo identificador debe reanudar o
  confirmar la misma migracion, nunca crear otra.
- `modelVersion`: version del contrato/modelo que justifica el cambio. No es el `status` del
  documento ni concede autorizacion para migrar por si sola.
- `author`: identidad humana o de servicio responsable del registro. No contiene credenciales.
- `createdAt`: momento UTC de creacion del registro, no un timestamp proporcionado por el cliente
  para documentos de negocio.
- `scope`: entorno, proyecto, academias, colecciones, campos, exclusiones y conteos esperados.
  `academyIds` debe ser una lista explicita; no se permite `*`, `all` ni una consulta sin limite.
- `up`: precondiciones, transformacion, orden de checkpoints y modo dry-run. Debe indicar si solo
  agrega campos/registros o si toca documentos existentes.
- `downOrRestore`: compensacion idempotente para cambios aditivos o restauracion/reversa probada
  para cambios en documentos existentes. Un texto generico como `revert changes` no alcanza.
- `verificationQueries`: consultas o comprobaciones identificadas, con resultado esperado y
  alcance por tenant. Se ejecutan antes, despues de cada checkpoint y al final.
- `backupReference`: referencia no secreta a un backup/export o a un fixture aislado del
  emulador, su alcance, su verificacion y la evidencia de restauracion.
- `operatorApproval`: estado y evidencia de aprobacion. Para produccion debe ser `approved`, con
  identidad, hora UTC y alcance exacto. Una variable de entorno, un commit o un mensaje ambiguo
  no reemplazan la aprobacion explicita.

El `schemaVersion` persistido en un documento identifica su forma almacenada. El
`modelVersion` del registro identifica el contrato de la migracion; ambos deben quedar
compatibles y no deben confundirse.

## Guardas de entorno

El runner futuro debe validar el registro y el entorno con politica fail-closed antes de abrir un
checkpoint de escritura. No existe un entorno por defecto.

### Orden de las guardas

1. Leer y validar la estructura del registro, incluyendo todos los campos obligatorios.
2. Rechazar si `scope.environment` no es exactamente `emulator`, `staging` o `production`.
3. Comparar `scope.projectId` con el proyecto permitido para el entorno. Un proyecto de
   produccion nunca se acepta como emulador o staging.
4. Validar que `academyIds`, colecciones, exclusiones y conteos sean explicitos y pertenezcan al
   alcance aprobado. La ruta `academies/{academyId}` y el campo `academyId` deben coincidir.
5. Validar que el dry-run, el backup y la evidencia de restauracion requeridos existan y
   correspondan al mismo `migrationId`, `modelVersion`, proyecto y alcance.
6. Validar `operatorApproval` cuando el entorno o el tipo de cambio lo exija.
7. Solo despues de todas las guardas se habilita el primer checkpoint de escritura.

Si una guarda falla, el proceso termina sin escribir. La salida debe identificar la guarda
fallida sin revelar credenciales ni documentos.

### Matriz por entorno

| Entorno      | Datos permitidos                                  | Requisitos antes de escribir                                                                                                                            | Puertos/proyecto                                                                                                          | Resultado permitido                                            |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `emulator`   | Fixtures sinteticos, nunca datos reales           | Proyecto `demo-bpt-jersey`, host loopback, alcance explicito y dry-run aprobado                                                                         | Auth `127.0.0.1:9099`, Firestore `127.0.0.1:8080`, RTDB `127.0.0.1:9000`, Functions `127.0.0.1:5001`, UI `127.0.0.1:4000` | Aplicar solo contra emuladores aislados; no toca Firebase real |
| `staging`    | Fixtures sinteticos o datos sanitizados aprobados | Proyecto de staging allowlisted, backup reciente, prueba de restauracion registrada, dry-run y alcance aprobado                                         | Endpoints y proyecto deben constar en el registro, nunca heredarse por defecto                                            | Validar `up`, `downOrRestore`, invariantes y restauracion      |
| `production` | Datos productivos dentro del alcance exacto       | Backup reciente verificado, restauracion verificada, dry-run, evidencia de staging, `operatorApproval.status: approved` y ventana/checkpoints definidos | Proyecto de produccion exacto y verificado; nunca se selecciona por omision                                               | Solo la migracion aprobada; cualquier duda bloquea             |

Para `emulator`, `corepack pnpm firebase:emulators` usa el proyecto local
`demo-bpt-jersey`. La configuracion vigente fija los puertos de la tabla; un conflicto de
puertos detiene la validacion hasta resolverlo, no autoriza a apuntar a otro proyecto. El comando
`corepack pnpm test:rules` inicia la porcion de emuladores que necesita su suite.

Las credenciales de staging o produccion deben provenir de los mecanismos autorizados del
entorno, nunca de este documento, fixtures, argumentos visibles o logs. Task 3 no lee secretos ni
configura credenciales.

## Flujo `up`

Las siguientes fases son obligatorias y deben ejecutarse en este orden para una migracion real:

```text
1. Review BRIEF.md, STACK.md, tasks.md, the current ADR, and the field-level contract.
2. Enumerate affected collections and expected document counts.
3. Run the migration against synthetic fixtures in the Firebase emulators.
4. Validate tenant path, academyId, references, deterministic IDs, statuses, timestamps, and query results.
5. Run in staging only after a backup and restoration test are recorded.
6. Create a recent production backup, verify restoration, and obtain explicit operator approval before production.
7. Apply additive, idempotent writes in bounded checkpoints with structured logs and counters.
8. Re-run invariants and query checks after every checkpoint.
```

La fase 3 incluye primero un dry-run sin escrituras y luego, si corresponde, una aplicacion
aislada sobre fixtures sinteticos del emulador. El runner debe fallar si el fixture contiene
datos reales, un `academyId` fuera del alcance o una referencia entre academias.

La fase 5 no se habilita por haber pasado el emulador: exige que el backup y la restauracion de
staging esten registrados en `backupReference`. La fase 6 no se habilita por haber pasado
staging: requiere un backup de produccion reciente, una restauracion verificada y aprobacion
explicita del operador para el alcance exacto.

**T013 no ejecuta ninguna migracion.** En particular, esta implementacion no ejecuta las fases
5-7, no toca produccion y no convierte este runbook en una aprobacion operativa. Las lecturas de
documentacion realizadas al preparar este archivo no son una ejecucion de `up`.

### Aplicacion en emulador

1. Confirmar `scope.environment: emulator`, `scope.projectId: demo-bpt-jersey` y hosts loopback.
2. Cargar solo fixtures sinteticos versionados o generados para la corrida.
3. Ejecutar el dry-run y conservar su plan, conteos, referencias y errores sanitizados.
4. Aplicar por checkpoints solo si el dry-run y las precondiciones pasan.
5. Ejecutar todas las `verificationQueries` y validar que RTDB solo tenga presencia efimera.
6. Descartar el emulador al terminar; una exportacion de fixture no es un backup de staging o
   produccion.

Las Rules de Firestore y RTDB permanecen default-deny hasta `T016`. Las pruebas de Rules deben
seguir esperando rechazos; este runbook no abre Rules para facilitar una migracion.

### Aplicacion en staging

1. Confirmar que el `projectId` no es el de produccion y que esta allowlisted para staging.
2. Confirmar el backup de las colecciones y academias del alcance, y registrar una restauracion
   exitosa en staging antes de escribir.
3. Repetir el dry-run con el mismo `migrationId`, `modelVersion`, alcance y conteos esperados.
4. Ejecutar checkpoints acotados, con pausa y validacion de invariantes despues de cada uno.
5. Ejecutar `downOrRestore` en staging cuando el registro lo exija y conservar la evidencia.
6. No avanzar a produccion si hay diferencias de conteos, referencias, permisos, consultas,
   auditoria o restauracion.

### Aplicacion en produccion

Produccion es un gate operativo separado. Antes de cualquier escritura deben existir el backup
reciente, la restauracion verificada, el dry-run, la corrida de staging, las consultas de
verificacion, el plan de checkpoints y `operatorApproval` explicita. El operador debe aprobar el
`migrationId`, `modelVersion`, proyecto, academias, colecciones y ventana concretos.

No se permite probar una migracion en produccion, seleccionar el proyecto por defecto, ampliar
el alcance durante la corrida ni continuar ante una guarda ambigua. Task 3 no solicita ni concede
esa aprobacion y no ejecuta este flujo.

## Dry-run

El dry-run es obligatorio para cada entorno y para cada reanudacion cuyo alcance haya cambiado.
Debe ser una simulacion de lecturas y del plan de escritura, sin crear, actualizar ni borrar
documentos. Como minimo produce:

- `migrationId`, `modelVersion`, entorno, proyecto y correlation ID.
- Colecciones, `academyIds`, exclusiones y conteos observados frente a los esperados.
- IDs que se crearían o campos que se añadirían, sin payloads sensibles.
- Referencias que se validarían, incluyendo coincidencia de tenant.
- Checkpoints, límites, cursor y número previsto de operaciones.
- Operaciones que el runner rechazaría por ser destructivas o no idempotentes.
- Consultas e invariantes que deben pasar antes de habilitar `up`.

Un dry-run no es suficiente si no puede determinar el alcance, si encuentra IDs duplicados, si
depende de valores `(f)` como constraints productivas o si no puede probar la reversa. En esos
casos el estado es bloqueado y no se escribe.

## Checkpoints e idempotencia

Cada checkpoint representa una unidad acotada y reanudable. El registro de observabilidad debe
conservar, al menos, el número de checkpoint, cursor o rango, academias afectadas, conteo previo,
conteo intentado, conteo exitoso, conteo fallido y resultado de las verificaciones.

- Confirmar el alcance y leer el estado actual antes de cada checkpoint.
- Aplicar solo cambios permitidos por el `up`, con límites acotados y orden determinista.
- Confirmar el resultado del lote antes de marcar el checkpoint como completado.
- Ejecutar las invariantes y `verificationQueries` antes de comenzar el siguiente checkpoint.
- Si el proceso se interrumpe, reanudar desde el ultimo checkpoint confirmado; nunca repetir a
  ciegas un lote parcialmente confirmado.
- Repetir el mismo `migrationId` sobre el mismo alcance debe producir cero duplicados y ningun
  cambio adicional una vez que el estado esperado ya existe.
- Usar IDs deterministas solo donde el contrato los define, en particular
  `{sessionId}__{studentId}` para `bookings` y `attendance`. Las correcciones de asistencia usan
  un ID opaco generado por backend y `correctionOf`; no reemplazan el registro canonico.
- Validar `academyId` tanto en la ruta como en el documento y rechazar referencias cruzadas.
- No reescribir `auditEvents`, `paymentEvents`, pagos, facturas, consentimientos ni otros
  historiales append-only para hacer que un conteo parezca correcto.
- Los timestamps, actores y estados sensibles siguen siendo propiedad del backend. Un cliente no
  puede inyectarlos para satisfacer una verificacion.

Un checkpoint que deja resultados ambiguos queda `failed` o `blocked`, no `succeeded`. La
reconciliacion debe explicar cada diferencia antes de continuar.

## Backup y restauracion

### Requisitos

- `backupReference` siempre aparece en el registro, aunque en `emulator` referencie un fixture
  aislado y no un backup productivo.
- En staging y produccion debe identificar proyecto, entorno, colecciones, academias, momento UTC,
  version, alcance y evidencia de integridad.
- Antes de staging debe registrarse una restauracion de prueba exitosa.
- Antes de produccion debe crearse un backup reciente y verificarse una restauracion, con evidencia
  vinculada al mismo alcance de migracion.
- La restauracion debe validarse en un proyecto/entorno controlado, nunca sobreescribir produccion
  como prueba.
- El procedimiento debe comprobar proyecto, tenant, conteos, `modelVersion`, permisos, estados,
  referencias, consultas y ausencia de datos de otro entorno antes de exponer el resultado.
- La politica definitiva de retencion, residencia, borrado y restauracion de datos `Restricted`
  sigue siendo responsabilidad de `T011`; no se inventan plazos en una migracion.

Firestore contiene la historia canonica y debe restaurarse desde un backup verificado de Firestore
o desde el mecanismo aprobado para ese entorno. La presencia de RTDB es efimera: no es backup, no
es fuente de verdad y nunca se usa para reconstruir asistencia, pagos, membresias, progreso,
consentimientos, auditoria, salud o safeguarding. Si se pierde presencia, se recrea con el flujo
operativo; no se modifica Firestore para compensarla.

El backup y sus logs se clasifican como los datos de mayor sensibilidad incluidos. Solo se registra
la referencia autorizada, nunca credenciales, URLs firmadas reutilizables, payloads completos o
copias de datos restringidos en este repositorio.

## `downOrRestore`, compensacion y rollback

La estrategia se decide antes del `up` y queda en el registro. No existe rollback implicito por
haber detenido un proceso.

| Cambio                                                 | Reversa requerida                                                      | Regla                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Campo o registro aditivo sin consumidores dependientes | Operacion compensatoria idempotente                                    | Identifica solo los elementos creados por `migrationId`; no borra historia ajena ni elimina datos por una consulta amplia |
| Cambio en documentos existentes                        | Restaurar el backup verificado o ejecutar un `down` probado en staging | Debe conservar o reconciliar actor, timestamps, estados e historial                                                       |
| Evento append-only, pago, auditoria o consentimiento   | Nuevo evento/correccion o restauracion aprobada                        | Nunca se corrige sobrescribiendo o borrando silenciosamente el evento original                                            |
| Presencia RTDB                                         | Expiracion/recreacion de presencia                                     | Nunca se usa para restaurar Firestore                                                                                     |

`DROP`, `TRUNCATE` y cambios de tipo con perdida de datos no forman parte del flujo normal. Una
operacion destructiva no puede ejecutarse sin backup verificado, evidencia de auditoria y
aprobacion explicita del operador; aun con esas condiciones requiere un plan separado, una prueba
de reversa y el gate operativo correspondiente. El borrado manual desde Firebase Console no es un
rollback: sin backup, auditoria y aprobacion explicita esta prohibido.

### Procedimiento ante rollback

1. Detener el proceso en el checkpoint actual y marcar el estado como `failed`.
2. Conservar el registro, correlation ID, logs estructurados, conteos y `backupReference` previo a
   la migracion.
3. No reintentar a ciegas. Clasificar si el fallo es de precondicion, escritura, referencia,
   permiso, consulta, infraestructura o restauracion.
4. Ejecutar el `downOrRestore` documentado para ese `migrationId` en el mismo alcance, empezando en
   emulador o staging cuando sea posible.
5. Validar de nuevo tenant, referencias, IDs, estados, timestamps, consultas, conteos e historial.
6. Conciliar cada elemento intentado, exitoso y fallido contra el backup o el inventario previo.
7. Marcar `rolled-back` solo cuando la evidencia de reversa y reconciliacion este completa. Si la
   reversa falla, el estado es `blocked` y requiere intervencion del operador; no se reabre el
   flujo.
8. Reabrir las escrituras de la operacion solo despues de la reconciliacion y de registrar el
   estado final. Una diferencia sin explicar mantiene el alcance cerrado.

## Observabilidad y auditoria

Cada corrida debe emitir logs estructurados, correlacionables y sin payloads sensibles. Son
obligatorios:

- `migrationId`, `modelVersion`, `environment`, `projectId` y `correlationId`.
- `checkpointNumber`, cursor/rango y timestamp UTC de inicio y fin.
- `attemptedCount`, `succeededCount`, `failedCount` y conteos antes/despues.
- `affectedAcademyIds`, colecciones y estado final.
- Una muestra de error sanitizada, sin documentos completos, secretos, datos medicos, datos de
  menores ni payloads de proveedor.
- Referencia al backup previo, resultado de cada `verificationQuery` y actor autorizado.

Ejemplo de forma, no de datos reales:

```json
{
  "migrationId": "<id>",
  "modelVersion": "<version>",
  "environment": "<emulator|staging|production>",
  "correlationId": "<correlation-id>",
  "checkpointNumber": 1,
  "affectedAcademyIds": ["<academy-id>"],
  "attemptedCount": 0,
  "succeededCount": 0,
  "failedCount": 0,
  "errorSample": null,
  "status": "<dry-run-passed|running|failed|verified>"
}
```

Los logs se conservan junto con su referencia de auditoria conforme a la politica aprobada por
`T011`. No se imprime la configuracion de secretos ni se copia el contenido del backup en los
logs.

## Fallos y reconciliacion

Ante cualquier fallo, timeout, diferencia de conteo, referencia invalida, error de tenant,
resultado de consulta inesperado o perdida de evidencia:

1. Frenar en el checkpoint actual, sin saltar al siguiente.
2. Preservar logs, metadatos, estado del checkpoint y referencia del backup pre-migracion.
3. No reintentar automaticamente ni cambiar el alcance para ocultar la diferencia.
4. Ejecutar la reversa definida y probada, o restaurar el backup verificado cuando corresponda.
5. Reconciliar intentos, exitos, fallos, documentos existentes, documentos creados y estado final
   por academia.
6. Repetir todas las `verificationQueries` y registrar cualquier diferencia residual.
7. Mantener bloqueadas las escrituras afectadas hasta que la reconciliacion sea aprobada por el
   operador responsable.

Un error que exponga datos sensibles, permita cruzar academias, pierda historia financiera o
restrinja la restauracion es un hallazgo critico: bloquea la tarea y el despliegue hasta tener
correccion y evidencia verificable.

## Consultas de verificacion e invariantes

El registro debe incluir consultas concretas, con resultado esperado, para cada coleccion afectada.
Como minimo, antes y despues de cada checkpoint se comprueba:

1. **Tenant:** cada documento esta bajo `academies/{academyId}` y su campo `academyId` coincide.
2. **Referencias:** cada referencia pertenece a la misma academia y apunta a un documento valido
   del contrato.
3. **Conteos:** documentos observados, intentados, exitosos y fallidos coinciden con el inventario
   y el alcance del registro.
4. **IDs:** no hay duplicados; `bookings` y el registro canonico de `attendance` respetan el ID
   determinista; las correcciones usan `correctionOf` y un ID opaco.
5. **Version y forma:** los documentos tocados tienen el `schemaVersion` esperado y no se agregan
   campos fuera del contrato.
6. **Estados:** los `status` pertenecen al dominio que los posee y no se congelan valores abiertos
   de `T008`, `T009`, `T010` o `T011` como constraints.
7. **Tiempo y actor:** timestamps y actores son de backend y las correcciones conservan la
   historia exigida.
8. **Fuente canonica:** Firestore conserva asistencia, pagos, membresias, progreso, consentimientos,
   auditoria y datos restringidos; RTDB contiene como maximo presencia efimera.
9. **Clasificacion:** datos `Restricted` no aparecen en listados generales, exports generales,
   fixtures publicos, logs ni muestras de error.
10. **Consultas propietarias:** cada consulta del modelo devuelve el resultado esperado con su
    proyeccion autorizada; un indice nunca se interpreta como permiso de acceso.

Las consultas de verificacion no autorizan una migracion por si solas. Son evidencia de
consistencia dentro del alcance ya aprobado.

## Verificacion local de este repositorio

Estos son los comandos exactos del contrato local y su proposito:

```powershell
corepack pnpm test:rules
corepack pnpm test
corepack pnpm typecheck
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

- `corepack pnpm test:rules` requiere los emuladores de Firebase. Debe conservarse el
  comportamiento default-deny de Firestore y RTDB hasta `T016`; los rechazos esperados no son un
  fallo del runbook.
- `corepack pnpm test` ejecuta la suite unitaria configurada.
- `corepack pnpm typecheck` comprueba los workspaces TypeScript.
- `git ... diff --check` detecta errores de whitespace en cambios versionables.

Una corrida local verde verifica el repositorio y los emuladores locales. No es aprobacion para
staging o produccion, no verifica un backup real y no autoriza `operatorApproval`.

## Checklist de aprobacion para una migracion posterior

- [ ] El registro tiene los diez campos obligatorios sin placeholders.
- [ ] El entorno es explicito y el proyecto coincide con la matriz.
- [ ] El alcance enumera academias, colecciones, exclusiones y conteos esperados.
- [ ] `up` y `downOrRestore` son concretos, idempotentes y probados en el entorno previo.
- [ ] El dry-run no escribe y su evidencia coincide con el registro.
- [ ] El backupReference esta verificado y la restauracion fue probada cuando corresponde.
- [ ] Cada checkpoint tiene limite, cursor, contadores y consultas de verificacion.
- [ ] No hay `DROP`, `TRUNCATE`, cambios destructivos ni borrado de consola en el flujo normal.
- [ ] Los logs no exponen secretos, datos restringidos ni payloads completos.
- [ ] En produccion, `operatorApproval` esta aprobado para el alcance exacto.
- [ ] La migracion no depende de valores no aprobados de `T008-T011` ni de Rules futuras de `T016`.

Task 3 termina con este documento. Cualquier aplicacion, migracion, restauracion, despliegue o
aprobacion de produccion pertenece a tareas posteriores y requiere sus propios checkpoints y
evidencia.
