# T066 - Biblioteca tecnica y lesson planning

Estado: revision (slice de dominio, persistencia tenant-scoped, Rules y RBAC runtime, 2026-08-31).

## Alcance implementado

- Biblioteca de tecnicas con version y estados draft/published/archived.
- Planes de leccion con referencia exacta a una version de biblioteca.
- Actividades acotadas por tipo, secuencia, duracion y tecnica activa.
- Aprobacion humana: solo un head_coach puede pasar un plan submitted a approved.
- Validacion fail-closed de IDs, estados, fechas, duplicados, limites y referencias.
- Salidas inmutables; no se automatizan belts, stripes ni promociones.

## Limites y dependencias abiertas

- Se agregaron Firestore writes internos, callables protegidos, UI administrativa staff y Rules deny-by-default; no se agregaron fuentes externas ni datos reales.
- Persistencia tenant-scoped, Rules/Emulator, RBAC runtime, auditoria atomica y UI estan implementados y verificados; el E2E autenticado en loopback tambien pasa.
- El catalogo definitivo, autoria, copy y workflow operativo requieren checkpoint de producto; la propuesta esta en docs/roadmap/t066-product-checkpoint.md.
- La aprobación de dominio queda expuesta solo por callable a headCoach; owner, administrator y coach no pueden aprobar.

## Evidencia

- lesson-planning-contracts.test.ts: 5/5.
- Store T066: 4/4 (in-memory + adapter Firestore simulado); callables: 6/6; Rules/Emulator: 6/6; runtime deploy: 3/3.
- Regresion de Levels, progreso y recordatorios: 42/42.
- @bpt-jersey/domain typecheck: pasa.
- AuditorÃ­a persistida: evento lesson.plan.approved creado atÃ³micamente junto al cambio de estado y validado en el test Firestore.
- UI: cliente validado y panel staff en /admin/lesson-plans; E2E autenticada T066 en Emulator: 1/1 pasa con headCoach.
- ESLint focalizado, Prettier y git diff --check: pasan.
