# App Check del calendario y series Regyfit duplicadas (25 sep 2026)

## Resumen

Tres cosas, en este orden:

1. **Parte A (4 pasos, solo consola, no escribe datos):** comprobar que la clave de reCAPTCHA
   Enterprise de App Check es la que usa la web y que admite los dominios reales. El aviso
   `AppCheck: 403 ... (appCheck/initial-throttle)` sale cuando el intercambio con reCAPTCHA falla,
   y eso casi siempre es configuración de consola, no código.
2. **Parte B (2 pasos):** desplegar las 13 funciones de lectura del calendario **antes** de que se
   publique la web.
3. **Parte C (7 pasos):** buscar con el script las series importadas de Regyfit (`regyfit-*`) que
   repiten una serie nativa, revisarlas y, solo si estás de acuerdo, detener esas series y cancelar
   sus clases futuras sin reservas.

Requisitos antes de empezar:

- Acceso de propietario a la consola de Firebase y a Google Cloud del proyecto `bptjersey-f5a25`.
- Acceso de lectura a la configuración del proyecto de Cloudflare Pages `bptjersey`.
- Para las Partes B y C: el commit de este cambio ya en `main` y en `origin/main`, con
  `/root/BPT-Jersey` del VPS limpio y en ese commit, y `corepack pnpm install --frozen-lockfile` hecho.
- Para la Parte B: `firebase-tools` ya autorizado en el VPS (es la sesión que usas en los despliegues
  habituales).
- Para la Parte C: la clave de cuenta de servicio del proyecto en `/root/secrets/` (el archivo
  `bptjersey-f5a25-firebase-adminsdk-*.json`). En el VPS no hay `gcloud`; los scripts de operador se
  autentican con esa clave mediante `GOOGLE_APPLICATION_CREDENTIALS`.

---

## Parte A. Comprobar App Check y reCAPTCHA (solo lectura)

### Paso A1. Anotar la clave que usa la web

📍 Navegador — tu portátil.

Abre Cloudflare → Workers & Pages → proyecto `bptjersey` → Settings → Variables and Secrets
(entorno **Production**). Anota el valor de `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY`.

Salida esperada: una clave de unos 40 caracteres que empieza por `6L`.
Si la variable no existe: la web no puede pedir tokens de App Check en producción; para aquí y
avísame.

### Paso A2. Comprobar que App Check usa esa misma clave

📍 Navegador — tu portátil.

Abre la consola de Firebase → proyecto `bptjersey-f5a25` → Build → App Check → pestaña **Apps** →
la app web → proveedor **reCAPTCHA Enterprise**. Compara la clave que aparece con la del paso A1.

Salida esperada: la app web aparece como registrada con reCAPTCHA Enterprise y la clave es
**idéntica** a la del paso A1.
Si es distinta: no la cambies todavía; anota las dos claves y avísame, porque cambiar cualquiera de
las dos afecta a todos los usuarios.

### Paso A3. Comprobar los dominios de la clave

📍 Navegador — tu portátil.

Abre Google Cloud Console → proyecto `bptjersey-f5a25` → Security → **reCAPTCHA** → haz clic en la
clave del paso A1 → **Edit key** (o "Domain list").

Salida esperada: en la lista de dominios están exactamente estos tres (reCAPTCHA incluye los
subdominios, así que `bptjersey.pages.dev` cubre también las vistas previas `*.bptjersey.pages.dev`):

- `bptjersey.com`
- `www.bptjersey.com`
- `bptjersey.pages.dev`

Si falta alguno: ⚠️ añadirlo cambia la clave que usa toda la web (es reversible: se puede quitar
igual). Añade solo el que falte, pulsa **Save** y espera unos 5 minutos.

### Paso A4. Probar desde el móvil

📍 Tu móvil — navegador.

Después de corregir algo en A2 o A3, el navegador puede seguir en espera por el 403 anterior
(`initial-throttle` bloquea nuevos intentos durante un tiempo). Cierra todas las pestañas de
`bptjersey.com`, borra los datos del sitio (Ajustes del navegador → Privacidad → Datos de sitios →
`bptjersey.com` → Borrar) y vuelve a entrar en **Admin → Classes & Services → Classes**.

