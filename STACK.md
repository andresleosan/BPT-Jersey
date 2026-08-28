# STACK.md - BPT Jersey Academy Platform

## Resumen

Aplicación web responsive/PWA en inglés, construida como monolito modular TypeScript con Next.js
y React, Firebase como plataforma operativa y Cloudflare R2 para almacenamiento privado. El MVP
vigente es un piloto aislado con pagos manuales y avisos in-app; no incluye nuevas escrituras o
despliegues productivos, cobros online ni mensajería externa.

## Nivel del proyecto

**3 - empresarial.** El sistema combina operación multi-módulo, permisos por rol, datos de menores y salud, pagos, auditoría, comunicaciones y obligaciones de continuidad.

- Ciclo de autocrítica completo: **sí**, con seguridad, QA, rendimiento antes de releases grandes y evidencia verificable.
- Workflow de Superpowers: **activo en la sesión OpenCode vigente** para diseño, planificación, TDD
  y verificación. La ejecución previa bajo Codex aplicó la disciplina equivalente sin asumir
  compatibilidad nativa.
- Clasificación y stack: **aceptados por el operador en A2.1 el 2026-08-06**.

## Entorno

- Plataforma activa al 2026-08-18: OpenCode. El proyecto conserva configuración para Codex y VS
  Code, pero esas plataformas no describen la sesión actual.
- OpenCode MCP: `@playwright/mcp@0.0.79 --extension` verificado contra la pestaña Regyfit en modo
  read-only. La conexión solo existe mientras el operador la autoriza en el navegador.
- Runtime local detectado: Node.js v24.18.0.
- Gestor de paquetes: pnpm 11.20.0 mediante Corepack, verificado en el entorno.
- Superpowers instalado y utilizado: sí, en OpenCode.

## Frontend

- Tecnología: Next.js 16.3.0, React 19.2.8 y TypeScript 6.0.3, con salida estática para Cloudflare Pages y experiencia PWA responsive.
- Por qué: permite combinar sitio público indexable y aplicación autenticada en un solo proyecto, tipado de extremo a extremo y despliegue estático en Cloudflare Pages sin introducir un servidor web adicional para el camino normal.
- Idioma: todo el contenido visible al usuario será inglés.

## Identidad visual (`design-benchmark`)

- Referencias reales consultadas:
  - BPT Jersey (`https://bptjersey.com/`) y sus redes oficiales: identidad real, comunidad, clases infantiles/adultas y voz de la academia.
  - Gymdesk (`https://gymdesk.com/software/martial-arts`): claridad operativa, navegación simple, CTA directo y presentación visual del producto.
  - Kicksite (`https://kicksite.com/martial-arts-management-software/`): flujos específicos de martial arts, check-in visible, belt progression y organización por problemas del propietario.
  - Zen Planner (`https://zenplanner.com/mma-gym-software/`): reporting, agenda, member self-service y comunicación de una suite madura.
- Patrones comunes detectados: navegación lateral en la aplicación autenticada; dashboard por prioridades; búsqueda global; acciones primarias visibles; perfiles unificados; estados con etiquetas; tablas que se adaptan a tarjetas en móvil; marketing público orientado a ahorro de tiempo y crecimiento.
- Diferenciación buscada: BPT debe sentirse como una academia de combate disciplinada y cercana, no como software fitness genérico. Check-in, menores presentes, pagos pendientes y próxima clase tendrán jerarquía operativa superior a métricas decorativas.
- Logo oficial verificado visualmente: `F:\Proyectos\BPT Jersey\Img\Logo.PDF`; tigre blanco sobre campo violeta, aro y lettering oscuros.
- Design DNA - paleta:
  - `#2F2483` — **BPT Purple**, identidad, navegación activa y acciones principales.
  - `#1A1A18` — **Mat Ink**, encabezados, fondos oscuros y texto de alto contraste.
  - `#FFFFFF` — **Gi White**, superficies, respiración visual y contraste del emblema.
  - `#F2F1ED` — **Canvas**, fondo neutro cálido para reducir fatiga frente al blanco puro.
