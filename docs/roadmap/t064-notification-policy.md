# T064 - Politica de notificaciones externas

Estado: revision (slice tecnico de preferencias, 2026-08-31).

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
- No hay red, proveedor, reintentos ni UI; la persistencia Firestore, RBAC/runtime y Rules/Emulator del registro de preferencias ya estan implementados y verificados.
- Seleccion de proveedor, limites/alertas de costo y E2E autenticada HTTP/UI siguen pendientes.
- Costo comprometido por este slice: USD 0/mes; STACK.md conserva la decision de no activar mensajeria sin proveedor y aprobacion.

## Evidencia

- notification-policy.test.ts: 6/6.
- Regresion de delivery/offline/Levels/progreso/recordatorios: 58/58.
- @bpt-jersey/domain typecheck: pasa.
- ESLint focalizado, Prettier y git diff --check: pasan.
- Persistencia Firestore Emulator: 1/1; upsert determinista, retiro de consentimiento e aislamiento entre academias.
- Callables/RBAC: 11/11 pruebas unitarias; solo owner/administrator, academyId y updatedAt derivados del actor/backend.
- Rules: client-data-boundary 35/35; la coleccion queda bloqueada para operaciones directas de cliente.
- Funciones typecheck, ESLint y Prettier focalizados: pasan.
Actualizacion 2026-08-31: la auditoria persistida `notification.preference.updated` se escribe de forma create-only dentro de la misma transaccion que el upsert; integracion Firestore Emulator 1/1.
El E2E autenticado real contra Auth + Firestore + Functions Emulator paso 2/2 proyectos Playwright (desktop/mobile), con usuario sintetico temporal y claim `owner`; cubre 401 sin sesion, login, list, save y update.
La regresion completa posterior paso 192 archivos y 1.297/1.297 pruebas unitarias; typecheck QA/Functions, lint focalizado, Prettier y `git diff --check` pasan.
Pendientes de T064: proveedor, limites/alertas de costo, UI y checkpoint de producto; no se hizo despliegue ni gasto.

## Rollback

El cambio es aditivo y no requiere migracion: retirar el export de las callables y detener nuevas escrituras elimina el flujo sin borrar historial. Los documentos creados en Emulator se limpian al finalizar las pruebas; cualquier eliminacion productiva requiere backup verificado y confirmacion explicita del operador.
