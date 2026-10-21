# Paquete de decisión: directorio de miembros lleno (400/400)

Fecha: 2026-10-20 (UTC). Estado: **Decisión A aprobada por el operador el 2026-10-21; enmienda en ADR-009 (Enmienda
2026-10-21). T097 no ejecutado.** Las
lecturas de solo lectura dentro del alcance ya autorizado no necesitan una aprobación nueva por
lectura. Cada despliegue, transición de estado o escritura necesita la autorización explícita del
operador en el chat, por separado. No se ha consultado producción para escribirlo.

## 1. Situación

Última lectura diagnóstica comunicada al coordinador (no es una medición nueva de esta sesión):
`globalLegacyReadEliminated=false`, `rollbackEligibleStudentCount=400`, `rollbackCapacityLimit=400`,
`stateRevision=794`.

Consecuencia: todo camino que admite un `student` nuevo (aprobar una inscripción, alta desde la
oficina, alta de un menor por su tutor) cuenta contra el límite en su propia transacción y, a 400,
falla sin escribir nada (ADR-009, «Mientras globalLegacyReadEliminated=false…»). Nadie nuevo puede
entrar hasta que se resuelva.

Lo que cambia con el fix de este worktree (pendiente de despliegue, ver §4): la oficina ve
`directory_capacity_exhausted` con instrucciones claras, la solicitud queda aparcada
(`approval-failed`) y no vuelve al solicitante, y reaprobarla después usa la misma clave de
aprobación fijada en la solicitud. Eso está probado solo con dobles en memoria
(`enrolment-approval-service.test.ts`, `enrolment-request-concurrency.test.ts`). Aquí no se han
probado el escritor canónico real, la creación de alumnos ni Auth, así que no es una garantía de
aprobación completa sin duplicados.

## 2. Por qué existe el límite y por qué hoy no protege nada ejecutable

- ADR-009 y `docs/data/migrations/member-directory-v1.md` (§«Required proof before global
  legacy-read elimination») reservan 400 identidades para el protocolo `legacy-projection-v1`: la
  promesa de poder volver al lector legacy con una proyección privacy-safe acotada. A 400 se para
  hasta que T097 desactive ese protocolo o un rollback-v2 aprobado lo sustituya.
- **Hallazgo:** el ejecutor de rollback-v1 no existe. `rollback-projection`, `rollback-readonly` y
  `legacy-rollback-v1` solo aparecen como nombres de tupla y de operación en los contratos; no hay
  materialización de proyecciones ni lector de emergencia `legacy-rollback-directory-v1` en
  `apps/functions/src`. El límite reserva capacidad para un mecanismo que no se puede ejecutar.
- El contador sube solo por el alta canónica, incluidas las altas de la migración S1, y su cadena
  firmada solo avanza: ni revertir S1 lo baja (`member-unification-s1-runbook.md`, «Vuelta atrás de
  emergencia»).

## 3. Lo que no se hará

Ninguna de estas acciones arregla el problema, y cada una incumple el ADR-009:

- Subir el literal 400. Es `z.literal(400)` en `member-directory-contracts.ts`, y la promesa que
  representa no existe por encima.
- Poner el contador a cero o bajarlo. El guard no restaurable `memberDirectoryRestoreGuards/{academyId}`
  encadena con HMAC el máximo admitido; un decremento rompe la cadena y bloquea todo el directorio.
- Desactivar o saltar el guard, o marcar la migración como completada sin las pruebas.
- Poner `globalLegacyReadEliminated=true` por un camino distinto de T097. Desde este worktree,
  `advanceMemberDirectoryControlPlane` lo impide: solo la transición `global-legacy-eliminate` puede
  activar el marcador.

## 4. Lo que hay preparado y por qué no es una solución operativa

| Pieza (worktree, sin efecto en producción)                                 | Qué resuelve                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Razón tipada `directory_capacity_exhausted` y mensaje para la oficina      | Error accionable. La solicitud se aparca y no se pierde.                        |
| Log `enrolment-approval-failed` saneado (lista blanca de causas y códigos) | Diagnóstico sin datos personales.                                               |
| `planMemberDirectoryGlobalLegacyElimination` + `listUnmet…Preconditions`   | Calcula el siguiente estado de T097 y nombra lo que falta. **No escribe nada.** |
| Vínculo marcador ↔ `global-legacy-eliminate` en el plano de control        | Impide activar el marcador por otro camino.                                     |

