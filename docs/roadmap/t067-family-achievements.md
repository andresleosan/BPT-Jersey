# T067 - Objetivos, logros y resumen familiar

Estado: revision (slice de dominio, persistencia read-only y cliente/panel administrativo, 2026-08-31).

## Alcance implementado

- Contrato puro para objetivos familiares medibles por clases asistidas y rachas.
- Candidatos de logros con estado `candidate`; no hay otorgamiento automático.
- Resumen read-only de miembros activos.
- Comparación familiar limitada a adultos activos con opt-in explícito.
- Menores excluidos de la comparación de adultos.
- Validación fail-closed de familia, identificadores, definiciones, métricas, targets y opt-in.
- Salidas congeladas para evitar mutación accidental y mantener determinismo.

## Persistencia y acceso implementados en este corte

- Catálogo canónico interno tenant-scoped en `familyGoals` y `familyAchievements`, con schema version `1`, validación fail-closed e idempotencia.
- Snapshots derivados tenant-scoped en `familyAchievementSnapshots`; cada snapshot conserva objetivos/progreso, candidatos y comparación de adultos permitida.
- Auditoría atómica append-only en `auditEvents` con acción `family.achievements.generated`; replay divergente falla cerrado.
- Callable `getFamilyAchievementSummary`: read-only para `owner`, `administrator` y `headCoach`; payload exige únicamente `familyId`.
- Firestore Rules mantienen deny-by-default para catálogo, snapshots y auditoría; no hay acceso directo desde navegador.
- No hay leaderboard público, otorgamiento automático, promoción, premios, pagos, datos reales ni migración productiva.

## Límites y dependencias abiertas

- La generación del snapshot sigue siendo un servicio interno; falta conectar una fuente de progreso real y un scheduler/runner aprobado.
- Cliente web validado y panel administrativo read-only implementados; falta E2E de callable autenticada y el slice queda en revisión hasta cerrar esa evidencia.
- Catálogo definitivo, copy, visibilidad y aprobación humana de logros requieren checkpoint de producto.
- No se agregan índices compuestos: la lectura está acotada a un snapshot por familia y el catálogo se valida con límites de 200 elementos.
- Rollback: detener el export de la callable y retirar únicamente documentos T067 del Emulator/entorno de prueba; cualquier borrado productivo exige backup verificado y confirmación explícita.

## Evidencia

- Dominio + auditoría: 26/26 focales.
- Stores y callable: 12/12 focales Node; 38/38 pruebas focales T067 en total.
- Cliente/panel web: 9/9 pruebas focales y suite completa de web 72 archivos/318 pruebas; cliente valida el payload y resumen con parser de dominio, y la UI no muestra identificadores internos ni ofrece escrituras.
- Rules/Emulator: 6/6 con Firestore Emulator y JDK 21.
- Typecheck de `@bpt-jersey/domain` y `@bpt-jersey/functions`: pasan.
- Unitarias globales: 179 archivos, 1254/1254 pruebas; Rules globales: 11 archivos, 84/84; runtime deploy 3/3; typecheck, ESLint, Prettier y git diff --check pasan.
