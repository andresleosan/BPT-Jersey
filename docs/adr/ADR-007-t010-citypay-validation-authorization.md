# ADR-007 — Autorización de validación externa de CityPay para T010

**Fecha:** 2026-09-01  
**Estado:** autorizada para validación; no aceptada como proveedor definitivo.

## Decisión

El operador autoriza validar CityPay Limited + Paylink alojado para pagos únicos en GBP. La autorización cubre únicamente solicitar onboarding, cotización, términos y acceso sandbox/test accounts.

## Límites

No se autoriza firmar, contratar, pagar, activar producción, procesar dinero real, introducir tarjetas ni custodiar credenciales de producción. T010 no puede marcarse como aprobada con esta decisión.

## Evidencia y siguiente paso

La solicitud preparada está en `docs/operations/t010-citypay-onboarding-request.md`. Debe enviarse por el canal comercial oficial con los datos corporativos no sensibles completados. La respuesta de CityPay debe conservarse junto con la cotización, términos, DPA/PCI y resultado de revisión legal.

La elegibilidad publicada por CityPay para Jersey y las capacidades de Paylink son indicios de investigación, no una conclusión legal ni contractual. La decisión definitiva requiere confirmación escrita de la entidad contratante, alcance JFSC, monedas/liquidación, tarifas, disponibilidad regional, controles de coste y sandbox probado.
