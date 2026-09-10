# T023 Datos de salud y soporte restringidos

## Objetivo

Implementar el mínimo operacional estructurado que la academia necesita para
atender a un estudiante sin convertir BPT Jersey en un expediente médico. Los
datos viven en una colección `Restricted`, tienen autorización backend por
tenant y finalidad, y no se exponen mediante acceso directo del navegador a
Firestore.

## Alcance aprobado

- Crear, consultar, actualizar y desactivar un perfil de soporte mínimo por
  estudiante.
- Permitir que un guardian relacionado cree o cancele una solicitud estructurada
  de cambio, sin modificar el perfil canónico.
- Permitir que `owner` o `administrator` revise y apruebe/rechace solicitudes.
- Permitir lectura mínima a `headCoach` o `coach` únicamente cuando exista una
  asignación vigente al estudiante.
- Mantener datos de salud y soporte separados de `students`, `families` y
  relaciones generales.
- Permitir al miembro/guardian describir una condición operacional en un campo
  de máximo 1000 caracteres, conforme a `BPTJ FUNCTIONS APP.docx`.
- Permitir a `owner`/`administrator` asignar una referencia interna de máximo 25
  caracteres para la revisión staff.
- Probar denegaciones por rol, tenant, familia y asignación.

## Fuera de alcance

- Diagnósticos, medicación, alergias, tratamientos o historia clínica.
- Historia clínica o narrativa médica sin límite; el único texto permitido es
  la descripción operacional acotada de 1000 caracteres.
- Contactos de emergencia y child check-out, que pertenecen a otras tareas.
- Archivos, waivers, consentimientos o URLs R2.
- Casos de safeguarding.
- Exportaciones generales, retención legal o migración de datos existentes.
- Acceso directo desde navegador a `healthProfiles` o
  `healthProfileChangeRequests`.

## Modelo de datos

### `healthProfiles`

Ruta canónica:

```text
academies/{academyId}/healthProfiles/{studentId}
```

Existe como máximo un documento lógico por estudiante. El ID del documento es
`studentId`, y `healthProfileId` debe tener el mismo valor.

Campos exactos:

| Campo                       | Tipo y restricciones                                           |
| --------------------------- | -------------------------------------------------------------- |
| `healthProfileId`           | ID seguro; igual a `studentId`.                                |
| `academyId`                 | Tenant derivado por backend.                                   |
| `studentId`                 | ID seguro de un estudiante existente del mismo tenant.         |
| `minimumOperationalSupport` | Lista no vacía, ordenada y sin duplicados de códigos cerrados. |
| `conditionSummary`          | Texto operacional opcional, máximo 1000 caracteres.            |
| `staffReferenceLabel`       | Etiqueta interna opcional, máximo 25 caracteres; solo staff.   |
| `reviewState`               | `current`, `needs-review` o `expired`.                         |
| `expiresAt`                 | Fecha ISO o `null`; no se aceptan fechas inválidas.            |
| `status`                    | `active` o `inactive`.                                         |
| `schemaVersion`             | Literal `1`.                                                   |
| `createdAt`, `createdBy`    | Envelope server-owned.                                         |
| `updatedAt`, `updatedBy`    | Envelope server-owned.                                         |

Los únicos códigos de `minimumOperationalSupport` son:

- `none`
- `mobility`
- `sensory`
- `communication`
- `supervision`

`none` es exclusivo. No se aceptan diagnósticos narrativos, códigos
desconocidos, HTML, controles, campos extra, símbolos propios o propiedades no
enumerables. `conditionSummary` no puede usarse como expediente completo,
historial clínico, contacto de emergencia ni nota de safeguarding.

### `healthProfileChangeRequests`

Ruta:

```text
academies/{academyId}/healthProfileChangeRequests/{requestId}
```

Campos exactos:

| Campo                               | Tipo y restricciones                                      |
| ----------------------------------- | --------------------------------------------------------- |
| `requestId`                         | ID seguro generado por backend.                           |
| `academyId`                         | Tenant derivado por backend.                              |
| `healthProfileId`                   | Referencia al perfil del mismo tenant.                    |
| `studentId`                         | Referencia al estudiante del mismo tenant.                |
| `requestedBy`                       | UID del guardian autenticado que propone el cambio.       |
| `proposedMinimumOperationalSupport` | Misma lista cerrada y reglas del perfil.                  |
| `proposedConditionSummary`          | Descripción operacional opcional, máximo 1000 caracteres. |
| `proposedExpiresAt`                 | Fecha ISO o `null`.                                       |
| `status`                            | `pending`, `approved`, `rejected` o `cancelled`.          |
| `createdAt`, `createdBy`            | Envelope server-owned.                                    |
| `updatedAt`, `updatedBy`            | Envelope server-owned.                                    |
| `reviewedAt`, `reviewedBy`          | Presentes únicamente después de una decisión staff.       |

La solicitud no contiene historia clínica, motivo separado, etiqueta staff,
archivos, claims, tokens, emails, teléfonos ni snapshots del perfil completo.
Solo puede existir una solicitud `pending` por perfil.

## Autorización y proyecciones

Todas las funciones derivan `academyId` y actor desde Auth/perfil backend. El
cliente no puede seleccionar tenant, actor, timestamps ni estado de revisión.

