# BPT Jersey Academy Platform

Plataforma de operacion y miembros para la academia BPT Jersey: sitio publico, area de cliente y
panel de administracion. Monorepo TypeScript con Next.js en el frontend, Firebase Cloud Functions de
segunda generacion en el backend, Firestore como base de datos y Cloudflare R2 para almacenamiento
privado.

Este documento es lo que hace falta para levantar el proyecto en una maquina nueva. Lo que hay que
construir esta en `tasks.md` y `tasksv2.md`; las decisiones de stack, en `STACK.md`.

---

## Requisitos

| Herramienta                | Version               | Para que                                                                                                                                                       |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**                | `>=22.13 <25`         | Todo. La version fijada en `package.json` (`engines`).                                                                                                         |
| **pnpm**                   | `11.20.0`             | Gestor de paquetes del monorepo. Se instala con Corepack, **no** con `npm i -g pnpm`.                                                                          |
| **Git**                    | cualquiera reciente   | Clonar y versionar.                                                                                                                                            |
| **JDK 21**                 | 21.x                  | **Solo** para los emuladores de Firebase (Firestore y Realtime Database corren sobre Java). Sin el, `pnpm test:rules` y todo lo que arranque emuladores falla. |
| **Chromium de Playwright** | lo instala Playwright | Solo para las pruebas E2E.                                                                                                                                     |

Node y pnpm bastan para instalar, compilar, tipar y correr las pruebas unitarias. El JDK y
Playwright solo hacen falta cuando toques reglas de Firestore o pruebas de navegador.

### Node.js

Ojo con la horquilla: **Node 25 no sirve**. Si usas varias versiones, `nvm-windows` o `fnm` te
dejan fijar una por proyecto.

```bash
node --version   # tiene que caer entre 22.13 y 24.x
```

### pnpm por Corepack

Corepack viene dentro de Node y lee la version exacta de `packageManager` en `package.json`, asi que
todos usamos la misma sin instalar nada global:

```bash
corepack enable
corepack pnpm --version   # 11.20.0
```

Si `corepack enable` falla por permisos en Windows, abre la terminal como administrador una sola vez.

### JDK 21 (solo emuladores)

