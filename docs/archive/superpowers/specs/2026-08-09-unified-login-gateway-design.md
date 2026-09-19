# Unified Login Gateway

**Fecha:** 2026-08-09
**Estado:** Pendiente de revisión final del operador
**Target web:** `https://bptjersey.pages.dev` (Cloudflare Pages)
**Identidad y autorización:** Firebase Authentication, custom claims y Firebase Functions

## Objetivo

Agregar una entrada de sesión unificada a la landing pública de BPT Jersey. La persona selecciona
`Administrator` o `Client`, y el formulario adapta el lenguaje, las acciones y el destino sin
convertir la selección visual en una concesión de permisos.

El cliente puede registrarse con email/contraseña o Google. El administrador puede iniciar sesión
con email/contraseña o Google, pero no puede registrarse públicamente: una cuenta administrativa
requiere invitación/provisionamiento y claims válidos.

### Incluido

- Botón único `Sign in` en el header de la landing.
- Ruta pública `/login` con selector de rol.
- Estado de autenticación de administrador.
- Estado de autenticación y registro de cliente.
- Inicio de sesión con email/contraseña y Google para ambos contextos.
- Recuperación de contraseña para email/contraseña.
- Redirección administrativa a `/admin`.
- Redirección de cliente a `/account` o `/shop` según el origen.
- Retorno al carrito después de autenticar al cliente durante checkout.
- Protección de checkout: no permite pagar sin sesión de cliente.
- Validación de rol y academia en backend.
- Estados de carga, error, sesión existente y cierre de sesión.
- Pruebas unitarias, integración de Auth/Functions y E2E por rol.

### Fuera de alcance

- Catálogo, carrito, órdenes, pagos o inventario completos.
- Registro o recuperación de cuentas administrativas.
- Elevación de privilegios desde la UI.
- Invitaciones administrativas completas si el flujo de provisioning existente no las expone aún.
- Social login distinto de Google.
- Checkout como invitado.

## Experiencia

### Entrada

La landing mantiene una sola acción `Sign in`. La ruta `/login` muestra una tarjeta de acceso con
selector segmentado, marca BPT Jersey y copy contextual.

- `Administrator`: `Team access`, copy orientado a operaciones, sin enlace de registro.
- `Client`: `Client account`, copy orientado a tienda, cuenta y progreso, con enlace de registro.

El selector tiene estados de teclado, foco visible, `aria-pressed` y una etiqueta accesible. En
mobile se mantiene en una sola columna y el formulario no depende de hover.

### Administrador

- Campos: email y contraseña.
- Acción secundaria: `Continue with Google`.
- Acciones auxiliares: `Forgot password?` y `Back to client access`.
- No se muestra `Create account`.
- Una sesión autenticada sin claims administrativas válidas recibe una pantalla de acceso no
  autorizado y no ve el shell administrativo.
- Una sesión con claims válidas navega a `/admin`.

### Cliente

- Campos: email y contraseña.
- Acción secundaria: `Continue with Google`.
- Acción de registro: `Create client account`.
- Registro requiere email/contraseña o Google y acepta los términos aplicables antes de habilitar
  compras cuando ese consentimiento exista en el flujo de comercio.
- Una sesión existente navega a `/account` por defecto.
- Si la entrada proviene de checkout, conserva un return URL interno allowlisted y vuelve al carrito
  después de autenticarse.

## Arquitectura

### Frontend

- Componente cliente aislado para el formulario y selector.
- Cliente Firebase inicializado solo en el navegador con configuración pública del proyecto de
  staging/producción correspondiente al build; nunca contiene Admin SDK ni service account.
- Métodos de Auth: `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`,
  `signInWithPopup(GoogleAuthProvider)` y `sendPasswordResetEmail`.
- El contexto seleccionado se conserva solo durante el flujo de login; no se trata como autoridad.
- La ruta de retorno se valida contra rutas internas allowlisted para evitar open redirects.

### Backend

