# T058 - Runbook de release coordinada y rollback

Estado: **redactado el 2026-09-07 como entregable de T099** (ensayo de release sin staging separado,
enmienda del 2026-09-07 a `t057-synthetic-staging-contract.md`), revisado el mismo día por una ronda
adversarial de cuatro lentes cuyos hallazgos confirmados están incorporados. Este documento describe
cómo se ejecuta y cómo se deshace una release; **no autoriza ninguna**. Cada release productiva sigue
exigiendo la confirmación explícita del operador (regla de oro de `.cronos/AGENCY.md`, condición 4 de
`deploy-checklist`), y hasta que T011 tenga las diez decisiones firmadas y la razón social completa,
ninguna release habilita tratamiento nuevo de datos reales.

Lo que aquí se afirma sobre producción tiene dos fuentes, y se dice cuál en cada caso: lo que se leyó
el 2026-09-07 con comandos de solo lectura (`firebase functions:list --json`, que da nombre, región,
fecha de la última subida y nombres de secretos ligados; `wrangler pages deployment list`), repetible
con `pnpm release:delta --project bptjersey-f5a25`; y lo que registran las entradas del ledger del
2026-09-07 sobre cada despliegue (el material de los secretos y qué árbol subió las Rules), que ningún
comando de lectura puede confirmar y por eso se cita como registro, no como medición.

## 1. Las tres capas y quién las publica

| Capa                      | Dónde vive                                                                     | Cómo se publica hoy                                                                                                                 | Cómo se deshace                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend estático         | Cloudflare Pages, proyecto `bptjersey`, rama de producción `main`              | **Automático en cada push a `main`**, también si el push solo toca documentación. No hay aprobación manual ni Environment protegido | Rollback a la deployment anterior desde el panel de Pages o la API (hecho el 2026-08-30)                                                                |
| Firestore Rules e índices | `firestore.rules`, `firestore.indexes.json`                                    | `firebase deploy --only firestore:rules,firestore:indexes` a mano                                                                   | Rules: redesplegar desde el commit baseline, o restaurar la versión anterior desde el historial de Rules de la consola. Índices: no se revierten (§5.2) |
| Cloud Functions v2        | `bptjersey-f5a25`, `us-central1`, `nodejs22`, artefacto `.firebase-functions/` | `firebase deploy --only functions:<nombre>,functions:<nombre>` a mano, **siempre por nombre**                                       | Reconstruir el artefacto en un worktree del commit baseline y redesplegar por nombre; borrar por nombre lo que no existía antes                         |

Tres consecuencias de esa tabla que ya causaron incidentes o los causarán:

- El frontend se publica solo y las Functions no. Un push a `main` que añade una pantalla nueva la
  deja invocando callables que devuelven 404 (el bucle de `registerShopperAccount` del 2026-09-06).
  **Por eso el frontend va último**, y solo cuando lo que invoca ya existe.
- Pages construye en **cada** push a `main`, incluido un commit que solo cambia `tasks.md`. Cada push
  crea una deployment nueva y mueve "la anterior". Los dos controles que existen son de Cloudflare,
  no del repositorio: "Build watch paths" en la configuración del proyecto Pages (incluir
  `apps/web/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`) o el marcador `[CI Skip]` en el
  mensaje del commit para un cambio solo de documentación. Activar el primero es una decisión del
  operador; hasta entonces, un push de documentación también es una release de frontend y se anota
  como tal.
- El hook `predeploy` de `firebase.json` reconstruye el artefacto **desde el árbol de trabajo
  actual**. Un rollback de Functions no es "volver a subir el zip anterior": es reconstruir desde el
  commit baseline en un worktree limpio y desplegar desde ahí.

Los callables administrativos (`browserAdminCallableOptions` y tres módulos más) solo aceptan el
origen exacto `https://bptjersey.pages.dev` en su CORS. Una preview de Pages (`<id>.bptjersey.pages.dev`)
o un dominio propio futuro reciben errores CORS de esos callables mientras los de cliente responden:
no es un despliegue a medias, es la lista de orígenes. Añadir un dominio propio es un cambio de
Functions (cuatro listas) que se despliega antes del cambio de DNS.

## 2. Inventario de producción al 2026-09-07 y baseline reconstruible

### 2.1 Cloud Functions: 39 desplegadas, en seis lotes

La fecha es la del `storageSource.generation` de cada función, que marca la **última** subida del
código que hoy sirve; `functions:list` no dice cuándo se creó una función ni si existía antes de esa
subida. El commit de origen se determinó por fecha y por `git diff` sobre `apps/functions` y
`packages/domain` entre los commits candidatos.

| Lote (UTC)             | Funciones                                                                                                                                                                                                                                                                                                          | Commit de origen (historial actual)                                                    | Nota                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-13 02:35-03:25 | `cleanupExpiredMemberImportSessionsSchedule`, `searchMembers`, `getMemberReportSummary`                                                                                                                                                                                                                            | `143e196` (anterior a la reescritura de T107, hash intacto)                            | `searchMembers` y `getMemberReportSummary` salieron de `index.ts` en `89fbe15` (T102) y **siguen desplegadas: son huérfanas**. Ligan `MEMBER_PAGE_TOKEN_SECRET`. La web ya no las invoca                                                                                                                                                                         |
| 2026-09-02 04:53-04:55 | 13 callables de T091: `getCurrentWaiverAdmin`, `publishWaiverVersion`, `withdrawCurrentWaiver`, `listClasses`, `saveClass`, `listSessions`, `saveSession`, `getDailyOperationsDashboard`, `getSessionOperationalView`, `getOperationalReport`, `getFinancialDashboard`, `listCrmLeads`, `listRegyfitAccessRecords` | `49e5018` (idéntico en Functions hasta `3f09016`)                                      | El ledger de T091 citaba `0cd2446` como baseline previo; ese hash no resuelve. El ledger no registra ningún despliegue de estas 13 entre el 2026-08-13 y el 2026-09-02 (la release del 2026-08-30 fue solo frontend), pero `functions:list` no puede confirmar si existían antes: si existían, su baseline es el commit que las exportaba entonces, no borrarlas |
| 2026-09-04 19:47-19:49 | `listRegyfitMemberRecords`, `getRegyfitMemberRecord`                                                                                                                                                                                                                                                               | `c8f06ed` (antes `872c398`)                                                            | T104                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-04 21:43-21:44 | 8 callables de la tienda: `listShopCatalog`, `listManagedShopProducts`, `saveShopProduct`, `setShopProductActive`, `placeShopOrder`, `listMyShopOrders`, `listShopOrders`, `updateShopOrder`                                                                                                                       | `12d7ff2` (antes `41394c8`)                                                            | T105                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-07 06:40-06:52 | `registerShopperAccount`, `createMember`, `getMemberDetail`, `listMembers`, `lookupMemberIdentity`, `updateMember`                                                                                                                                                                                                 | fuente de Functions de `8a269c5` (idéntica hasta `97abca3`)                            | Secretos v2 montados; el servicio arranca, luego el material es válido (registro del ledger)                                                                                                                                                                                                                                                                     |
| 2026-09-07 08:08-08:09 | 7 callables de inscripción: `submitEnrolmentRequest`, `listMyEnrolmentRequests`, `withdrawEnrolmentRequest`, `listEnrolmentRequests`, `getEnrolmentRequestDetail`, `approveEnrolmentRequest`, `returnEnrolmentRequest`                                                                                             | `3cc108e` (commit a las 08:06Z; el despliegue lo hizo el operador dos minutos después) | Segundo despliegue del día para estas siete; el primero quedó sustituido                                                                                                                                                                                                                                                                                         |