- Design DNA - tipografía: **Barlow Condensed** para títulos, números y señalización por su carácter deportivo y compacto; **Source Sans 3** para navegación, formularios, tablas y texto por su legibilidad en interfaces densas.
- Design DNA - tono: **disciplinado, enérgico y confiable**; directo en operaciones, positivo en progreso y especialmente cuidadoso al comunicar datos infantiles.
- Interacción: movimiento breve y funcional (feedback de check-in, cambio de estado, drawers), respetando `prefers-reduced-motion`; no se usarán animaciones decorativas que retrasen tareas de recepción.
- Defaults genéricos que se evitan explícitamente: degradados morado/azul tipo startup; mosaicos de métricas sin prioridad; exceso de cards redondeadas; fotografías de stock de gimnasio occidental que no representen BJJ ni a la comunidad real de BPT.

## Backend

- Tecnología: Firebase Cloud Functions de segunda generación con TypeScript; endpoints HTTP/callable y triggers controlados.
- Por qué: mantiene privilegios, integraciones de pago, URLs firmadas de R2, auditoría y procesos asíncronos fuera del cliente; comparte lenguaje y tipos con el frontend.
- Patrón: capa de aplicación por módulos y adaptadores para proveedores externos. Ningún webhook o cambio financiero confía en datos enviados por el navegador.

## Base de datos

- Motor canónico: Cloud Firestore Standard.
- Tiempo real efímero: Firebase Realtime Database solo para presencia/estado operativo no canónico cuando aporte valor medible.
- Por qué: Firestore ofrece reglas de seguridad, transacciones, consultas e integración con Functions. RTDB no duplicará membresías, pagos, evaluaciones ni auditoría; esos registros permanecen en Firestore.
- Integridad: pagos, consentimientos, asistencia y cambios sensibles usan eventos idempotentes, historial inmutable y soft delete/estado cuando corresponda.

## Levels y progreso IBJJF

- Fuente vinculante: los DOCX aprobados gobiernan edades, clases y tiempo; el inventario Regyfit
  read-only gobierna jerarquía, orden, colores, cantidad de stripes y habilidades observadas.
- Inventario sanitizado: `docs/data/ibjjf-levels-observed.sanitized.json`, schema 1, hash de
  contenido `9b039b795f8178c42730ff567ef9283fb385895368115ac2621ce816a829835a`.
- Cobertura observada: 171 definiciones, 27 belts, 144 stripes y 11 habilidades iniciales. No
  contiene IDs fuente, HTML, códigos de acción, tokens, cookies ni datos personales.
- Persistencia: `levelSystems`, `levelDefinitions`, `levelRequirements`, `studentLevelProgress` y
  `levelPromotions` como subcolecciones de `academies/{academyId}`.
- Versionado: una definición publicada queda inmutable. Los estudiantes conservan la versión usada
  para su evaluación; editar requisitos crea una versión nueva.
- Herencia: requisitos de técnicas distinguen `inherit`, `replace` y `none`; un array vacío de la
  fuente no se interpreta automáticamente como ausencia de requisito.
- Promoción: asistencia y skills solo generan elegibilidad/propuesta. Head coach es el único actor
  que aprueba o rechaza belts/stripes, siempre con auditoría.
- UI: `/admin/levels` para owner/head coach, `/coach/levels` para consulta y seguimiento asignado,
  y `/account/progress` para progreso propio/familiar. Los belts se renderizan mediante SVG propio,
  sin copiar HTML de Regyfit.

## Almacenamiento de archivos

- Servicio: Cloudflare R2 Standard en bucket privado.
- Uso previsto: waivers, documentos firmados, comprobantes y contenido multimedia; los metadatos y permisos viven en Firestore.
- Acceso: URLs firmadas de corta duración emitidas por Functions, validando usuario, rol y relación familiar antes de cada acceso.
- Restricción: la ubicación/jurisdicción de datos y el tratamiento de documentos médicos deben validarse antes de producción.

## Hosting / Despliegue

