# T033 Lifecycle de membresías

## Fuentes vinculantes

- `BRIEF.md` define el catálogo, las sedes Town/West, el piloto aislado y la
  separación de pagos manuales frente a proveedores post-piloto.
- `F:\Proyectos\BPT Jersey\Varios\BPTJ FUNCTIONS APP.docx` exige que el registro
  asigne el tipo de membresía al estudiante y define PAYG, familias y tutores.
- `F:\Proyectos\BPT Jersey\Varios\BPT-memberships.docx` define los diez planes,
  accesos, límites semanales y tarifas Open Mat.
- T032 es la única fuente de precios y reglas de acceso. T033 no duplica ni
  modifica el catálogo.

## Objetivo

Crear membresías vinculadas a estudiante/familia/plan y controlar su lifecycle
con una máquina de estados explícita, transacciones Firestore, autorización por
tenant y auditoría append-only. T033 no cobra, no crea deuda y no integra
proveedores de pago.

## Alcance aprobado

- Crear una membresía inicial en `trial` o `active`.
- Ejecutar transiciones válidas entre `trial`, `active`, `paused`, `overdue` y
  `cancelled`.
- Permitir que guardianes y estudiantes adultos creen únicamente una membresía
  `trial` dentro de su alcance.
- Permitir que `owner`/`administrator` creen y transicionen membresías del tenant.
- Conservar historial de membresías canceladas y cambios de estado.
- Reutilizar el plan T032 para validar existencia, actividad y elegibilidad.
- Emitir eventos append-only mediante el writer de auditoría existente.

## Fuera de alcance

- Precio duplicado o snapshot de precio dentro de `memberships`.
- Cargos, pagos, facturas, recibos, balances, refunds o proveedores.
- Deuda PAYG y bloqueo de reservas; pertenece a T037/T038.
- Hosted checkout, suscripciones o webhooks; pertenece a T034-T036.
- UI de compra o dashboard financiero; se resolverá en tareas posteriores.
- Hard delete, migración de membresías existentes o despliegue productivo.

## Modelo de datos

Ruta canónica:

```text
academies/{academyId}/memberships/{membershipId}
```

Campos exactos:

| Campo                    | Tipo y restricciones                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `membershipId`           | ID seguro generado por backend; igual al documento.                 |
| `academyId`              | Tenant derivado por backend.                                        |
| `familyId`               | Familia existente del mismo tenant.                                 |
| `studentId`              | Estudiante existente del mismo tenant y familia.                    |
| `planId`                 | ID cerrado de T032; el plan debe estar activo al crear o reactivar. |
| `status`                 | `trial`, `active`, `paused`, `overdue` o `cancelled`.               |
| `startsAt`               | Fecha ISO server-owned.                                             |
| `endsAt`                 | Fecha ISO o `null`; se fija al cancelar cuando corresponda.         |
| `nextBillingAt`          | Fecha ISO o `null`; T033 no ejecuta cobros.                         |
| `schemaVersion`          | Literal `1`.                                                        |
| `createdAt`, `createdBy` | Envelope server-owned.                                              |
| `updatedAt`, `updatedBy` | Envelope server-owned.                                              |

Todas las referencias deben compartir `academyId`. No se copia precio,
moneda, sedes, límites ni reglas de acceso desde `plans`.

## Máquina de estados

La única tabla de transición válida es:

| Estado actual | Estados permitidos               |
| ------------- | -------------------------------- |
| `trial`       | `active`, `cancelled`            |
| `active`      | `paused`, `overdue`, `cancelled` |
| `paused`      | `active`, `cancelled`            |
| `overdue`     | `active`, `cancelled`            |
| `cancelled`   | Ninguno; estado terminal         |

Crear permite únicamente `trial` o `active`. Una transición inválida devuelve
`failed-precondition` y no escribe. Repetir el mismo estado es idempotente y no
crea historial duplicado; una transición a un estado distinto actualiza solo
estado, fechas aplicables y envelope.

Invariantes:

- Un estudiante no puede tener más de una membresía vigente entre `trial`,
  `active`, `paused` y `overdue`.
- Las membresías `cancelled` permanecen consultables para historial.
- `cancelled` no puede reactivarse; la reactivación requiere crear una nueva
  membresía después de verificar el plan.
