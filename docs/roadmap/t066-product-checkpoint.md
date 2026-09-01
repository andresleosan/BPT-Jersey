# T066 — Checkpoint de producto

Estado: propuesta pendiente de confirmación humana.

## Propuesta de contenido v1

- Biblioteca publicada: `t066-core`, versión `1`.
- Unidad inicial: una técnica principal por plan, con duración y orden explícitos.
- Flujo: `draft` → `submitted` → `approved`; solo `headCoach` puede aprobar.
- La aprobación conserva la versión de biblioteca usada por el plan y genera el evento append-only `lesson.plan.approved`.

El contenido usado en pruebas (`Guard pass` y referencias `t066-*`) es sintético. No debe presentarse como currículo definitivo ni copiarse a una academia sin revisión del responsable técnico/deportivo.

## Decisiones que faltan

1. Responsable que valida la biblioteca y sus etiquetas visibles.
2. Técnicas, duraciones y secuencias definitivas para la primera academia.
3. Si `owner` y `administrator` deben conservar solo lectura o también recibir una acción de revisión explícita.
4. Evidencia autenticada E2E ejecutada por el operador con emuladores locales y variables sintéticas.

## Criterio de cierre

T066 podrá pasar a `aprobada` cuando exista confirmación del contenido y del flujo, el E2E autenticado pase en loopback, y se conserve evidencia de auditoría y pruebas de Rules. Hasta entonces permanece en `revision`.