- Servicio: Cloudflare Pages para el frontend estático/PWA (`https://bptjersey.pages.dev`); Firebase Cloud Functions para backend.
- Build de Pages: ejecutar `next build` desde `apps/web` y publicar `apps/web/out`.
- Variables de Pages: configurar los seis `NEXT_PUBLIC_FIREBASE_*` públicos por entorno, `NEXT_PUBLIC_FIREBASE_ENV=staging` (o `production`) y `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false`; nunca configurar material de Admin SDK en el frontend. La guardia de build/runtime rechaza emuladores fuera de `local`.
- CI actual: GitHub Actions ejecuta calidad, Rules, build y smoke sintético. No existe todavía CD,
  GitHub Environments, aprobación automatizada por entorno ni rollback reproducible; completarlos
  pertenece a `T057` y no se presentan como disponibles.
- Por qué: conserva el frontend estático independiente de Functions y fija el target aprobado de Cloudflare Pages.
- Producción: prohibida hasta cumplir las cinco condiciones de despliegue de Cronos.

## Testing

- Herramientas: Vitest, React Testing Library, Firebase Emulator Suite, pruebas de Security Rules y
  Playwright E2E. El piloto prueba finanzas manuales; los contratos de webhooks/cobros online se
  exigirán cuando esa integración post-piloto exista.
- Estrategia Nivel 3: unitarias para dominio, integración contra emuladores, E2E por rol y flujos críticos, contratos de integraciones, carga sobre check-in/dashboard y restauración de backups.
- Playwright MCP configurado: **sí**. `.codex/config.toml` y `opencode.json` usan
  `@playwright/mcp@0.0.79`; OpenCode añade `--extension` para reutilizar una pestaña autenticada solo
  cuando el operador la conecta. El handshake read-only de `T083` fue verificado sin conservar
  storage, cookies o tokens.
- Suite E2E: `qa/tests/`.
- Evidencia histórica más reciente: `tasks.md` registra suites amplias hasta el 2026-08-12 y CI
  smoke el 2026-08-13. No existe todavía una corrida fresca del release candidate completo; P7 debe
  repetir todos los gates antes de aprobar el piloto.

## Fases de entrega del MVP aprobado

1. **P0 - seguridad y alcance:** bloquear el importador production-as-staging, reconciliar los gates
   de Auth y consolidar DOCX/Regyfit como fuentes.
2. **P1 - registro:** adultos, familias, menores, tutores, salud mínima, disclaimers y sedes.
3. **P2 - membresías:** catálogo, lifecycle, pagos manuales, deuda PAYG, invoices y penalizaciones.
4. **P3 - operación:** staff, grupos, currículo, clases, seminarios, booking, capacidad y mínimo.
5. **P4 - tatami:** QR, GPS asistido, manual/cash, check-in/out, asistencia y puntualidad.
6. **P5 - progreso:** técnicas, evaluaciones, levels, belts/stripes, rachas, reconocimiento,
   comparación adulta opt-in, propuestas y aprobación humana.
7. **P6 - portales:** owner/admin, coach, miembro/tutor, avisos internos, cumpleaños y reportes.
8. **P7 - cierre del piloto:** seguridad, Rules, contratos, integración, E2E por rol, accesibilidad,
   carga, restauración y rollback.

Cada fase trabaja con WIP=1 desde `tasks.md`, reemplaza previews por persistencia real y exige
evidencia fresca antes de pasar a revision. El gate local usa verify:mvp con build normal y build:e2e-synthetic; CI conserva build normal, sin NEXT_PUBLIC_ADMIN_E2E como sustituto de Auth real de staging.

## Integraciones externas

- Firebase Authentication: email/password y Google; Email/Password y Google deben estar habilitados en cada proyecto. Los dominios autorizados deben incluir `bptjersey.pages.dev` y el origen local de QA. MFA queda fuera del rediseño aprobado del panel administrativo. Phone Auth queda pendiente de justificación.
- Firebase Emulator Suite: uso exclusivamente local. Un `.env.local` no versionado puede declarar `NEXT_PUBLIC_FIREBASE_ENV=local` y `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`; los builds de Cloudflare Pages, staging y producción deben declarar el entorno correspondiente y `false`. No se acepta un flag de emulador verdadero en esos entornos.
- Autorización de Auth: la selección Administrator/Client es solo contexto de UX. Las cuentas administrativas se provisionan fuera del registro público y Functions/Rules validan `academyId` más el acceso administrativo. Los administradores aprobados operan el panel, pero solo el claim `owner` puede conceder o revocar accesos administrativos. Cliente y administrador quedan sin MFA en este rediseño aprobado.
- MFA TOTP: queda fuera del alcance del panel administrativo aprobado. No se implementan enrolamiento, desafíos ni secretos MFA en estos flujos; Phone/SMS Auth queda deliberadamente fuera.
- Pagos del piloto: registros manuales/cash auditables, invoices y receipts internos. El proveedor
  para Jersey, hosted checkout y webhooks firmados quedan para una fase productiva posterior.