- `nextBillingAt` es informativo y no autoriza ningún cobro.
- `overdue` puede ser marcado por un comando administrativo en T033; la deuda
  y su resolución financiera pertenecen a T037/T038.

## Autorización

Firestore mantiene `deny-by-default`; todas las operaciones pasan por Functions.

| Actor                                     | Lectura                  | Creación                             | Transiciones                   |
| ----------------------------------------- | ------------------------ | ------------------------------------ | ------------------------------ |
| `owner`                                   | Todo su tenant           | Cualquier estudiante válido          | Todas las transiciones válidas |
| `administrator`                           | Todo su tenant           | Cualquier estudiante válido          | Todas las transiciones válidas |
| `guardian`                                | Membresías de su familia | Solo `trial` de un menor relacionado | Ninguna                        |
| `adultStudent`                            | Sus propias membresías   | Solo `trial` propia                  | Ninguna                        |
| `headCoach`, `coach`                      | Denegado                 | Denegado                             | Denegado                       |
| Anónimo, tenant ajeno o relación inválida | Denegado                 | Denegado                             | Denegado                       |

El actor, tenant, timestamps, estado final, referencias y envelope nunca se
aceptan como autoridad desde el cliente. Los mensajes públicos no revelan
existencia de membresías de otra familia o tenant.

## API backend

Los handlers son testeables sin wiring Firebase.

- `listMemberships`: devuelve proyecciones autorizadas y tenant-scoped.
- `getMembership`: obtiene una membresía por ID solo dentro del alcance del actor.
- `createMembership`: recibe `familyId`, `studentId`, `planId` y estado inicial
  permitido; genera `membershipId`, fechas operativas y envelope. El cliente no
  envía `startsAt`, `endsAt` ni `nextBillingAt`.
- `transitionMembership`: recibe `membershipId` y `targetStatus`; aplica la
  tabla de transición y autorización.
- `cancelMembership`: comando semántico que delega en `transitionMembership`
  con `targetStatus: "cancelled"`.

Todos los payloads usan objetos planos, allowlists exactas, IDs seguros, fechas
válidas y límites. Los errores se mapean a `unauthenticated`,
`permission-denied`, `invalid-argument` o `failed-precondition` sin exponer
Firestore, stack traces ni secretos.

## Auditoría

Cada creación y transición efectiva usa el writer append-only de T019 en la
misma unidad transaccional cuando el adapter lo permita. Se añadirán únicamente
acciones tipadas para:

- `membership.created`
- `membership.status.changed`

El evento contiene actor, tenant, acción, `targetRef`, propósito, correlación,
resultado y versión; nunca copia precio, payload completo, emails, teléfonos,
claims, tokens ni datos médicos. No se agrega lector ni UI de auditoría.

## Pruebas

- Dominio: tabla completa de transiciones, estados terminales, idempotencia,
  fechas, enums, IDs, campos extra y objetos hostiles.
- Store: creación `trial`/`active`, plan inactivo, familia/estudiante cruzados,
  membresía vigente duplicada, transición atómica, cancelación terminal,
  preservación de envelope y tenant isolation.
- Callables: seis roles, alcance guardian/adulto, coach denegado, payloads
  hostiles, errores públicos y no exposición cross-tenant.
- Emulator: dos academias, familia con menor, adulto, creación guardian,
  transición administrativa, auditoría y ausencia de documentos financieros.
- Rules: get/list/create/update/delete directo de `memberships` denegado para
  todos los roles.
- Regresión: T033 no altera `plans`, no crea `payments`, `invoices`, recibos ni
  debt documents.
- Gates: suite completa, Rules, lint, typecheck, build, formato, diff, audit y
  autocrítica de seguridad.

## Rollback y operación

- No hay migración: en Emulator/staging se limpian documentos sintéticos o se
  deja el estado cancelado; producción no se toca.
- No hay hard delete ni reactivación de una membresía cancelada.
- No se crean usuarios Auth, claims, secretos ni integraciones de pago.
- T011 sigue siendo el gate legal para retención, residencia y borrado de datos
  sensibles; T033 conserva historial, pero no define la política legal.