La función pura no es T097. T097, tal como está diseñado, es una operación con plan firmado,
aprobación consumida y una única transacción que mueve estado, guard, evento, atestación y
auditoría a la vez. Esa operación no existe.

## 5. Componentes que faltan para T097 (inventario honesto)

| #   | Componente (member-directory-v1.md / ADR-009)                                                                                                                                                                    | Estado en el código                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Lector de preparación de solo lectura: estado, cabecera y evento del guard con verificación MAC, operaciones y conteos                                                                                           | Falta. `member-unification-s1-report.mjs` solo da lector, contador y límite.                         |
| 2   | Registro versionado de dependencias legacy y `zeroDependencyProofMac` (imports, inventario en ejecución directo y de collection-group, callables, jobs, rutas)                                                   | Falta.                                                                                               |
| 3   | Historial anidado (evaluaciones, graduaciones, bajas médicas) migrado o adaptado a colecciones directas con backup                                                                                               | Sin medir. Es un prerrequisito (§7, R6).                                                             |
| 4   | Planificador: recibo `memberDirectoryMigrations` en `planned` con `operationType=global-legacy-elimination` y `planMac` (cutover, revisión, baseline, hashes de código y esquema, prueba, backup, I4, caducidad) | Falta. El tipo de operación y su paso `planned → completed` existen en los contratos.                |
| 5   | Aprobación exacta `global-legacy-eliminate` (emitir, caducar, consumir una sola vez)                                                                                                                             | Falta. Solo existe el nombre de la transición.                                                       |
| 6   | Verificación fresca de la atestación I4 del ensayo de restore backup v3 y su consumo en `memberDirectoryRestoreAttestationConsumptions/{attestationId}`                                                          | El ensayo y la atestación backup v3 existen (`apps/functions/src/data/backup-v3-*`). El consumo, no. |
| 7   | Transacción del marcador: revalidar todo, consumir aprobación y atestación, avanzar guard y evento, marcador a true, protocolo `disabled`, operación `completed`, auditoría. Repetición exacta sin efecto.       | Solo existe el primitivo de estado y guard (`advanceMemberDirectoryControlPlane`).                   |
| 8   | CLI de operador con dry-run, runbook y la matriz RED de T097 (member-directory-v1.md §«Required RED matrix»)                                                                                                     | Falta.                                                                                               |
| 9   | Enmienda del ADR-009 (§6)                                                                                                                                                                                        | Falta.                                                                                               |

## 6. Alternativas

| Opción                                                                                                                                        | Qué consigue                                                                                                                   | Coste y riesgo                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. T097**: eliminación global de lecturas legacy                                                                                            | Quita el bloqueo de forma permanente y coherente con el ADR. No toca los datos de `members` (el borrado sigue en T011).        | Construir los componentes 1 a 8 y aprobar la enmienda. **Irreversible en v1**: el marcador nunca vuelve a false y el guard no restaurable (fuera del backup) registra que se activó. Restaurar un backup no deshace T097 ni puede asumirse como reversión; no hay recuperación validada (§10). |
| **B. rollback-v2**: un protocolo de vuelta atrás que exista de verdad y escale, por ejemplo una proyección por chunks con el runner existente | Conserva una vía real hacia el lector legacy y su capacidad deja de depender de un 400 fijo.                                   | ADR nuevo, diseño, implementación y ensayo. Es lo que debía ser rollback-v1 y además escalado. Más trabajo que A, y el bloqueo sigue mientras tanto.                                                                                                                                           |
| **C. Mantener el guard** (estado actual, con el fix de §4 desplegado)                                                                         | Nada se rompe. Las solicitudes se aparcan y se reaprueban después con la misma clave fijada (probado solo con dobles; ver §1). | El negocio no puede admitir alumnos nuevos hasta que A o B estén listos.                                                                                                                                                                                                                       |

**Recomendación:**