- Cloudflare R2: almacenamiento privado compatible con S3.
- Email/SMS transaccional: proveedor por confirmar; comunicación a menores debe permanecer visible al tutor. T046 deja una frontera provider-independent y un historial tenant-scoped; no se realizan llamadas externas mientras no exista proveedor y credencial aprobados.
- Canales de marca: sitio, Instagram y Facebook oficiales como fuentes de contenido, no como dependencias operativas del MVP.

## Costo

- Firebase: plan Blaze obligatorio para Cloud Functions y Phone Auth. En escala inicial de una sola academia se estima **USD 0-25/mes** de infraestructura si el uso permanece cerca de las cuotas gratuitas; escenario de crecimiento inicial: **USD 25-100/mes**, excluyendo SMS y comisiones de pago.
- Cloudflare R2 Standard: estimado **USD 0/mes** hasta 10 GB-mes, 1 millón de operaciones Clase A y 10 millones Clase B; fuera de eso, USD 0.015/GB-mes, USD 4.50/millón Clase A y USD 0.36/millón Clase B. Egress directo desde R2: sin cargo.
- Firestore Standard: 1 GiB, 50,000 lecturas/día, 20,000 escrituras/día, 20,000 borrados/día y 10 GiB/mes de egress incluidos antes de cobro por uso.
- Realtime Database: 1 GB almacenado y aproximadamente 10 GB/mes descargado sin costo; Spark limita a 100 conexiones simultáneas, Blaze admite hasta 200,000 por base.
- Cloud Functions: hasta 2 millones de invocaciones mensuales sin costo dentro de Blaze, además de cuotas de cómputo y red.
- Authentication: 50,000 MAU sin costo aplica a Blaze con Identity Platform; Phone Auth se factura por SMS y no se presupuestará como “10,000 verificaciones gratuitas”.
- Pagos y mensajería: costo pendiente hasta elegir proveedores y volumen. T034 adapter unconfigured: USD 0/mes comprometidos; T035/T036 siguen sin activación. T046 tiene costo externo comprometido **USD 0/mes** mientras permanece en modo unconfigured; al seleccionar proveedor se debe documentar rango mensual, límite/alerta de facturación y aprobación del operador antes de activarlo.
- T010 investigacion oficial 2026-08-27: PayPal (primera opcion a validar), Adyen (alternativa de escala) y Revolut Business (condicionada); Stripe descartado para entidad de Jersey. Fuentes y limites en docs/operations/payment-provider-decision-packet.md.
- T010 permanece bloqueada: no hay proveedor seleccionado, cuenta, credenciales, cobro ni gasto. Antes de activar se requieren seleccion explicita, cotizacion/terminos, onboarding, alertas y pruebas sandbox.
- Alertas configuradas: **no**. El repositorio de Artifact Registry de staging tiene cleanup policy de 7 días; aún deben crearse presupuestos/alertas de Google Cloud y notificaciones de Cloudflare. Firebase/Google Cloud no se tratará como un hard cap automático.
- Fuentes verificadas el 2026-08-06: https://firebase.google.com/pricing, https://firebase.google.com/docs/auth/limits y https://developers.cloudflare.com/r2/pricing/.

## Gestión de secretos