Salida esperada: el calendario carga las clases y no aparece ningún aviso rojo.
Si sale "We couldn't verify this device. Try again in a moment.": pulsa **Retry** una vez; si sigue,
vuelve a A2/A3 y mándame una captura.

---

## Parte B. Orden de publicación de este cambio

### Paso B1. Por qué funciones primero

Este cambio hace que las lecturas del calendario usen el token de App Check normal (en caché) en
lugar de uno de un solo uso. Estas 13 funciones deben desplegarse **antes** de que la web se publique
(un push a `main` publica la web sola en Cloudflare Pages): `listScheduleCatalog`, `listClasses`,
`listSessions`, `getDailyOperationsDashboard`, `listSessionBookedCounts`, `listSessionBookings`,
`listStudentBookings`, `listSessionAttendance`, `listStudentAttendance`, `listAttendanceHistory`,
`listSessionCheckouts`, `getStudentCheckout`, `getSessionOperationalView`. Las escrituras (reservas,
copiar semana, etc.) no cambian y no se despliegan.

### Paso B2. Desplegar solo esas 13 funciones

⚠️ **Cambia producción.** Solo con tu confirmación explícita, y siempre por nombre: nunca
`--only functions` a secas (hay funciones que no deben desplegarse, como `selfCheckIn`). El comando lo
ejecutas tú; el asistente no despliega. Para revertir, se vuelve a desplegar por nombre desde el
commit anterior.

📍 Terminal A — VPS por SSH, usuario `root`, en `/root/BPT-Jersey`.

```bash
bash apps/functions/scripts/deploy-schedule-read-functions.sh --project bptjersey-f5a25
```

Qué hace: el script guarda la lista de las 13 funciones (así no hay que pegar una línea larguísima),
comprueba que el proyecto es `bptjersey-f5a25`, te enseña la lista y te pregunta
`Deploy these 13 functions to bptjersey-f5a25? [y/N]`. Solo si respondes `y` ejecuta
`corepack pnpm exec firebase deploy --only functions:listScheduleCatalog,...` con esas 13. El
`predeploy` construye el artefacto `.firebase-functions/` y antes comprueba que el árbol está limpio e
igual a `origin/main`.

Salida esperada: primero `Project: bptjersey-f5a25`, `Functions to deploy (13):` y los 13 nombres, y la
pregunta. Si respondes cualquier otra cosa que no sea `y`: `Cancelled. Nothing deployed.` Si respondes
`y`: 13 líneas `✔  functions[<nombre>(<región>)] Successful update operation.` y al
final `✔  Deploy complete!`.
Si el `predeploy` falla diciendo que el árbol no está limpio o no coincide con `origin/main`: no
fuerces nada; haz `git status` y avísame. Si alguna función sale como `Failed`, copia el bloque de
error y avísame antes de reintentar.

---

## Parte C. Retirar series Regyfit duplicadas

Qué hace el script `apps/functions/scripts/retire-duplicate-regyfit-series.mjs`:

- Lee las series semanales (`sessionSeries`, su revisión más reciente) y las clases **futuras** no
  canceladas de la academia.
- Una serie importada (id `regyfit-*`) es duplicada si hay una serie nativa en la **misma sede**, el
  **mismo día de la semana** y la **misma hora local** (Jersey), y con el **mismo programa** o el
  **mismo título** (sin mayúsculas ni espacios dobles). Las series `regyfit-*` sin gemela nativa son
  el horario vigente de adultos y **nunca** aparecen.
- Sin `--apply` (por defecto) no escribe nada: imprime las parejas, las series que detendría y desde
  qué fecha, y cada clase futura afectada con su número de reservas activas.
