# ADR-008 — Propuesta de política de retención, residencia y eliminación para T011

**Fecha:** 2026-09-01  
**Estado:** propuesta; enmendada el 2026-09-06 por decisión del operador. La aprobación independiente deja de ser un gate: pendiente de firma del controller.

## Contexto

BPT Jersey puede tratar datos personales de usuarios, menores y, potencialmente, salud. La política necesita decisiones trazables sobre base legal, conservación, ubicación, transferencias, eliminación y evidencia operativa.

## Decisión propuesta

Adoptar minimización y denegación por defecto para datos de salud; separar por finalidad; usar un calendario de retención con trigger y acción verificables; preferir Jersey/UK/EEA; bloquear transferencias sin adecuación o salvaguarda documentada; y ejecutar eliminación idempotente en primario, índices, objetos, colas y procesadores.

El detalle, las diez decisiones y el runbook están en `docs/operations/t011-retention-residency-erasure-policy.md`. La matriz verificable está en `docs/operations/t011-privacy-test-matrix.md`.

## Alternativas descartadas

- Un único plazo global: no respeta finalidad, necesidad ni obligaciones distintas.
- Permitir salud “por si acaso”: eleva el riesgo y no cumple minimización.
- Declarar “todo en Jersey” sin mapa de subprocesadores: no prueba residencia ni transferencia.
- Borrado manual sin evidencia: no demuestra cumplimiento y no es repetible.

## Consecuencias

Positivas: menor superficie de datos, controles fail-closed y auditoría reproducible.  
Costes: inventario de proveedores, DPIA, automatización de borrado y pruebas periódicas. El registro JOIC y la revisión jurídica se retiraron del coste el 2026-09-06 por decisión del operador; lo que se ahorra en coste se traslada a riesgo asumido por el controller.

## Gates de aceptación

Enmienda 2026-09-06 (decisión del operador): se retiran de los gates el reviewer independiente y el registro JOIC. Quedan: completar la razón social del controller —forma jurídica, número de registro y domicilio—; aprobar la DPIA; resolver y firmar las diez decisiones; documentar transferencias/DPA; implementar controles de menores/salud; y pasar la matriz de pruebas. La firma que cierra es la del controller, sin contraparte que la revise.