- `.gitignore` instalado y completado: sí; cubre secretos, dependencias, cachés locales, builds y artefactos de QA.
- `.env.example`: sí; contiene solo nombres de variables y el project ID seguro `demo-bpt-jersey`, sin credenciales reales.
- Producción: Secret Manager/secretos de Functions y secretos cifrados del CI. Las credenciales de R2 y proveedores nunca llegan al cliente.
- Firebase Web config no se trata como secreto; la seguridad depende de Rules, App Check, Auth y validación de backend.
- Los artefactos históricos opt-in de `T017_MFA_*` no forman parte del piloto aprobado y no deben
  ejecutarse en CI, staging o producción. Se conservarán o retirarán al reconciliar ADR-005 con el
  threat model antes de cualquier release productiva.

## Gates de seguridad abiertos

- `bptjersey-f5a25` es producción, nunca staging. El runner de importación PDF que acepta ese
  proyecto bajo `target: staging` es un hallazgo crítico y permanece bloqueado hasta separar
  explícitamente los entornos y confirmaciones. No se ejecutará ninguna importación durante el MVP.
- La decisión ADR-005 de operar sin MFA solo se acepta para el piloto con datos sintéticos o
  sanitizados. Producción continúa bloqueada hasta reconciliar el threat model, MFA o mitigaciones
  compensatorias con aceptación explícita del operador.
- La política de retención/residencia de `T011`, backup integral, presupuestos, alertas y monitoreo
  siguen siendo gates de producción; no se presentan como resueltos por el piloto.
- La primera conexión de Playwright expuso un token efímero en salida de herramientas. La
  inspección se detuvo, el operador rotó el token y el relevamiento continuó sin enumerar la URL de
  conexión. Ningún valor se guardó en archivos del proyecto.

## Decisiones de arquitectura

1. **Monolito modular en monorepo pnpm**, no microservicios: una sola academia y un solo equipo no justifican coordinación distribuida. Los límites de módulo permiten extraer servicios más adelante.
2. **Firestore como fuente canónica y RTDB solo efímero**: evita dos verdades para pagos, asistencia o progreso.
3. **Frontend estático/PWA en Cloudflare Pages y backend en Functions**: evita App Hosting/Cloud Run para el camino principal y mantiene costos/operación predecibles.
4. **R2 privado mediante adaptador de almacenamiento**: reduce costo de objetos y egress sin acoplar el dominio a la API S3.
5. **Integraciones asíncronas solo donde existen consumidores reales**: webhooks, notificaciones y reportes lentos; no se introduce event sourcing general ni colas “por si acaso”.
6. **Levels versionados y propios, sin sincronización Regyfit**: el inventario observado se usa como
   seed sanitizado; BPT conserva su propio contrato, historial y aprobación humana.

Alternativas descartadas:

- Microservicios desde el inicio: complejidad operativa sin equipos ni escalado independientes.
- Realtime Database como base principal: consultas y modelo menos adecuados para el dominio multi-módulo y el historial auditable.
- Guardar archivos privados directamente en Firebase/Cloud Storage: viable, pero R2 fue indicado como restricción y ofrece egress directo sin cargo; se conserva un adaptador para poder migrar.
- Apps iOS/Android nativas en el MVP: duplican esfuerzo antes de validar los flujos web.

## Modelo recomendado

- Modelo activo en esta sesión OpenCode: `gpt-5.6-sol`, informado por el runtime. El proyecto no
  fija un modelo OpenCode propio en `opencode.json`.
- Configuración histórica Codex: `gpt-5.6-luna` con esfuerzo `xhigh`, confirmada por el operador el
  2026-08-06 y conservada en `.codex/config.toml` para esa plataforma.
- Alterno ante caída del proveedor: no hay bloques `[model_providers.*]` configurados. Es una limitación conocida; antes de la auditoría de seguridad conviene conectar un proveedor/modelo distinto y fuerte para reducir el punto ciego de autoauditoría.

## Convenciones de código

- Estilo: TypeScript estricto, ESLint/formatter automatizado, validación de entradas con Zod y funciones pequeñas orientadas al dominio.
- Estructura: monorepo pnpm con `apps/web`, `apps/functions`, `packages/domain`, `packages/ui`, `packages/config` y `qa/`.
- Nomenclatura: código y contratos en inglés; componentes `PascalCase`, funciones/variables `camelCase`, archivos descriptivos en `kebab-case`.
- Dependencias: versiones fijadas por lockfile; toda instalación se realiza con pnpm.
