# ADR-009: students como participante canonico

Fecha: 2026-09-03
Estado: aceptada para el codigo del piloto; cualquier migracion remota conserva su propio checkpoint

## Contexto

El modelo aprobado ya define students/{studentId} como participante y lo referencia desde
familias, memberships, bookings, attendance, salud, consentimientos y reportes. Sin embargo, el
modulo administrativo historico de Members crea, importa y consulta documentos independientes en
members/{memberId}.

Esa separacion produce dos identidades funcionales:

- un alta o PDF importado puede aparecer en Members sin existir para memberships, bookings,
  attendance o reportes operativos;
- progreso y reconocimientos mezclan ambas colecciones y suponen que memberId == studentId;
- algunos campos importados (membershipStatus y paymentStatus) aparentan autoridad aunque los
  agregados canonicos son memberships, invoices y payments;
- una promocion puede hacer merge sobre members/{studentId} y crear un documento parcial.

El BRIEF exige un perfil unificado y el modelo no puede conservar dos fuentes de verdad.

## Decision

academies/{academyId}/students/{studentId} es la unica identidad operativa de cada participante.

1. Todas las referencias de memberships, bookings, attendance, progreso, consentimientos y reportes
   usan studentId.
2. families y relationships siguen siendo la autoridad de tutela y pertenencia familiar.
3. Los campos administrativos que no pertenecen al perfil se guardan uno-a-uno en
   studentAdminProfiles/{studentId}.
4. studentAdminProfiles nunca contiene nombre, fecha de nacimiento, email, telefono, sede,
   participantType, estado del participante, estado de membership ni estado de pago.
5. Membership y finanzas se derivan exclusivamente de memberships, invoices y payments.
6. members queda congelada como fuente legacy. T093 puede cambiar el reader del directorio
   administrativo solo cuando no quede ningun writer normal sobre members. Los readers de
   compatibilidad de progreso/reportes permanecen identificados y fail-closed hasta que T097 los
   retire; el cutover global ocurre entonces. Despues del cutover global ninguna operacion normal
   lee o escribe members.
7. Los nombres publicos de los callables de Members pueden conservarse temporalmente, pero
   memberId pasa a ser un alias de compatibilidad de studentId.
8. No existe dual-write permanente. El cambio de reader es explicito, versionado y reversible.
9. Ninguna coincidencia automatica usa nombre, email o fecha de nacimiento. Vincular un legado o
   una cuenta Auth requiere una decision administrativa explicita, tenant-scoped y auditada.
10. Un menor se crea mediante el flujo de familia/tutor, salvo los menores legacy migrados por S1,
    que pueden existir con `guardianStatus: pending`. La asignación de tutor es una acción explícita
    de owner/administrator, tenant-scoped y auditada. Nunca se inventan tutor, cuenta Auth, familia,
    relationship ni membership: S1 crea solo el estudiante; la familia de oficina nace después de
    recibir un contacto real del administrador.
11. La evidencia de desarrollo usa colecciones directas tenant-scoped: assessments para evidencia,
    studentLevelProgress/{studentId} para el estado actual, levelPromotions para decisiones formales
    y recognitions para reconocimientos no equivalentes a belts/stripes.
12. Las rutas transitorias students/{studentId}/evaluations y graduations dejan de recibir nuevas
    escrituras al hacer el cutover de T097. members.currentLevel y cualquier enumeracion de members
    quedan prohibidos. T097 debe migrar o adaptar el historial antes de retirar compatibilidad.
13. Medical leave es dato Restricted de salud y no forma parte del directorio ni del documento de
    progreso. Su ruta canonica es la coleccion directa medicalLeaves y solo se proyecta al calculo
    autorizado que pausa elegibilidad.
14. membershipNumber, idCardNumber, vatNumber y legacyMemberId son Restricted. Nunca aparecen sin
    mascara en listados, tablas, busqueda general, PDFs generales, analytics ni exports generales.
    Un lookup exacto exige owner/administrator, proposito cerrado, rate limit y auditoria; la
    respuesta no reexpone el valor consultado.
15. La unicidad de membershipNumber, idCardNumber, vatNumber, legacyMemberId y userId se mantiene
    con reservas tenant-scoped create-only dentro de la misma transaccion que crea o vincula al
    estudiante.
16. Una promocion formal la aprueba exclusivamente headCoach. owner no sustituye esa decision y
    ningun nivel se infiere por ausencia: un estudiante sin studentLevelProgress esta uninitialized,
    nunca en white belt por fallback.

Contrato minimo de la extension StudentAdminProfile:

    studentId: string
    academyId: string
    membershipNumber?: string
    idCardNumber?: string
    vatNumber?: string
    gender: male | female | unknown
    frequencyNote?: string
    legacyMemberId?: string
    source: admin | member-pdf-import | legacy-member-migration
    importRunId?: string
    migrationId?: string
    schemaVersion: "1"
    createdAt: UTC timestamp
    createdBy: actor ID
    updatedAt: UTC timestamp
    updatedBy: actor ID

| Campo                                                               | Clasificacion local                         | Regla                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| academyId, schemaVersion                                            | Internal dentro del registro Restricted     | Derivados del path/contrato; nunca elegidos por cliente.                                                                    |
| studentId                                                           | Internal opaque operational key             | Puede aparecer como resource key en lista/detalle administrativo autorizado; no es identificador administrativo ni externo. |
| membershipNumber, idCardNumber, vatNumber, legacyMemberId           | Restricted                                  | No listado/export general; lookup exacto con proposito, rate limit y auditoria.                                             |
| gender, frequencyNote, source, importRunId, migrationId, timestamps | Confidential dentro del registro Restricted | Proyeccion minima; provenance/envelope server-owned y source inmutable.                                                     |
| createdBy, updatedBy                                                | Confidential dentro del registro Restricted | IDs internos de actor; nunca se muestran en el directorio.                                                                  |

Todos los campos de tenant, identidad, source, version, timestamps y actores son server-owned. La
coleccion permanece deny-direct y solo se expone mediante proyecciones minimas autorizadas.