- Firebase Auth emite el ID token.
- Functions valida `request.auth`, `academyId` y `role` desde claims verificadas.
- Roles administrativos válidos: `owner` y `administrator`.
- Usuarios clientes no reciben claims administrativas y no pueden llamar operaciones administrativas.
- La UI puede ocultar rutas, pero las Functions y Rules son la frontera efectiva.

### Datos de cliente

El registro crea la identidad Auth. Los perfiles, consentimientos, carrito y órdenes pertenecen a
las tareas de comercio posteriores y no se inventan en esta implementación. Si el flujo necesita
un documento base de cliente, debe ser mínimo, auditable y separado de los claims administrativos.

## Seguridad

- El selector de rol nunca escribe claims ni determina autorización.
- Admin registration no existe en cliente ni en endpoint público.
- El backend rechaza ausencia de Auth, claims inválidas, academia ausente o rol no administrativo.
- Los mensajes de login no revelan si un email existe.
- No se guardan contraseñas, tokens, cookies, storage state ni datos personales en Git, logs,
  screenshots o artefactos de QA.
- Google OAuth usa el dominio autorizado de Cloudflare Pages y los dominios locales de QA según
  ambiente.
- Checkout requiere sesión antes de crear una orden o iniciar pago.
- El return URL solo acepta rutas relativas allowlisted (`/shop`, `/account`, `/checkout`).
- Logout revoca la sesión local y devuelve a la landing o al login.

## Estados y errores

- Inicializando Auth: skeleton de tarjeta, sin contenido administrativo.
- Email inválido: validación local accesible.
- Credenciales inválidas: mensaje genérico y acción de recuperación.
- Popup cancelado o bloqueado: alternativa email/contraseña sin perder el contexto.
- Admin sin permisos: pantalla `Administrative access not authorized` sin shell ni datos.
- Cliente autenticado: destino contextual visible y navegable.
- Error de red/Functions: mensaje recuperable, sin stack trace ni detalles de infraestructura.
- Sesión expirada: limpieza local y retorno a `/login` conservando solo un return URL válido.

## Verificación

### Unitarias e integración

- Selector cambia contexto sin conceder permisos.
- Admin no muestra registro.
- Cliente muestra registro.
- Email/password y Google llaman los adaptadores correctos.
- Return URLs externas o no allowlisted son rechazadas.
- Claims `owner`/`administrator` autorizan; roles de cliente, ausencia de claims y academia
  incorrecta rechazan.
- Mensajes de error no contienen email existence leakage, tokens o stack traces.

### E2E

- Signed-out: `/login` muestra selector y no muestra shell ni datos.
- Cliente: registro/login, acceso a cuenta/tienda y bloqueo de checkout sin sesión.
- Cliente Google: flujo de proveedor en entorno dedicado o mock contractual controlado.
- Administrador: login con cuenta previamente provisionada y navegación a `/admin`.
- Cuenta autenticada sin claims administrativas: denegación visible y sin datos.
- Logout y sesión expirada.
- Desktop y mobile, foco de teclado, lector de etiquetas, contraste, sin overflow y sin errores
  de consola.

## Despliegue y rollback

- Build estático y variables públicas se publican únicamente al proyecto Cloudflare Pages objetivo.
- Firebase Functions/Auth/Firestore permanecen en el proyecto de backend configurado por ambiente.
- Antes de producción se requiere presupuesto/alerta de billing, dominios OAuth verificados y
  aprobación operativa explícita.
- Rollback frontend: restaurar el deployment anterior de Cloudflare Pages.
- Rollback backend: redeployar la revisión anterior de Functions; no borrar cuentas ni datos de
  clientes como parte del rollback visual.

## Criterio de aceptación

La tarea queda completa cuando una persona puede entrar por `Sign in`, elegir `Client`, crear o
usar su cuenta con email/contraseña o Google y llegar a su destino; una cuenta administrativa
provisionada puede elegir `Administrator` y entrar a `/admin`; una cuenta sin claims no puede entrar
al área administrativa; checkout bloquea usuarios anónimos; y las pruebas unitarias, de seguridad,
responsive y E2E pasan con evidencia real.
