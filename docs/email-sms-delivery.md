# Entrega externa de email/SMS

## Estado

T046 deja preparada la frontera provider-independent y el historial tenant-scoped. No hay un
proveedor real seleccionado ni credenciales activas; el adaptador por defecto registra
`skipped/provider_unconfigured` y no hace llamadas de red.

## Contrato

- `ExternalDeliveryRequest` valida tenant, canal, destinatario, plantilla, variables y fecha.
- Email acepta una dirección con formato válido; SMS exige número internacional E.164.
- `DeliveryHistoryRecord` conserva estado, intento, proveedor, referencia externa sanitizada y
  código de fallo. No persiste destinatario, variables, cuerpo, tokens ni credenciales.
- `deliveryId` es la clave idempotente. Los intentos se limitan a tres y usan backoff acotado de
  250 ms, 500 ms y 1 s; solo se repiten fallos marcados como retryable.

## Proveedor futuro

El proveedor se implementa detrás de `ExternalDeliveryProvider`. La credencial debe vivir en
Secret Manager/secretos de Functions y nunca en el cliente, tests, logs o documentos de historial.
La integración concreta debe añadir contract tests del proveedor, prueba de rate limit, timeout,
fallo permanente, entrega aceptada y comportamiento ante caída.

## Degradación

Una caída o respuesta inválida del proveedor produce un historial `failed` sanitizado; no rompe la
experiencia in-app. El fallback `unconfigured` deja constancia de que el canal externo no se
intentó. La activación real requiere elegir proveedor, configurar alertas de gasto y aprobación
explícita del operador.