- Con `--apply`, primero **detiene** cada serie duplicada desde su primera semana futura (la misma
  revisión que escribe "dejar de repetir semanalmente" en la oficina, más `retiredBy` y
  `retiredAt`), para que el calendario no vuelva a crear esas semanas. Después cancela **solo** las
  clases futuras sin reservas (`status: "cancelled"`, `cancelledBy:
"retire-duplicate-regyfit-series"`, `cancelledAt`). Las que tienen reservas las lista y no las
  toca. Nunca borra documentos.

### Paso C1. Entrar en el VPS

📍 Terminal A — VPS por SSH, usuario `root`.

```bash
cd /root/BPT-Jersey
```

Qué hace: se sitúa en el repositorio, desde donde se lanza el script.

Salida esperada: ninguna. Si dice `No such file or directory`, el repositorio no está ahí; avísame.

### Paso C2. Comprobar que el script está en esta copia

📍 Terminal A — VPS, `root`, en `/root/BPT-Jersey`.

```bash
ls apps/functions/scripts/run-retire-duplicates.sh
```

Qué hace: confirma que el commit con el script (y su lanzador `run-retire-duplicates.sh`) ya está en
`main` local.

Salida esperada: la misma ruta impresa. Si dice `No such file or directory`, primero hay que traer
el commit a `main`; avísame.

### Paso C3. Comprobar la clave de la cuenta de servicio

📍 Terminal A — VPS, `root`, en `/root/BPT-Jersey`.

```bash
ls /root/secrets/*adminsdk*.json
```

Qué hace: confirma que existe exactamente una clave de cuenta de servicio, la que usan los scripts de
operador para leer y escribir en Firestore. El lanzador de los pasos siguientes usa esa misma clave y
se niega a arrancar si hay cero o más de una.

Salida esperada: una sola línea, `/root/secrets/bptjersey-f5a25-firebase-adminsdk-fbsvc-....json`.
Si salen varias o ninguna: para aquí y avísame.

### Paso C4. Comprobar que la clave es del proyecto correcto

📍 Terminal A — VPS, `root`, en `/root/BPT-Jersey`.

```bash
grep -o '"project_id": *"[^"]*"' /root/secrets/*adminsdk*.json
```

Qué hace: muestra solo el campo `project_id` de la clave, sin ningún secreto.

Salida esperada: `"project_id": "bptjersey-f5a25"`. Si sale otro valor, no sigas. (El script también lo comprueba y se
niega a ejecutarse si la clave no coincide con `--project`.)

### Paso C5. Ejecutar la prueba en seco (no escribe nada)

📍 Terminal A — VPS, `root`, en `/root/BPT-Jersey`.

```bash
bash apps/functions/scripts/run-retire-duplicates.sh dryrun
```

Qué hace: el lanzador busca la clave de `/root/secrets/`, la pasa al script solo para esta ejecución
(nunca la muestra), fija `--project=bptjersey-f5a25` y `--academy=demo-academy` (`demo-academy` es,
literalmente, el id de la academia en producción), crea `/root/bpt-runbook/` con permisos 700 si no
existe y guarda la salida en `/root/bpt-runbook/dryrun-<fecha>.txt`.

Salida esperada: dos líneas del lanzador, `Key: bptjersey-f5a25-firebase-adminsdk-....json` y
`Output: /root/bpt-runbook/dryrun-....txt`; después la primera línea del script dice `Project bptjersey-f5a25, academy demo-academy, timezone
Europe/Jersey, dry-run`, después una tabla con columnas `importedSeriesId`, `nativeSeriesId`,
`locationId`, `weekday`, `localTime`, `title` (por ejemplo `regyfit-1420` junto a la serie nativa de
STRIVE BJJ West), la línea `Weekly series to stop (no new weeks from this date):` con una tabla
(`seriesId`, `fromIndex`, `from` = fecha y hora UTC de la primera semana que dejará de crearse), otra
tabla con cada clase futura (`sessionId`, `series`, `startAt`, `title`, `bookings`), un resumen
`S series to stop, R already stopped; N future sessions in T series; ...` y al final
`Dry-run: nothing written.`

