# Paquete de decision: proveedor de pagos

## Estado

T010 permanece **bloqueada**: ahora existe una propuesta explicita de proveedor, pero no existe
aceptacion del operador, alta de cuenta, credenciales, cotizacion contractual, revision legal ni
activacion de cobros.

Investigacion actualizada: 2026-09-01 (America/Bogota).

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

## Propuesta explicita de seleccion (pendiente de aceptacion)

**Proveedor propuesto: CityPay Limited.**

**Producto inicial propuesto: CityPay Paylink, checkout alojado para pagos unicos en GBP.**
La pagina alojada mantiene PAN, CVV y autenticacion dentro del entorno de CityPay; BPT Jersey solo
crea la sesion, redirige, recibe el resultado minimo y concilia por referencias. No se habilitan
suscripciones, MIT ni tokenizacion en esta primera fase: la documentacion de CityPay marca Billing como
capacidad futura y deja los paquetes de stored credentials/MIT para una fase posterior.

La propuesta se basa en evidencia directa y vigente del proveedor:

- CityPay declara estar registrado ante la JFSC para promover/ofrecer merchant services en EEA,
  incluidos los Channel Islands, y declara certificacion PCI DSS Level 1.
- Sus soluciones publicas incluyen merchant account multidivisa, gateway/API, e-commerce y Paylink.
- Existen pagos alojados publicados para Ports of Jersey, Jersey Water y Jersey FA, lo que prueba uso
  operativo del servicio en Jersey, aunque no sustituye la confirmacion contractual de elegibilidad de
  BPT Jersey.
- La documentacion tecnica ofrece cuentas de prueba, sandbox, escenarios 3DS, refund, void y
  pre-auth, y exige Merchant ID/licence key y allowlist de IP para la integracion.

La afirmacion de registro/alcance regulatorio es inicialmente evidencia del proveedor, no una opinion
legal. Antes de aceptarla hay que obtener un extracto o confirmacion JFSC y el nombre exacto de la
entidad que contratara, adquirira y liquidara los fondos.

## Shortlist basada en fuentes oficiales

| Proveedor                       | Evidencia de Jersey                                                                                                                          | Encaje tecnico                                                                                                                            | Coste conocido                                                                                                                                                                                         | Riesgo/pendiente                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **CityPay Limited (propuesto)** | Declara registro JFSC para merchant services en EEA/Channel Islands; tiene Paylink publicado para Ports of Jersey, Jersey Water y Jersey FA. | Paylink/Elements alojado, API REST, 3DS, webhooks y reportes; adecuado para pagos unicos GBP sin PAN en BPT.                              | No publica una tarifa contractual completa; requiere cotizacion de setup, fijo, transaccion, FX, refund, chargeback y payout.                                                                          | Confirmar elegibilidad de la sociedad concreta, alcance JFSC, adquirente, settlement, DPA, AOC PCI del producto exacto, monedas y limites.      |
| PayPal                          | Su acuerdo de pagos con tarjeta aplica a residentes registrados en UK, Jersey, Guernsey e Isle of Man.                                       | API de pagos con tarjeta; Website Payments Pro incluye API/Express Checkout y ofrece Recurring Payments Tool como funcionalidad opcional. | Tarifario UK actualizado 2026-07-15: 1.2% + GBP 0.30 para pago con tarjeta sin cuenta PayPal; otras transacciones comerciales: 2.9% + GBP 0.30; pueden aplicar recargos internacionales y chargebacks. | Confirmar elegibilidad final, producto exacto, limites, liquidacion bancaria y tarifa contractual para BPT.                                     |
| Adyen                           | La documentacion de Adyen for Platforms incluye United Kingdom, incluyendo Jersey e Isle of Man.                                             | Integracion unificada online/in-person/in-app; plataformas, onboarding, pagos divididos, webhooks y conciliacion documentados.            | Sin tarifa publica comparable en las fuentes revisadas; requiere contacto/cotizacion.                                                                                                                  | Posible sobrecarga de onboarding/operacion para el volumen inicial; confirmar si aplica al merchant directo y no solo Platforms, ademas de POS. |
| Revolut Business                | La pagina revisada documenta pagos online/in-person, pero no confirma expresamente elegibilidad de una sociedad incorporada en Jersey.       | Payment Gateway, checkout, invoices y subscriptions; liquidacion en cuenta Merchant.                                                      | Pagina UK: online 1% + GBP 0.20 para Visa/Mastercard consumer UK; 2.8% + GBP 0.20 para tarjetas no UK/comerciales; fees/T&Cs aplican.                                                                  | Verificar por onboarding/ventas que una entidad de Jersey puede abrir Merchant account y confirmar tarifas aplicables a BPT.                    |