| Actor                                      | `healthProfiles`                                     | `healthProfileChangeRequests`         | Proyección                                                           |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `owner`                                    | Lee, crea, actualiza y desactiva                     | Lee, aprueba, rechaza                 | Completa, sin secretos ni narrativa porque no existen en el contrato |
| `administrator`                            | Lee, crea, actualiza y desactiva                     | Lee, aprueba, rechaza                 | Completa dentro del tenant                                           |
| `headCoach`                                | Lee solo con asignación vigente                      | Sin crear ni decidir                  | Soporte mínimo, `conditionSummary`, estado y expiración              |
| `coach`                                    | Lee solo con asignación vigente                      | Sin crear ni decidir                  | Soporte mínimo, `conditionSummary`, estado y expiración              |
| `guardian`                                 | Lee solo menores con relación vigente; nunca escribe | Crea o cancela su solicitud pendiente | Soporte mínimo, estado y expiración; sin actores ni IDs de solicitud |
| Otros roles, tenant ajeno o sesión ausente | Denegado                                             | Denegado                              | Ninguna                                                              |

La aprobación staff actualiza el perfil y la solicitud en una sola transacción.
El rechazo solo actualiza la solicitud. La cancelación solo la puede ejecutar el
guardian que la creó mientras esté `pending`. No hay hard delete.

La comprobación de asignación para `headCoach`/`coach` es una dependencia
explícita del servicio. Si el proveedor de asignaciones todavía no está
disponible o no devuelve una asignación vigente, la lectura se deniega; no
existe un fallback por rol amplio.

## API backend

Los handlers se separan del wiring Firebase para permitir pruebas unitarias.
Los nombres previstos son:

- `getHealthProfile`: recibe `{ studentId }` para cualquier actor autenticado y
  devuelve una proyección según el actor; guardian solo puede usar el ID de un
  menor de su relación vigente.
- `saveHealthProfile`: solo `owner`/`administrator`; recibe el estudiante y
  los campos estructurados del perfil y la etiqueta interna opcional, sin
  envelope ni actor.
- `deactivateHealthProfile`: solo `owner`/`administrator`; marca el perfil
  `inactive` y no elimina el documento.
- `createHealthProfileChangeRequest`: solo guardian relacionado; recibe los
  valores estructurados propuestos y `proposedConditionSummary` opcional.
- `cancelHealthProfileChangeRequest`: solo el guardian creador y mientras esté
  `pending`.
- `reviewHealthProfileChangeRequest`: solo `owner`/`administrator`; acepta o
  rechaza y, si acepta, actualiza perfil y solicitud atómicamente.

Todos los payloads usan allowlists exactas, límites de tamaño, IDs seguros y
validación server-side. Los errores públicos son genéricos y no revelan si un
estudiante o perfil restringido existe en otro tenant o familia.

## UI aprobada

- La vista administrativa de familia puede mostrar y editar el soporte mínimo
  de sus menores para `owner`/`administrator`, incluyendo solicitudes pendientes.
- La vista guardian muestra únicamente la proyección redacted de sus menores y
  permite enviar o cancelar una solicitud estructurada con una descripción de
  condición de máximo 1000 caracteres.
- La vista staff muestra la referencia interna de máximo 25 caracteres y nunca
  la trata como diagnóstico o decisión médica.
- No se agrega una pantalla general de salud.
- No se agrega UI de salud para coaches; su permiso se prueba en backend y
  Emulator.
- La interfaz y mensajes visibles permanecen en inglés, conforme a `BRIEF.md`.

## Pruebas

- Dominio: enums cerrados, allowlists exactas, fechas, `none` exclusivo,
  duplicados, campos extra, símbolos, prototipos, HTML y límites de 1000/25
  caracteres.
- Store: tenant, estudiante inexistente, familia ajena, relación guardian,
  asignación coach, una solicitud pending, cancelación, expiración,
  desactivación y aprobación atómica.
- Callables: Auth, roles, payloads hostiles, mensajes seguros y aislamiento
  entre perfiles.
- Firebase Emulator: owner/admin gestionan; guardian solicita; guardian ajeno,
  coach no asignado y tenant cruzado son rechazados.
- Rules: lectura/escritura directa denegada para todas las colecciones y roles.
- UI: guardian no ve actores, IDs internos, solicitudes ajenas ni campos fuera
  de la proyección redacted; staff ve únicamente controles autorizados.
- Gates: suite unitaria completa, Rules, lint, typecheck, build, formato,
  `git diff --check`, audit high/critical y autocrítica de seguridad.

## Seguridad, rollback y operación

- No se crean cuentas Auth ni claims nuevos.
- No se almacenan secretos, PII innecesaria, historia clínica, narrativa de
  safeguarding ni datos de producción en tests, fixtures, logs, capturas o
  artefactos. El único texto de condición permitido se valida y limita a 1000
  caracteres en el contrato.
- Las Rules permanecen `deny-by-default`; Functions/Admin SDK aplica la
  autorización de aplicación antes de cualquier lectura o escritura.
- No hay migración: el rollback consiste en retirar los callables/UI/contratos
  antes de un despliegue futuro y dejar las colecciones sin acceso cliente.
- Si algún documento de prueba ya existe en Emulator, se limpia reiniciando el
  Emulator; no se borra información de producción.
- La política de retención legal y residencia sigue bloqueada por `T011`.
