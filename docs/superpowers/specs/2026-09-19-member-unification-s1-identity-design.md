# Unificación de miembros S1: identidad — Design

Fecha: 2026-09-19. Estado: aprobado por el operador en `/brainstorming` (preguntas 1-4, secciones 1-4).
Backlog: `BACKLOG.md` C1 (subproyecto S1 de 4). Sustituye el camino de ejecución de T108.

## Problema

Producción (`bptjersey-f5a25`, academia `demo-academy`, conteo de solo lectura del 2026-09-19):

| Colección | Documentos |
| --- | --- |
| `members` (legacy, importados del PDF el 2026-08-13) | 243 |
| `students` (directorio canónico, ADR-009) | 2 |
| `regyfitMemberRecords` (archivo capturado de Regyfit) | 249 |
| `regyfitMemberLinks` | 1 |
| `families` | 2 |

La ficha canónica (`/admin/members/profile`) lee `students`, así que no ve a casi nadie. S1 da a cada
miembro real un `student` y lo enlaza con su registro del archivo cuando existe. S2 (histórico), S3
(ficha viva) y S4 (retirar el visor) dependen de esto y tienen spec propia.

## Decisiones del operador

| # | Decisión |
| --- | --- |
| P1 | La unificación se parte en S1-S4; esta spec cubre solo S1. |
| P2 | Emparejamiento automático **solo** por identificador fuerte idéntico (número de socio o documento de identidad). Lo demás va a una cola de revisión con decisión explícita y auditada (ADR-009 regla 9). Antes de escribir nada, un informe de solo lectura en producción. |
| P3 | Los menores pasan por la cola con un paso de tutor que usa el flujo de familia existente (ADR-009 regla 10). Sin datos de tutor, el menor queda pendiente y visible. **Enmendada por P5.** |
| P5 (enmendada) | S1 migra todos los miembros: menores con `guardianStatus: pending`; sin fecha con `reviewReason: date-of-birth-missing`. Tutor y fecha se revisan después desde admin. No se crea Auth, familia, relationship ni membership al migrar un menor o una persona sin fecha. El censo comunicado es 243: 143 menores y 20 sin fecha. |
| P4 | No hay migración masiva: cada `student` nace de una decisión de la cola por el camino canónico de alta. Se enmienda la ADR-009. |

## Componentes

### 1. Emparejamiento (dominio, función pura)

`packages/domain/src/members/member-migration-contracts.ts`, exportado como
`@bpt-jersey/domain/members/migration`. Entrada: filas legacy `members`, registros
`regyfitMemberRecords`, claves ya reservadas (legacyMemberIds con decisión, recordIds enlazados) y la
fecha de referencia. Salida: una fila por miembro legacy sin decisión, con una categoría:

- `strong`: exactamente un registro del archivo con el mismo número de socio normalizado **o** el mismo
  documento de identidad normalizado, y ningún otro miembro legacy comparte ese identificador.
- `suggested`: sin fuerte, pero uno o más registros con nombre normalizado igual y la misma fecha de
  nacimiento. Es solo una sugerencia: nunca se aplica sin decisión individual.
- `none`: sin candidatos.
- `ambiguous`: el identificador fuerte coincide con más de un registro, o dos miembros comparten el
  identificador. Nunca es `strong`.

Cada fila lleva además `isMinor`: menor de 18 años en la fecha de referencia, según la fecha de
nacimiento del miembro legacy o, si falta, la del registro emparejado. Sin fecha de nacimiento,
`isMinor: "unknown"`. Todas las filas pueden decidirse; la pestaña "Under 18 / no date" muestra
"Guardian required" o "Check age", el aviso que se aplicará. Solo se recupera fecha de un candidato fuerte único. Los registros del archivo que no
casan con ningún miembro se listan aparte como `archive-only`: se ven, no se deciden en S1.

La misma función la usan el callable y el script de informe: el informe muestra exactamente lo que
verá la cola.

### 2. Lectura de la cola

