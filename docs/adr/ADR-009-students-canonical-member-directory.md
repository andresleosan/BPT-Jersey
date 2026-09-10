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
10. Un menor solo se crea mediante el flujo de familia/tutor; el alta administrativa individual no
    inventa tutor, cuenta Auth, familia, relationship ni membership.
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
