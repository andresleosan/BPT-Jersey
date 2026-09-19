# C4 / T024V2 — barrido programado de quorum

Estado: implementación local; **sin desplegar**. C4 sigue `en-progreso` hasta que el operador
confirme el despliegue y conserve evidencia de una ejecución satisfactoria en producción.

## Regla y comportamiento existente

La decisión 3 del BRIEF está recogida en `docs/archive/tasksv2.md`, fila T024V2, y en
`docs/archive/tasks.md`, sección T110: cuatro reservas confirmadas como mínimo por defecto,
una hora antes del inicio; se respeta el `minParticipants` de la sesión. Si no se alcanza,
se cancela la sesión y se avisa in-app a quienes reservaron.

Ya existían `decideQuorumSweep`, `createQuorumSweepService`, el callable de staff
`reconcileSessionQuorum` y un runner manual exclusivo del emulador. Faltaba el disparador
automático exportado. No se introduce otra política de cancelación ni financiera:

- La transacción cancela la sesión y las reservas confirmadas, aumenta la revisión de aforo
  y crea un único evento `session.quorum.cancelled`, con ID determinista. Las reservas conservan
  el motivo, la hora y el actor; el evento identifica la cancelación de la sesión que las libera.
- `listClientReminders` deriva el aviso de la sesión cancelada y las reservas existentes; no se
  añade una cola de mensajes. El trigger administrativo existente consume el mismo evento
  de auditoría mediante un ID determinista.
- Este flujo no cobra, reembolsa ni anula facturas. La propuesta por cancelación tardía y su
  retirada son trabajo pendiente de T007V2; C4 no las implementa.
- El corte existente admite reservas exactamente a los 60 minutos. El barrido cancela cuando
  quedan **menos** de 60 minutos. No se cambia ese límite compartido con las reservas.

## Implementación

`sweepSessionQuorumsSchedule` usa `onSchedule` v2 cada minuto, UTC, `us-central1` (la región
actual de Functions), una instancia/concurrencia, timeout de 540 segundos y tres reintentos,
siguiendo el patrón de `subscriptionExpiryNoticesSchedule`. Los reintentos y ejecuciones
solapadas vuelven al servicio transaccional existente; nunca vuelven a liberar una reserva
ni a crear el evento de una sesión ya cancelada.

La orquestación sin SDK recibe reloj y adaptador. Mantiene la ventana del runner: desde
24 horas antes de la ejecución hasta una hora después. Materializa las ocurrencias semanales
con el servicio del calendario, incluso si nadie abrió esa semana, preservando revisiones y
cancelaciones. Recorre las series y las sesiones en páginas de 200. Una sesión con error no
impide procesar las siguientes; el resumen marca el fallo y el entry point solicita reintento.
Un fallo al preparar las series o consultar una página también provoca reintento.

El log `session-quorum-sweep` solo contiene `evaluatedSessions`, `cancelledSessions`,
`releasedBookings` y `failedSessions`. No contiene identificadores, nombres ni errores del SDK.
`session-quorum-sweep-failed` indica un fallo y la excepción pública tiene texto constante.
Las acciones se auditan en Firestore con actor `system:quorum-sweep`.

