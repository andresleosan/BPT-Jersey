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

`sweepSessionQuorumsSchedule` usa `onSchedule` v2 cada cinco minutos (`every 5 minutes`), UTC,
`us-central1` (la región actual de Functions), una instancia/concurrencia, timeout de 540 segundos y tres reintentos,
siguiendo el patrón de `subscriptionExpiryNoticesSchedule`. Los reintentos y ejecuciones
solapadas vuelven al servicio transaccional existente; nunca vuelven a liberar una reserva
ni a crear el evento de una sesión ya cancelada.

La orquestación sin SDK recibe reloj y adaptador. Mantiene la ventana del runner: desde
24 horas antes de la ejecución hasta una hora después. Materializa las ocurrencias semanales
con el servicio del calendario, incluso si nadie abrió esa semana, preservando revisiones y
cancelaciones. Recorre las academias a partir de páginas de 200 series y las sesiones en páginas
de 200. Cada serie se materializa de forma aislada: una revisión malformada, una zona horaria
inválida o una transacción fallida se registra y no bloquea las demás series. Un fallo al leer
las series de una academia tampoco bloquea las demás academias. Incluso si falla la consulta
global de series, se procesan los candidatos ya materializados. Una sesión con error no impide
procesar las siguientes. Si falla una página de candidatos, se conserva el progreso anterior
en el informe. Cualquier fallo registrado provoca reintento en el entry point.

El informe devuelto y los logs `session-quorum-sweep` / `session-quorum-sweep-failed` contienen
`evaluatedSessions`, `cancelledSessions`, `releasedBookings`, `failedSessions`,
`failedMaterialisations`, un `correlationId` UUID aleatorio por ejecución y `failures`.
Cada fallo incluye únicamente `stage`, `code` y `retryable` de una lista permitida. No se registran
IDs de academias, series, sesiones o miembros, documentos, nombres, mensajes, detalles ni causas
del SDK. La excepción pública mantiene texto constante. Los fallos de inicialización se registran
con el mismo esquema de diagnóstico y un UUID, antes de disponer de contadores.

- Etapas: `initialise`, `materialise` (lectura global), `materialise-academy`,
  `materialise-series`, `list-candidates` y `reconcile`.
- `failed-precondition` en `list-candidates` requiere comprobar primero el índice: incluye el
  caso de índice ausente o todavía no listo. El código por sí solo no demuestra que falte un índice;
  no se interpreta ni se registra el mensaje del SDK.
- `permission-denied` / `unauthenticated` requieren revisión de acceso por el operador;
  `malformed-series` identifica datos de recurrencia inválidos. `invalid`, `tenant`, `conflict`,
  `invalid-argument` y `not-found` también se clasifican como no transitorios (`retryable: false`).
- `aborted`, `unavailable`, `deadline-exceeded`, `resource-exhausted` e `internal` son errores de
  infraestructura potencialmente transitorios (`retryable: true`). Los códigos no reconocidos
  se reducen a `unknown`, con `retryable: null`; no se deduce nada del mensaje.
- `retryable` ayuda al diagnóstico; no cambia los tres reintentos configurados. Un fallo persistente
  necesita intervención del operador. El UUID permite unir los logs de una ejecución sin PII;
  cada reintento tiene un UUID nuevo.

Las acciones se auditan en Firestore con actor `system:quorum-sweep`.

