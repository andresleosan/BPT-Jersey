# T013 Firestore and RTDB Data Model Design

## Objetivo

Definir el modelo conceptual de datos de BPT Jersey Academy Platform: límites de agregados, colecciones Firestore, uso acotado de RTDB, consultas e índices, invariantes, versionado de esquema y procedimiento de migración/rollback.

Este documento es un diseño provisional. Los valores `(f)` de `docs/operations/academy-configuration-provisional.md` sirven únicamente para ejemplos y fixtures; no se convierten en constraints de producción.

## Decisiones de arquitectura

### Firestore canónico

Firestore Standard es la fuente de verdad para identidad, familias, estudiantes, personal, agenda, reservas, asistencia, check-out, membresías, pagos, progreso, CRM, comunicaciones, archivos, consentimientos, safeguarding, auditoría, reportes y exports.

Todos los datos de una academia viven bajo:

```text
academies/{academyId}/...
```

Cada documento operativo también conserva `academyId` para una segunda comprobación de tenant y para detectar referencias cruzadas inválidas. La ruta nunca sustituye las verificaciones de autorización de `T016`.

### RTDB efímero

RTDB solo contiene presencia y estado operativo temporal:

```text
academies/{academyId}/presence/{sessionId}/{studentId}
```

Los nodos pueden contener estado mínimo, `lastSeenAt` y una versión de sesión. No contienen pagos, membresías, asistencia canónica, progreso, consentimientos, auditoría ni datos médicos. Un proceso de limpieza elimina presencia caducada; si RTDB pierde datos, Firestore no se reconstruye desde RTDB.

### Monolito modular

El modelo mantiene límites de dominio dentro del monorepo. No se crean bases separadas ni microservicios: no existen equipos, ritmos de despliegue o necesidades de escala independientes que justifiquen esa complejidad.

La decisión de límites de agregados y RTDB efímero se registrará en `docs/adr/ADR-004-firestore-aggregate-boundaries.md` al implementar T013.

## Colecciones conceptuales

Todas las colecciones siguientes son subcolecciones directas de `academies/{academyId}`, incluidas las restringidas; la separación sensible es de responsabilidad y autorización, no una fuente alternativa de datos. Los nombres son contratos internos en inglés.

| Grupo | Colecciones | Responsabilidad y límites |
|---|---|---|
| Academy | Documento raíz `academies/{academyId}`, `locations`, `programs`, `classes`, `sessions`, `plans` | Configuración de academia, ubicaciones, programas, plantillas de clase, sesiones y catálogo de membresías. Los valores operativos pendientes permanecen configurables. |
| Identity | `users`, `families`, `students`, `staff`, `relationships` | Identidad adulta, perfiles, relaciones tutor-menor, estado activo y asignaciones. Las relaciones son documentos explícitos, no arrays ilimitados embebidos. |
| Scheduling | `bookings` | Reserva/roster por estudiante y sesión; no duplica la sesión ni la membresía. |
| Attendance | `attendance`, `checkouts` | Registro canónico de presencia, puntualidad, no-show, correcciones y salida de menores. |
| Commercial | `memberships`, `invoices`, `payments`, `paymentEvents` | Estado comercial, facturas, pagos administrativos y evidencia mínima/idempotente de eventos de proveedor. Nunca guarda tarjeta cruda. |
| Development | `assessments`, `skillProgress`, `recognitions` | Evaluaciones, checklist, progreso y candidatos/aprobaciones de reconocimiento. No otorga belts/stripes automáticamente. |
| CRM and communication | `leads`, `messages`, `deliveryEvents` | Prospectos, tareas, mensajes, audiencias e historial de entrega. La comunicación de menores conserva visibilidad del tutor. |
| Restricted governance | `healthProfiles`, `safeguardingCases`, `consents`, `documents`, `auditEvents`, `exports` | Datos `Restricted` separados de los perfiles generales para limitar Rules, consultas, exports, retención y revisión. |

### Envolvente común

Los documentos mutables, excepto los eventos append-only, usarán cuando corresponda:

```text
academyId
schemaVersion
createdAt
createdBy
updatedAt
updatedBy
status
```

Los valores de actor y tiempo los genera el backend. Un cliente no puede escoger `academyId`, `createdBy`, `updatedBy`, `status` sensible ni timestamps de auditoría.