El documento completo studentAdminProfiles se clasifica Restricted por contener identificadores
administrativos. No contiene active ni status: su ciclo de vida depende de students. La allowlist
de la lista administrativa general es studentId, fullName, trainingCenter, participantType, active,
status y, opcionalmente, una membershipReference enmascarada calculada por backend; no incluye DOB,
contactos ni ningun campo del perfil administrativo. La consulta de detalle por studentId tiene una
allowlist separada: perfil Student editable mas membershipNumber, idCardNumber, vatNumber, gender y
frequencyNote. Excluye siempre provenance, timestamps y actores; provenance queda solo en el runner
privado de migracion y ningun callable/UI del MVP puede leerla. frequencyNote es una etiqueta importada acotada, no
texto libre para salud, safeguarding, pagos o credenciales. legacyMemberId nunca es una identidad
publica, un argumento operativo ni la fuente de un studentId nuevo.

La lista administrativa exige Auth + App Check y owner/administrator activo, deriva la academia de
claims y consulta solo students: pagina entre 1 y 50, usa limit+1 y como maximo 50 direct-gets de
perfiles para calcular la mascara. El cursor es opaco, expira en cinco minutos y queda autenticado y
su payload exacto contiene academyId, actorId, role, projectionVersion=`admin-directory-v1`,
order=`__name__:asc`, afterDocumentId, issuedAt, expiresAt y cursorSecretVersion. El backend ordena
por ID documental ascendente y solo aplica startAfter con el afterDocumentId autenticado. guardian,
adultStudent, coach y headCoach usan sus proyecciones propias; overrides de tenant/filtro/orden,
campos desconocidos y cursores falsos, vencidos, cross-tenant o de otro reader fallan antes de la
consulta.

El adapter rollback usa projectionVersion=`legacy-rollback-directory-v1`; su token firmado contiene
solo cursorId aleatorio, orden privado fijo, actor/tenant/rol, stateRevision y expiracion. El
afterLegacyDocumentId vive exclusivamente en memberDirectoryCursorStates/{cursorId}, Restricted,
backend-only, excluido de backup/export y con TTL de cinco minutos. Ningun ID legacy aparece en el
token cliente.

Cada pagina lee memberDirectoryStates/current, cursor opcional, filas y perfiles/keys en una sola
transaccion/snapshot Firestore. El lock del state compite con adquisicion/chunks y un retry vuelve a
seleccionar reader; no puede devolver una mezcla. legacy-v1 responde migration-required sin consultar
members ni students porque un memberId legacy no se puede exponer como studentId. Solo la
tupla canonical-v1/canonical-v1/open/idle consulta students. Solo la tupla estable
legacy-rollback-v1/blocked/frozen/rollback-readonly invoca el adapter acotado de emergencia. Toda
operacion activa de bootstrap, forward, reconciliacion, rollback-projection, recovery o restore falla
cerrada antes de consultar dominio; asi ningun student parcial se hace visible.

El lookup exacto y el detalle sensible de un solo studentId exigen Auth + App Check y derivan
academia/actor de claims, nunca del payload. El enum publico lookupKind acepta solamente
membership-number, id-card-number o vat-number; legacy-member-id queda solo runner/rollback y
auth-user-id solo flujo Auth. Comparten un limite backend-only de 20 intentos por
actor/academia/cinco minutos. Una transaccion valida state y lee cuota/key/perfil o student antes de
crear el evento append-only y responder; su lock evita cruzar una transicion. El intento 21
concurrente no puede pasar. Un rechazo por limite se audita sin leer la
blind key o el perfil solo la primera vez por actor/ventana; los siguientes son read-only para evitar
audit/cost flooding. No existe detalle batch. Audit, logs y errores no contienen input,
normalizacion, digest/keyId ni el identificador administrativo.

source y el envelope de procedencia son inmutables. source=admin prohibe IDs de importacion o
migracion y legacyMemberId; source=member-pdf-import exige importRunId y prohibe migrationId y
legacyMemberId; source=legacy-member-migration exige migrationId y legacyMemberId, y solo permite
importRunId cuando el recibo forward vincula el import previo y su MAC. Ningun callable/UI del MVP
expone provenance. Los actores/timestamps se actualizan solo mediante comandos backend.

Las reservas viven en studentIdentityKeys/{kind}:{digest}. kind se limita a membership-number,
id-card-number, vat-number, legacy-member-id o auth-user-id. digest son 64 caracteres hexadecimales
minusculos producidos con HMAC-SHA-256. El mensaje usa un prefijo de dominio y segmentos UTF-8 con
longitud uint32 big-endian para academyId, kind y valor normalizado; no concatena texto ambiguo. La
clave backend tiene una secretVersion no secreta, es inyectable en Emulator y debe residir en el
secret manager aprobado para uso remoto. Los secretos HMAC de identity keys, integridad de migracion
y cursor son base64url sin padding, decodifican 32-64 bytes aleatorios, son distintos por proposito y
entorno y no tienen fallback/default. Claves vacias, cortas, placeholder, iguales o reutilizadas
fallan antes de leer fuente/Firestore; test keys distintas por proyecto/proposito solo valen con el
binding Emulator exacto demo-bpt-jersey o demo-bpt-jersey-restore en 127.0.0.1:8080. Los MAC se
comparan en tiempo constante. Los cuatro identificadores administrativos usan NFKC,
trim, mayusculas, longitud acotada y un alfabeto ASCII cerrado; Firebase userId conserva comparacion
exacta. El valor original nunca se almacena en el documento ni en su path.

Cada reserva contiene keyId, academyId, kind, digestVersion, secretVersion, ownerStudentId,
schemaVersion y timestamps/actores server-owned. Es create-only e inmutable en operaciones
normales: corregir un valor reserva primero la clave nueva en la transaccion del perfil y conserva
la anterior. Un lookup que resuelve una clave antigua debe comparar dentro de la misma operacion el
valor autoritativo actual: membership-number, id-card-number, vat-number y legacy-member-id leen
studentAdminProfiles, mientras auth-user-id lee students.userId. La revalidacion y todo
create/link/change propietario comparten la misma transaccion y academia. Si el digest no coincide,
devuelve no-match sin revelar al estudiante. Liberacion, tombstone, rotacion o reutilizacion
pertenecen a T011. La unica excepcion
de borrado es la compensacion pre-cutover de una operacion fallida, sujeta a recibo/manifiesto exacto,
ausencia original probada, documento sin cambios, cero referencias y la politica de T011 para
cualquier entorno remoto.

T093 no cambia secretVersion. identity-key-reconcile puede reemplazar el baseline exacto solo con el
mismo secreto, por lo que toda reserva obsoleta continua bloqueando reutilizacion. Rotar exige un
plan posterior multi-version read/deny y single-write; una version distinta falla antes de leer o
escribir.