### Descartado provisionalmente: Stripe

Stripe no es candidato para una empresa incorporada en Jersey segun su documentacion de disponibilidad
para territorios dependientes; no se debe crear una cuenta con pais distinto para eludir esa limitacion.

## Orden de decision

1. **CityPay Limited + Paylink: propuesta principal**, por la evidencia local mas directa, el checkout
   alojado y la ruta de sandbox ya documentada.
2. **PayPal: alternativa de menor friccion**, si CityPay no confirma por escrito la sociedad, el
   settlement o las condiciones comerciales.
3. **Adyen: alternativa de escala**, solo si la cotizacion y el onboarding justifican la mayor
   complejidad operativa.
4. **Revolut Business: condicionada**, solo despues de confirmar por escrito la elegibilidad de una
   entidad incorporada en Jersey.

Stripe permanece descartado para esta entidad; no se debe abrir una cuenta con otro pais para eludir
la disponibilidad territorial.

## Decision requerida al operador

Para desbloquear T010 se requiere que el operador acepte o rechace expresamente **CityPay Limited +
Paylink**. Si lo acepta, solo queda autorizado el siguiente paso: solicitar onboarding, cotizacion,
terminos y requisitos de sandbox. La activacion de cobros, la creacion de secretos productivos,
cualquier gasto y el despliegue siguen requiriendo autorizacion separada.

## Checklist de onboarding, contrato y revision legal

Solicitar a CityPay una respuesta escrita con version/fecha de cada documento:

- Entidad: nombre legal de CityPay y adquirente, numero de registro, alcance JFSC y confirmacion de
  que aceptan una sociedad Jersey; MCC y pais de liquidacion.
- Comercio: GBP para cobro y settlement; soporte real de JEP, EUR y USD; tarjetas/wallets, paises de
  compradores, payout schedule, reservas y holdbacks.
- Tarifas: setup, mensual, autorizacion/captura, 3DS, refund, chargeback, retrieval, FX, payout,
  minimo mensual, cancelacion y cambios de tarifa.
- Terminos: fraude/chargeback, SLA, incidentes, suspension, termination, datos, reportes y rollback.
- Datos y legal Jersey: DPA, controller/processor, subprocesadores, residencia, transferencias,
  retencion/borrado, brechas y derechos; coordinar con T011.
- PCI: AOC PCI DSS vigente para Paylink/Elements, responsabilidades y SAQ aplicable; nunca PAN,
  CVV/CVC ni track data en BPT.
- Sandbox: Client ID, Licence Key, Merchant ID, endpoint, 3DS, webhooks firmados, test cards,
  allowlist IP, refunds/voids y reportes de conciliacion; todo de prueba y revocable.

## Gate de promocion

Mantener T010 bloqueada hasta completar disponibilidad, producto, cotizacion/terminos, tratamiento de datos,
limites, techo y alerta desde documentacion actual o cotizacion oficial. Despues actualizar ADR, STACK.md,
contrato del adaptador, pruebas y evidencia de tasks.md. Este paquete no aprueba por si solo una cuenta,
credenciales, cobros, gasto, staging real ni produccion.

## Presupuesto y guardas propuestas (requieren aprobacion del operador)

Mientras no exista aprobacion, el costo comprometido es **GBP 0** y el proveedor sigue
unconfigured. Como baseline de 90 dias para negociar y controlar el post-piloto, proponer:

- setup y alta: maximo GBP 500 una sola vez;
- cargos fijos: maximo GBP 100/mes;
- cargos variables de procesamiento/FX/chargeback: techo GBP 2,500 acumulado en 90 dias;
- limite operativo: GBP 500 por transaccion, GBP 1,000 por dia y GBP 5,000 por mes;
- alertas al 50%, 80% y 100% del techo mensual/acumulado, con bloqueo fail-closed al 100% si el
  proveedor no ofrece hard cap; el bloqueo no revierte cargos ya autorizados;
- responsable de escalamiento: operador/aprobador de operaciones, con revision semanal y conciliacion
  contra el reporte del adquirente.

Los importes son limites de control propuestos, no tarifas publicadas ni autorizacion de gasto. Si la
cotizacion o el volumen esperado los supera, se requiere nueva aprobacion antes de continuar.

## Custodia de credenciales y no almacenamiento de tarjetas