Callable `listMemberMigrationQueue` (owner/administrator, App Check, `requireAdminActor` +
`assertAcademyScope`, las mismas guardas que los demás callables de oficina; el MFA obligatorio,
T017, está cancelado). Lee `members`, `regyfitMemberRecords`,
`memberMigrationDecisions`, `regyfitOfficeLinks` y `regyfitMemberLinks`, y devuelve el resultado de la función de
emparejamiento más contadores por categoría. No guarda la cola: se recalcula en cada llamada (243 ×
249 filas).

La respuesta enmascara número de socio y documento (últimos 3 caracteres). El valor completo solo se
ve con el "reveal" existente, auditado con motivo. No devuelve contacto de emergencia, datos de salud
ni dirección.

### 3. Decisión (única escritura)

Callable `decideMemberMigration` (mismos permisos). Entrada, validada con zod: lista de 1-50
decisiones `{ legacyMemberId, kind: "link" | "create-unlinked" | "skip", recordId?, reason?, trainingCenter?, trainingTimePreferences? }`.

- `link` exige `recordId`. `skip` exige `reason` (texto de 3-200 caracteres).
- Menores y filas sin fecha admiten `link`, `create-unlinked` y `skip`, con las mismas validaciones
  de candidato y entrenamiento que los adultos. La fecha propia tiene prioridad; si falta se recupera
  del candidato fuerte único, incluso con `create-unlinked`. Nunca se inventa fecha.
- `link` y `create-unlinked` exigen `trainingCenter` (`Town` | `West`) y `trainingTimePreferences`
  (1-3 de `morning`, `afternoon`, `evening`), porque el alta canónica los exige y el legado no los
  tiene. En la aprobación en lote el admin los elige una vez para todo el lote: es su decisión y
  queda registrada en cada decisión.
- **El servidor recalcula el emparejamiento.** Una decisión `link` cuyo `recordId` no aparece como
  candidato (`strong`, `suggested` o `ambiguous`) de ese miembro se rechaza.

Cada decisión es **una transacción** que:

1. crea `memberMigrationDecisions/{legacyMemberId}` (create-only: la segunda decisión falla);
2. para `link` y `create-unlinked`: crea el `student` ampliando el alta canónica existente
   (`createAdult` de `canonical-member-directory-service`, el mismo camino que
   `registerImportedMemberForOffice`) con `source: "legacy-member-migration"`, `legacyMemberId` y
   `migrationId`, y reserva sus `studentIdentityKeys` más una clave `legacy-member-id`. Deriva la edad
   en servidor. Para menores marca `guardianStatus: pending`; sin fecha omite `dateOfBirth`, marca
   `reviewReason: date-of-birth-missing` y mantiene `participantType: minor` como restricción
   conservadora. No crea familia para estos casos. El alta normal de adultos conserva su contrato;
3. para `link`: crea `regyfitOfficeLinks/{recordId}` (el enlace del camino de oficina; si ya existe
   uno en `regyfitOfficeLinks` o `regyfitMemberLinks`, la decisión se rechaza con
   `record-already-linked`). Los datos del `student` salen del registro del archivo (nombre, fecha,
   número de socio), excepto la fecha, que conserva la propia o recupera solo la fuerte. El
   camino canónico verifica nombre y número contra el archivo;
4. añade un `auditEvent` con actor, tipo, `legacyMemberId`, `recordId`, `migrationId`, sin datos
   personales en claro.

El callable devuelve por decisión `applied` o `rejected` con un código seguro. Un rechazo no detiene
las demás. Repetir una decisión ya aplicada devuelve `rejected: already-decided`, así que reintentar
es seguro.

`migrationId` es una constante de la operación: `member-unification-s1-2026-09`.

### 4. Pantalla de la cola

Ruta `apps/web/src/app/admin/members/migration/` con `apps/web/src/lib/member-migration-client.ts`.
Pestañas: Fuertes (con "Aprobar todos los visibles", que envía lotes de hasta 50), Sugerencias,
Ambiguos, Sin coincidencia, Menores y Solo en el archivo (lectura). Contador de progreso. Cada fila
muestra nombre, fecha de nacimiento e identificadores enmascarados de los dos lados, lado a lado.
Reutiliza el shell y los controles de admin existentes (`DESIGN.md`). Solo visible para
owner/administrator.