Antes de confiar en unicidad, T093 debe reconciliar todos los students y studentAdminProfiles ya
existentes, incluidas las vinculaciones userId. memberDirectoryStates/current registra algoritmo,
secretVersion, identityKeyBaselineMac, el opaque identityKeyBaselineArtifactId y
identityKeyCoverage=complete. El artifact privado cifrado conserva el conjunto exacto y ordenado de
tuplas; verificacion, compensacion y restore deben reabrirlo y recomputar su MAC porque una raiz por
si sola no prueba ausencia. Todo writer canonico y todo cutover fallan cerrados si la cobertura,
artifact o versiones no coinciden.

La coordinacion reversible usa memberDirectoryStates/current,
memberDirectoryMigrations/{operationId} y
memberDirectoryMigrationChunks/{operationId}:{phase}:{chunkNo}. Para un directory-forward,
operationId es tambien el migrationId inmutable del studentAdminProfile.
Solo guardan MACs, hashes publicos, conteos, versiones, estado, lease/freeze, cobertura de claves y
correlacion de auditoria; no PII ni valores reversibles. Todo valor derivado de fuentes, paths o
documentos privados usa HMAC-SHA-256 con un secreto de integridad versionado, distinto del secreto
de identity keys y distinto por entorno; SHA-256 simple queda limitado a codigo/esquemas publicos.
Una operacion remota requiere ademas un memberDirectoryApprovals/{approvalId} create-only emitido por
Auth + App Check para un owner/administrator activo; vincula proyecto, operacion, planMac, tipo,
transicion, expectedStateRevision, restoreEpoch cuando aplica y expiry con actor/tenant derivados por
backend. Cada uso local crea memberDirectoryApprovalConsumptions/{approvalId} stage=local-transition
en la misma transaccion de state/operacion. Restore usa kinds distintos restore-acquire y
restore-complete y una saga source-handoff -> target-transition tambien para recovery: el source
consume/revalida el rol y emite un handoff HMAC de hasta 60 segundos; el target lo consume una sola
vez atomico con su transicion. Expiry/CAS exige approval nuevo y nunca se supone atomicidad
cross-project. Reuse, cruce de etapa/revision/epoch o reviewer declarado por el manifiesto fallan.
Cada chunk relee dentro de su propia transaccion el state,
revision, lease, vencimiento, freeze, operationId, phase y numero anterior. El reader legacy permanece
activo hasta que todos los chunks create-only se verifican y una transaccion final cambia el
puntero, habilita exclusivamente los writers canonicos y libera el freeze. El marcador
globalLegacyReadEliminated permanece false e independiente hasta T097.

Los tipos de operacion son identity-key-bootstrap, identity-key-reconcile, directory-forward,
post-cutover-rollback, canonical-recovery, member-directory-restore-recovery y
global-legacy-elimination. Las fases de chunk son bootstrap, identity-reconcile, forward,
compensation, rollback-projection, canonical-recovery y restore-recovery. Sus estados y transiciones
son cerrados; los chunks son create-only con status=committed. El padre sigue en transacciones
auditadas separadas planned -> frozen -> applying -> verified -> completed, salvo el marcador global
metadata-only atomico. Un crash reanuda solo la siguiente transicion exacta y nunca expone un reader
estable antes de completar al padre. El estado estable legacy-rollback-v1 queda frozen/blocked, sin
operacion/lease/deadline y con lastCommittedChunkNo=0. Los memberDirectoryCursorStates efimeros de
cinco minutos pueden existir mientras se pagina el adapter: no son un cursor del state machine. Una
canonical-recovery aprobada adquiere despues una operacion y lease nuevos desde ese estado, incluso
tras un intervalo largo, sin abrir writers legacy.

La entrada a compensacion de directory-forward consume failed-operation-compensate en la misma transaccion que mueve
failed -> compensating, cambia phase, reinicia lastCommittedChunkNo, crea lease/deadline y avanza
state/guard/audit; no toca dominio. Cero chunks usan otra transaccion de prueba exacta antes de
compensating -> aborted. El deadline inicial es 30 minutos, salvo dos horas para paged-v2; despues de
vencer, cada approval post-deadline nuevo habilita solo un intento adicional de maximo 30 minutos sin
cambiar plan/modo/phase/freeze/dominio.

Un identity-key-bootstrap fallido nunca compensa ni borra keys de identidades preexistentes. Un
failed-bootstrap-abandon separado verifica receipts/keys, conserva todas las reservas monotonicas y
el dominio, mueve failed -> aborted y vuelve a legacy/open/idle con cobertura incompleta,
lastCommittedChunkNo=0 y sin operacion/lease/deadline. Un bootstrap nuevo adopta keys compatibles;
cualquier ambiguedad conserva el freeze.

identity-key-reconcile es la unica operacion que puede reemplazar baseline tras el cutover y siempre
conserva secretVersion. Usa canonical-v1/blocked/frozen, conserva el marcador global y vuelve a
open/idle solo al completar. Antes del marcador se limita a 400; despues usa
identity-reconcile-paged-v2: captura una revision state/guard, pagina por separado students y
studentAdminProfiles de 200 en 200, maximo 10.000 en cada conjunto, rechaza perfiles huerfanos o
mismatched y relee la revision al terminar. La fila 10.001 o una carrera entre paginas falla antes de
crear receipt/freeze; adquisicion vuelve a rechazar una revision obsoleta. Usa chunks de 50 y deadline
inicial de dos horas.
La preparacion del ensayo usa solo canonical-v1/blocked/frozen/restore-prepared con
preparedOperationId, lastCommittedChunkNo=0 y sin operacion/lease/deadline activos. Una unica
transaccion target crea state, guard/event, receipt planned y audit; acquire limpia
preparedOperationId y entra a restore-recovery con operacion/lease nuevos, sin importar el marcador
fuente. Todo reader legacy con marcador true y toda tupla no enumerada fallan antes de leer dominio.

El ensayo de restore termina solamente en
canonical-v1/blocked/frozen/restore-rehearsal-complete, sin operacion/lease/deadline y con
lastCommittedChunkNo=0. Ese target aislado nunca sirve lectores o writers de aplicacion.

