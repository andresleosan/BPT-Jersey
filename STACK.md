# STACK.md - BPT Jersey Academy Platform

## Resumen

Aplicación web responsive/PWA en inglés, construida como monolito modular TypeScript con Next.js y React, Firebase como plataforma operativa y Cloudflare R2 para almacenamiento privado de archivos.

## Nivel del proyecto

**3 - empresarial.** El sistema combina operación multi-módulo, permisos por rol, datos de menores y salud, pagos, auditoría, comunicaciones y obligaciones de continuidad.

- Ciclo de autocrítica completo: **sí**, con seguridad, QA, rendimiento antes de releases grandes y evidencia verificable.
- Workflow completo de Superpowers: **no disponible en Codex CLI según el adaptador de Cronos**. Se aplicará la disciplina equivalente con las skills instaladas, pruebas, revisión y checkpoints; no se asumirá compatibilidad de OpenCode.
- Clasificación y stack: **aceptados por el operador en A2.1 el 2026-08-06**.

## Entorno

- Plataforma de orquestación: Codex; el ejecutable `codex` no está disponible en el shell compartido, por lo que no fue posible capturar su versión CLI.
- Compatibilidad con el core: el adaptador fue verificado documentalmente al 2026-08-03; esta sesión no permite una verificación empírica mediante `codex --version`.
- Runtime local detectado: Node.js v24.18.0.
- Gestor de paquetes: pnpm 11.20.0 mediante Corepack, verificado en el entorno.
- Superpowers instalado: no aplica en Codex CLI.

## Frontend

- Tecnología: Next.js 16.3.0, React 19.2.8 y TypeScript 6.0.3, con salida estática donde sea posible y experiencia PWA responsive.
- Por qué: permite combinar sitio público indexable y aplicación autenticada en un solo proyecto, tipado de extremo a extremo y despliegue en Firebase Hosting sin introducir un servidor web adicional para el camino normal.
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

## Almacenamiento de archivos

- Servicio: Cloudflare R2 Standard en bucket privado.
- Uso previsto: waivers, documentos firmados, comprobantes y contenido multimedia; los metadatos y permisos viven en Firestore.
- Acceso: URLs firmadas de corta duración emitidas por Functions, validando usuario, rol y relación familiar antes de cada acceso.
- Restricción: la ubicación/jurisdicción de datos y el tratamiento de documentos médicos deben validarse antes de producción.

## Hosting / Despliegue

- Servicio: Firebase Hosting para frontend estático/PWA; Firebase Cloud Functions para backend.
- CI/CD: GitHub Actions con entornos separados (`dev`, `staging`, `production`), emuladores y aprobación manual para producción.
- Por qué: reduce componentes operativos y conserva despliegue independiente de frontend y Functions.
- Producción: prohibida hasta cumplir las cinco condiciones de despliegue de Cronos.

## Testing

- Herramientas: Vitest, React Testing Library, Firebase Emulator Suite, pruebas de Security Rules, Playwright E2E y pruebas contractuales de webhooks/pagos.
- Estrategia Nivel 3: unitarias para dominio, integración contra emuladores, E2E por rol y flujos críticos, contratos de integraciones, carga sobre check-in/dashboard y restauración de backups.
- Playwright MCP configurado: **sí** en `.codex/config.toml`, fijado a `@playwright/mcp@0.0.79`; no estuvo expuesto como herramienta en esta sesión, por lo que la validación se ejecutó con Playwright CLI.
- Suite E2E: `qa/tests/`.
- Última corrida (2026-08-06): build estático aprobado; smoke desktop/móvil 2/2 y estabilidad repetida 10/10, sin errores de consola ni overflow horizontal.

## Integraciones externas

- Firebase Authentication: email/password y Google inicialmente; MFA obligatorio para owner/admin. Phone Auth queda pendiente de justificación.
- Proveedor de pagos: por confirmar para Jersey, detrás de una interfaz independiente; hosted checkout y webhooks firmados.
- Cloudflare R2: almacenamiento privado compatible con S3.
- Email/SMS transaccional: proveedor por confirmar; comunicación a menores debe permanecer visible al tutor.
- Canales de marca: sitio, Instagram y Facebook oficiales como fuentes de contenido, no como dependencias operativas del MVP.

## Costo

