# T066 - Biblioteca tecnica y lesson planning

Estado: revision (slice de dominio, 2026-08-27).

## Alcance implementado

- Biblioteca de tecnicas con version y estados draft/published/archived.
- Planes de leccion con referencia exacta a una version de biblioteca.
- Actividades acotadas por tipo, secuencia, duracion y tecnica activa.
- Aprobacion humana: solo un head_coach puede pasar un plan submitted a approved.
- Validacion fail-closed de IDs, estados, fechas, duplicados, limites y referencias.
- Salidas inmutables; no se automatizan belts, stripes ni promociones.

## Limites y dependencias abiertas

- No se agregaron Firestore writes, callables, UI ni fuentes externas.
- Persistencia tenant-scoped, Rules/Emulator, E2E y auditoria siguen pendientes.
- El catalogo definitivo, autoria, copy y workflow operativo requieren checkpoint de producto.
- La aprobacion implementada es de dominio; todavia no existe resolucion RBAC/runtime.

## Evidencia

- lesson-planning-contracts.test.ts: 5/5.
- Regresion de Levels, progreso y recordatorios: 42/42.
- @bpt-jersey/domain typecheck: pasa.
- ESLint focalizado, Prettier y git diff --check: pasan.