Mientras globalLegacyReadEliminated=false, rollbackProtocolVersion es
legacy-projection-v1, rollbackCapacityLimit es 400 y rollbackEligibleStudentCount es el numero
monotono de identidades admitidas al conjunto canonico estable. Los outputs privados de forward no lo
incrementan hasta el cutover, por lo que compensarlos no lo reduce; en estados estables false-marker
coincide con students porque no hay hard delete normal. Dry-run/receipt y recheck pre-write exigen
preexistentes + nuevos = final <= 400. Cada alta normal lo incrementa en su misma transaccion;
despues de 400 la siguiente falla sin writes de dominio, keys o audit. T097 deshabilita el protocolo
y retiene el conteo como evidencia.

El guard no restaurable vive fuera del tenant backup en
memberDirectoryRestoreGuards/{academyId}; su head liga project/academy, maxima stateRevision,
marcador-ever-true, maximo conteo admitido, restoreEpoch, versiones HMAC y ultimo event/MAC. La
subcoleccion events/{stateRevision} es create-only y encadena revision/MAC/valores monotonos,
operacion y transicion. Inicializacion, cada mutacion de identidad/state y el gate global actualizan
state, head y nuevo event en la misma transaccion. Missing/divergente, decremento, collision o MAC
invalido falla sin writes. Rules niegan todo acceso cliente y backup/export lo excluyen.

La prueba terminal vive source-local fuera del tenant backup en
memberDirectoryRestoreAttestations/{attestationId}. I4 crea esa atestacion una sola vez bajo un ID
HMAC opaco estable y liga ambos proyectos, revision/epoch target, authorityMode, backupManifestMac,
sourceStateEvidenceMac, attestedReadTime, raices/conteos/bytes payload/control/combined y los MAC de
handoff, consumo e inventario. Retry/T097 escanean a un verificationReadTime nuevo: readTime/MAC
pueden cambiar, pero todo binding/raiz/conteo estable debe coincidir y ambos proofs entran al plan.
T097 la consume una sola vez en memberDirectoryRestoreAttestationConsumptions/{attestationId},
atomicamente con marker, guard y event. Rules niegan acceso cliente y ambas colecciones se excluyen
de backup/export.

Rollback y restore crean primero un receipt planned metadata-only, luego reciben approval. La
adquisicion consumida mueve planned -> frozen; el primer chunk mueve frozen -> applying y cero filas
usan una transaccion explicita sin dominio. Solo despues siguen applying -> verified y verified ->
completed. Restore exige approvals distintos restore-acquire y restore-complete.

Un fallo anterior al cutover deja el reader legacy y el freeze activo. Solo permite reanudar el
mismo plan exacto o compensar en reversa con el manifiesto privado vinculado al recibo y el MAC de
salidas de cada chunk. Un rollback posterior al cutover sigue otro orden: congela, materializa y
verifica primero toda proyeccion legacy faltante, cambia el reader despues y preserva los registros
canonicos. Ese reader de emergencia es un adapter privacy-safe: resuelve originales mediante la
reserva legacy-member-id, vuelve a verificar el valor actual del perfil y emite studentId; una
ausencia, clave obsoleta o duplicidad falla cerrada. Permanece read-only/frozen hasta recuperar el
reader canonico y solo existe mientras globalLegacyReadEliminated=false.

T097 solo puede marcar la eliminacion global mediante una operacion global-legacy-elimination
metadata-only. Su plan vincula cutover, revision, baseline, codigo/esquema desplegado, prueba exacta
de cero dependencias y atestacion I4 source-local create-only del ensayo aislado backup v3. El
planner repite I4 target antes de crear la operacion source. Desde
canonical-v1/canonical-v1/open/idle, sin lease,
una transaccion revalida y consume atestacion y approval, incrementa revision, crea/avanza
el event/head ever-true, marca true, completa la operacion y audita; tambien fija
rollbackProtocolVersion=disabled sin reducir su conteo historico. Compite
atomicamente con cualquier adquisicion de rollback, es idempotente solo para el mismo recibo y nunca
vuelve a false en v1. No borra members; cleanup sigue separado bajo T011.

## Alternativas consideradas

### Hacer members canonica

Descartada. Exigiria cambiar las foreign keys de todos los agregados operativos ya construidos y
convertiria un formato de importacion administrativa en la identidad central.

### Copiar todo MemberRecord a students

Descartada. Mezclaria PII administrativa con el perfil operativo y duplicaria estados comerciales y
financieros.

### Mantener dual-write permanente

Descartada. Una falla parcial o un cambio de contrato volveria a crear dos verdades. La
compatibilidad debe existir en readers/adapters acotados y desaparecer tras la estabilizacion.

### Fusionar automaticamente por email o nombre

Descartada. Es insegura para familias, nombres compartidos y datos de menores; tambien permite
revelar la existencia de otra identidad.

## Consecuencias

- Alta, importacion y busqueda administrativa deben proyectar el directorio canonico.
- Levels y reportes dejan de enumerar members.
- La extension administrativa agrega una coleccion backend-only y debe entrar en backup, Rules,
  pruebas de tenant y retencion.
- Backup/restore debe tratar students, studentAdminProfiles, studentIdentityKeys y el puntero del
  directorio, limites de lectura, operaciones, chunks, approvals, auditoria y fuente members como un
  conjunto consistente, junto con progreso directo y rutas transitorias. El backup v2 actual no
  cubre esa frontera; T093 debe introducir backup v3 y ensayar restore aislado antes del gate global.
- El `memberDirectoryStates/current` fuente queda capturado cifrado como evidencia de autoridad, no
  como payload materializable. Su sourceStateEvidenceMac entra en manifest, parent e I4; el target
  crea su propio state en target-control y nunca sobrescribe ni doble-clasifica esa ruta.
- artifactDispositionVersion=member-directory-restore-v1 cierra la disposicion: state exacto es
  verify-only-authority; los otros paths tenant allowlisted son materialize-exact; cursor y controles
  top-level se excluyen antes del backup; cualquier otro path/disposition falla. Root backup incluye
  materializable + state, root payload solo materializable y no existe remap en v1.
- El manifest v3 vincula read time, revision y marcador del snapshot, tupla reader/write/freeze,
  protocolo/conteo de rollback, versiones de codigo/esquema, conteos/raices, baseline artifact/MAC y
  versiones exactas de secretos. El ensayo debe reabrir los artifacts privados.
- T093 solo restaura desde demo-bpt-jersey hacia el project namespace local separado
  demo-bpt-jersey-restore, misma academia, Firestore 127.0.0.1:8080, Auth 127.0.0.1:9099, target sin
  Auth/documentos/workloads y create-only. Same-project, remoto o target no vacio falla antes de
  leer artifacts/dominio.