- Firebase: plan Blaze obligatorio para Cloud Functions y Phone Auth. En escala inicial de una sola academia se estima **USD 0-25/mes** de infraestructura si el uso permanece cerca de las cuotas gratuitas; escenario de crecimiento inicial: **USD 25-100/mes**, excluyendo SMS y comisiones de pago.
- Cloudflare R2 Standard: estimado **USD 0/mes** hasta 10 GB-mes, 1 millón de operaciones Clase A y 10 millones Clase B; fuera de eso, USD 0.015/GB-mes, USD 4.50/millón Clase A y USD 0.36/millón Clase B. Egress directo desde R2: sin cargo.
- Firebase Hosting: 10 GB de almacenamiento y 360 MB/día de transferencia sin costo; excedentes facturados en Blaze.
- Firestore Standard: 1 GiB, 50,000 lecturas/día, 20,000 escrituras/día, 20,000 borrados/día y 10 GiB/mes de egress incluidos antes de cobro por uso.
- Realtime Database: 1 GB almacenado y aproximadamente 10 GB/mes descargado sin costo; Spark limita a 100 conexiones simultáneas, Blaze admite hasta 200,000 por base.
- Cloud Functions: hasta 2 millones de invocaciones mensuales sin costo dentro de Blaze, además de cuotas de cómputo y red.
- Authentication: 50,000 MAU sin costo aplica a Blaze con Identity Platform; Phone Auth se factura por SMS y no se presupuestará como “10,000 verificaciones gratuitas”.
- Pagos y mensajería: costo pendiente hasta elegir proveedores y volumen.
- Alertas configuradas: **no**. Antes de staging deben crearse presupuestos/alertas de Google Cloud y notificaciones de Cloudflare; Firebase/Google Cloud no se tratará como un hard cap automático.
- Fuentes verificadas el 2026-08-06: https://firebase.google.com/pricing, https://firebase.google.com/docs/auth/limits y https://developers.cloudflare.com/r2/pricing/.

## Gestión de secretos

- `.gitignore` instalado y completado: sí; cubre secretos, dependencias, cachés locales, builds y artefactos de QA.
- `.env.example`: sí; contiene solo nombres de variables y el project ID seguro `demo-bpt-jersey`, sin credenciales reales.
- Producción: Secret Manager/secretos de Functions y secretos cifrados del CI. Las credenciales de R2 y proveedores nunca llegan al cliente.
- Firebase Web config no se trata como secreto; la seguridad depende de Rules, App Check, Auth y validación de backend.

## Decisiones de arquitectura

1. **Monolito modular en monorepo pnpm**, no microservicios: una sola academia y un solo equipo no justifican coordinación distribuida. Los límites de módulo permiten extraer servicios más adelante.
2. **Firestore como fuente canónica y RTDB solo efímero**: evita dos verdades para pagos, asistencia o progreso.
3. **Frontend estático/PWA en Firebase Hosting y backend en Functions**: evita App Hosting/Cloud Run para el camino principal y mantiene costos/operación predecibles.
4. **R2 privado mediante adaptador de almacenamiento**: reduce costo de objetos y egress sin acoplar el dominio a la API S3.
5. **Integraciones asíncronas solo donde existen consumidores reales**: webhooks, notificaciones y reportes lentos; no se introduce event sourcing general ni colas “por si acaso”.

Alternativas descartadas:

- Microservicios desde el inicio: complejidad operativa sin equipos ni escalado independientes.
- Realtime Database como base principal: consultas y modelo menos adecuados para el dominio multi-módulo y el historial auditable.
- Guardar archivos privados directamente en Firebase/Cloud Storage: viable, pero R2 fue indicado como restricción y ofrece egress directo sin cargo; se conserva un adaptador para poder migrar.
- Apps iOS/Android nativas en el MVP: duplican esfuerzo antes de validar los flujos web.

## Modelo recomendado

- Modelo activo: `gpt-5.6-luna`, esfuerzo de razonamiento `xhigh`, detectado en `~/.codex/config.toml`.
- Recomendación A3 para arquitectura/backend inicial: mantener `gpt-5.6-luna` con `xhigh`; el proyecto Nivel 3 requiere razonamiento sostenido, contexto amplio y tool-calling confiable.
- Estado: confirmado por el operador en A3 el 2026-08-06 y escrito en `.codex/config.toml`.
- Alterno ante caída del proveedor: no hay bloques `[model_providers.*]` configurados. Es una limitación conocida; antes de la auditoría de seguridad conviene conectar un proveedor/modelo distinto y fuerte para reducir el punto ciego de autoauditoría.

## Convenciones de código

- Estilo: TypeScript estricto, ESLint/formatter automatizado, validación de entradas con Zod y funciones pequeñas orientadas al dominio.
- Estructura: monorepo pnpm con `apps/web`, `apps/functions`, `packages/domain`, `packages/ui`, `packages/config` y `qa/`.
- Nomenclatura: código y contratos en inglés; componentes `PascalCase`, funciones/variables `camelCase`, archivos descriptivos en `kebab-case`.
- Dependencias: versiones fijadas por lockfile; toda instalación se realiza con pnpm.