### 5. Revisión posterior de oficina

Los avisos viven en `students`, con zod en `profiles`. Lista y detalle admin muestran un punto rojo
con "Guardian required" / "Check age" y el directorio cuenta revisiones pendientes en la página
actual. La proyección coach no añade avisos ni contacto ni acciones.

`assignMemberGuardian` (owner/administrator activo, Auth + App Check) recibe `studentId`, UUID de
petición y contacto con nombre obligatorio y teléfono y/o email usando validadores existentes.
Crea una familia de oficina `office-{studentId}` con `primaryContactUserId` y `billingContactUserId`
nulos y `guardianContact`. Enlaza `student.familyId` y marca `guardianStatus: assigned`; no crea
relationship porque requiere un `adultUserId` real. El contacto no habilita acceso online.

`setMemberDateOfBirth` recibe `studentId`, UUID y fecha válida no futura. Recalcula edad, elimina
`date-of-birth-missing` y marca guardian pending si es menor; si es adulto limpia el aviso. El editor
normal de detalles también recalcula los avisos. Sin fecha, los procesos que necesitan comprobar
edad (reserva/plan) fallan cerrados.

Ambas acciones validan tenant/rol y estado canónico dentro de una transacción, avanzan el control
canónico y guardan auditoría sin contacto/fecha y recibo con MAC de petición. Replay idéntico no
reescribe; uno divergente se rechaza. Ninguna colección nueva ni permisos cliente nuevos.

### 6. Scripts de operación

`qa/scripts/member-unification-s1-report.mjs`: solo lectura. Ejecuta la función de emparejamiento
contra el proyecto indicado e imprime contadores por categoría, número de menores, filas sin fecha
de nacimiento, `legacyMemberId` que no cumplen el patrón de identificador administrativo, el
`pendingGuardian` y `pendingDateOfBirth` de estudiantes creados por S1, el
`readerVersion`, `rollbackEligibleStudentCount` y `rollbackCapacityLimit` actuales. No imprime datos personales. Exige `GCLOUD_PROJECT` y, contra emuladores,
host loopback.

`qa/scripts/member-unification-s1-revert.mjs`: dry-run por defecto; cuenta y, con `S1_REVERT_APPLY=yes` más
`MEMBER_UNIFICATION_CONFIRMATION=member-unification-s1-revert-v1` en producción, sigue la cadena de
las decisiones `memberMigrationDecisions` con `migrationId: member-unification-s1-2026-09`.
Para decisiones `link` o `create-unlinked`, comprueba en el perfil admin la marca S1:
`source: legacy-member-migration`, el mismo `migrationId` y el `legacyMemberId` normalizado de la
decisión. Si el perfil ya se borró en un revert parcial, permite reintentar los documentos restantes.
Borra los students, perfiles admin, claves de identidad, enlaces en `regyfitOfficeLinks`, decisiones
y familias de oficina `office-{studentId}` de esa cadena, incluidas las de Assign guardian;
al borrar el estudiante se elimina su enlace `familyId`. No hay relationships creadas por S1. Si la
familia pasó a online, se comparte con un estudiante externo o existe una relación, aborta para
revisión manual. Un `skip` solo borra su decisión.
Nunca toca `members` ni `regyfitMemberRecords`. Mismo patrón de guardas que
`purge-regyfit-record-passwords.mjs`.

## Puesta en marcha

1. Informe de solo lectura en producción. El operador lo revisa.
2. Deploy de los cuatro callables y de la web. ⚠️ Con confirmación explícita del operador.
3. Decisiones en la cola. La app sigue leyendo `members` hasta el paso 4.
4. Corte: el directorio canónico está inicializado en producción desde T025V2 y el alta canónica
   solo escribe con el lector en `canonical-v1`, así que se espera que no haga falta. El informe del
   paso 1 lo confirma. Si `readerVersion` no es `canonical-v1`, se para y se vuelve a diseñar este
   paso. ⚠️ Cualquier cambio de `readerVersion` requiere confirmación explícita del operador.