- El preflight restore exige flags source/target y exactamente dos Admin apps nombradas, sin default
  ni extras; variables ambiente son source-only. `firestore-namespace-inventory-v1` recorre desde la
  raiz con ListCollectionIds y ListDocuments(showMissing=true) a un readTime unico; encola tambien
  parents ausentes, valida el patron/ID/profundidad y detecta subcolecciones huerfanas, otra academia e
  IDs desconocidos. Payload admite 10.000 documentos/256 MiB; target-control 2.048/32 MiB; el hard
  cap combinado es 12.048 documentos, 288 MiB y 12.049 paths visitados por el unico anchor ausente.
  Ambos sets son disjuntos y tienen raices separadas/combined. I0 exige vacio; I1-I4 ligan el set/root
  exacto preparado/restaurado/terminal.
  listUsers y direct gets son defensa adicional. El ensayo usa emulators:exec fresco, sin import,
  singleProjectMode=false y un solo writer target.
- El runner verifica fuente y firma target con secretos distintos. Approvals acquire/complete/recovery
  provienen del owner/administrator Auth + App Check fuente; source consume a un handoff HMAC inmutable
  y target lo aplica una vez con su transaccion. Revocacion previa bloquea; la posterior no revoca esa
  capacidad corta ya consumida. Crash reusa solo el mismo handoff vigente.
- Solo snapshots de tuplas estables son elegibles. El guard fuente conserva maxima revision, count,
  epoch y marker-ever-true; snapshot viejo o false despues de true queda solo como evidencia.
  Restaurar nunca reinstala state/guard/lease/approval fuente como autoridad. State es verify-only;
  guard/lease se excluyen; approvals/consumptions historicos de un snapshot estable se materializan
  exactos solo como evidencia inerte y nunca autorizan una transicion target. Una transaccion
  create-only prepara guard, event revision-cero, state restore-prepared, receipt planned y audit;
  crash queda completamente en I0 o I1. Acquire luego limpia preparedOperationId y crea
  operation/lease/revision/epoch nuevos.
- Firebase Auth y su autoridad no se restauran. Para no romper invariantes familia/menor, los enlaces
  Firestore students.userId/auth-user-id y users/staff/families/relationships se preservan como
  evidencia exacta en authorityMode=quarantined-no-auth. No otorgan acceso: target Auth permanece
  vacio, todas las fases son blocked y ningun runtime apunta al proyecto. Relinking/rekey/activacion
  exige una operacion y ADR futuros con revalidacion completa.
- El ensayo se limita a 10.000 documentos payload/256 MiB mas el headroom target-control exacto de
  2.048 documentos/32 MiB y 30 minutos; cada chunk create-only admite 40 documentos payload, 2.500
  reads, 8 MiB, 100 writes y 15 segundos. Termina bloqueado en
  restore-rehearsal-complete y nunca abre un reader/writer de aplicacion.
- Activar o sobrescribir un tenant servido requiere otro ADR: fence tenant-wide o namespace
  versionado y revision de autoridad Auth compartida por provisioning/revocation, ademas de T011 y
  checkpoint nuevo. T092/T093 no autorizan ese camino.
- El gate global no intenta una transaccion entre proyectos: despues de completion, I4 crea una
  atestacion source-local create-only; antes de planear, T097 repite I4 target y liga su
  backupManifestMac/sourceStateEvidenceMac, ID/MAC/attested readTime/inventory MAC, project/revision/
  epoch/roots y verification readTime/inventory MAC al planMac source. El marker la consume
  atomicamente.
- La politica final de retencion y borrado pertenece a T011. Hasta entonces no se habilitan datos
  reales; perfiles, reservas, recibos y auditoria se preservan y no tienen hard delete interactivo.
- Los documentos legacy se conservan intactos durante la ventana reversible.
- El rollback post-cutover reconstruye y verifica primero una proyeccion legacy cuando sea
  necesario; solo despues cambia el reader y nunca borra los registros canonicos como parte del
  rollback normal. La vista degradada no habilita altas/correcciones ni devuelve legacyMemberId.
- La unica excepcion a la congelacion de members es el compensador de rollback, con freeze activo,
  recibo exacto y autorizacion separada; crea solo proyecciones faltantes y nunca sobrescribe un
  documento historico. Esas proyecciones usan memberId=studentId opaco, membershipStatus=inactive y
  paymentStatus=unknown, nombre placeholder y ningun campo opcional/PII administrativo; son solo de
  directorio y nunca otorgan membership ni acceso financiero. Sus chunks permanecen committed; solo
  la operacion padre se verifica antes de entrar al estado estable sin lease.
- El cambio requiere pruebas de contrato, Emulator, autorizacion negativa y un golden path
  autenticado antes de staging.
- No se autoriza migracion productiva, eliminacion de legacy ni carga de PII con este ADR.

## Gates

1. T092 cierra el contrato y el plan reversible.
2. T093 implementa y prueba convergencia solo en procesos locales/Emulator.
3. T098 demuestra el golden path completo en Emulator.
4. T011 y T057 deben cerrarse antes de datos reales.
5. Crear/desplegar staging requiere checkpoint explicito y controles de costo.
6. Produccion y cleanup destructivo requieren backup verificado, rollback ensayado y confirmacion
   separada del operador.

## Enmienda 2026-09-19: migración dirigida por decisiones (S1)

Para `demo-academy`, los `students` que vienen de `members` se crean mediante decisiones de la cola
`/admin/members/migration`, con los callables `listMemberMigrationQueue` y `decideMemberMigration`,
sobre el alta canónica `createAdult`, en lugar del forward executor por lotes.

La regla 9 se mantiene y la regla 10 admite la excepción legacy: el emparejamiento automático solo admite un identificador fuerte
idéntico y su aplicación sigue siendo una decisión explícita del administrador, incluso en lote.
Los menores se crean con `students.guardianStatus: pending`. Sin fecha propia ni recuperada de una
coincidencia fuerte se omite `dateOfBirth`, se guarda `reviewReason: date-of-birth-missing` y se usa
`participantType: minor` como restricción conservadora, no como edad verificada. Los flags tienen
esquema zod en dominio y se proyectan solo a lista/detalle de oficina; el coach conserva su proyección.
La fecha introducida por admin recalcula el tipo: si es menor pasa a guardian pending; si es adulto
limpia el aviso. Las operaciones que exigen edad comprobada fallan cerradas sin fecha.

