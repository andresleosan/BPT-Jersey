# Plan de avance v2/v3

Estado: borrador de preimplementacion; no cambia el alcance aprobado del MVP ni autoriza produccion.

Actualizado: 2026-08-27 (America/Bogota).

## Criterio

La puntuacion RICE es preliminar y relativa, porque todavia no hay datos de uso de tres meses ni
presupuesto aprobado. Se usa para ordenar el discovery, no para aprobar funcionalidades. Alcance e
impacto van de 1 a 5; confianza va de 1 a 5; esfuerzo inverso va de 1 a 5. Puntaje = promedio.

## Orden recomendado de discovery e implementacion

| Orden | Tarea | Capacidad | RICE preliminar | Motivo y condicion |
|---:|---|---|---:|---|
| 1 | T060 | Booking avanzado, waitlists, creditos y reservas recurrentes | 3.75 | Amplia la operacion central ya validada en T027. Requiere politica de cupos, prioridad, expiracion de creditos y recurrencia. |
| 2 | T063 | Autoservicio ampliado para tutores y adultos | 3.75 | Reduce trabajo administrativo y usa roles existentes. Requiere delimitar acciones de tutor, adulto y staff. |
| 3 | T062 | Alertas de retencion y automatizacion CRM | 3.25 | Aprovecha T043/T044 aprobadas en alcance sintetico. Empezar solo con proyecciones in-app y reglas auditables. |
| 4 | T067 | Goals, achievements y resumen familiar ampliado | 3.25 | Extiende progreso y rachas existentes. Requiere privacidad, opt-in y definicion de logros. |
| 5 | T064 | Notificaciones externas automatizadas | 2.75 | Tiene valor operativo, pero requiere proveedor, consentimiento, preferencias y costos. |
| 6 | T066 | Biblioteca tecnica y lesson planning avanzado | 3.00 | Aumenta profundidad del producto. Requiere fuente de contenido, versionado y aprobacion del coach. |
| 7 | T065 | Asistencia offline y resolucion de conflictos | 2.50 | Mejora resiliencia en tatami, pero requiere modelo de dispositivo, cola local y politica de conflicto. |
| 8 | T061 | Automatizacion avanzada de cobros y membresias | 2.50 | Requiere resolver T010/T034/T035 y definir reglas financieras antes de codigo. |
| 9 | T070 | Referidos, privadas, competencias y retail | 2.50 | Potencial comercial, pero mezcla ofertas, pagos y operacion; requiere separar slices. |
| 10 | T069 | Comunidad moderada | 2.25 | Requiere modelo de moderacion, safeguarding, reportes y retencion de contenido. |
| 11 | T068 | Aplicaciones nativas iOS/Android | 1.75 | No hay evidencia de necesidad antes de validar el producto web; requiere decision de plataforma. |
| 12 | T071 | Analytics, IA, multiacademia, white label y SaaS | 1.50 | Iniciativa de escala; requiere metrica base, arquitectura, costos y estrategia comercial. |

## Trabajo que puede adelantarse sin T010/T011

### T060 - paquete de discovery

- Definir contratos de waitlist, promocion automatica y cancelacion sin cambiar todavia Firestore.
- Definir credito: emision, motivo, saldo, expiracion, uso parcial, reverso y auditoria.
- Definir recurrencia: zona horaria Jersey, capacidad, cancelacion y conflictos con reservas existentes.
- Preparar casos de prueba de dominio con fixtures sinteticos.
- No activar cobros ni modificar el booking MVP hasta checkpoint humano.

### T063 - paquete de discovery

- Inventariar acciones de tutor y adulto sobre perfil, membresia, booking, pagos manuales y documentos.
- Confirmar que un tutor no puede actuar sobre menores fuera de su relacion activa.
- Preparar matriz RBAC y escenarios responsive con datos sinteticos.
- No ampliar permisos ni exponer datos reales sin T011 y revision de seguridad.

### T062 - paquete de discovery

- Definir triggers idempotentes y explicables para riesgo de abandono.
- Entregar primero una bandeja in-app tenant-scoped para staff.
- Diferir email/SMS y cualquier envio externo hasta resolver T046, proveedor y consentimiento.

### T067/T066/T065 - paquetes de discovery

- T067: catalogar logros, opt-in familiar, visibilidad y auditoria.
- T066: definir versionado de tecnicas, autoria del coach y workflow de aprobacion.
- T065: definir cola local, idempotencia, reloj confiable y resolucion fail-closed.

