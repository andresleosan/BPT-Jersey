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

## Functions desplegadas; web pendiente

El 2026-09-20 el operador autorizó explícitamente el lote de 16 funciones. Se desplegó el código de `bd50832` en `bptjersey-f5a25`, región `us-central1`: 6 creaciones y 10 actualizaciones correctas, con salida 0 de Firebase CLI. No se han cambiado cuentas de producción. La publicación de la web continúa pendiente.

El lote desplegado contiene:

- `listTeamDirectory`, `changeTeamRole`, `createStaffInvitation`, `listStaffInvitations`, `cancelStaffInvitation`, `acceptStaffInvitation`.
- `createStaffProfile`, `updateStaffProfile`: impiden nuevas asignaciones headCoach.
- `recordEvaluation`, `approvePromotion`, `rejectPromotion`, `openStudentLevel`, `assignLevel`, `voidPromotion`, `getStudentLevelHistory`: capacidades deportivas y lectura de la nueva autoridad.
- `approveLessonPlan`: aprobación por owner/administrator.

Son 16 funciones. No se requiere cambiar reglas ni índices. No usar un deploy total. La web se publica con el push autorizado a main después de disponer de las funciones. Andres ejecuta el push; no se solicitan credenciales. Comprobar el estado Success del commit en Cloudflare Pages y probar el acceso con cuentas autorizadas.

Una reversión de código posterior a nuevas decisiones de administrator debe conservar la lectura de esos registros. Las invitaciones en `processing` requieren revisión operativa antes de reautorizar; no se repiten concesiones de resultado incierto. Véase ADR-011.

Verificación posterior: un POST sin sesión por cada endpoint, sin reintentos y con pausa de 0,5 s, devolvió HTTP 401 en los 16 casos. Registro `.tmp/staff-roles-release/probe-results.json` y log de despliegue `.tmp/staff-roles-deploy.log`. Esta comprobación confirma disponibilidad y rechazo sin autenticación; no sustituye la prueba con sesiones reales tras publicar la web.