Se reutilizan las colecciones privadas actuales: no hay colecciones, reglas, dependencias ni
subpaths de dominio nuevos. `firestore.indexes.json` añade el índice ascendente de grupo de
colecciones `sessions.startAt`, conservando los índices de colección ascendente y descendente.
Los índices de grupo filtrados requieren declaración explícita
([documentación de Firebase](https://firebase.google.com/docs/firestore/query-data/index-overview)).

La recuperación automática está limitada a un día, como el runner anterior. Un corte mayor
requiere revisión del operador. El barrido puede cancelar sesiones pasadas dentro de esa ventana
si siguen `scheduled`: es el comportamiento existente. La cadencia añade hasta aproximadamente
un minuto de demora en condiciones normales; los fallos pueden aumentarla. No se ha medido el
rendimiento en producción. Cada ejecución lee las series y las sesiones de esa ventana.

## Despliegue exclusivo del operador

1. Obtener confirmación explícita en el chat para el índice y **solo**
   `sweepSessionQuorumsSchedule`. Revisar antes las sesiones `scheduled` de la ventana anterior,
   sus mínimos y las series semanales: se aplicará la regla al activar la función.
2. Publicar los índices revisados, sin aceptar eliminaciones ajenas, y esperar a que
   `sessions.startAt` con alcance `COLLECTION_GROUP`, ascendente, esté listo en Firestore:

   ```bash
   corepack pnpm exec firebase deploy --project bptjersey-f5a25 --only firestore:indexes
   ```

3. Desplegar únicamente la función nueva. El predeploy configurado construye el artefacto:

   ```bash
   FUNCTIONS_DISCOVERY_TIMEOUT=300000 corepack pnpm exec firebase deploy \
     --project bptjersey-f5a25 --only functions:sweepSessionQuorumsSchedule
   ```

   No usar `--only functions` ni un deploy global. **No desplegar `selfCheckIn`**. La tarea de
   Cloud Scheduler se crea con la función; no crear otro job ni una URL pública manualmente.
   Véase [programación v2 de Firebase](https://firebase.google.com/docs/functions/schedule-functions).

4. Esperar una ejecución natural y consultar:

   ```bash
   corepack pnpm exec firebase functions:log --project bptjersey-f5a25 \
     --only sweepSessionQuorumsSchedule
   ```

   Conservar fecha UTC, revisión desplegada y el resumen `session-quorum-sweep` con
   `failedSessions: 0`. Un resumen con todos los contadores a cero demuestra ejecución, no
   una cancelación real. Si hubo cancelaciones, comprobar de forma privada el evento
   `session.quorum.cancelled` y su actor; no copiar documentos de miembros a evidencias públicas.
5. Solo entonces cerrar C4 según las reglas de BACKLOG.md. Si falla, conservar el fallo y
   dejar C4 abierto. Una pausa del job requiere decisión del operador; pausar no revierte
   cancelaciones ya confirmadas ni justifica reabrir reservas automáticamente.

## Verificación local

Ejecutar el gate solicitado desde la raíz:

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm format:check && \
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
```

Las reglas y las integraciones deben ejecutarse con fixtures sintéticas, proyecto
`demo-bpt-jersey` y Docker `bpt-emu:local --network none`, sin montar credenciales.
La prueba `qa/integration/quorum-sweep-schedule.test.ts` cubre recurrencia no consultada,
límite exacto de reserva, paginación con fechas iguales, aislamiento de tenant y carreras
con una sola cancelación, liberación, revisión de aforo y auditoría. El emulador no demuestra
que el índice de producción esté construido ni que Cloud Scheduler haya ejecutado el job.

Comando utilizado en este VPS, montando únicamente el repositorio y las cachés de herramientas:

```bash
docker run --rm --network none \
  --mount type=bind,src=/root/BPT-Jersey,dst=/root/BPT-Jersey \
  --mount type=bind,src=/root/.cache/firebase/emulators,dst=/root/.cache/firebase/emulators,readonly \
  --mount type=bind,src=/root/.cache/node,dst=/root/.cache/node,readonly \
  -w /root/BPT-Jersey -e COREPACK_ENABLE_NETWORK=0 \
  -e npm_config_verify_deps_before_run=false -e BPT_TEST_INTEGRATION=true \
  bpt-emu:local bash -lc 'corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,database "corepack pnpm exec vitest run --project rules --project firestore-integration"'
```

Resultado local de `78b8b8b`: build runtime, formato, lint, TypeScript y 4.178 pruebas en 382
archivos aprobadas. Suites específicas: `quorum-sweep-job.test.ts` (7),
`quorum-sweep-schedule.test.ts` del entry point (6), servicio existente (8), runner existente (4)
y `qa/integration/quorum-sweep-schedule.test.ts` (5).

En Docker: 96 pruebas de reglas y 103 de integración aprobadas; una prueba de ensayo
de backup omitida porque el emulador no admite lecturas point-in-time. Las cinco integraciones
de quorum se ejecutaron y aprobaron.