## Estado del slice T060 (2026-08-27)

- Se implementaron contratos de dominio para waitlist y creditos en packages/domain/src/schedule/advanced-booking-contracts.ts.
- La validacion es estricta y fail-closed: entradas desconocidas, identificadores invalidos, timestamps incompatibles y saldos imposibles se rechazan.
- Se cubren estados waiting/offered/accepted/expired/cancelled, consumo parcial, agotamiento y reverso acotado sin mutar el balance.
- Evidencia: 9/9 pruebas focalizadas, typecheck de @bpt-jersey/domain, Prettier y git diff --check pasan.
- No se agregaron callables, UI, Firestore, migraciones, cobros ni datos reales. T060 pasa a revision; la promocion automatica, el asignador de posiciones y las politicas de credito siguen pendientes de checkpoint.

## Estado del slice T063 (actualizado 2026-08-28)

- Se corrigio una brecha de autorizacion en agenda: guardian ya no puede usar un `studentId` arbitrario.
- El guard revalida tenant, relacion guardian activa y temporalmente vigente, familia activa con contacto principal coincidente y estudiante menor activo; ante errores de resolucion o reloj invalido falla cerrado.
- Adultos siguen limitados a su propio estudiante. Staff conserva el flujo existente. Guardian puede gestionar booking, cancelacion, consultas de booking/asistencia/historial y checkout unicamente del menor vinculado; check-in delegado permanece denegado.
- Rules niega acceso directo a todas las colecciones de agenda, incluido `checkouts`, para todos los roles cliente. El E2E usa login real de Auth Emulator y callables controlados para verificar proyeccion familiar redacted, ausencia de acceso directo a Firestore/RTDB, denegacion del admin shell y layout desktop/movil.
- Evidencia: unitarias focalizadas 23/23, Firestore Emulator 2/2, Rules completa 64/64, build web, E2E responsive 2/2 y estabilidad 10/10; typecheck Functions, ESLint, Prettier, audit sin high/critical y `git diff --check` pasan.
- Gate global: `corepack pnpm verify:mvp` pasa con 1122/1122 unitarias, 64/64 Rules, carga sintetica 240/240 sin fallos (p95 28 ms) y smoke E2E 5 aprobadas/1 omitida esperada.
- No se agregaron colecciones, indices, migraciones, secretos, proveedores, cobros ni datos reales. T063 pasa a revision; las decisiones de tutor secundario y checkout adulto siguen pendientes y permanecen denegadas/fail-closed.

## Estado del slice T062 (actualizado 2026-08-28)

- Se extendio el contrato puro con una bandeja Firestore tenant-scoped: persistencia transaccional idempotente, conflicto fail-closed ante reuso alterado, lotes y lecturas limitados a 200 y fechas de calendario estrictas.
- `listRetentionAlerts` es read-only, acepta payload nulo, deriva tenant del actor y autoriza solo owner/administrator. La proyeccion omite IDs internos, tenant, contactos y deduplicacion; Rules niega todo acceso directo cliente.
- `/admin/retention` entrega estados loading/error/empty y una bandeja responsive sin mutaciones. El E2E real usa Auth, Functions y Firestore Emulator; el artefacto de Functions se corrigio para compilar desde la raiz adecuada y exporta el callable nuevo.
- Evidencia focalizada: servicio/callable 15/15, cliente 8/8, store Emulator 1/1, Rules 71/71, E2E sintetico 2/2, E2E real 2/2, runtime 2/2, typecheck/build/lint y audit sin high/critical. Gate global: 1139/1139 unitarias, 71/71 Rules, carga 240/240 sin fallos (p95 32 ms) y smoke E2E 5 aprobadas/1 omitida esperada.
- No se agregaron productor automatico, auditoria persistida, asignacion/cierre, App Check, rate limit persistente, CRM externo, mensajes, datos reales, credenciales, gasto, migracion ni despliegue. T062 pasa a revision y sigue bloqueada para produccion por T011/T057.

## Estado del slice T067 (2026-08-27)