Secretos ligados (nombres, de `functions:list`): `MEMBER_DIRECTORY_IDENTITY_KEY_SECRET`,
`MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET` y `MEMBER_DIRECTORY_CURSOR_SECRET` en `createMember`,
`getMemberDetail`, `listMembers`, `lookupMemberIdentity`, `updateMember`, `approveEnrolmentRequest`
y `getEnrolmentRequestDetail`; `MEMBER_PAGE_TOKEN_SECRET` en las dos huérfanas. Que las tres del
directorio estén en versión 2 con 48 bytes aleatorios es registro del ledger ("Despliegue del circuito
de inscripcion a produccion", 2026-09-07, DPIA §4.7), no algo que `functions:list` muestre. Ninguna
función desplegada define `BPT_SYNTHETIC_PILOT` (sí es visible en `environmentVariables`), así que
`publishWaiverVersion`, `getCurrentWaiverAdmin` y `withdrawCurrentWaiver` están desplegadas **e
inertes**: fallan cerrado con `failed-precondition`.

### 2.2 Frontend

| Deployment de Pages | Commit    | Estado                                                |
| ------------------- | --------- | ----------------------------------------------------- |
| `eb118dd6`          | `51918ad` | **Producción actual** (`https://bptjersey.pages.dev`) |
| `9e083487`          | `3cc108e` | Anterior al momento de la lectura                     |
| `71270aff`          | `97abca3` | Anterior                                              |
| `7166db31`          | `c50800d` | Anterior                                              |

La lista cambia con cada push; para un rollback se lee de nuevo con `wrangler pages deployment list`.

### 2.3 Firestore

Rules e índices desplegados el 2026-09-07 desde el árbol de `8a269c5`, según el registro del ledger
de ese despliegue. `git diff 8a269c5 HEAD -- firestore.rules firestore.indexes.json` está vacío, así
que, si ese registro es exacto, producción sirve las Rules de `HEAD`, las mismas que verifican las
92/92 pruebas. Ningún comando de lectura devuelve la revisión de Rules que sirve producción; la
consola de Firebase (Firestore, Rules, historial) es la única confirmación.

### 2.4 Mapa de hashes tras la reescritura de T107

Los commits de despliegue que citaba el ledger dejaron de existir con `git filter-repo`. Este es el
mapa vigente; cualquier procedimiento que cite un hash antiguo debe usar el nuevo:

| Antiguo                                                               | Nuevo                                                                 | Qué es                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| `73cf92b`                                                             | `131150c`                                                             | T103                                              |
| `872c398`                                                             | `c8f06ed`                                                             | T104, despliegue Regyfit                          |
| `f68508f`                                                             | `6f19de3`                                                             | docs T104                                         |
| `41394c8`                                                             | `12d7ff2`                                                             | T105, tienda                                      |
| `ec26c9a`                                                             | `fdee210`                                                             | docs T105                                         |
| `0ec8eb3` `a03fc3d` `cf9c2ba` `bd549bc` `c4bf34d` `bb973f3` `9255d32` | `1321c0d` `d907502` `040e4b2` `2419a52` `ae6877c` `98d9872` `2ea48ea` | resto del mapa registrado en la evidencia de T107 |

Dos hashes citados por el ledger **no son pares de la reescritura** y no resuelven en este linaje (ni
en `rev-list --all` ni en el reflog): `3da1f1c`, que la fila de T102 daba como su commit; el commit de
T102 es `89fbe15`, anterior a `73cf92b`, cuyo hash no cambió, así que se identifica por mensaje y
fecha, no por el mapa. Y `0cd2446`, el baseline de rollback que citaba T091 (ver la nota del lote de
2026-09-02 en §2.1).

**Regla desde ahora:** cada despliegue registra en el ledger el hash completo del commit desde el que
se construyó el artefacto y la salida de `firebase functions:list --json` posterior. Sin eso no hay
baseline.

## 3. Lo que falta por desplegar, medido

`pnpm release:delta --project bptjersey-f5a25` sobre `51918ad`:

| Medida                                                                                                                                                                                                                          | Valor   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Cloud Functions exportadas por `apps/functions/src/index.ts` (la herramienta descarta los cinco re-exports que no se declaran con `onCall`/`onSchedule`: tres helpers de auth, `bootstrapEmulatorOwner` y `provisionAdminRole`) | 165     |
| Desplegado en `bptjersey-f5a25`                                                                                                                                                                                                 | 39      |
| Invocado por `apps/web/src`                                                                                                                                                                                                     | 149     |
| **Invocado por la web y sin desplegar**                                                                                                                                                                                         | **114** |
| Exportado y sin desplegar                                                                                                                                                                                                       | 128     |
| Desplegado y ya no exportado (huérfanas)                                                                                                                                                                                        | 2       |

La nota del ledger del 2026-09-07 que decía "37 llamadas distintas, 30 sin desplegar; quedan 25"
contaba con una expresión regular sobre `httpsCallable(` que no veía los clientes que pasan
`getFirebaseFunctions()` como primer argumento ni los que nombran el callable en su propia línea. La
cifra correcta es tres veces mayor. Queda corregida en el ledger y el método vive en
`scripts/release-delta.mjs` con su prueba. Límites de la herramienta: `--ref <commit>` cambia solo
el lado de Functions; el escaneo de `apps/web/src` siempre lee el árbol de trabajo. Y "invocado por
la web" no ve las funciones programadas (`onSchedule`), que aparecen en "exportado y sin desplegar":
al armar un lote hay que mirar las dos listas.

### 3.1 Las 114, agrupadas por módulo y por lo que las bloquea

| Módulo                                                                                                            | Callables                                                                                                                                                                      | Gate real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consents/consent-callables` (7) | `acceptWaiver`, `getWaiverEvidenceDownload`, `getWaiverRegistration`, `revokeWaiverConsent`                                                                                    | **`BPT_WAIVER_REGISTRATION`** desde el 2026-09-08 (T127): parámetro `defineString`, por defecto `disabled`, así que fallan cerrado mientras nadie lo ponga en `enabled`. Sustituye a `BPT_SYNTHETIC_PILOT`, que sigue abriendo el Emulator y cuyo nombre no podía viajar a producción sin afirmar algo falso del entorno. R2 real: **resuelto** el 2026-09-08. Sigue faltando una versión de waiver publicada en producción, y `publishWaiverVersion` es una de las siete, así que el mismo parámetro la gobierna |
| `health/health-callables` (6)                                                                                     | `getHealthProfile`, `saveHealthProfile`, `deactivateHealthProfile`, `createHealthProfileChangeRequest`, `cancelHealthProfileChangeRequest`, `reviewHealthProfileChangeRequest` | **`BPT_SYNTHETIC_PILOT`**. Categoría especial: la DPIA (§2, decisión 4) no autoriza tratamiento de salud sin caso de uso aprobado                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `exports/aggregate-report-export-callables` (1)                                                                   | `prepareAggregateReportExport`                                                                                                                                                 | **`BPT_SYNTHETIC_PILOT`** y R2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `schedule/schedule-callables` (20), `schedule/advanced-booking-callables` (7), `schedule/pre-class-callables` (1) | reservas, asistencia, check-in, quórum, geocerca, listas de espera, vista preclase                                                                                             | Sin gate de código. Dependen de que existan programas y sesiones configurados; `saveLocationGeofence` necesita las coordenadas reales de T109                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `levels/*` (15)                                                                                                   | catálogo, evaluaciones, promociones, informes, planes de clase, logros familiares                                                                                              | **Bloqueado por herramientas, no solo por datos.** Necesitan el catálogo sembrado, y el seed (`apps/functions/scripts/seed-levels.mjs`, T100/T101) rechaza `--target=production`, trata `bptjersey-f5a25` como proyecto productivo siempre inseguro y tiene la allowlist de staging vacía. Sembrar en producción exige un cambio aprobado por el operador en `level-seed-target.mjs` (destino productivo con su propia confirmación y backup previo), registrado como fila nueva, y después poner `NEXT_PUBLIC_LEVELS_BACKEND=true` en el entorno de Pages antes del push del frontend |
| `memberships/*` (9), `finance/finance-callables` (6)                                                              | planes, membresías, facturas y pagos manuales                                                                                                                                  | Sin gate de código. Sin pasarela (T010 decidido: pago en academia)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `staff/*` (9)                                                                                                     | perfiles de staff, disponibilidad, permisos delegados                                                                                                                          | Sin gate de código                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `announcements/*` (9), `reminders` (1), `retention` (1), `birthdays` (1)                                          | avisos, recordatorios, alertas de retención, cumpleaños                                                                                                                        | Sin gate de código. Mensajería externa fuera del MVP; todo es in-app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `consents/disclaimer-callables` (6)                                                                               | disclaimers versionados                                                                                                                                                        | Sin gate de código; el texto lo escribe office (T117). Un disclaimer pendiente no bloquea nada por decisión del operador                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `families` (3), `profiles/*` (4)                                                                                  | familia, perfil de cliente y de tutor                                                                                                                                          | Sin gate de código. Camino de onboarding de T094. **Corregido el 2026-09-07:** la nota anterior decía que el perfil autoservicio no llega al directorio canónico, y es falso. `saveClientProfile` (`profiles/profile-service.ts`) pasa por `assertCanonicalMemberDirectoryWriterReady` y, en una sola transacción, crea el estudiante, reserva su clave de identidad, avanza estado, guard y evento del plano de control y escribe su recibo: **es un escritor canónico de pleno derecho**. De ahí se siguen dos cosas para la release: exige que `memberDirectoryStates/current` exista en producción y esté en la tupla `canonical-v1/open/idle` con cobertura completa -si no, falla cerrado-, y **abre una vía por la que un cliente autenticado crea su propio estudiante sin pasar por la bandeja de solicitudes de T121**. Lo segundo es una decisión de producto, no un detalle de despliegue                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `members/canonical-member-import-callables` (4 callables + 1 `onSchedule`)                                        | importación PDF canónica y `cleanupExpiredCanonicalMemberImportSessionsSchedule`                                                                                               | Sin gate de código. Escribe en el directorio canónico: solo con T108 y aprobación. La programada se despliega con las cuatro (no aparece en "invocado por la web") y, según su declaración `secrets:`, liga los secretos del directorio y los dos `R2_*`; sin R2 real no arranca                                                                                                                                                                                                                                                                                                       |
| `crm` (3), `penalties` (3), `shop` (1: `listPublicShopCatalog`)                                                   | CRM, penalizaciones por no-show, catálogo público                                                                                                                              | Sin gate de código. `listPublicShopCatalog` es el único que sirve sin cuenta: la portada lo invoca                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

"Sin gate de código" no significa "desplegar sin mirar". Significa que el bloqueo, si lo hay, está en
datos (seed, configuración), en decisiones (T011, T010) o en que la pantalla que lo invoca no debe
publicarse todavía. Cada lote de release elige su subconjunto y lo justifica en el ledger.

### 3.2 Parámetros y flags por entorno, y quién los pone

Los secretos viajan por Secret Manager (`defineSecret`) y `firebase deploy` los liga. Los demás
parámetros se leen de `process.env` y **hoy nada los lleva a producción**: el `predeploy` borra y
reconstruye `.firebase-functions/`, `build-deploy-artifact.mjs` no copia ningún `.env`, y `.env*`
está en `.gitignore`. Una función que dependa de ellos se despliega inerte.

| Parámetro                                                                                                                                   | Lado      | Quién lo lee                                                                  | Valor en producción hoy                    | Cómo llegaría                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BPT_SYNTHETIC_PILOT`                                                                                                                       | Functions | salud, documentos privados, export agregado | no definido: esos callables fallan cerrado | **Resuelta para waiver el 2026-09-08** (T127): las siete de `consent-callables` pasan a `BPT_WAIVER_REGISTRATION`, un `defineString` con defecto `disabled` que viaja en el despliegue y se ve en `functions:describe`. Se eligió sobre el `.env` copiado por el artefacto porque deja la configuración a la vista. **Los otros tres módulos siguen con el gate sintético**: salud además no la desbloquea un flag, porque la DPIA §2 decisión 4 no autoriza tratar datos de salud sin caso de uso aprobado |
| `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`                                                                                                           | Functions | cliente R2 (evidencia PDF, documentos privados, limpieza programada)          | no definidos                               | Mismo mecanismo; con `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` reales en Secret Manager (placeholders desde T104)                                                           |
| `ACADEMY_ID`, `MEMBER_DIRECTORY_OPERATION_TARGET`                                                                                           | Functions | inicializador del directorio y runner de operaciones                          | no definidos                               | Solo para operaciones de T108; no para callables                                                                                                                            |
| `NEXT_PUBLIC_FIREBASE_*` (seis identificadores públicos), `NEXT_PUBLIC_FIREBASE_ENV=production`, `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false` | Pages     | `firebase-client.ts`; la guardia de build rechaza emuladores fuera de `local` | configurados en el panel de Pages (T104)   | Solo el operador, en el panel de Cloudflare; no viven en el repositorio                                                                                                     |
| `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`                                                                                                   | Pages     | App Check en el navegador; todos los callables desplegados lo exigen          | configurada el 2026-09-04 (T104)           | Panel de Pages; la clave de reCAPTCHA Enterprise debe listar `bptjersey.pages.dev` como dominio permitido. `NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN` vacío en producción |
| `NEXT_PUBLIC_LEVELS_BACKEND`                                                                                                                | Pages     | pantallas de Levels                                                           | `false` hasta sembrar el catálogo          | Panel de Pages, después del seed (§3.1)                                                                                                                                     |
| `NEXT_PUBLIC_ACADEMY_ID`                                                                                                                    | Pages     | academia por defecto del cliente                                              | configurado                                | Panel de Pages                                                                                                                                                              |

## 4. Procedimiento de release

### 4.0 Precondiciones, todas con evidencia adjunta al ledger

1. **Autorización.** Instrucción explícita del operador para _esta_ release, con la lista de
   funciones, si van Rules e índices, y si va frontend. "Ya se probó antes" no cuenta.
2. **Commit identificado.** Árbol limpio (`git status --short` vacío) en un commit de `main` cuyo
   hash completo se anota. Nunca desde un worktree sucio.
3. **Gates locales sobre ese commit**, con `JAVA_HOME` en JDK 21 (`scripts/emulator-java-env.mjs` lo
   hace por los gates que arrancan emuladores):
   - `pnpm verify:mvp` (formato, lint, typecheck, build, unitarias, Rules, carga sintética, smoke).
   - `pnpm test:e2e:golden-path` con secretos sintéticos (`qa/scripts/generate-synthetic-emulator-secrets.mjs`,
     que exige `GCLOUD_PROJECT=demo-bpt-jersey` antes de correr) y `FUNCTIONS_DISCOVERY_TIMEOUT=300000`:
     con 170 exports, el Emulator en Windows no descubre el artefacto en los 10 s por defecto y las
     19 pruebas fallan sin que ninguna se ejecute (visto el 2026-09-07). El mismo valor hace falta en
     `firebase deploy`, como ya registró el despliegue de T104. Con Node 24, `--env-file=` se lo
     queda **node** aunque vaya después de la ruta del script, y aborta si el fichero todavía no
     existe: se invoca `node -- qa/scripts/generate-synthetic-emulator-secrets.mjs …`, o se crea el
     fichero antes. En CI no se nota porque `$GITHUB_ENV` ya existe (visto el 2026-09-07).
     **El golden path local no es repetible: hay que vaciar `.tmp/member-directory-baselines/` antes
     de cada corrida.** Cada ejecución genera un `MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET` nuevo,
     así que el artefacto de línea base de la corrida anterior ya no se puede reabrir y el
     inicializador aborta con `Empty canonical initialization failed.` —un mensaje que **no dice la
     causa**, porque `member-directory-empty-initialize.mjs` la descarta en un `catch` sin binding—.
     Pasa la primera vez y falla la segunda, siempre, en la misma máquina; en CI nunca, porque el
     workspace nace limpio (visto el 2026-09-08). Además, el bloque `env:` del job de
     `.github/workflows/golden-path.yml` tiene **18 variables** que el runner exige
     (`GOLDEN_PATH_EMULATOR_E2E`, `BPT_SYNTHETIC_PILOT`, los correos sintéticos): copiarlas a mano
     cuesta dos vueltas por dejarse alguna, y sale más barato leerlas del propio workflow.
   - `node apps/functions/scripts/build-deploy-artifact.mjs` termina con exit 0.
4. **Delta medido.** `pnpm release:delta --project bptjersey-f5a25`: la lista "invocado y sin
   desplegar" debe contener exactamente lo que la release va a cubrir para las pantallas que se
   publican, y la lista "exportado y sin desplegar" se cruza para no olvidar una `onSchedule` del
   mismo módulo; las huérfanas se deciden aparte (§4.3).
5. **Secretos.** Para cada secreto que las funciones del lote liguen, `gcloud secrets versions list
<nombre> --project bptjersey-f5a25` muestra habilitada la versión que el ledger registra como
   material real (hoy la 2 para los tres `MEMBER_DIRECTORY_*`); la lista solo da número y estado, no
   puede distinguir un placeholder, así que una versión distinta de la registrada o deshabilitada
   bloquea la release. Nunca `versions access`: imprime el valor.
6. **Parámetros de entorno.** Para cada función del lote, la lista de `process.env` que lee (§3.2) y
   el mecanismo que se los entrega. Si el mecanismo no existe todavía, la función no entra en el lote.
7. **Entorno de Pages**, si la release lleva frontend: las variables de §3.2 con su valor de
   producción, comprobadas en el panel; `NEXT_PUBLIC_FIREBASE_ENV=production` y
   `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false` sin excepción.
8. **Facturación viva.** `gcloud billing projects describe bptjersey-f5a25` devuelve
   `billingEnabled: true`. Sin Blaze no arranca ninguna Functions v2 (incidente del 2026-09-07).
9. **Compatibilidad de datos para el rollback** (§5.0), escrita en la fila de release antes de
   desplegar.
10. **Ventana y aviso.** Fuera del horario de clases de Town y West, con el operador disponible durante
    la hora siguiente para la verificación de navegador, y con office y coaches avisados antes de
    empezar y al terminar (qué cambia para ellos y a quién escribir si algo falla).

### 4.1 Orden

```
índices (y esperar READY)  ->  Rules  ->  Functions (por nombre, por lotes)  ->  frontend  ->  verificación
```

- **Índices primero, y esperar a que terminen**: `firebase deploy --only firestore:indexes` vuelve
  cuando la construcción se ha pedido, no cuando termina; un índice compuesto tarda minutos, más
  cuantos más documentos haya, y un callable que consulte un índice en estado `CREATING` devuelve
  `FAILED_PRECONDITION` hasta que esté `READY`, cosa que §4.4 leería como despliegue roto. Además, el
  despliegue de índices **pregunta si borrar** los índices (y overrides de campo) que existen en
  producción y no están en `firestore.indexes.json`; la respuesta es siempre "no" salvo que el
  operador haya autorizado ese borrado por escrito. En modo no interactivo sin `--force` los omite;
  con `--force` los borra sin preguntar. **Nunca `--force` en un `firebase deploy`**, ni para índices
  ni para Functions.
- **Rules antes que Functions**: una colección nueva debe estar denegada a clientes antes de que un
  callable la escriba. Las Rules son deny-by-default, así que desplegarlas antes no abre nada.
- **Functions por nombre**: `firebase deploy --only functions:a,functions:b --project
bptjersey-f5a25`. **Nunca `--only functions` a secas** mientras existan huérfanas: en modo
  interactivo la CLI pregunta si borrar `searchMembers` y `getMemberReportSummary`; con `--force` las
  borra sin preguntar; en modo no interactivo y sin `--force` aborta con un error que las lista y no
  despliega nada, lo que no debe leerse como un despliegue roto.
- **Frontend al final**: `git push origin main` publica Pages. Si la release no lleva frontend, no se
  hace push de nada, tampoco de documentación (§1).

### 4.2 Comandos

```bash
# Solo con la autorización de §4.0 (1) registrada en el ledger. Los pasos 1, 2 y 4 escriben en
# producción; ninguno se ejecuta sin ella, y "ya se probó antes" no la sustituye.
# 0. Identidad y árbol
git status --short              # vacío
git rev-parse HEAD              # se anota completo en el ledger
corepack pnpm --filter @bpt-jersey/domain build:runtime

# 1. Índices, espera a READY, y Rules
npx firebase deploy --only firestore:indexes --project bptjersey-f5a25   # responder "no" a cualquier borrado
gcloud firestore indexes composite list --project bptjersey-f5a25 --format="table(name.basename(),state)"
#    repetir hasta que todos los índices de la release estén READY; anotar cuánto tardó
npx firebase deploy --only firestore:rules --project bptjersey-f5a25

# 2. Functions, un lote por línea, por nombre (el timeout largo evita el "Cannot determine backend
#    specification" del descubrimiento con 170 exports)
FUNCTIONS_DISCOVERY_TIMEOUT=300000 npx firebase deploy --only functions:nombreA,functions:nombreB --project bptjersey-f5a25

# 3. Inventario posterior, se guarda junto al ledger de la release
npx firebase functions:list --project bptjersey-f5a25 --json > release-<hash>-functions.json
corepack pnpm release:delta --deployed release-<hash>-functions.json

# 4. Frontend (solo si la release lo incluye y todo lo anterior está verde)
git push origin main
npx wrangler pages deployment list --project-name bptjersey   # anotar el id de la deployment
```

Cada `firebase deploy` de Functions ejecuta el `predeploy` que reconstruye el artefacto desde el
árbol actual: por eso el paso 0 exige árbol limpio y commit anotado.

### 4.3 Las dos huérfanas

`searchMembers` y `getMemberReportSummary` no están en `index.ts` desde `89fbe15`, la web no las
referencia, y siguen sirviendo con `MEMBER_PAGE_TOKEN_SECRET`. Se retiran en un paso propio y
deliberado, autorizado por el operador, con `npx firebase functions:delete searchMembers
getMemberReportSummary --region us-central1 --project bptjersey-f5a25`. Hasta entonces, ningún
despliegue usa `--only functions` sin nombres. `listRegyfitAccessRecords` está en la misma situación
funcional (el panel web ya no existe) pero sigue exportada; retirarla es una decisión del operador
pendiente desde el 2026-09-06.

### 4.4 Verificación posterior

1. `functions:list` muestra exactamente el conjunto esperado, `state: ACTIVE`, sin funciones de más ni
   de menos.
2. Sondeo anónimo a cada callable nueva: respuesta `401` (sin sesión) es la correcta; `404` es que no
   se desplegó; `5xx` es arranque roto (secreto, facturación, dependencia). Un `429` tras varios
   sondeos es el límite propio, no un fallo.
3. Logs de Cloud Run de cada función nueva: `Default STARTUP TCP probe succeeded` y ausencia de
   `billing is disabled`, `Invalid ... secret` o `Cannot find module`.
4. El operador abre las pantallas afectadas con sesión real **en `https://bptjersey.pages.dev`**, no
   en una preview (§1, CORS), y anota `200`/errores de consola, como se hizo el 2026-09-04 con
   `/admin/members/search`.
5. Ledger: la fila de release de §8, completa. `Lista/Lista.js` refleja lo mismo en la misma sesión.

## 5. Rollback

Decidir antes de desplegar quién lo ordena (el operador), cuánto se espera antes de ordenarlo (una
verificación de §4.4 en rojo basta) y qué NO se revierte (datos escritos por las funciones nuevas: se
conservan; un rollback de código nunca borra documentos).

### 5.0 Compatibilidad de datos, por lote y antes de desplegar

Conservar los datos solo es seguro si el código baseline los tolera. Por cada lote, la fila de release
responde, con el archivo que lo prueba:

- Qué colecciones o campos nuevos escribe la versión nueva.
- Si el baseline los lee sin romperse. La mayoría de los contratos del dominio son `strictObject`
  de zod: un campo desconocido **hace fallar el parseo**, así que el baseline no lee un documento con
  un campo añadido; lo rechaza y el callable responde "contract rejected". Donde el esquema sea no
  estricto, el campo se descarta al leer y el riesgo pasa al punto siguiente.
- Si algún callable del baseline **reescribe** esos documentos. Un `set` desde un parseo no estricto
  pierde el campo nuevo en silencio; ahí un rollback destruye datos aunque no borre documentos.
- Si las Rules del baseline siguen admitiendo los documentos nuevos.

Cuando la respuesta es "rechaza" o "reescribe", la decisión por defecto es corregir hacia delante en
vez de volver atrás, y se dice en la fila. Ejemplo ya vigente, y no es el cómodo: el waiver aceptado
en la solicitud de inscripción (`3cc108e`) añade `waiverAcceptance` (versión, hash, fecha, quién) a
cada documento nuevo de `enrolmentRequests`, cuyo contrato es `strictObject`, y las transiciones
(devolver, retirar, aprobar) hacen `transaction.set` del registro parseado entero. Un rollback de las
siete callables a `8a269c5` no borraría esas solicitudes, pero dejaría **imposible de devolver, retirar
o aprobar** cualquiera enviada con la versión nueva. Ese lote no admite rollback limpio: se corrige
hacia delante.

### 5.1 Functions

Dos casos, y no se mezclan:

- **La función existía antes del lote** (se actualizó): reconstruir desde el commit baseline y
  redesplegar por nombre.

  ```bash
  # Rollback ordenado por el operador (§5, primer párrafo); redesplegar también escribe en producción.
  git worktree add ../rollback-<baseline> <baseline>
  cd ../rollback-<baseline>
  corepack pnpm install --frozen-lockfile
  corepack pnpm --filter @bpt-jersey/domain build:runtime
  FUNCTIONS_DISCOVERY_TIMEOUT=300000 npx firebase deploy --only functions:nombreA,functions:nombreB --project bptjersey-f5a25
  cd - && git worktree remove ../rollback-<baseline>
  ```

  El baseline de cada función es el commit de su lote en §2.1, o el hash que el ledger registró en la
  release que se está revirtiendo.

- **La función no existía antes** (se creó): borrarla por nombre. Una `onSchedule` se borra con el
  mismo comando.

  ```bash
  # Rollback ordenado por el operador; borra la función, no los documentos que escribió.
  npx firebase functions:delete nombreA nombreB --region us-central1 --project bptjersey-f5a25
  ```

  Un `404` honesto en la web es preferible a una función que responde mal.

Los secretos no se revierten: una versión nueva de un secreto solo se deshabilita, con autorización
expresa del operador y en un paso propio, si la release que la introdujo se revierte entera y ninguna
función activa la liga.

### 5.2 Firestore Rules e índices

Desde el worktree del baseline: `npx firebase deploy --only firestore:rules --project
bptjersey-f5a25`. Alternativa sin worktree: consola de Firebase, Firestore, Rules, historial de
versiones, restaurar la anterior. **Los índices no se revierten nunca**: un índice de más no rompe
consultas, y un `--only firestore:indexes` desde el baseline ofrecería borrar los índices nuevos,
que es exactamente lo que no hay que hacer. El rollback despliega solo `firestore:rules`.

### 5.3 Frontend

Panel de Cloudflare Pages, proyecto `bptjersey`, deployments, "Rollback to this deployment" sobre la
deployment anterior a la de la release, leída en ese momento con `wrangler pages deployment list`
(no la que este documento lista en §2.2: cada push la mueve), o la API como el 2026-08-30. Un
rollback del frontend **no** deshace un push: el siguiente push a `main` vuelve a publicar el corte.
Si hay que retirar código, se revierte el commit en `main` y se deja que Pages publique la reversión.

### 5.4 Orden del rollback

Inverso al de la release: frontend primero (deja de invocar lo nuevo), luego Functions, luego Rules
solo si la release las cambió. Índices se quedan.

### 5.5 Lo que este runbook no cubre

Migraciones de datos. La release coordinada de T058 no lleva ninguna. La migración de la colección
legacy `members` es T108 y tiene su propio plan de reversión en
`docs/data/migrations/member-directory-v1.md`; una release que la incluyera exigiría backup verificado,
recibo de alcance y confirmación separada (regla de migraciones de `AGENCY.md`).

## 6. Riesgos que el Emulator no cubre, asumidos por la enmienda de T057

1. Identidad cloud e IAM, incluido el `invoker` público de los callables.
2. Región, cuotas y arranque en frío de Cloud Run.
3. Montaje real de secretos al arrancar la instancia.
4. App Check con clave y dominio reales.
5. El despliegue mismo: descubrimiento de funciones, tiempos y fallos parciales.
6. Cloudflare Pages con `noindex`, cabeceras y variables de producción.

Y uno que no estaba en la lista y ocurrió el mismo día: **la facturación**. La prueba gratuita de
Google Cloud terminó, Cloud Functions v2 dejó de servir y nadie lo supo hasta que el operador abrió la
página. El plazo que dio Google para restablecer servicios era el 6 de octubre de 2026; ya no aplica,
pero la misma situación se repite si la cuenta de pago cae.

### 6.1 Alertas, creadas el 2026-09-08 salvo una

**Corrección de una premisa falsa de esta misma sección.** Hasta el 2026-09-08 este apartado decía
que las cinco alertas "requieren roles de facturación o de monitorización que el repositorio no
tiene, así que son del operador". **No es cierto**, y nadie lo había comprobado. La identidad gcloud
autenticada en la máquina de desarrollo (`andres.san1404@gmail.com`) tiene concedidos, verificados
con `testIamPermissions` contra `cloudresourcemanager` y `cloudbilling`:
`monitoring.notificationChannels.create`, `monitoring.alertPolicies.create`,
`monitoring.uptimeCheckConfigs.create` y `billing.budgets.create` sobre
`billingAccounts/01A152-164886-CFA852`. Una nota que declara un bloqueo sin medirlo cuesta tantas
releases como una que declara verde algo roto. **Antes de escribir "no tengo permiso", ejecútese
`testIamPermissions`.**

Con la autorización del operador del 2026-09-08 se crearon cuatro de las cinco. Se crean en este
orden: el canal primero, porque las cuatro políticas lo necesitan al guardarse. Umbrales concretos,
decididos el 2026-09-07 para que sean creables sin volver a pensarlos.

1. **Canal de notificación.** Monitoring, Alerting, Notification channels, tipo Email, la dirección
   del owner. Es el paso 1 y no el 5: sin canal, una política se guarda sin avisar a nadie.
2. **Presupuesto.** `console.cloud.google.com/billing`, presupuesto mensual sobre
   `bptjersey-f5a25` con el importe que el operador acepte gastar, y umbrales de aviso al **50 %,
   90 % y 100 % del gasto real** más uno al **100 % del previsto**. El presupuesto **no corta el
   gasto**: solo avisa. Cortar es lo que dejó producción caída el 2026-09-07.
3. **5xx en Cloud Run.** Métrica `run.googleapis.com/request_count` filtrada por
   `response_code_class = "5xx"`, agregada por `service_name`, alineación `rate` de 60 s y condición
   **cualquier serie > 0 durante 5 min**. Sin filtrar por servicio: una función nueva que arranque
   rota tiene que disparar sin haberla añadido a mano.
4. **Cloud Scheduler.** Las `onSchedule` fallan en silencio y sin esto nadie se enteraría. La forma
   que se pidió primero —umbral sobre `cloudscheduler.googleapis.com/job/attempt_count` filtrada por
   `response_code != "success"`— **no es creable en este proyecto**, y no por falta de jobs: ver
   §6.3. La que existe es una **coincidencia de registro** sobre
   `resource.type="cloud_scheduler_job" AND severity>=ERROR`, que vigila lo mismo, no depende de
   ningún descriptor de métrica y dispara al primer intento fallido.
5. **Disponibilidad.** Uptime check HTTPS cada 5 min contra `https://bptjersey.pages.dev/`
   esperando `200`, y un segundo check contra la URL de un callable desplegado aceptando cualquier
   código que no sea `5xx` -un `401` anónimo significa "vivo y rechazando bien"-. Ambos con alerta
   sobre el canal del punto 1.

### 6.2 Lo que existe hoy en `bptjersey-f5a25`, verificado leyendo la API

Creado el 2026-09-08 sobre un proyecto que tenía **cero** canales y **cero** políticas. Los
identificadores se anotan para que un rollback o un cambio de umbral no tenga que buscarlos:

| §6.1 | Recurso | Identificador | Estado |
| --- | --- | --- | --- |
| 1 | Canal de correo `andres.san1404@gmail.com` | `notificationChannels/12257294977499398601` | **Vivo**, `enabled: true` |
| 2 | Presupuesto mensual 200.000 COP | `billingAccounts/01A152-164886-CFA852/budgets/b5c93313-9397-4736-8555-d270abf20b29` | **Vivo**, avisos 50/90/100 % real y 100 % previsto |
| 3 | 5xx en Cloud Run | `alertPolicies/14551742904807390116` | **Viva**, 1 condición, sin filtrar por servicio |
| 4 | Fallos de Cloud Scheduler, por coincidencia de registro | `alertPolicies/14996584831695689321` | **Viva** desde el 2026-09-08, 1 condición. No es la de umbral. Ver abajo |
| 5 | Disponibilidad, dos uptime checks | `alertPolicies/136751823744566063` | **Viva**, 2 condiciones |

**El presupuesto avisa y no corta**, que era la decisión del 2026-09-07: no lleva regla de corte de
gasto, y cortar es exactamente lo que dejó producción caída ese día. La moneda de la cuenta de
facturación es **COP**, no GBP; el importe está en pesos y conviene no leerlo como libras.

Los dos uptime checks corren cada 300 s: `https://bptjersey.pages.dev/` esperando `200`, y
`https://us-central1-bptjersey-f5a25.cloudfunctions.net/getCurrentWaiverAdmin` aceptando cualquier
clase que no sea `5xx`. Medido al crearlos: Pages devuelve `200` y el callable `400` a un `GET`
desnudo, que es "vivo y rechazando bien".

### 6.3 Por qué la 4 no es una alerta de umbral, y el defecto de producción que eso destapó

**Cómo empezó.** La API rechazaba la política con `404`: no existe descriptor para
`cloudscheduler.googleapis.com/job/attempt_count` en este proyecto. La causa no era la métrica:
**no había ningún job de Cloud Scheduler**, comprobado en
`us-central1`, `us-east1`, `us-east4`, `us-west1`, `us-west2`, `europe-west1` y `europe-west2`, todos
a cero. Y sin embargo `cleanupExpiredMemberImportSessionsSchedule` figura desplegada y `ACTIVE` desde
el 2026-09-07 06:22.

**Conviene no confundirse con la anatomía de una `onSchedule` v2, porque invita a un diagnóstico
falso.** Su `eventTrigger` es `null` y lo único que la marca es la etiqueta
`deployment-scheduled: true`: eso es **correcto y esperado**. Una función programada v2 se despliega
como función **HTTPS**, y quien la dispara es un job de Cloud Scheduler **separado**
(`firebase-schedule-<función>-<región>`) que la invoca. Así que `eventTrigger: null` no prueba nada
malo. Lo que sí lo prueba es la otra mitad: **el job no existe**. `firebase functions:list` la pinta
como `scheduled` leyendo la etiqueta, no comprobando el job, así que **el inventario dice "scheduled"
de una función que hoy no puede dispararse**. Consecuencia real: las sesiones de importación de
miembros caducadas no se limpian desde esa fecha.

**La comprobación honesta de una función programada son dos lecturas, no una.** La etiqueta dice que
se desplegó con intención de programarse; solo `gcloud scheduler jobs list --location <región>` dice
si algo la va a llamar.

Es literalmente el fallo silencioso para el que existe la alerta 4, ocurriendo mientras la alerta no
existe.

**Resuelto el mismo día, y lo que salió debajo.** Con autorización propia del operador se redesplegó
la función y el job quedó creado (`ENABLED`, cada 15 minutos). Eso no la arregló: la **destapó**.
Empezó a devolver `500` cada quince minutos con `Private file storage is not configured`, porque
ligaba un solo secreto de los cinco que la configuración de R2 necesita —incumplimiento de la
precondición 6 de este runbook, medida para las 31 del lote y **no** para la que se añadió después—.
Corregido eso, el error pasó a `Member import cleanup journal unavailable`, que resultó ser un índice
compuesto ausente para `memberImportPreviews (status, expiresAt)`, ni declarado ni en producción.

Con las tres capas resueltas la función se ejecutó **por primera vez desde que existe**: `HTTP 200`,
cero `5xx`, cero entradas de error. **Nunca había funcionado**, y el inventario la mostró sana todo
ese tiempo. Tres lecciones que este runbook se lleva:

- **La precondición 6 se mide por función desplegada, no por lote.** Un añadido de última hora no
  hereda la medición de los demás, y es justo el que nadie vuelve a mirar.
- **Un síntoma no nombra su causa.** "Journal unavailable" era un índice; "scheduled" era una etiqueta
  sin disparador. Dos `catch` que descartan el error original costaron el grueso del tiempo de
  diagnóstico.
- **La alerta se pagó sola.** La política de `5xx` creada esa mañana disparó sobre una función rota
  desde agosto, una hora después de existir.

**El descriptor sigue sin publicarse aunque el job funcione, y eso está medido.** El 2026-09-08, con
el job `ENABLED` ejecutándose cada 15 minutos y devolviendo `200`, la familia
`cloudscheduler.googleapis.com` tiene **cero descriptores** en el proyecto, mientras
`run.googleapis.com` tiene 53 y `cloudfunctions.googleapis.com` 7. La sospecha razonable es que hace
falta al menos un intento **fallido** para materializarla, lo que es irónico tratándose de la alerta
de fallos. **No se esperó a comprobarlo**: una alerta que solo empieza a existir después del primer
fallo no vigila el primer fallo.

**Lo que se hizo en su lugar.** Una condición de **coincidencia de registro** sobre
`resource.type="cloud_scheduler_job" AND severity>=ERROR`. No valida contra ningún descriptor, así
que se crea antes de que exista una sola entrada que la haga coincidir, y dispara la primera vez que
un intento falle. El flujo de registro está vivo y comprobado: `cloudscheduler.googleapis.com%2Fexecutions`
emite una entrada `INFO` cada 15 minutos. Política `alertPolicies/14996584831695689321`, al mismo
canal de correo del punto 1, con límite de una notificación cada 900 s y cierre automático a 7 días.
El cuerpo exacto está en `docs/operations/alert-4-cloud-scheduler-log-match.json`, para recrearla o
para revertirla borrándola.

**La nota que decía "no creable hoy" costó lo que suelen costar.** Estuvo escrita en este runbook
como si fuera una propiedad del proyecto, cuando lo que describía era una propiedad de **una forma
concreta** de escribir la alerta. Es la misma lección que ya se llevó una release entera: **un
bloqueo que no se ha medido no es un bloqueo, es una hipótesis.**

Una vez el job emite su primera métrica —Google publica el descriptor con hasta 10 minutos de
retardo—, la política se crea con el fichero ya escrito:

```bash
curl -s -X POST "https://monitoring.googleapis.com/v3/projects/bptjersey-f5a25/alertPolicies" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" -d @policy-scheduler.json
```

con filtro `metric.type="cloudscheduler.googleapis.com/job/attempt_count" AND
resource.type="cloud_scheduler_job" AND metric.labels.response_code!="success"`, agregación
`ALIGN_SUM`/`REDUCE_SUM` sobre 900 s agrupando por `job_id`, y condición `> 0`.

**Un detalle que costó un `403` y conviene no repetir.** La API de presupuestos exige cabecera de
proyecto de cuota cuando se llama con credenciales de usuario: `-H "x-goog-user-project:
bptjersey-f5a25"`. Sin ella responde `PERMISSION_DENIED` con `reason: SERVICE_DISABLED` apuntando al
proyecto `32555940559`, que es el del propio gcloud y despista. Hubo que habilitar además
`billingbudgets.googleapis.com`, que estaba apagada.

### 6.3 App Check consumible: un permiso IAM que faltaba desde siempre

**Síntoma:** cualquier callable declarada con `consumeAppCheckToken: true` devuelve `401` a un usuario
correctamente autenticado. En el navegador se lee como "no has iniciado sesión", que es exactamente lo
contrario de lo que pasa.

**Causa:** la cuenta de servicio de las funciones —`387764816359-compute@developer.gserviceaccount.com`,
con `roles/editor`— no tenía `firebaseappcheck.appCheckTokens.verify`. Las callables que **no**
consumen token validan el JWT de App Check localmente y funcionan; las que **sí** lo consumen deben
llamar al backend de App Check para gastarlo, reciben `403` y responden `401` al cliente.

**Arreglo,** aplicado el 2026-09-08 con autorización del operador:

```bash
gcloud projects add-iam-policy-binding bptjersey-f5a25 \
  --member="serviceAccount:387764816359-compute@developer.gserviceaccount.com" \
  --role="roles/firebaseappcheck.tokenVerifier"
```

Ese rol concede **un solo permiso**, el que falta. `roles/firebaseappcheck.admin` también sirve y
añade administración de configuración y automatizaciones que nadie necesita.

**Lo que conviene retener, más allá del arreglo:**

- **Afectaba a producción desde antes de cualquier release de T058**, y nadie lo sabía: panel
  financiero, informes operativos, agenda, backup, export, perfil de tutor, penalizaciones, permisos
  de staff y cumpleaños. El primer lote no lo causó; hizo que alguien mirara.
- **La propagación de IAM no es inmediata.** Las llamadas de los primeros ~20 segundos tras el
  `add-iam-policy-binding` siguieron fallando. Un minuto o dos antes de concluir nada.
- **El log del servidor lo decía en texto plano**, con enlace al troubleshooter. Antes de llegar ahí
  se descartaron dos hipótesis —los clientes web y un reCAPTCHA hostil al navegador automatizado—,
  las dos falsas. **Leer el log del que falla va antes que razonar sobre el que llama.**
- **El cliente también importa, pero no era el bloqueo.** Una callable con `consumeAppCheckToken`
  exige que el navegador pida un token *limited-use*: `httpsCallable(fns, name,
  { limitedUseAppCheckTokens: true })`. Sin eso falla igualmente, sólo que por otra razón. Ambas
  condiciones son necesarias.

### 6.4 Verificación §4.4(4) con navegador conducido

Se puede automatizar la mitad que no necesita sesión —`qa/tests/production-verification.spec.ts`,
opt-in con `PROD_VERIFY=true` y `BASE_URL`, saltada en CI—, y conviene, porque comprueba carga,
consola y que `/admin` rechaza a un anónimo sin romperse.

La otra mitad exige sesión real y **no debe automatizarse con credenciales**: se abre Chromium con
ventana visible, el operador inicia sesión a mano y el guion continúa desde ahí, registrando por
pantalla el código HTTP de **cada callable invocada**. La contraseña nunca llega al asistente.

Tres cosas aprendidas haciéndolo el 2026-09-08:

- **La puerta de administración es `/staff/login`**, no `/login`, que es la de clientes.
- **Un navegador conducido no es juez suficiente.** Resultados no deterministas —la misma callable
  dando `200` y `401` en dos pantallas de la misma sesión— llevaron a culpar a reCAPTCHA. Era falso,
  pero la duda sólo se resolvió con el operador abriendo la pantalla en su navegador normal. El §4.4(4)
  pide una persona por una razón.
- **Que una deployment esté activa no es que contenga el cambio.** Antes de pedirle al operador que
  verifique, se comprueba leyendo los chunks que la página referencia en producción.

## 7. Registro de releases

| Fecha      | Alcance                                                                             | Commit             | Evidencia                                                    | Baseline de rollback                                                                                          |
| ---------- | ----------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | Secretos v2, Rules e índices, 8 callables de inscripción, 5 del directorio canónico | árbol de `8a269c5` | ledger "Despliegue del circuito de inscripcion a produccion" | borrar las 13 (no existían); Rules del lote anterior                                                          |
| 2026-09-07 | 7 callables de inscripción actualizadas con el waiver                               | `3cc108e`          | ledger "Owner aprovisionado y waiver en el alta"             | redesplegar las 7 desde `8a269c5` dejaría atascadas las solicitudes con waiver (§5.0): corregir hacia delante |
| 2026-09-07 | Frontend `51918ad` (Pages `eb118dd6`)                                               | `51918ad`          | `wrangler pages deployment list`                             | Pages `9e083487`                                                                                              |
| 2026-09-08 | Primer lote de T058: 31 callables (staff, families, crm, penalties, tienda, anuncios) y el redespliegue de la programada huérfana | `437e7a2` | ledger "Release 2026-09-08: las 31 callables del primer lote de T058"; `docs/operations/release-437e7a2-functions.json` | borrar las 31, no existían; la programada vuelve atrás borrando su job de Scheduler |
| 2026-09-08 | `cleanupExpiredMemberImportSessionsSchedule` con los cinco secretos de R2 ligados, más el índice `memberImportPreviews (status, expiresAt)` | `0b412c0` y `5d3a0a6` | ledger "La cebolla de la limpieza programada y R2 cableado" | pausar el job de Scheduler; el índice es aditivo y no se retira |
| 2026-09-08 | Frontend: token de App Check de un solo uso en los clientes de penalizaciones, permisos de staff y cumpleaños | `dd131ef` (Pages `2dfc97be`) | ledger "Fila de release del frontend" | Pages `a53dfe90` |

Las releases anteriores al 2026-09-07 están reconstruidas en §2.1 a partir de producción, no de un
registro escrito en su momento. A partir de aquí, cada fila se escribe el día de la release.

## 8. Plantilla de la fila de release en el ledger

Se copia entera; una casilla vacía es una release que no se hizo como dice este runbook.

```
### Release <fecha> - <alcance en una línea>
- Autorización: <quién, cuándo, con qué palabras> (§4.0.1)
- Commit: <hash completo>; árbol limpio: sí
- Gates sobre ese commit: verify:mvp <resultado>, golden path <n/n, minutos>, artefacto exit 0
- Delta previo: invocado y sin desplegar <n>, exportado y sin desplegar <n>, huérfanas <n>
- Lotes: <funciones por lote, en orden>
- Índices: <cuáles, minutos hasta READY>; Rules: <sí/no, hora>
- Secretos verificados: <nombre: versión>; parámetros de entorno: <nombre: mecanismo>
- Entorno de Pages verificado: <sí/no>; deployment de Pages: <id> (anterior: <id>)
- Compatibilidad de datos (§5.0): <por lote: lee/reescribe/Rules>
- Verificación §4.4: functions:list <ok>, sondeos <401/404/5xx por función>, logs <ok>, navegador <pantallas, resultado>
- Baseline de rollback: <commit por lote; borrar lo nuevo>
- Aviso a office y coaches: antes <hora>, después <hora>
- Inventario posterior: release-<hash>-functions.json
```