### Documentos restringidos

- `healthProfiles` referencia `studentId` y contiene únicamente el mínimo operacional necesario.
- `safeguardingCases` separa intake, participantes, acciones y resolución bajo autorización específica.
- `consents` conserva versión, firmante, momento, revocación y referencia a evidencia sin permitir sobrescritura destructiva.
- `documents` conserva metadatos y permisos; el blob vive en R2 privado.
- `auditEvents` y `paymentEvents` son append-only y no contienen payloads completos, secretos ni datos innecesarios.
- `exports` conserva propósito, solicitante, alcance, clasificación, destinatario, expiración y estado; el contenido descargable no se vuelve una colección canónica.

## Relaciones y fuentes de verdad

- `families` no embebe todos los estudiantes; `relationships` representa tutoría, vigencia y alcance.
- `sessions` referencia `programId`, `classId`, `locationId` y datos temporales; no copia reglas de membresía como autoridad.
- `bookings` referencia `sessionId` y `studentId`; la elegibilidad se recalcula contra membresía/programa.
- `attendance` referencia `sessionId` y `studentId`; una corrección crea historial/auditoría, no borra el registro original.
- `checkouts` referencia `sessionId` y `studentId`; el estado de salida es canónico en Firestore.
- `memberships` referencia titular/familia/estudiante y plan; los eventos financieros no redefinen el historial sin reconciliación.
- `payments` contiene estado administrativo y referencia externa mínima; `paymentEvents` conserva idempotencia y evidencia verificada.
- `students` no contiene expedientes médicos completos ni casos de safeguarding; esos datos viven en colecciones restringidas.
- RTDB nunca se usa para reconstruir una verdad perdida de Firestore.

## Índices orientados a consultas

Firestore conserva los índices de campo único por defecto. Solo se agregarán índices compuestos asociados a consultas reales:

| Colección | Consulta | Índice conceptual |
|---|---|---|
| `sessions` | Agenda por estado ordenada por inicio | `status ASC, startAt ASC` |
| `sessions` | Agenda por ubicación ordenada por inicio | `locationId ASC, startAt ASC` |
| `sessions` | Agenda por programa ordenada por inicio | `programId ASC, startAt ASC` |
| `bookings` | Roster de sesión filtrado por estado | `sessionId ASC, status ASC, createdAt ASC` |
| `bookings` | Historial de reservas de estudiante | `studentId ASC, createdAt DESC` |
| `attendance` | Asistencia de estudiante por fecha | `studentId ASC, occurredAt DESC` |
| `attendance` | Asistencia de sesión por estado | `sessionId ASC, state ASC` |
| `memberships` | Membresías de estudiante por estado | `studentId ASC, status ASC` |
| `memberships` | Renovaciones/próximos cobros | `status ASC, nextBillingAt ASC` |
| `invoices` | Facturas de familia por vencimiento | `familyId ASC, status ASC, dueAt ASC` |
| `payments` | Historial financiero de familia | `familyId ASC, occurredAt DESC` |
| `leads` | Leads por estado y próxima acción | `status ASC, nextActionAt ASC` |
| `leads` | Trabajo de owner por próxima acción | `ownerId ASC, nextActionAt ASC` |
| `messages` | Historial de audiencia por fecha | `audienceId ASC, sentAt DESC` |
| `auditEvents` | Historial de entidad por momento | `targetRef ASC, occurredAt DESC` |
| `auditEvents` | Acciones de actor por momento | `actorId ASC, occurredAt DESC` |

Los índices finales se validan contra los contratos de consulta y se escriben en `firestore.indexes.json` solo cuando el modelo se implemente. No se agregan índices para cada campo por anticipación.

## Invariantes de datos

### Tenant y referencias

- La ruta y el campo `academyId` de cada documento deben coincidir.
- Toda referencia entre documentos debe pertenecer a la misma academia.
- El backend vuelve a comprobar relación familiar, asignación, estado activo y clasificación antes de devolver o mutar datos.
- Los IDs siguen los contratos nominales de `T012`; el cliente no convierte un string arbitrario en autoridad.

### Consistencia y concurrencia

