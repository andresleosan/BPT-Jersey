# ADR-017 — Cambiar roles de Staff sin correo

Fecha: 2026-09-20. Estado: aceptada por petición explícita del operador; publicación pendiente.

El directorio deshabilitaba Change role cuando Firebase Auth no tenía correo. El contrato y el
aprovisionamiento exigían correo/Google; además, el acceso por Staff ID solo aceptaba coach y el
panel administrativo rechazaba usuarios sin correo. Habilitar únicamente el botón dejaba el flujo
incompleto.

El owner identifica al integrante existente por UID y academia. La transición interna `team`
admite correo nulo y no exige Google. La petición no puede seleccionar esa transición: únicamente
la callable del directorio la establece después de verificar owner vigente y App Check. Se conservan
las comprobaciones de academia, integrante del equipo, cuenta activa, exclusión de cambio propio,
el bloqueo por usuario, compensación y auditoría. Las invitaciones y el aprovisionamiento general
mantienen la comprobación de Google. El correo almacenado procede de Auth y el proveedor registrado
refleja el proveedor real, o custom para Staff ID.

El perfil deportivo no cambia. Staff ID permite coach, administrator y owner; los dos últimos
requieren coincidencia con adminRole canónico. Credencial, usuario y perfil deportivo deben seguir
activos y pertenecer a la misma academia. El panel usa UID y claims administrativos válidos, con
correo opcional para presentación. No se crean cuentas ni correos ficticios.

Despliegue requerido, previa autorización: `changeTeamRole`, `signInStaffWithId` y
`changeStaffIdPassword`, seguido del frontend. No requiere migraciones, índices ni reglas.
Las pruebas reproducen nueve fallos anteriores y verifican ascensos, autenticación posterior,
denegaciones y recuperación ante errores; las capturas usan únicamente identidades sintéticas.

## Evidencia local

- `.tmp/staff-no-email-red.log`: nueve fallos reproducen los bloqueos anteriores.
- `.tmp/staff-no-email-focused.log`: 129/129 pruebas del cambio y rutas relacionadas.
- `.tmp/staff-no-email-browser.log`: 6/6 pruebas de móvil/escritorio, teclado, guardado y reintento. Capturas sintéticas revisadas.
- `.tmp/staff-no-email-types.log`, `.tmp/staff-no-email-lint.log`, `.tmp/staff-no-email-format-check.log`: correctos.
- Compilaciones Functions y web correctas (`.tmp/staff-no-email-functions-build.log`, `.tmp/staff-no-email-web-build.log`). La primera compilación concurrente terminó con 137; repetida de forma aislada pasó.
- Suite general: 4.404/4.405. Un timeout de 5 s al importar el índice en `member-directory-callables.test.ts`; repetición aislada 13/13, importación en 2,3 s (`.tmp/staff-no-email-timeout-recheck.log`). No se afirma una suite general enteramente verde.
- Sin cambios en roles, credenciales o datos de producción. La revisión automática rechazó el despliegue de las tres funciones: el operador autorizó commit y push, pero no explícitamente el backend de esta corrección. El despliegue no se ejecutó; publicar el código no activa por sí solo el cambio de rol sin correo.
