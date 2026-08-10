# T017 MFA TOTP

**Fecha:** 2026-08-09
**Estado:** Pendiente de revisión final del operador
**Tarea:** T017 - Implementar MFA obligatorio para owner/admin

## Objetivo

Exigir un segundo factor TOTP para `owner` y `administrator` antes de permitir acceso al shell
administrativo o a Functions sensibles. El enrolamiento será guiado en el primer acceso y Firebase
Authentication será la única autoridad que almacena y verifica el secreto TOTP.

## Decisión

- Segundo factor: TOTP compatible con aplicaciones autenticadoras.
- No se usa SMS/Phone Auth en esta tarea por costo, abuso y dependencia operativa.
- El administrador puede enrolar su propio factor después de completar el primer factor.
- Un usuario administrativo sin TOTP ve el wizard de enrolamiento, no el shell ni datos sensibles.
- Cliente no requiere MFA en esta fase.
- El selector `Administrator/Client` no concede ni infiere MFA.

## Flujo

### Primer acceso administrativo

1. El usuario completa Google o email/contraseña.
2. Firebase devuelve la sesión de primer factor.
3. Si no hay factor TOTP enrolado, la UI muestra `Set up your authenticator`.
4. Firebase genera el secreto de enrolamiento y la UI muestra QR/URI de uso único sin escribirlo en
   Firestore, logs, URLs, analytics, screenshots ni traces.
5. El usuario escanea el QR, escribe el código de seis dígitos y confirma.
6. Firebase registra el factor; la UI renueva el token y vuelve a evaluar la sesión.
7. Solo una sesión con segundo factor válido entra a `/admin`.

### Acceso posterior

- Si Firebase responde `auth/multi-factor-auth-required`, la UI muestra el desafío TOTP.
- El usuario introduce el código de su autenticador.
- Firebase resuelve el desafío y la UI renueva el token antes de mostrar `/admin`.
- Código inválido, expirado o cancelado mantiene el usuario fuera del shell y muestra un error
  genérico recuperable.

### Pérdida del dispositivo

- No existe bypass público, código fijo, claim manual desde el navegador ni recuperación que ignore
  MFA.
- El operador debe intervenir mediante el mecanismo administrativo de Firebase para eliminar el
  factor o reestablecer el acceso; esa operación queda fuera de la UI normal y debe auditarse.

## Autoridad backend

`requireAdminActor` debe exigir, además de `academyId` y rol administrativo, evidencia de segundo
factor en el token Firebase:

- `request.auth.token.firebase.sign_in_second_factor === "totp"` para operaciones administrativas
  sensibles.
- La ausencia o cualquier otro valor produce `permission-denied`.
- `mfaEnrolled` no se considera suficiente como prueba de autenticación reciente; un custom claim
  no reemplaza la evidencia emitida por Firebase Auth.

Las operaciones no administrativas del cliente no usan esta exigencia. La UI puede orientar al
usuario, pero Functions conserva la frontera efectiva.

## Componentes

- Firebase Web Auth: `multiFactor`, `TotpMultiFactorGenerator`, `getMultiFactorResolver` y
  `TotpMultiFactorAssertion`.
- Login form: maneja el estado de primer factor y el resolver de MFA sin almacenar secretos.
- `AdminAuthProvider`: estados `loading`, `signed-out`, `mfa-required`, `mfa-enrollment-required`,
  `authorized` y `denied`.
- `AdminGate`: muestra wizard/desafío antes de `AdminShell`.
- Functions authorization: valida el segundo factor en `request.auth.token.firebase`.
- `firebase-client`: mantiene la boundary de SDK y no expone secretos fuera del flujo Auth.

## Seguridad

- El secreto TOTP nunca se persiste en Firestore, RTDB, custom claims, localStorage, URLs o logs.
- QR, URI y códigos quedan solo en memoria durante el enrolamiento.
- Código inválido y errores de proveedor no revelan detalles internos.
- No se permite acceso administrativo con primer factor solamente.
- Se evita guardar screenshots/traces/video durante la verificación real de MFA.
- Las cuentas de test son no productivas y los valores locales se inyectan fuera del repositorio.
- La activación del proveedor TOTP y dominios OAuth se configura por ambiente, nunca desde la UI.

## Pruebas

### Unitarias/integración

- Claims administrativas sin evidencia TOTP producen `permission-denied`.
- Token con `firebase.sign_in_second_factor: "totp"` autoriza la operación.
- Cliente y roles no administrativos no obtienen acceso administrativo.
- Wizard aparece cuando no hay factores enrolados.
- QR/URI queda en memoria y no se escribe en storage/logs.
- Código válido completa enrolamiento; código inválido permanece bloqueado.
- Resolver `auth/multi-factor-auth-required` muestra desafío y un código válido resuelve la sesión.
- Logout limpia el flujo y evita acceso al shell.

### E2E

- Desktop/mobile: admin sin MFA no ve shell ni datos.
- Enrolamiento manual controlado en staging con una cuenta administrativa dedicada.
- Acceso posterior exige el código TOTP.
- Cliente sigue entrando sin MFA.
- Cuenta admin con código inválido permanece denegada.
- Se verifica que no se generen screenshots, traces, videos o logs con QR, URI, secreto o código.

La prueba real de TOTP es opt-in y local/staging; CI usa mocks/contratos sin secretos MFA.

## Rollback

- Código: restaurar la revisión anterior de web/Functions.
- Cuenta: el operador elimina el factor TOTP enrolado desde Firebase Auth si la prueba debe
  revertirse.
- No hay migración de Firestore ni backup de datos requerido, pero toda modificación de factor debe
  quedar registrada en el runbook de staging.

## Criterio de aceptación

T017 pasa a revisión cuando owner/administrator no pueden entrar ni usar Functions sensibles con
primer factor solamente, pueden completar TOTP guiado, el acceso posterior exige una evidencia
Firebase de segundo factor, cliente no se ve afectado, los secretos no aparecen fuera de memoria y
las pruebas unitarias, Rules, Functions, E2E sintéticas y verificación staging pasan con evidencia.
