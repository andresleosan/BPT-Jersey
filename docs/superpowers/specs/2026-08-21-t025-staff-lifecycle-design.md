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
