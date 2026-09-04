# T010 — Solicitud de onboarding de CityPay

**Estado:** autorizada para validación externa; sin contratación, cobro ni gasto.

**Proveedor propuesto:** CityPay Limited  
**Producto inicial:** Paylink alojado para pagos únicos en GBP.  
**Entidad solicitante:** BPT Jersey, entidad incorporada en Jersey — completar razón social, número de registro, domicilio y persona autorizada antes de enviar.

## Alcance autorizado

El operador autorizó solicitar a CityPay:

- confirmación de elegibilidad de una entidad incorporada en Jersey;
- onboarding y requisitos KYC/KYB, sin obligación de firmar ni activar producción;
- cotización completa y términos contractuales;
- monedas de cobro y liquidación, disponibilidad regional y calendario de payouts;
- acceso a sandbox/test accounts, Paylink, 3DS, webhooks, refunds y voids;
- documentación PCI, DPA, subprocesadores, retención y transferencias internacionales.

No están autorizados todavía: firmar contrato, pagar setup o mensualidades, habilitar producción, procesar dinero real, usar credenciales reales o introducir datos de tarjeta.

## Mensaje listo para enviar

> **Subject:** Jersey-incorporated entity — Paylink GBP onboarding, quotation and sandbox request
>
> Hello CityPay Sales Team,
>
> We are evaluating CityPay Paylink for a Jersey-incorporated entity and would like to validate a limited post-pilot use case: one-time e-commerce payments in GBP, using a CityPay-hosted checkout. We are requesting information and sandbox access only; this request does not authorize a contract, production activation, payment processing or spend.
>
> Please confirm:
>
> 1. Whether you accept our exact Jersey legal entity and intended business/MCC, and which CityPay/acquiring/settlement legal entity would contract with us.
> 2. Your current JFSC registration/permission scope relevant to this service and Channel Islands merchants, with the official registry reference or extract we should retain for legal review.
> 3. Available payment methods, shopper-country coverage, charge currency and settlement currencies. Our initial requirement is GBP charge and GBP settlement; please identify any minimums, reserves or restrictions.
> 4. Full commercial terms: setup, monthly, per-authorisation, capture, 3DS, refund, void, chargeback, retrieval, FX, payout, minimum-volume, cancellation and rate-change fees, plus payout schedule and reserves.
> 5. Contractual terms, SLA, incident notification, fraud/chargeback responsibilities, suspension/termination, data processing agreement, subprocessors, data residency/transfers, retention/deletion and breach obligations.
> 6. PCI DSS Attestation of Compliance and the applicable Paylink SAQ guidance for a redirect-hosted integration where our systems never store, process or transmit PAN, CVV or track data.
> 7. Sandbox/test-account onboarding: Client ID, integration licence key, Merchant ID, endpoint, IP allowlisting, 3DS test cases, test cards, webhook signing/verification, idempotency, refunds, voids, pre-authorisation/capture and reconciliation reports. Please confirm that every credential is test-only, revocable and separate from production.
> 8. Recommended rollback/disable procedure and whether a hard transaction or spend limit and webhook replay controls are available.
>
> Our technical integration will keep payment logic server-side, redirect shoppers to Paylink, retain only non-sensitive payment references/status/amount/currency/timestamps, and redact credentials and card data from logs. We will not email or upload card details.
>
> Please send the onboarding form, current quotation, standard terms, DPA/PCI documents and sandbox instructions. We will route legal documents for independent review before any acceptance.
>
> Kind regards,  
> **[Nombre y cargo del representante autorizado]**  
> **[Razón social exacta]**  
> **[Número de registro de Jersey]**  
> **[Sitio web/dominio]**  
> **[Correo corporativo y teléfono]**

El canal comercial oficial publicado por CityPay es su formulario de **Sales Enquiry**: <https://www.citypay.com/get-in-touch/sales-enquiry>. No se deben incluir contraseñas, claves, PAN, CVV, capturas de tarjetas ni datos de clientes en el formulario o por correo.

## Evidencia pública que acompaña la solicitud

- CityPay declara estar registrado ante la JFSC para ofrecer servicios a la región EEA, incluidas las Channel Islands: <https://www.citypay.com/about/about-citypay>.
- CityPay documenta Paylink como formulario alojado y ofrece guía SAQ para el escenario en que el comerciante no almacena, procesa ni transmite datos de tarjeta: <https://docs.citypay.com/paylink-overview> y <https://docs.citypay.com/pci-dss-saq-guide/paylink>.
- CityPay publica documentación de pruebas para 3DS, autorizaciones, refunds, voids, preautorización/captura y otros flujos: <https://docs.citypay.com/testing> y <https://docs.citypay.com/testing-best-practice>.
- Existen Paylinks públicos usados por organizaciones de Jersey, incluido Ports of Jersey; esto demuestra uso visible, pero no sustituye la confirmación contractual de elegibilidad para BPT Jersey: <https://payments.citypay.com/UwoETV8XUA/~PoJSRegistry>.

Estas afirmaciones son evidencia de investigación, no una opinión legal. La aceptación de T010 exige conservar la respuesta de CityPay, la cotización/contrato y la revisión legal independiente.

## Criterio de recepción

Guardar en el expediente de T010, sin secretos:

1. respuesta escrita de elegibilidad y entidad contratante;
2. cotización fechada, términos, monedas, liquidación y disponibilidad regional;
3. DPA, subprocesadores, PCI AOC/SAQ y resolución de la revisión legal;
4. acceso sandbox y matriz de pruebas completada;
5. límites, alertas, custodio de secretos y procedimiento de rollback aprobados.

Hasta completar los cinco puntos, T010 no puede pasar a **aprobada** ni habilitar cobros.
