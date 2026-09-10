# ADR-006: CityPay como proveedor de pagos post-piloto (propuesta)

Fecha: 2026-09-01
Estado: propuesta; pendiente de aceptacion del operador y de evidencia externa

## Contexto

BPT Jersey necesita pagos online para una sociedad incorporada en Jersey. El piloto actual usa pagos
manuales y no captura tarjetas. La eleccion del proveedor afecta contrato, coste, datos, PCI DSS,
settlement, webhooks y dificultad de rollback.

## Decision

Proponer **CityPay Limited**, usando inicialmente **Paylink alojado para pagos unicos en GBP**, detras
del adapter provider-independent ya aprobado. No se activa ninguna cuenta, credencial, cobro ni gasto
hasta completar onboarding, cotizacion, legal, alertas y sandbox.

## Alternativas consideradas

- PayPal: alternativa de menor friccion, con evidencia previa de cobertura Jersey; queda como fallback si
  CityPay no confirma por escrito entidad, settlement o condiciones.
- Adyen: alternativa de escala, pero con onboarding/cotizacion potencialmente sobredimensionados para el
  volumen inicial y necesidad de confirmar merchant directo frente a Platforms.
- Revolut Business: condicionada; la evidencia disponible no confirma expresamente una sociedad Jersey.
- Stripe: descartada para esta entidad por disponibilidad territorial; no se debe falsear otro pais.

## Evidencia y consecuencias

CityPay declara registro JFSC para merchant services en EEA/Channel Islands, PCI DSS Level 1, merchant
accounts multidivisa, gateway/API y Paylink. Hay Paylinks publicados para organizaciones de Jersey y
documentacion de sandbox, 3DS, refunds, voids y test accounts. Esto hace que la propuesta sea mas
reversible y localmente verificable que una integracion server-led propia.

La consecuencia principal es depender de la confirmacion contractual de CityPay sobre elegibilidad,
adquirente, settlement, monedas, tarifas, DPA, residencia y AOC PCI. Paylink limita la personalizacion
del checkout y deja suscripciones/tokenizacion fuera de la primera fase. La salida consiste en apagar la
feature flag, volver a unconfigured/manual, conciliar por reportes y revocar credenciales.

## Gates para reemplazar propuesta por aceptada

- aceptacion explicita del operador;
- contrato, entidad contratante, alcance JFSC, adquirente y tarifas fechados;
- elegibilidad Jersey, GBP settlement y monedas confirmadas;
- revision legal/DPA coordinada con T011;
- presupuesto, techo, alertas y responsable de escalamiento aprobados;
- AOC PCI del producto exacto y SAQ confirmados;
- sandbox aislado probado y rollback ensayado.