- Creación de booking, roster y capacidad se resuelve con transacción/idempotencia; la capacidad `(f)` no se trata como límite aprobado.
- Un booking tiene identidad determinista por `sessionId + studentId`; repetir la operación no crea otro booking.
- Un registro de asistencia tiene identidad determinista por `sessionId + studentId`; las correcciones conservan historial.
- Un checkout activo por estudiante/sesión se resuelve de forma transaccional y exige un estado de salida válido.
- Los estados de membresía, booking y checkout solo avanzan por transiciones explícitas del módulo; las reglas definitivas quedan condicionadas a `T008`.

### Integridad histórica

- `auditEvents` y `paymentEvents` son append-only para usuarios interactivos.
- Facturas, pagos, membresías, asistencia, consentimientos y evaluaciones no se eliminan físicamente por una acción normal.
- Cambios sensibles incluyen actor, momento, propósito, entidad, resultado y correlación.
- Los timestamps de servidor no se aceptan desde el cliente.

### Seguridad y minimización

- No se almacenan números de tarjeta, CVV/CVC, contraseñas, MFA secrets, claves R2 ni secretos de proveedores.
- Los campos `Restricted` no se mezclan con listados generales ni exports sin una consulta autorizada.
- `documents` guarda metadatos; los objetos privados usan R2 y URLs firmadas emitidas por backend.
- Los valores `(f)` y los datos de prueba no se mezclan con entornos productivos.

## Versionado y migraciones

### Estado actual

No existen datos de negocio productivos ni migraciones aplicadas en este repositorio. `firestore.indexes.json` está vacío y ambas Rules están en default-deny. T013 define el plan; no ejecuta una migración.

### Procedimiento obligatorio

1. Escribir la versión del modelo y el alcance exacto de la migración.
2. Definir el procedimiento `up` y la reversión `down` o compensatoria antes de aplicar.
3. Ejecutar dry-run contra emuladores con fixtures sintéticos y validar conteos/invariantes.
4. Ejecutar en staging con backup y restauración verificados.
5. Antes de producción, crear un backup reciente, verificar que se puede restaurar y obtener confirmación explícita del operador.
6. Aplicar cambios aditivos, idempotentes y observables con checkpoints.
7. Validar invariantes y queries después de cada checkpoint.
8. Si falla, detener la migración, preservar evidencia y ejecutar rollback documentado.

### Rollback

- Cambios aditivos sin consumidores pueden revertirse con una operación compensatoria idempotente.
- Cambios que afectan datos existentes se revierten restaurando el backup verificado o ejecutando un `down` probado en staging.
- `DROP`, `TRUNCATE` y cambios de tipo con pérdida de datos están prohibidos sin backup verificado y confirmación explícita del operador.
- No se considera rollback borrar manualmente documentos desde una consola sin auditoría.
- La restauración valida proyecto/entorno, versión, conteos y permisos antes de exponer datos.

## Dependencias abiertas

- `T008` debe aprobar programas, ubicaciones, horarios, capacidades, precios y membresías; sus `(f)` se mantienen fuera de constraints.
- `T009` puede cambiar campos y ownership de evaluaciones/reconocimiento.
- `T010` define los límites concretos de payment events, checkout, refunds y reconciliación, manteniendo el modelo provider-independent.
- `T011` define retención, residencia, borrado y restauración de datos `Restricted`.
- `T016` implementará las Rules a partir de este modelo y de la matriz de `T007`.

## Entregables de implementación posterior

- `docs/adr/ADR-004-firestore-aggregate-boundaries.md`.
- `docs/data/firestore-data-model.md` con campos, ownership y clasificación.
- `docs/data/migrations/README.md` con procedimiento, backup y rollback.
- `firestore.indexes.json` solo con índices respaldados por consultas.
- Fixtures sintéticos y pruebas de invariantes contra emuladores.

## Criterio de aceptación

- Los límites Firestore/RTDB y fuentes de verdad están explícitos.
- Las colecciones cubren los dominios del MVP sin duplicar fuentes canónicas.
- Cada índice conceptual tiene una consulta propietaria.
- Las invariantes cubren tenant, relaciones, duplicados, estados, timestamps e historial.
- El plan de migración y rollback existe antes de cualquier aplicación.
- Los valores `(f)` no aparecen como restricciones productivas.
- T010/T011/T008 permanecen visibles como dependencias abiertas.