- Se implementó un contrato puro para objetivos familiares, candidatos de logros y resumen de progreso en packages/domain/src/levels/achievement-contracts.ts.
- Los objetivos y candidatos usan únicamente clases asistidas y rachas; un logro solo queda como `candidate` y nunca otorga belt, stripe o promoción automáticamente.
- El resumen excluye miembros inactivos. La comparación familiar solo incluye adultos activos con `adultComparisonOptIn`; los menores nunca se exponen en esa comparación.
- La entrada exige familia consistente, identificadores y definiciones válidas, métricas no negativas, targets acotados y opt-in prohibido para menores; la salida es inmutable y determinista.
- Evidencia: 6/6 pruebas focalizadas y 37/37 pruebas de regresión, typecheck de @bpt-jersey/domain, ESLint, Prettier y `git diff --check` pasan.
- No se agregaron Firestore writes, callables, UI, leaderboard público, auditoría persistida, credenciales, pagos ni datos reales. T067 pasa a revision; quedan pendientes persistencia tenant-scoped, Rules/Emulator, E2E, auditoría y checkpoint de producto sobre catálogo/visibilidad.
## Estado del slice T066 (2026-08-27)

- Se implemento un contrato puro para biblioteca tecnica versionada y planes de leccion en packages/domain/src/levels/lesson-planning-contracts.ts.
- Cada plan referencia libraryId/libraryVersion exactos y solo puede usar tecnicas activas de esa version; las definiciones invalidas, duplicadas o fuera de version fallan cerrado.
- La transicion a approved exige plan submitted, staffRole head_coach, staffId y timestamp validos. No se automatizan belts, stripes ni promociones.
- Evidencia: 5/5 pruebas focalizadas y 42/42 de regresion de Levels/progreso/recordatorios, typecheck de @bpt-jersey/domain, ESLint, Prettier y git diff --check pasan.
- No se agregaron Firestore writes, callables, UI, fuentes externas, auditoria persistida, credenciales, pagos ni datos reales. T066 pasa a revision; quedan pendientes persistencia tenant-scoped, Rules/Emulator, E2E, auditoria y checkpoint de producto.
## Estado del slice T065 (2026-08-27)

- Se implemento un contrato puro para eventos de asistencia offline y reconciliacion en packages/domain/src/attendance/offline-contracts.ts.
- Los reintentos exactos son idempotentes; un eventId con payload diferente o un conflicto de misma sesion/estudiante/tipo se reporta y no se resuelve silenciosamente.
- Se validan IDs, tipo de evento, fechas y orden de reloj; la salida es inmutable y determinista.
- Evidencia: 6/6 pruebas focalizadas y 48/48 de regresion de dominio, typecheck de @bpt-jersey/domain, ESLint, Prettier y git diff --check pasan.
- No se agregaron red, Firestore writes, UI, persistencia de cola, migraciones, credenciales ni datos reales. T065 pasa a revision; quedan adaptador de dispositivo, politica operativa de conflictos, persistencia tenant-scoped, Rules/Emulator y E2E.
## Estado del slice T064 (2026-08-27)

- Se implemento una politica pura de elegibilidad de notificaciones en packages/domain/src/delivery/notification-policy.ts, complementaria a la frontera provider-independent de T046.
- La decision es tenant/audience scoped y cruza proposito, canal, enabled y consentimiento; email/sms requieren consentimiento granted y in-app no representa una llamada externa.
- Preferencia ausente, disabled o withdrawn queda como skipped explicable. La salida no contiene contactos, mensajes, proveedor ni credenciales.
- Evidencia: 6/6 pruebas focalizadas y 58/58 de regresion de delivery/offline/Levels/progreso/recordatorios, typecheck de @bpt-jersey/domain, ESLint, Prettier y git diff --check pasan.
- No se agregaron red, Firestore writes, UI, reintentos, proveedor, credenciales ni gasto. T064 pasa a revision; quedan persistencia, RBAC/runtime, Rules/Emulator, E2E, seleccion de proveedor y limites de costo.
## Gates que siguen fuera de este avance

- T061 y cualquier checkout, webhook o automatizacion financiera siguen dependiendo de T010/T034/T035.
- T064 no puede enviar mensajes reales; T011 y el proveedor de mensajeria siguen abiertos.
- T068 y T071 requieren decision de producto y arquitectura antes de construir.
- Ninguna tarea de este documento permite despliegue, migracion, credenciales, datos reales o gasto.

## Checkpoint requerido

Antes de implementar codigo de cualquiera de estas tareas, el operador debe confirmar la tarea,
el slice exacto, las reglas de negocio y los criterios de aceptacion. El resultado de este documento
es discovery priorizado; T060 queda en revision por este slice y T061-T071 permanecen pendientes en el ledger.