1. Ahora: C. Desplegar el fix de §4 con autorización.
2. No elegir todavía entre A y B. La decisión queda condicionada a:
   - el inventario de dependencias legacy y del historial anidado (R5, R6);
   - pruebas de restore y de una recuperación compatible con el marcador y el guard monótonos, sin bajarlos (R7);
   - el alcance que se apruebe.

   Que rollback-v1 no exista no convierte A en una opción sin riesgo: A es irreversible y hoy no tiene recuperación validada. B conserva una vuelta atrás real a cambio de más trabajo.

La enmienda del ADR-009 que exigiría A debe decidir explícitamente:

- **Gate 6.** El ADR exige «rollback ensayado» para producción, y rollback-v1 no se puede ensayar. La enmienda debe sustituirlo para T097 por «restore backup v3 ensayado + atestación I4» o mantener la exigencia y elegir B. Un ensayo de restore prueba la copia de seguridad; no deshace T097.
- **Cutover.** El precondicionante «completed directory-forward» supone un recibo de forward por lotes. Con la enmienda S1 (2026-09-19) las altas se hicieron por decisiones y `createAdult`, así que hay que fijar qué recibo cuenta como cutover.
- **Modelo de evidencia.** Hay que aprobar el modelo de evidencia y su caducidad.

## 7. Prerrequisitos de solo lectura (antes de decidir, sin escribir nada)

Son lecturas: dentro del alcance de lectura ya autorizado no necesitan una aprobación nueva por
lectura. Mientras no exista el componente 1, solo R1 tiene herramienta: `qa/scripts/member-unification-s1-report.mjs`, ya existente y de solo lectura, que
imprime solo contadores. No se ha ejecutado para este documento.

| ID  | Qué leer                                                                                                             | Valor esperado                                                                                                                                                                                                                                                                                                                                                    | Si no coincide                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| R1  | `academies/{academyId}/memberDirectoryStates/current`                                                                | `readerVersion=canonical-v1`, `directoryWriteMode=canonical-v1`, `freezeStatus=open`, `operationPhase=idle`, `identityKeyCoverage=complete`, `globalLegacyReadEliminated=false`, `rollbackProtocolVersion=legacy-projection-v1`, contador 400, límite 400, sin operación, lease ni deadline, `lastCommittedChunkNo=0`. Anotar `stateRevision` (último dato: 794). | PARAR.                                                                          |
| R2  | `memberDirectoryRestoreGuards/{academyId}` y su `events/{stateRevision}`                                             | Revisión máxima = `stateRevision` de R1, marcador nunca activado, máximo admitido 400, evento presente con la cadena MAC válida. La verificación necesita el secreto del servidor y solo puede hacerla el componente 1.                                                                                                                                           | PARAR. Cadena rota o divergente = incidente, no capacidad.                      |
| R3  | Conteo (agregación) de `academies/{academyId}/students`                                                              | 400. El ADR dice que con el marcador en false coincide con el contador, porque no hay borrado normal.                                                                                                                                                                                                                                                             | PARAR e investigar.                                                             |
| R4  | `academies/{academyId}/memberDirectoryMigrations` y `…MigrationChunks`                                               | Ninguna operación en curso, congelada o aplicando. Identificar el recibo de cutover (ver la enmienda en §6).                                                                                                                                                                                                                                                      | PARAR.                                                                          |
| R5  | Lectores legacy de `members` en el código desplegado (análisis del repo al commit desplegado, sin producción)        | Lista exacta. Cero para T097, salvo los documentos legacy que se preservan.                                                                                                                                                                                                                                                                                       | Construir su retirada antes de A.                                               |
| R6  | Conteo de collection-group de las subcolecciones anidadas bajo `members` (evaluaciones, graduaciones, bajas médicas) | Cero pendientes de migrar o adaptar.                                                                                                                                                                                                                                                                                                                              | Migración previa (necesita su propia autorización).                             |
| R7  | Backups: PITR activo, un backup v3 verificado reciente y la atestación I4 en `memberDirectoryRestoreAttestations`    | Presentes y verificables.                                                                                                                                                                                                                                                                                                                                         | PARAR.                                                                          |
| R8  | Versión desplegada de las funciones que crean `students`                                                             | Procedencia verificable: un registro de build y despliegue que ligue el artefacto desplegado a la revisión revisada. `firebase-functions-hash` es un hash del código empaquetado, no un SHA de commit: solo compara despliegues entre sí y no prueba la revisión.                                                                                                 | Sin ese vínculo, declarar la versión desplegada como no verificada y no seguir. |

