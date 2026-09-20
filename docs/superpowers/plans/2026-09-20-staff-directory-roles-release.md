# Staff: directorio y roles unificados — entrega local

Fecha: 2026-09-20. Rama: `feat/staff-directory-roles`.

## Resultado

- Owner hereda todas las capacidades administrativas y deportivas; solo owner concede acceso administrativo.
- Administrator reúne administrator y headCoach. Coach conserva su acceso deportivo limitado.
- Staff muestra nombre, correo y rol; owner puede revisar y confirmar cambios a administrator/owner.
- Owner autoriza un correo durante siete días. Se activa al iniciar sesión en `/staff/login` con Google y correo verificado; no se envía un correo automáticamente.
- Las cuentas headCoach existentes conservan sus permisos hasta que owner las pase explícitamente a administrator. Los perfiles docentes y asignaciones se conservan.

## Evidencia local

4.312 pruebas en 402 archivos; 18 pruebas de navegador en móvil y escritorio. Incluyen aislamiento de academia, owner frente a administrator, rechazo de credenciales obsoletas, Google verificado, invitaciones de un solo uso, revisión antes de conceder acceso, teclado y estados de carga/error. TypeScript, lint y formato pasan. El test de empaquetado importa la distribución copiada de Functions con el nuevo contrato incluido.

Capturas sintéticas y registros en `.tmp/team-*`. Sin mediciones nuevas de rendimiento de producción.

## Publicación pendiente

No se ha publicado esta funcionalidad ni modificado cuentas de producción. La identidad Git local está configurada con los datos proporcionados por el operador.

Tras guardar los commits y obtener aprobación específica para producción, el lote acotado de Functions contiene:

- `listTeamDirectory`, `changeTeamRole`, `createStaffInvitation`, `listStaffInvitations`, `cancelStaffInvitation`, `acceptStaffInvitation`.
- `createStaffProfile`, `updateStaffProfile`: impiden nuevas asignaciones headCoach.
- `recordEvaluation`, `approvePromotion`, `rejectPromotion`, `openStudentLevel`, `assignLevel`, `voidPromotion`, `getStudentLevelHistory`: capacidades deportivas y lectura de la nueva autoridad.
- `approveLessonPlan`: aprobación por owner/administrator.

Son 16 funciones. No se requiere cambiar reglas ni índices. No usar un deploy total. La web se publica con el push autorizado a main después de disponer de las funciones. Andres ejecuta el push; no se solicitan credenciales. Comprobar el estado Success del commit en Cloudflare Pages y probar el acceso con cuentas autorizadas.

Una reversión de código posterior a nuevas decisiones de administrator debe conservar la lectura de esos registros. Las invitaciones en `processing` requieren revisión operativa antes de reautorizar; no se repiten concesiones de resultado incierto. Véase ADR-011.
