# Paquete de decision: proveedor de pagos

## Estado

T010 permanece **bloqueada**: hay shortlist documentada, pero no existe seleccion del operador,
alta de cuenta, credenciales, cotizacion contractual ni activacion de cobros.

Investigacion actualizada: 2026-08-27 (America/Bogota).

## Alcance y restricciones

- Jersey-incorporated business; moneda operativa prevista: GBP.
- Prioridad: checkout web, pagos unicos y suscripciones futuras, con webhooks y conciliacion.
- Esta investigacion no creo cuentas, no uso credenciales, no hizo llamadas de cobro y no genero gasto.
- No se autoriza produccion, staging con dinero real ni datos reales hasta contar con seleccion explicita,
  onboarding aprobado, contrato/tarifas confirmadas, secretos gestionados, alertas de coste y pruebas de
  sandbox.

## Fronteras no negociables

- Mantener los datos de pago fuera del cliente y backend de BPT Jersey; usar checkout alojado y un adaptador independiente del proveedor.
- Exigir verificacion de firma de webhooks, idempotencia, proteccion contra replay, eventos de auditoria y errores fail-closed.
- No tratar marketing como prueba de disponibilidad en Jersey, residencia de datos, cumplimiento legal o idoneidad para datos de menores.
- T011 sigue sin resolver retencion, residencia, transferencias, borrado, backups y redaccion legal para datos reales.
- Una seleccion real requiere cotizacion oficial, terminos actuales, terminos de tratamiento de datos, aprobacion del operador y rollback documentado.

## Shortlist basada en fuentes oficiales

| Proveedor | Evidencia de Jersey | Encaje tecnico | Coste conocido | Riesgo/pendiente |
|---|---|---|---|---|
| PayPal | Su acuerdo de pagos con tarjeta aplica a residentes registrados en UK, Jersey, Guernsey e Isle of Man. | API de pagos con tarjeta; Website Payments Pro incluye API/Express Checkout y ofrece Recurring Payments Tool como funcionalidad opcional. | Tarifario UK actualizado 2026-07-15: 1.2% + GBP 0.30 para pago con tarjeta sin cuenta PayPal; otras transacciones comerciales: 2.9% + GBP 0.30; pueden aplicar recargos internacionales y chargebacks. | Confirmar elegibilidad final, producto exacto, limites, liquidacion bancaria y tarifa contractual para BPT. |
| Adyen | La documentacion de Adyen for Platforms incluye United Kingdom, incluyendo Jersey e Isle of Man. | Integracion unificada online/in-person/in-app; plataformas, onboarding, pagos divididos, webhooks y conciliacion documentados. | Sin tarifa publica comparable en las fuentes revisadas; requiere contacto/cotizacion. | Posible sobrecarga de onboarding/operacion para el volumen inicial; confirmar si aplica al merchant directo y no solo Platforms, ademas de POS. |
| Revolut Business | La pagina revisada documenta pagos online/in-person, pero no confirma expresamente elegibilidad de una sociedad incorporada en Jersey. | Payment Gateway, checkout, invoices y subscriptions; liquidacion en cuenta Merchant. | Pagina UK: online 1% + GBP 0.20 para Visa/Mastercard consumer UK; 2.8% + GBP 0.20 para tarjetas no UK/comerciales; fees/T&Cs aplican. | Verificar por onboarding/ventas que una entidad de Jersey puede abrir Merchant account y confirmar tarifas aplicables a BPT. |

### Descartado provisionalmente: Stripe

Stripe no es candidato para una empresa incorporada en Jersey segun su documentacion de disponibilidad
para territorios dependientes; no se debe crear una cuenta con pais distinto para eludir esa limitacion.

## Recomendacion para la siguiente decision

1. **Primera opcion a validar: PayPal**, por ser la evidencia mas directa de cobertura de residentes de
   Jersey y por tener una ruta documentada para pagos unicos y recurrentes.
2. **Alternativa de escala: Adyen**, si la cotizacion y el proceso de onboarding justifican su mayor
   complejidad operativa.
3. **Alternativa condicionada: Revolut Business**, solo despues de confirmar por escrito la elegibilidad
   de la entidad de Jersey y la tarifa efectiva.

Esto es una recomendacion de shortlist, no una aprobacion de proveedor.

## Decision requerida al operador

Para desbloquear T010 se requiere confirmar uno de los proveedores y autorizar unicamente el siguiente
paso: obtener onboarding/cotizacion y requisitos de integracion en sandbox. La activacion de cobros,
la creacion de secretos, cualquier gasto y el despliegue siguen requiriendo autorizacion separada.

## Gate de promocion

Mantener T010 bloqueada hasta completar disponibilidad, producto, cotizacion/terminos, tratamiento de datos,
limites, techo y alerta desde documentacion actual o cotizacion oficial. Despues actualizar ADR, STACK.md,
contrato del adaptador, pruebas y evidencia de tasks.md. Este paquete no aprueba por si solo una cuenta,
credenciales, cobros, gasto, staging real ni produccion.

## Evidencia T034 sintetica (2026-08-26)

El adaptador independiente del proveedor esta implementado localmente en
packages/domain/src/payments/ y apps/functions/src/payments/. Acepta solo un contrato estricto de
checkout GBP, excluye datos de tarjeta, requiere URLs HTTPS, normaliza salidas malformadas como resultado
fallido y deduplica por tenant y clave de idempotencia. El proveedor por defecto unconfigured no hace
llamadas externas y tiene costo comprometido estimado de USD 0/mes.

Esto no selecciona ni verifica un proveedor real, no crea credenciales, no abre checkout, no procesa dinero
ni satisface T010. T034 queda aprobada unicamente para el adaptador tecnico/sintetico; T035 y T036 siguen pendientes hasta resolver T010.

## Fuentes oficiales consultadas

- [PayPal Online Card Payment Services Agreement](https://www.paypal.com/uk/legalhub/paypal/pocpsa-full?locale.x=en_GB)
- [PayPal Merchant Fees](https://securepayments.paypal.com/uk/business/paypal-business-fees)
- [Adyen for Platforms - Classic integration](https://docs.adyen.com/classic-platforms/)
- [Adyen - Accept payments](https://www.adyen.com/en_AE/accept-payments)
- [Revolut Business - Accept payments](https://www.revolut.com/business/accept-payments/)
- [Revolut - card payment fees](https://help.revolut.com/help/merchant-accounts/fees/how-much-does-it-cost-to-accept-card-payments/business/)
- [Stripe - availability for outlying territories](https://support.stripe.com/questions/stripe-availability-for-outlying-territories-of-supported-countries?locale=en-GB)
