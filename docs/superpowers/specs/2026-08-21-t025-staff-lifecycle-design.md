# T025 Staff Lifecycle And Assignments

## Objetivo

Definir el contrato canónico para cuentas de coaches/staff, roles no
administrativos, disponibilidad y asignaciones operativas sin conceder
autoridad desde el navegador.

## Diseño

- `staff` será la fuente canónica de estado activo, rol operativo,
  disponibilidad y asignaciones; referencia a un `users` del mismo tenant.
- `owner` será el único actor que pueda conceder o revocar acceso administrativo;
  `headCoach` y `coach` se emitirán solo desde un registro staff válido y una
  asignación canónica.
- Las asignaciones serán tenant-scoped y podrán apuntar a sedes, programas y
  clases existentes. No se inventarán sedes, horarios, capacidades ni
  instructores.
- La disponibilidad usará ventanas locales con timezone explícito de la
  configuración de academia; no se asumirá `Europe/Jersey` ni otra zona mientras
  `T008` siga abierta.
- La desactivación revocará acceso operativo y conservará autoría, auditoría e
  historial. No habrá borrado destructivo.

## Límites

- No incluye salud, safeguarding, menores, pagos, retención final ni residencia;
  esos límites pertenecen a sus tareas propietarias y `T011`.
- No habilita acceso directo del cliente a Firestore/RTDB.
- No incluye producción, migraciones ni provisioning real durante la fase de
  diseño.

## Gate De Ejecución

La implementación solo comienza cuando el ledger permita el WIP de `T025`.
Antes de moverla a `en-progreso` deben existir RED tests para contratos,
autorización, conflictos de asignación, desactivación y sincronización de claims.

## Task 4 - Diseño Aprobado

Task 4 se ejecutará en tres bloques secuenciales, cada uno con su propio gate:

1. Rules y Emulator.
2. Proyección segura y cliente web.
3. UI administrativa y E2E desktop/mobile.

### Rules Y Emulator

Firestore seguirá siendo `deny-by-default` para `staff`, disponibilidad,
asignaciones y locks bajo `academies/{academyId}`. El navegador no tendrá
lecturas ni escrituras directas; toda operación pasará por Functions. La
integración Emulator cubrirá creación, actualización, reemplazo de
asignaciones, desactivación, aislamiento cross-tenant y errores genéricos.

### Proyección Y Contratos

Se añadirá un callable admin-only `listStaffProfiles` que derive la academia
del actor autenticado y acepte únicamente un payload vacío exacto. La respuesta
será una proyección validada y mínima por fila:

- `staffKey`: identificador operativo opaco basado en el ID hash existente; no
  se expondrán Auth UID, claims, rutas Firestore ni IDs de auditoría.
- `role`: `headCoach` o `coach`.
- `active`: booleano.
- `status`: `active` o `inactive`.
- `schemaVersion`: `1`.

Las mutaciones existentes continuarán recibiendo el identificador operativo
validado por el backend, derivando tenant y actor del contexto Auth. No se
añadirán campos de claims, auditoría, familia, salud, finanzas o datos de
otras academias a la respuesta web.

La capa `staff-client.ts` validará allowlists y tipos de respuesta antes de
entregar datos a React. Cualquier error de Functions se transformará en un
mensaje genérico sin reenviar detalles de infraestructura.

### UI Administrativa

Se añadirá `/admin/staff` a la navegación existente. La pantalla ofrecerá:

- listado de staff con rol y estado;
- alta de perfil con `userId`, rol y `requestId` introducidos por un
  administrador autorizado;
- cambio de rol y activación/desactivación desde la fila seleccionada;
- formularios de disponibilidad y asignaciones que acepten solo referencias
  explícitas introducidas por el administrador, sin inventar sedes, programas,
  clases ni horarios.

La UI reutilizará el shell, tabla, estados y estilos administrativos actuales.
Será accesible por teclado, tendrá errores `role=alert` genéricos, estados
`role=status`, foco estable tras acciones y no generará overflow horizontal en
desktop ni Pixel 7.

### Pruebas Y Gates

- Rules: acceso anónimo, client, coach, owner y administrator; lectura y
  escritura directa siempre rechazadas, incluyendo academias cruzadas.
- Emulator: lifecycle completo y aislamiento usando los callables protegidos.
- Web unit: validación de proyección, errores seguros, carga, acciones y foco.
- Playwright: permisos owner/administrator, navegación, teclado, errores,
  desktop/mobile y ausencia de overflow.
- Final: `corepack pnpm test`, `corepack pnpm test:rules`, lint, typecheck,
  build, formato y auditoría. No se ejecutan migraciones, despliegues ni
  operaciones productivas.

Task 4 no podrá mover T025 a `aprobada`; solo dejará evidencia para revisión
humana después de todos los gates.