Se reutilizan las colecciones privadas actuales: no hay colecciones, reglas, dependencias ni
subpaths de dominio nuevos. `firestore.indexes.json` añade el índice ascendente de grupo de
colecciones `sessions.startAt`, conservando los índices de colección ascendente y descendente.
Los índices de grupo filtrados requieren declaración explícita
([documentación de Firebase](https://firebase.google.com/docs/firestore/query-data/index-overview)).

La recuperación automática está limitada a un día, como el runner anterior. Un corte mayor
requiere revisión del operador. El barrido puede cancelar sesiones pasadas dentro de esa ventana
si siguen `scheduled`: es el comportamiento existente. La cadencia añade hasta aproximadamente
cinco minutos de demora tras el corte de una hora en condiciones normales, por decisión del
operador; los fallos pueden aumentarla. Son **288 invocaciones al día**, **8.640 en un mes de
30 días** (8.064 / 8.352 / 8.928 en meses de 28 / 29 / 31 días), sin contar reintentos. No se ha medido
el rendimiento en producción. Cada ejecución lee las series y las sesiones de esa ventana.

## Despliegue exclusivo del operador

1. Obtener confirmación explícita en el chat para el índice y **solo**
   `sweepSessionQuorumsSchedule`. Revisar antes las sesiones `scheduled` de la ventana anterior,
   sus mínimos y las series semanales: se aplicará la regla al activar la función.
2. Publicar los índices revisados, sin aceptar eliminaciones ajenas, y esperar a que
   `sessions.startAt` con alcance `COLLECTION_GROUP`, ascendente, esté **READY** en Firestore.
   **Precondición bloqueante: no desplegar ni activar la función antes de que termine la
   construcción del índice.** La declaración en Git y las pruebas del emulador no bastan:

   ```bash
   corepack pnpm exec firebase deploy --project bptjersey-f5a25 --only firestore:indexes
   ```

   Comprobarlo en Firebase Console → proyecto correcto → Firestore Database → base de datos
   correspondiente → Indexes → Single field. Abrir la configuración de `sessions` / `startAt` y
   verificar el índice **Ascending** con alcance **Collection group**. Esperar hasta que la
   construcción haya terminado y aparezca **Enabled / READY**, sin estado **Building** ni error;
   actualizar la consola mientras se construye. No confundirlo con los índices de alcance
   Collection ni con la pestaña Composite. Si el estado no está confirmado, detener el despliegue.
   Conservar evidencia del estado y de la base de datos antes de continuar. Véase la
   [gestión de índices y su estado de construcción](https://firebase.google.com/docs/firestore/query-data/indexing).

3. Solo después de confirmar el índice READY, desplegar únicamente la función nueva. El predeploy
   configurado construye el artefacto:

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
   `failedSessions: 0`, `failedMaterialisations: 0` y `failures: []`. Un resumen con todos los
   contadores a cero demuestra ejecución, no una cancelación real. Si hubo cancelaciones, comprobar de forma privada el evento
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
con una sola cancelación, liberación, revisión de aforo y auditoría. También cubre series
malformadas y zonas horarias inválidas sin bloquear otras academias, y un mínimo positivo
alcanzado por reservas confirmadas sin cancelación ni auditoría. El emulador no demuestra
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

Resultado de la revisión P1/P2: build runtime, formato, lint y TypeScript aprobados;
**4.202 pruebas en 384 archivos** aprobadas en la repetición completa. El primer pase tuvo
4.201 aprobadas y un fallo ajeno a quorum en `schedule-security-boundary.test.ts`,
«stores the site coordinates and its audit event together, then clears them»: dos escrituras
pueden generar el mismo ID de auditoría basado en milisegundos. Pasaron después tanto ese
archivo aislado (14 pruebas) como la suite completa, sin modificar ese código.

Suites específicas: `quorum-sweep-job.test.ts` (7), diagnóstico (21), adaptador (1), entry point (8),
servicio existente (8), runner existente (4), repetición semanal (6) y quorum de integración (6).
La regresión de series malformadas, los diagnósticos y la cadencia se comprobaron primero en rojo.

En Docker: **96 pruebas de reglas y 104 de integración aprobadas**; una prueba de backup omitida
porque el emulador no admite lecturas point-in-time. El test de importación PDF compiló Functions
y dominio, pero omitió su comprobación opcional del runner empaquetado al no existir el artefacto
`.firebase-functions` en este worktree. Las seis integraciones de quorum sí se ejecutaron.
Se usó `/root/BPT-Jersey-quorum-review` como ruta del repositorio en la orden Docker anterior,
en la rama `feature/quorum-sweep-schedule`, para aislar actividad concurrente en el checkout original.