En Windows, [Eclipse Temurin 21](https://adoptium.net/temurin/releases/?version=21) es el que usamos.

> **Trampa real de este proyecto.** Tener el JDK 21 instalado no basta: comprueba que
> `java -version` lo reporte de verdad. En la maquina del operador hay un Oracle Java 8 en
> `C:\Program Files (x86)\Common Files\Oracle\Java\java8path` que **tapa** al Temurin 21 en el
> `PATH`, y entonces firebase-tools se niega a arrancar los emuladores diciendo que falta Java.
> No hace falta desinstalar nada: antepon el JDK bueno para ese comando.
>
> ```bash
> export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"
> java -version   # ahora si: 21.x
> ```

---

## Puesta en marcha

```bash
git clone https://github.com/andresleosan/BPT-Jersey.git
cd BPT-Jersey
corepack enable
corepack pnpm install --frozen-lockfile
```

Despues, crea tu configuracion local a partir de la plantilla:

```bash
cp .env.example apps/web/.env.local
```

`.env.example` esta versionado y no lleva secretos; `.env.local` esta ignorado por git y **nunca**
se sube. Para desarrollo contra emuladores, estos dos valores son los que importan:

```ini
NEXT_PUBLIC_FIREBASE_ENV=local
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey
NEXT_PUBLIC_ACADEMY_ID=demo-academy
```

Los `NEXT_PUBLIC_FIREBASE_*` restantes son identificadores publicos de navegador, no credenciales de
Admin SDK. Para apuntar a un proyecto real necesitas que el operador te pase los suyos.

Comprueba que todo quedo bien antes de escribir codigo:

```bash
corepack pnpm typecheck
corepack pnpm test
```

Si esos dos pasan, el entorno esta listo.

---

## Estructura

```
apps/
  web/          Next.js 16 + React 19. Sitio publico, area de cliente y panel de administracion.
  functions/    Firebase Cloud Functions v2 (TypeScript). Callables, triggers y servicios.
packages/
  domain/       Contratos, esquemas zod y reglas de negocio. Sin dependencias de Firebase.
  ui/           Componentes compartidos.
  config/       Configuracion compartida.
qa/             Pruebas de reglas, integracion y E2E de Playwright.
docs/           ADRs, operaciones, seguridad y desarrollo.
Lista/          Tablero HTML de la primera version del proyecto.
Listav2/        Tablero HTML de la segunda version.
scripts/        Utilidades de release e inventario.
```

La regla que sostiene el diseño: **`packages/domain` no conoce Firebase**. Las reglas de negocio se
prueban sin emuladores, y `apps/functions` solo las conecta a la infraestructura.

---

## Comandos

Todos se lanzan desde la raiz con `corepack pnpm <script>`.

| Comando                     | Que hace                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `install --frozen-lockfile` | Instala exactamente lo que dice el lockfile. Usa siempre `--frozen-lockfile`.           |
| `typecheck`                 | `tsc --noEmit` en los seis paquetes del workspace.                                      |
| `lint`                      | ESLint con `--max-warnings 0`.                                                          |
| `format` / `format:check`   | Prettier, escribiendo o solo comprobando.                                               |
| `test`                      | Suite unitaria completa (vitest, proyectos `web` y `node`). Unos 2.500 tests, ~45 s.    |
| `test:unit:coverage`        | Lo mismo con cobertura.                                                                 |
| `test:rules`                | Reglas de Firestore y RTDB. **Necesita JDK 21**: arranca emuladores, corre y los apaga. |
| `test:e2e`                  | Playwright completo.                                                                    |
| `test:e2e:smoke`            | Solo los E2E marcados `@smoke`.                                                         |
| `test:integration`          | Pruebas de integracion.                                                                 |
| `firebase:emulators`        | Auth, Firestore, RTDB y Functions contra el proyecto `demo-bpt-jersey`.                 |
| `firebase:emulators:data`   | Igual pero sin Functions, cuando solo necesitas datos.                                  |
| `release:delta`             | Compara lo desplegado en produccion contra lo exportado y lo que el web invoca.         |

Para levantar el frontend:

```bash
corepack pnpm --filter @bpt-jersey/web dev     # http://127.0.0.1:3000
```

### La primera vez que corras E2E

Playwright necesita descargar su Chromium:

```bash
corepack pnpm --dir qa exec playwright install chromium
```

Se guarda en `.playwright-browsers/`, que esta ignorado.

---

## Emuladores de Firebase

El entorno local usa el proyecto **`demo-bpt-jersey`**. Un project ID que empieza por `demo-` no
puede alcanzar recursos reales de Firebase, asi que no hay forma de escribir en produccion ni de
generar factura por accidente mientras desarrollas.

Puertos (definidos en `firebase.json`, todos en `127.0.0.1`):

| Servicio          | Puerto |
| ----------------- | ------ |
| Auth              | 9099   |
| Functions         | 5001   |
| Firestore         | 8080   |
| Realtime Database | 9000   |
| Hosting           | 5000   |
| UI de emuladores  | 4000   |

```bash
export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"
corepack pnpm firebase:emulators
```

La CLI de Firebase (`firebase-tools`) ya viene como dependencia de desarrollo: **no la instales
global**, se usa la del repo.

Detalles del flujo de emuladores, incluidos los E2E autenticados de callables con App Check, en
[`docs/development/firebase-emulators.md`](docs/development/firebase-emulators.md).

> **Otra trampa de Windows.** El proyecto exporta unas 170 funciones y el descubrimiento por defecto
> de firebase-tools caduca a los 10 segundos, con lo que ninguna carga. Para el camino dorado y los
> E2E de emulador, exporta `FUNCTIONS_DISCOVERY_TIMEOUT=300000` antes de arrancar.
>
> Si la CLI se queja al escribir su configuracion, apunta `XDG_CONFIG_HOME` al directorio ignorado
> `.firebase-config` del propio repositorio.

---

## Desarrollar desde un VPS

Antes de montar nada, conviene tener claro **que papel juega el VPS aqui**, porque este proyecto no
lo necesita para funcionar:

- El frontend se compila a **estatico** (`output: "export"` en `apps/web/next.config.ts`) y se
  publica en Cloudflare Pages. No hay servidor Node en produccion.
- El backend son **Cloud Functions** en Firebase. Tampoco hay servidor propio.

Asi que un VPS aqui es una **maquina de desarrollo remota**, no un destino de despliegue: te da un
Linux estable, siempre encendido, donde compilar, correr las pruebas y levantar emuladores sin
depender de tu portatil. Todo lo de este README funciona igual; lo que cambia es la instalacion y
que no tienes navegador ni escritorio.

### Dimensionado

Los emuladores de Firestore y Realtime Database son procesos Java, y el `next dev` mas la suite de
pruebas suman lo suyo. Con **2 vCPU y 4 GB de RAM** se trabaja, pero justo: si vas a correr
emuladores y pruebas a la vez, pide **8 GB**. Reserva unos 10 GB de disco entre `node_modules`, el
cache de Next y el Chromium de Playwright.

### Instalacion en Ubuntu 22.04 / 24.04

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential openjdk-21-jdk-headless

# Node por fnm, para poder fijar la version del proyecto sin pelearte con apt
curl -fsSL https://fnm.vercel.app/install | bash
exec "$SHELL"
fnm install 24
fnm default 24

corepack enable
node --version    # entre 22.13 y 24.x
java -version     # 21.x, y aqui no hay ningun Java 8 tapandolo
```

Despues, exactamente lo mismo que en local:

```bash
git clone https://github.com/andresleosan/BPT-Jersey.git
cd BPT-Jersey
corepack pnpm install --frozen-lockfile
cp .env.example apps/web/.env.local
corepack pnpm typecheck && corepack pnpm test
```

En Linux el JDK correcto ya es el unico del sistema, asi que la trampa del `PATH` de Windows no
existe. La del descubrimiento de funciones si:

```bash
export FUNCTIONS_DISCOVERY_TIMEOUT=300000
```

Dejalo en tu `~/.bashrc` y te ahorras el fallo.

### Ver el navegador desde tu maquina

El servidor de desarrollo y todos los emuladores escuchan en `127.0.0.1` a proposito: no se exponen
a internet. La forma correcta de llegar a ellos no es abrir puertos en el firewall, es un **tunel
SSH** desde tu portatil:

```bash
ssh -L 3000:127.0.0.1:3000 \
    -L 4000:127.0.0.1:4000 \
    -L 5001:127.0.0.1:5001 \
    -L 8080:127.0.0.1:8080 \
    -L 9099:127.0.0.1:9099 \
    usuario@tu-vps
```

Con la sesion abierta, `http://localhost:3000` en tu navegador es el `next dev` del VPS y
`http://localhost:4000` es la UI de emuladores. Nada queda publicado.

> No cambies el bind a `0.0.0.0` para ahorrarte el tunel. Los emuladores no tienen autenticacion:
> exponerlos es entregar una base de datos abierta a quien escanee el puerto.

### Que el trabajo sobreviva a la desconexion

Una sesion SSH que se cae se lleva por delante lo que estuviera corriendo. Usa `tmux`:

```bash
sudo apt install -y tmux
tmux new -s bpt          # dentro: arranca dev y emuladores
# Ctrl-b d para salir dejandolo vivo
tmux attach -t bpt       # para volver
```

### Pruebas E2E sin escritorio

Playwright necesita librerias de sistema que un VPS pelado no trae. El instalador las pone:

```bash
corepack pnpm --dir qa exec playwright install --with-deps chromium
```

Corre en headless por defecto, asi que no hace falta ni pantalla ni Xvfb.

### Si de verdad quieres servir el sitio desde el VPS

Se puede, porque el build es estatico, pero hay una condicion que rompe todo si se pasa por alto:

```bash
corepack pnpm --filter @bpt-jersey/web build   # deja los estaticos en apps/web/out
```

Ese directorio lo sirve cualquier nginx o Caddy. **Pero las Cloud Functions solo aceptan
`https://bptjersey.pages.dev` en su lista CORS** (`apps/functions/src/auth/callable-options.ts:2`,
y tres archivos mas de callables), asi que un sitio servido desde otro dominio cargara bien y
fallara en cuanto llame a cualquier callable. Publicar desde un dominio propio exige anadir ese
origen a la lista y volver a desplegar las funciones: es un cambio de superficie de seguridad, no
de configuracion del servidor, y lo decide el operador.

Para previsualizar sin tocar nada, sirve `apps/web/out` en local del VPS y llega por el tunel SSH.

### Acceso a produccion desde el VPS

Solo si vas a leer o desplegar produccion. La CLI de Firebase es la del repo:

```bash
corepack pnpm exec firebase login --no-localhost   # imprime una URL, la abres en tu portatil
corepack pnpm exec firebase projects:list
```

`--no-localhost` es lo que hace que el OAuth funcione en una maquina sin navegador. No copies
credenciales de servicio al VPS mientras haya una alternativa interactiva.

---

## Lo que no esta en el repositorio

Clonar no basta para todo. Estas cosas no viajan en git y tienes que pedirlas o generarlas:

- **`apps/web/.env.local`** — tu copia de `.env.example`. Para trabajar contra emuladores te la
  puedes escribir tu; para apuntar a un proyecto real, los valores los tiene el operador.
- **Secretos de Cloud Functions** (`.firebase-functions/.secret.local`) — solo si vas a correr los
  E2E autenticados de emulador. Se generan sinteticos con
  `qa/scripts/generate-synthetic-emulator-secrets.mjs`; nunca uses los de produccion en local.
- **Credenciales de R2** — `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`. En emulador hay un
  sustituto en memoria y no hacen falta.
- **Acceso a Firebase y a Google Cloud** — para leer produccion o desplegar. Pideselo al operador.
- **El dataset real de miembros** — datos personales reales, deliberadamente fuera del repositorio
  (`apps/web/src/app/admin/real-members-data.ts` esta en `.gitignore`).

Nada de esto se inventa ni se sube: si algo falta, se pide.

---

## Antes de subir cambios

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Los cuatro tienen que pasar. Un par de avisos previos:

- `qa/unit/listav2-*.test.ts` falla si tocas `tasksv2.md` sin sincronizar `Listav2/Listav2.data.js`,
  o al reves. Los dos suben en el mismo cambio, y despues se reensambla el tablero con
  `node Listav2/build.mjs` (`Listav2.js` es generado: editarlo a mano se pierde).
- Ejecuta siempre los scripts que define `package.json`, no `tsc` o `vitest` sueltos: con otra
  configuracion producen fallos que no son regresiones reales.

---

## Donde esta la verdad del proyecto

| Archivo                   | Que contiene                                                                     |
| ------------------------- | -------------------------------------------------------------------------------- |
| `tasks.md` + `Lista/`     | Ledger y tablero de la primera version. Fuente de verdad de todo lo anterior.    |
| `tasksv2.md` + `Listav2/` | Ledger y tablero de la segunda version (bugs y funciones nuevas del 2026-09-09). |
| `STACK.md`                | Stack elegido, identidad visual y por que de cada decision.                      |
| `BRIEF.md`                | El encargo original y las decisiones de producto del operador.                   |
| `LECCIONES.md`            | Lo aprendido a base de equivocarse. Vale la pena leerlo antes de repetirlo.      |
| `AGENTS.md`               | Como trabajan los agentes en este repositorio.                                   |
| `docs/adr/`               | Decisiones de arquitectura, una por documento.                                   |
| `docs/operations/`        | Runbooks, DPIA, retencion y politicas.                                           |

El estado de una tarea se actualiza **en el ledger primero** y en el tablero despues, en el mismo
cambio logico.