`assignMemberGuardian` crea `families/office-{studentId}` con contactos de usuario nulos y
`guardianContact: { fullName, phoneNumber?, email? }`, enlaza `student.familyId` y marca `assigned` en
una transacción con auditoría y recibo idempotente. No crea Auth ni relationship porque ésta exige
`adultUserId`. Es un contacto de oficina, no acceso online ni prueba de tutela legal. No se reutiliza
una familia existente ni se inventa una relación. `setMemberDateOfBirth` comparte autorización,
validación, auditoría y protección de replay. El detalle general también conserva/recalcula los
avisos al editar la fecha. Los avisos son la excepción explícita a la allowlist mínima anterior;
el contacto del tutor no se expone en listados ni en la proyección de coach.

Cada alta lleva `source: legacy-member-migration`, `migrationId: member-unification-s1-2026-09`,
una clave de identidad `legacy-member-id` y un registro `memberMigrationDecisions/{memberId}`
create-only. Los ejecutores bootstrap y forward ya construidos quedan sin uso y no se borran.

T108 se cierra como **«sustituida por S1»** al verificar el conteo final en producción; esta enmienda
no declara realizada esa verificación. La operación y su vuelta atrás se describen en el
[runbook S1](../operations/member-unification-s1-runbook.md), conforme a la
[spec de identidad S1](../superpowers/specs/2026-09-19-member-unification-s1-identity-design.md).

## Enmienda 2026-10-21: T097 sin rollback-v1 (directorio lleno a 400)

El 2026-10-21 el directorio de producción está lleno. `memberDirectoryStates/current` tiene `rollbackEligibleStudentCount=400`, igual a `rollbackCapacityLimit=400`, con `globalLegacyReadEliminated=false`, `rollbackProtocolVersion=legacy-projection-v1` y `stateRevision=794`. Por eso toda alta nueva de `students` se rechaza por capacidad: `directory_capacity_exhausted` en el alta canónica y en las familias, y código `capacity` en el alta de perfil. El operador eligió T097 como salida definitiva: la academia va a crecer y no debe quedar ningún límite de alumnos. Esta enmienda adapta T097 a lo que de verdad se construyó y se desplegó. Conserva la transición única `global-legacy-eliminate`, el guard no restaurable con su cadena HMAC, la irreversibilidad del marcador y la confirmación del operador. Retira las pruebas que suponían un mecanismo que nunca existió.

El punto de partida es este. El ejecutor de rollback-v1 no existe. `rollback-projection`, `rollback-readonly` y `legacy-rollback-v1` aparecen solo como nombres. En `apps/functions/src/members/member-directory-state.ts` son tipos de transición y el clasificador de la tupla legacy-rollback. Además están en el mapa de fases de `member-directory-chunk-runner.ts`, en la tabla de adquisición de `packages/domain/src/members/member-directory-transitions.ts` y en los contratos y el ensayo backup v3 (`backup-v3-contracts.ts`, `backup-v3-rehearsal.ts`). No hay materialización de proyecciones ni lector de emergencia. T093 no migró `members`: inicializó un directorio canónico vacío en la revisión 0 (`apps/functions/src/members/canonical-directory-initialization.ts`), y la enmienda S1 sustituyó el forward executor por las decisiones de la cola. En producción `members` tiene 0 documentos, y `memberDirectoryMigrations` y `memberDirectoryRestoreAttestations` están vacías. El límite de 400 reserva capacidad para una vuelta atrás que no se puede ejecutar, así que T097 no renuncia a nada ejecutable.

Gate 6 y el ensayo de rollback. Para T097, «rollback ensayado» se sustituye por tres cosas: PITR activo, comprobado con un comando del operador; la hora de recuperación anotada justo antes de aplicar; y la confirmación separada del operador. Razón: no hay rollback que ensayar, y T097 solo escribe cuatro documentos de metadatos (estado, cabecera del guard, evento del guard y auditoría). No toca alumnos, perfiles, pagos ni `members`. PITR protege el resto de la base frente a un fallo del ejecutor. No es un mecanismo para deshacer T097. Dentro de la misma base, el guard rechaza recuperar un estado anterior al marcador (`member-directory-state.test.ts`, «refuses a pre-T097 backup against a guard that has seen the marker»). Esa negativa no cubre un restore de la base completa: el guard vive en la misma base `(default)` que `memberDirectoryStates/current`, de modo que un restore de PITR o de backup a un punto anterior a T097 traería también la cabecera y la cadena del guard de ese momento. El resultado sería marcador false, protocolo `legacy-projection-v1` y contador 400 (lleno), y se perderían las altas posteriores. Por eso, después de T097 solo se pone en servicio un restore de la base completa a un punto posterior al commit de T097. Uno anterior requiere un ADR nuevo y la confirmación del operador. La regla 6 de Gates queda: «Produccion y cleanup destructivo requieren backup verificado, rollback ensayado (para T097, ver Enmienda 2026-10-21) y confirmacion separada del operador». El cleanup destructivo de `members` y cualquier otro cambio productivo siguen sujetos a la regla original.

Recibo de cutover. El precondicionante `completed-directory-forward` (`packages/domain/src/members/member-directory-transitions.ts`, `completedDirectoryForwardCount >= 1`) se retira. Producción no puede tener nunca un recibo de forward, porque se inicializó vacía y se pobló con S1. La prueba de cutover pasa a ser la propia cadena del guard, con tres exigencias. Primera, el estado actual `canonical-v1/canonical-v1/open/idle` con `identityKeyCoverage=complete`, sin operación, lease ni deadline, y con `lastCommittedChunkNo=0`. Segunda, ese estado ligado a la cabecera `memberDirectoryRestoreGuards/{academyId}` y a su último evento con MAC válido, verificado con `assertMemberDirectoryControlPlane` y el secreto `MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET`. Tercera, el conteo de `academies/{academyId}/members` igual a 0, leído dentro de la misma transacción con `limit(1)`. Las altas de S1 quedan identificadas por `migrationId: member-unification-s1-2026-09` y por `memberMigrationDecisions`, que no se vuelven a leer.