- Guardar solo secretos de servidor en Secret Manager; nunca en Git, chat, logs, cliente o fixtures.
- Mantener separadas credenciales sandbox y produccion; rotar/revocar al terminar la validacion.
- No guardar PAN, CVV/CVC, track data ni payloads completos; persistir solo payment reference,
  estado, importe/moneda, timestamps, resultado minimo y clave de idempotencia tenant-scoped.
- Redactar headers, firmas, tokens, claves y cualquier campo de tarjeta en logs y trazas.
- Validar firma, timestamp, replay e idempotencia de cada webhook antes de cambiar estado financiero.

## Validacion aislada y rollback

La prueba debe usar un Merchant ID sandbox de CityPay y datos sinteticos, sin datos reales de alumnos,
sin dinero real y sin tocar el proyecto Firebase productivo. La matriz minima es: aprobado, declinado,
3DS frictionless/challenge, refund, void/pre-auth, timeout, malformed, webhook duplicado, replay,
webhook fuera de orden, misma idempotency key con payload divergente y proveedor indisponible.

Rollback:

1. Desactivar la feature flag del proveedor y volver a unconfigured/pago manual; bloquear nuevos
   checkouts externos sin borrar el historial interno.
2. Mantener conciliables los pagos ya autorizados; no reintentarlos ni crear cargos compensatorios.
   Tramitar refunds pendientes por el reporte/portal del proveedor.
3. Confirmar por reporte de CityPay autorizaciones, capturas, refunds y chargebacks; auditar diferencias.
4. Revocar/rotar credenciales sandbox y restaurar la version previa del adapter si la regresion fue de
   codigo. No se requiere migracion destructiva.

### Criterio de cierre de T010

Solo pasar T010 a aprobada con evidencia de: aceptacion del operador; onboarding; contrato, tarifas,
monedas y settlement; revision legal/DPA; presupuesto y alertas; secretos en el gestor; matriz sandbox
completa; y simulacro de rollback registrado.

## Evidencia T034 sintetica (2026-08-26)

El adaptador independiente del proveedor esta implementado localmente en
packages/domain/src/payments/ y apps/functions/src/payments/. Acepta solo un contrato estricto de
checkout GBP, excluye datos de tarjeta, requiere URLs HTTPS, normaliza salidas malformadas como resultado
fallido y deduplica por tenant y clave de idempotencia. El proveedor por defecto unconfigured no hace
llamadas externas y tiene costo comprometido estimado de USD 0/mes.

Esto no selecciona ni verifica un proveedor real, no crea credenciales, no abre checkout, no procesa dinero
ni satisface T010. T034 queda aprobada unicamente para el adaptador tecnico/sintetico; T035 y T036 siguen pendientes hasta resolver T010.

## Fuentes oficiales consultadas

- [CityPay - About](https://www.citypay.com/about/about-citypay)
- [CityPay - Merchant Account](https://www.citypay.com/our-solutions/merchant-accounts)
- [CityPay - Paylink SAQ guide](https://docs.citypay.com/pci-dss-saq-guide/paylink)
- [CityPay - Testing framework](https://docs.citypay.com/testing)
- [CityPay - Testing best practices](https://docs.citypay.com/testing-best-practice)
- [CityPay - Quickstart/API access](https://docs.citypay.com/quickstart)
- [Ports of Jersey - CityPay Paylink](https://payments.citypay.com/UwoETV8XUA/~PoJSRegistry)
- [Jersey Water - pay online with CityPay](https://www.jerseywater.je/accounts-and-billing/)
- [Jersey Financial Services Commission - Registry](https://www.jerseyfsc.org/registry/)
- [PCI SSC - SAQ A iframe FAQ](https://www.pcisecuritystandards.org/faqs/1438/)

- [PayPal Online Card Payment Services Agreement](https://www.paypal.com/uk/legalhub/paypal/pocpsa-full?locale.x=en_GB)
- [PayPal Merchant Fees](https://securepayments.paypal.com/uk/business/paypal-business-fees)
- [Adyen for Platforms - Classic integration](https://docs.adyen.com/classic-platforms/)
- [Adyen - Accept payments](https://www.adyen.com/en_AE/accept-payments)
- [Revolut Business - Accept payments](https://www.revolut.com/business/accept-payments/)
- [Revolut - card payment fees](https://help.revolut.com/help/merchant-accounts/fees/how-much-does-it-cost-to-accept-card-payments/business/)
- [Stripe - availability for outlying territories](https://support.stripe.com/questions/stripe-availability-for-outlying-territories-of-supported-countries?locale=en-GB)