Si sale `No duplicate Regyfit series found. Nothing to do.`: no hay nada que retirar; has terminado.
Si aparece alguna línea `<serie>: already stopped, N sessions left to cancel (M booked, kept)`: es una
serie que este script ya detuvo en una ejecución anterior; C7 solo cancelará sus `N` clases sin
reservas (no vuelve a detenerla) y dejará las `M` con reservas.
Si sale `Expected exactly one service-account key ...`, `Retirement failed.` con un error de
credenciales o `The key file belongs to ...`: repite C3 y C4.

### Paso C6. Revisar la lista (tú decides)

📍 Tu portátil o donde leas el archivo.

Abre el `/root/bpt-runbook/dryrun-<fecha>.txt` que indicó la línea `Output:` de C5 (o pídeme
que lo lea) y comprueba, pareja por pareja, que cada `importedSeriesId` es de verdad la misma clase que su `nativeSeriesId`. Si alguna
pareja no es un duplicado real, **no sigas**: avísame y ajustamos el criterio antes de aplicar.

Mira también las clases con `bookings` mayor que 0: `--apply` no las tocará; habrá que mover a esos
alumnos a la clase nativa o cancelarlas a mano desde el calendario.

### Paso C7. Aplicar

⚠️ **Escribe en producción.** Detiene las series listadas en C5 y cancela sus clases futuras sin
reservas. No borra nada (cada serie queda marcada con `retiredBy` y cada clase con `cancelledBy`),
pero no hay un botón para deshacerlo en bloque: hazlo solo después de revisar C6.

📍 Terminal A — VPS, `root`, en `/root/BPT-Jersey`.

```bash
bash apps/functions/scripts/run-retire-duplicates.sh apply
```

Qué hace: te pregunta `Write to bptjersey-f5a25 (academy demo-academy): ... [y/N]`; solo con `y`
continúa (cualquier otra respuesta: `Cancelled. Nothing written.`). Guarda la salida en
`/root/bpt-runbook/apply-<fecha>.txt`. El script repite la búsqueda; detiene cada serie en una transacción; después, clase por clase dentro
de una transacción, vuelve a comprobar que no tiene reservas activas antes de cancelarla.

Salida esperada: las mismas tablas que en C5, después `Stopped S weekly series.`,
`Cancelled N sessions.` y, si había clases con reservas, `Left untouched because they have bookings
...` con su tabla.

Si el comando se corta a mitad (red, terminal cerrada), vuelve a ejecutar exactamente el mismo
comando y responde `y` otra vez: las series que ya detuvo no se tocan otra vez y solo cancela las clases sin reservas que
falten.

---

## Verificación final

📍 Terminal A — VPS, `root`, en `/root/BPT-Jersey`.

```bash
bash apps/functions/scripts/run-retire-duplicates.sh verify
```

Qué hace: vuelve a ejecutar la prueba en seco después de aplicar y la guarda en
`/root/bpt-runbook/verify-<fecha>.txt`. En el resumen, `R already stopped` y
`N future sessions in T series` cuentan las clases futuras no canceladas que quedan de las series
retiradas.

Salida esperada, una de estas dos:

- `No duplicate Regyfit series found. Nothing to do.`: todo retirado y no queda ninguna clase futura
  de esas series. Terminado.
- Solo líneas `<serie>: already stopped, 0 sessions left to cancel (M booked, kept)` y en la tabla de
  clases únicamente filas con `bookings` mayor que 0: también es correcto. Esas `M` clases con
  reservas se quedan a propósito; muévelas a la clase nativa o cancélalas a mano desde el calendario
  y repite esta verificación.

Si alguna línea dice `N sessions left to cancel` con `N` mayor que 0, o aparece una tabla de parejas
(`importedSeriesId` / `nativeSeriesId`) o de `Weekly series to stop`, la aplicación no terminó: repite
C7 (es seguro repetirlo) y después esta verificación. Si sigue igual, mándame
el archivo `apply-<fecha>.txt` y el `verify-<fecha>.txt` de `/root/bpt-runbook/`.

Y en el móvil: **Admin → Classes & Services → Classes**, semana actual, sede West: STRIVE BJJ West
aparece una sola vez por hora, y no se ve ningún aviso rojo de App Check.