Modelo de evidencia y caducidad. Ya no se usan recibo `planned` con `planMac`, aprobación `memberDirectoryApprovals` emitida ni atestación I4 consumida. Dentro de la transacción de T097 se miden la tupla del estado, la cadena del guard con MAC y `members` igual a 0. Los conteos anidados transitorios se leen una vez antes del dry-run, pidiendo solo rutas, y entran como evidencia al planificador. Son los collection-group `evaluations`, `graduations` y `medicalLeaves` con padre bajo `students/*` o `members/*`; los `medicalLeaves` directos de la academia son la colección canónica y no cuentan. Si alguno no es 0, se para. Ningún código del historial escribe esas subcolecciones, así que nada puede crearlas entre esa lectura y la aplicación.

La lista de lectores legacy queda fijada aquí, verificada en HEAD 6d8ad85. Ningún callable exportado en `apps/functions/src/index.ts` lee `members` sin pasar por `assertLegacyReadsOpen` o `legacyReadState`. El código desplegado anterior a 264c2c9 no tiene esas compuertas y lee `members` (0 documentos) y Regyfit (borrado el 2026-09-24), sin efecto. Hay lectores Regyfit sin compuerta: `listRegyfitMemberRecords`, `getRegyfitMemberRecord`, `listRegyfitAccessRecords`, `revealRegyfitRecordField`, `getMemberHistory`, `getMemberRecoveryHistory` y `manageMemberSubscription` con previously-paid. Leen un archivo vacío y se comportan igual antes y después del marcador. Esta enmienda lo registra: el marcador cierra las lecturas de `members`, y esos lectores Regyfit siguen abiertos sobre un archivo vacío hasta que se cierren o retiren como seguimiento (S). Ese seguimiento incluye quitar la opción «Previously paid» de la web y retirar los CLI que escriben stores legacy (`qa/scripts/import-member-pdfs.mjs`, `qa/scripts/import-regyfit-member-records.mjs`).

La aprobación sigue el patrón de los CLI de operador ya existentes (`apps/functions/scripts/reconcile-membership-numbers.mjs`). El dry-run imprime una confirmación derivada de `academyId`, `stateRevision`, el `eventId` del último evento del guard y los conteos medidos. `--apply` exige esa cadena exacta más la constante `T097-GLOBAL-LEGACY-ELIMINATE-PRODUCTION-APPLY`, y solo se ejecuta después de la confirmación del operador en el chat. En el dominio, `verified-backup-attestation` se retira y `global-legacy-eliminate-approval` se satisface con esa confirmación verificada. La confirmación caduca si cambia `stateRevision`. Con una sola academia y un solo operador, la cadena ligada a la revisión es exacta y de un solo uso, porque la transacción revalida la revisión y el marcador. El evento create-only del guard, con `transitionKind: global-legacy-eliminate`, más el evento de auditoría hacen de recibo inmutable. El tipo de operación `global-legacy-elimination` de `member-directory-operation-contracts.ts` queda sin uso y no se borra.

Premisa de borrado y regla R3. La regla del contador (400, «coincide con students porque no hay hard delete normal») y la frase «no tienen hard delete interactivo» dejaron de ser ciertas el 2026-09-22. Ese día `deleteMemberAccount` (`apps/functions/src/members/member-delete-callables.ts`, 066178b, ampliado en 6c41a6f) añadió el borrado definitivo desde la oficina. Ese borrado también libera las claves de identidad del alumno, en contra del párrafo que reservaba eso a T011. Esta enmienda lo registra como un hecho aceptado; la retención y el borrado siguen perteneciendo a T011. `rollbackEligibleStudentCount` cuenta admisiones, no alumnos vivos, y nunca baja. R3 se registra una sola vez para explicar el contador y no es precondición de T097, porque T097 no cambia ni usa el contador y una diferencia no tendría ninguna corrección permitida. El dato del 2026-10-21 es este: 150 `students` más 250 `targetRef` distintos en los eventos `member.account.deleted` dan 400. Para obtenerlo se leen solo identificadores opacos y agregaciones.

legacy-projection-v1 y el límite de 400 después de T097. La transacción pone `rollbackProtocolVersion=disabled` y `globalLegacyReadEliminated=true`. Conserva `rollbackEligibleStudentCount=400` y `rollbackCapacityLimit=400` como histórico: no se suben, no se bajan y no vuelven a incrementarse. Las comprobaciones de capacidad de `canonical-member-directory-service.ts`, `profiles/profile-service.ts`, `families/family-service.ts` y `member-recovery-service.ts` ya saltan el límite y dejan de contar cuando el marcador está a true; esas ramas existen desde el primer commit del historial (59e5686). Por eso no cambia ningún literal y la academia admite alumnos sin límite de directorio. El `z.literal(400)` de `member-directory-contracts.ts` sigue igual, como forma del histórico. El límite de 10.000 por conjunto de `identity-reconcile-paged-v2` solo afecta a una reconciliación que no está construida y no limita las altas. El marcador nunca vuelve a false. legacy-projection-v1 queda retirado sin haber tenido ejecutor, y cualquier vuelta atrás futura necesita un ADR nuevo (rollback-v2).

Procedimiento mínimo de T097. El CLI se construye desde HEAD y lo ejecuta el operador, porque necesita el secreto de integridad.

1. Dry-run, el modo por defecto. Verifica la tupla, la cadena del guard con MAC, `members` igual a 0 y los conteos anidados igual a 0. Imprime el estado siguiente (revisión + 1, marcador true, protocolo `disabled`, contador 400) y la confirmación.
2. Confirmación del operador en el chat justo antes de aplicar, a una hora tranquila: las ediciones de perfil cambian la revisión y obligan a repetir el dry-run.
3. `--apply` en una sola `runTransaction`. La transacción relee y revalida todo, planifica con `planMemberDirectoryGlobalLegacyElimination` y avanza con `advanceMemberDirectoryControlPlane` y `transitionKind: global-legacy-eliminate`. En la misma transacción escribe `tx.set` del estado y de la cabecera, `tx.create` de `memberDirectoryRestoreGuards/{academyId}/events/{eventId}` y la auditoría, igual que `own-emergency-contact.ts`. Si el marcador ya es true, responde «ya hecho» sin escribir y sin llamar al planificador.
4. Verificación: marcador true, protocolo `disabled`, el evento del guard con `transitionKind: global-legacy-eliminate` en la revisión anterior + 1, contador 400 y evento de auditoría presente. Después, con autorización expresa del operador, se reaprueba una solicitud aparcada real.

Ante un resultado incierto (error, timeout o respuesta perdida) se repite solo el dry-run, y se actúa según lo que muestre:

- Marcador true: la operación se confirmó, porque solo la transición `global-legacy-eliminate` puede ponerlo. Se busca ese evento en la revisión anterior + 1 y se pasa a verificar, aunque haya eventos posteriores.
- Marcador false y revisión sin cambiar: no se escribió nada, y se puede repetir el mismo `--apply`.
- Marcador false y revisión cambiada: se usa la confirmación nueva.

Nunca se abre otro camino para salir de la duda.

Lo que sigue prohibido. No se sube el literal 400. No se pone a cero ni se baja el contador. No se salta, desactiva ni rodea el guard ni ninguna comprobación. `globalLegacyReadEliminated` solo se activa con la transición `global-legacy-eliminate` de este procedimiento. T097 es una escritura productiva irreversible y necesita la confirmación del operador en el chat justo antes de aplicar. No se despliega ni se escribe en producción sin su aprobación concreta. T097 no borra `members` ni ningún dato; eso sigue en T011. La auditoría y los recibos de T097 solo llevan identificadores, revisiones y conteos.

La regla del contador (párrafo «rollbackCapacityLimit es 400…») y el párrafo de T097 sobre la operación `global-legacy-elimination` con atestación I4 se leen con esta enmienda. Las pruebas retiradas aquí no se borran del documento de diseño, pero dejan de ser precondición de T097. Esta enmienda no declara realizadas las lecturas de producción pendientes (PITR, cadena MAC y conteos anidados) ni declara construido el ejecutor. El diseño original está en [member-directory-v1](../data/migrations/member-directory-v1.md), y el contexto y las alternativas en el [paquete de decisión](../operations/member-directory-capacity-decision-packet.md).

## Enmienda 2026-10-22: seguimiento (S), retirada de los lectores Regyfit

Esta enmienda registra el seguimiento (S) de la Enmienda 2026-10-21 sin cambiar su texto. El archivo Regyfit está vacío en producción desde el 2026-09-24, y T097 cerró las lecturas de `members` el 2026-10-21. El seguimiento (S) retira del código lo que solo leía ese archivo. No borra ningún documento de Firestore. No cambia reglas, índices ni listas de backup.

Lo que se retira:

- Los seis callables sin compuerta salen de `apps/functions/src/index.ts`: `listRegyfitMemberRecords`, `getRegyfitMemberRecord`, `listRegyfitAccessRecords`, `revealRegyfitRecordField`, `getMemberHistory` y `getMemberRecoveryHistory`. Sale también el código de functions y de la web que solo usaban ellos, salvo lo que se nombra en «Queda sin uso».
- `manageMemberSubscription` se queda. Su contrato pierde el modo `previously-paid`, y el servicio pierde la rama que leía el archivo. La lectura de `previousPaymentRecordId` se queda, porque puede haber membresías vivas que lo lleven.
- En la web salen la opción «Previously paid», el archivo importado de `/admin/members/search?archive` («Previous member records», con su ficha y el revelado de campos), la pestaña History de la ficha del alumno, el historial previo de `/account/progress` y los enlaces y frases de la ficha del alumno y de Members que remitían al archivo importado. La búsqueda exacta por número de socio, DNI o VAT sigue en `/admin/members/search?archive`.
- Salen los CLI `qa/scripts/import-member-pdfs.mjs` y `qa/scripts/import-regyfit-member-records.mjs`. También `qa/scripts/normalize-regyfit-capture.mjs`, que solo preparaba la entrada del segundo, y `qa/scripts/member-unification-bulk-coverage.mjs`, que solo enviaba `previously-paid`. Sale además la prueba Playwright `qa/tests/imported-registration-retry.spec.ts`, que recorría el archivo.

Lo que no cambia. `resolveMemberSubscriptionProfile`, `registerImportedMemberForOffice`, `listMemberMigrationQueue`, `decideMemberMigration` y la página `/admin/members/migration` siguen cerrados por T097. Los dos primeros se quedan sin llamador web. `qa/scripts/import-regyfit-access.mjs` y `apps/functions/src/regyfit/access-import.ts` siguen igual: no pueden escribir en producción y se revisan en un cambio aparte.

Queda sin uso, a propósito, para un cambio aparte:

- La pila de recuperación de cuentas: `member-recovery-callables.ts`, `member-recovery-service.ts`, `member-recovery-sources.ts`, `member-recovery-ticket.ts` y `member-recovery-subject-service.ts`, en `apps/functions/src/members/`. `index.ts` ya no exporta nada de ella; solo la usan sus pruebas unitarias y de integración.
- Contratos de dominio sin llamador: `@bpt-jersey/domain/members/history`, los esquemas de listado y de revelado de `members/regyfit-records`, y `importedSubscriptionLinkSchema` y `OfficeMemberRegistration` de `memberships/admin`.
- Restos menores: la prop `children` de `MemberProgress`, las reglas `.member-search-archive` y `.member-history` de `admin.css`, y la comprobación de `getRegyfitProjectionScope` en `qa/unit/release-delta.test.ts`, que ya no puede fallar.

La acción de auditoría `regyfit.record.field.read` se queda: hay eventos guardados con ella.

Pendiente de la aprobación del operador. Nada de esto está hecho todavía:

1. Publicar la web nueva (push a `origin/main`).
2. Redesplegar `manageMemberSubscription`, por nombre. Es la única función de (S) que cambia de comportamiento.
3. Borrar de producción los seis callables, por nombre exacto y en todas las regiones, después de publicar la web. Están en europe-west9, y puede quedar alguna copia antigua en us-central1. La web reintenta en us-central1 cuando europe-west9 responde `not-found` (`apps/web/src/lib/callable.ts`). `firebase functions:delete` con los seis nombres y sin `--region` los busca en todas las regiones y pide confirmación antes de borrar. No borra datos.

Hasta el paso 3, los seis siguen desplegados y leen un archivo vacío. Cuando se hagan los pasos, se anotan aquí el SHA del commit publicado, la hora del borrado y la salida de `functions:list`.

Listas fijas de despliegue. En cuanto este cambio esté en `main`, las listas fijas de nombres de despliegue se regeneran desde `apps/functions/src/index.ts`. Las de `/root/bpt-runbook/`, por ejemplo `deploy-2026-10-21/lote-completo.txt` y `p06-cuenta-servicio/todas-353.txt`, todavía nombran los seis. Un `--only functions:<nombre>` que ya no está en el código aborta el lote entero con «No function matches the filter».
