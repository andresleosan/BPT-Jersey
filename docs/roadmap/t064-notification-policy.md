# T064 - Politica de notificaciones externas

Estado: revision (slice de dominio, 2026-08-27).

## Alcance implementado

- Preferencias por academia, audiencia, proposito y canal.
- Consentimiento obligatorio para email y sms.
- In-app permitido sin consentimiento externo.
- Estados explicables: missing_preference, disabled, consent_required y consent_withdrawn.
- Matching explicito de tenant y audience.
- Salida sin contactos, mensajes, proveedor ni credenciales.
- Duplicados y campos extra rechazados; salida inmutable y determinista.

## Limites y dependencias abiertas

- Complementa la frontera provider-independent de T046; no crea un cliente externo.
- No hay red, proveedor, reintentos, Firestore writes, UI ni persistencia.
- Seleccion de proveedor, limites/alertas de costo, RBAC/runtime, Rules/Emulator y E2E siguen pendientes.
- Costo comprometido por este slice: USD 0/mes; STACK.md conserva la decision de no activar mensajeria sin proveedor y aprobacion.

## Evidencia

- notification-policy.test.ts: 6/6.
- Regresion de delivery/offline/Levels/progreso/recordatorios: 58/58.
- @bpt-jersey/domain typecheck: pasa.
- ESLint focalizado, Prettier y git diff --check: pasan.