## 8. Operaciones que serían necesarias para A (no ejecutadas)

En orden; ningún paso empieza sin el anterior verificado. Los pasos que despliegan, escriben o
cambian estado (3, 5, 8 y 9) necesitan su propia autorización. Las lecturas (4) no, si están dentro
del alcance ya autorizado.

1. Aprobar la enmienda del ADR-009 (§6).
2. Implementar y revisar los componentes 1 a 8, con pruebas, Emulator y la matriz RED de T097.
3. Desplegar las funciones con la ventana del despliegue por lotes habitual.
4. Ejecutar R1 a R8. Todo debe coincidir.
5. Hacer un backup verificado inmediatamente antes, con un ensayo de restore v3 y una atestación I4 recientes. El diseño de T097 lo exige como prueba; no es un mecanismo para deshacerla.
6. Abrir una ventana sin altas: la oficina no aprueba durante la operación.
7. Hacer el dry-run del planificador. Se obtiene el plan, `planMac`, la lista de precondiciones (vacía) y el estado siguiente, todo sin escribir.
8. Emitir la aprobación exacta `global-legacy-eliminate` con caducidad corta.
9. Aplicar: una sola transacción (componente 7).
10. Verificar:
    - el marcador está a true;
    - el protocolo es `disabled`;
    - `stateRevision` es la anterior más 1;
    - el guard y el evento están avanzados;
    - la operación está `completed`;
    - la aprobación y la atestación están consumidas;
    - el contador sigue en 400 como histórico;
    - un alta de prueba sintética no se puede hacer en producción, así que hay que reaprobar una solicitud aparcada real con autorización expresa.

## 9. Condiciones de parada

- Cualquier R1 a R8 distinto de lo esperado.
- Un dry-run con precondiciones pendientes.
- Una aprobación caducada o un plan cuyo `stateRevision` ya no es el actual.
- Un error o una respuesta perdida en el paso 9: el resultado es incierto. Seguir §10 antes de repetir o abandonar.
- Cualquier escritura de `members` detectada durante la ventana.

## 10. Recuperación por fase

| Fase                                   | Si algo sale mal                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pasos 1 a 8 (sin escrituras de estado) | Abandonar. Nada cambió en el directorio; la aprobación no consumida caduca sola.                                                                                                                                                                                                                                                                                                                          |
| Paso 9 con error o sin respuesta       | La atomicidad evita un estado a medias, pero un error o una respuesta perdida no dicen si la transacción se confirmó. Primero leer el recibo de la operación, el estado, la cabecera y el evento del guard y los consumos de aprobación y atestación. Si se confirmó, pasar al paso 10. Si no, repetir solo la misma operación exacta o abandonar. Nunca crear una operación nueva para salir de la duda. |
| Paso 9 hecho                           | Sin vuelta atrás conocida. El marcador y el guard no restaurable son monótonos y el guard vive fuera del backup, así que restaurar un backup no devuelve el marcador a false ni puede asumirse como reversión. Una recuperación compatible, que no baje marcador ni guard, tendría que diseñarse y validarse antes de ejecutar T097.                                                                      |

## 11. Aprobaciones separadas necesarias (alcance)

1. Decisión A, B o C, del operador.
2. Texto de la enmienda del ADR-009.
3. Implementación de los componentes, por el flujo normal de revisión. No toca producción.
4. Cada despliegue de funciones.
5. Las lecturas R1 a R8 no necesitan aprobación nueva si están dentro del alcance de lectura ya
   autorizado.
6. La ventana T097 completa (pasos 5 a 10) como escritura productiva irreversible, confirmada en el chat justo antes del paso 9.
7. Cualquier limpieza o borrado de `members`, que queda fuera de este paquete (T011).
