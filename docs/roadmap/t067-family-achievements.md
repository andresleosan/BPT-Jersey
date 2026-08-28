# T067 - Objetivos, logros y resumen familiar

Estado: `revision` (slice de dominio, 2026-08-27).

## Alcance implementado

- Contrato puro para objetivos familiares medibles por clases asistidas y rachas.
- Candidatos de logros con estado `candidate`; no hay otorgamiento automático.
- Resumen read-only de miembros activos.
- Comparación familiar limitada a adultos activos con opt-in explícito.
- Menores excluidos de la comparación de adultos.
- Validación fail-closed de familia, identificadores, definiciones, métricas, targets y opt-in.
- Salidas congeladas para evitar mutación accidental y mantener determinismo.

## Límites y dependencias abiertas

- No se agregaron Firestore writes, callables, UI ni leaderboard público.
- No se persisten logros, auditoría, preferencias ni visibilidad.
- Persistencia tenant-scoped, Rules/Emulator, E2E y permisos de staff siguen pendientes.
- Catálogo definitivo, copy, visibilidad y aprobación humana de logros requieren checkpoint de producto.
- Belt, stripe y promoción permanecen bajo aprobación humana y fuera de este contrato.

## Evidencia

- `achievement-contracts.test.ts`: 6/6.
- Regresión de niveles, progreso y recordatorios: 37/37.
- `@bpt-jersey/domain` typecheck: pasa.
- ESLint focalizado, Prettier y `git diff --check`: pasan.