5. Verificación: conteo de solo lectura. `students` = 2 + decisiones `link`/`create-unlinked`;
   `regyfitOfficeLinks` = previos + decisiones `link`; `memberMigrationDecisions` = decisiones;
   ningún `legacyMemberId` repetido; `rollbackEligibleStudentCount` por debajo de su tope (400).

## Vuelta atrás

- Lectura: no aplica si el corte no hizo falta (paso 4). `members` nunca se modificó.
- Límite conocido: el script inverso no toca `memberDirectoryStates` (su cadena de integridad firmada
  solo la avanza el alta canónica), así que `rollbackEligibleStudentCount` no baja al revertir. Con
  tope 400, revertir unas 245 altas deja sitio para unas 155 más: una segunda pasada completa exigiría
  antes una transición del plano de control que S1 no construye. El script inverso es para
  emergencias, no para repetir la migración.
- Datos: `member-unification-s1-revert.mjs`. Los 2 `students` previos quedan fuera de la cadena de
  decisiones S1 y no se tocan; el script comprueba la marca S1 del perfil admin cuando existe.

## Garantías

- `members` y `regyfitMemberRecords` no se modifican en S1.
- Toda escritura nueva queda ligada a una decisión `memberMigrationDecisions` con `migrationId`; el perfil admin lleva `migrationId`.
- Ningún emparejamiento sin decisión explícita de owner/administrator (lote incluido: cada elemento
  del lote es una decisión registrada con su actor).
- Contactos de emergencia, datos de salud y dirección del archivo no se copian al `student`.

## Firestore

- `memberMigrationDecisions`: reglas deny-all para el cliente (solo callables con Admin SDK).
- Sin índices compuestos nuevos: la cola lee colecciones completas de un tenant.

## Pruebas

- Dominio: emparejamiento (fuerte por número, fuerte por documento, número repetido → `ambiguous`,
  sugerencia por nombre y fecha, `none`, `archive-only`, menor el día anterior y el día del 18
  cumpleaños, fecha ausente → `unknown`); esquemas zod de decisión.
- Servicio con fakes: creación de menores y sin fecha, asignación de contacto, fecha a menor/adulto,
  replay idéntico/divergente, permisos, tenant y auditoría sin PII; cada tipo de decisión; rechazos (`already-decided`, registro ya enlazado,
  `link` a un `recordId` que no es candidato, datos inválidos, `skip` sin motivo); lote con fallos
  parciales.
- Reglas: `memberMigrationDecisions` inaccesible desde el cliente para todos los roles; se desactiva
  la guardia y se confirma que el test cae (`LECCIONES.md` §4).
- Integración con emuladores: siembra sintética (miembros, archivo, un menor) → decidir → corte →
  conteos → rollback de lectura → script inverso.
- E2E Playwright: cola en móvil y escritorio, aprobación en lote, `skip` con motivo.

## ADR-009

Enmienda "Migración dirigida por decisiones": para esta academia, la creación de `students` desde
`members` se hace por decisiones de la cola en lugar del forward executor por lotes. Se mantiene la regla 9 y se enmienda la regla 10 con la excepción de menores legacy pendientes; se conservan las claves de identidad y el interruptor de `readerVersion`. Los ejecutores bootstrap y
forward ya construidos quedan sin uso y no se borran en S1. T108 se cierra como "sustituida por S1"
tras el corte.

## Fuera de S1

Pagos, clases y notas del archivo (S2); reapuntar `auditEvents` de clase a `studentId` (S2); pestañas
vivas de la ficha (S3); retirar el visor del archivo (S4); borrar `members`; los 5 ejecutores de T108
que faltan.

## Hecho cuando

El conteo final en producción cuadra con el informe inicial, `readerVersion` está en `canonical-v1`,
y format, lint, typecheck, unitarias, reglas, integración y E2E están en verde.
