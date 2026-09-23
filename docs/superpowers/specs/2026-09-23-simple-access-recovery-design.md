# Registro sin verificación de email y waiver obligatorio (recuperación retirada)

> **Cambio de alcance 2026-09-23 (Luis):** se ELIMINA la recuperación de acceso de socios antiguos.
> La base de datos de miembros queda intacta; los duplicados los resuelve el owner a mano. Siguen en
> vigor D8, D10, D11, D12 y D13 y los arreglos de `/enrol`. D1–D7 y D9 quedan **retiradas**. Se quitan
> `/login/recover`, su enlace en el login y la pestaña "Member access recovery"; el backend queda sin uso.

Fecha: 2026-09-23. Decisiones fijadas por el operador (Luis) en conversación, una a una.
Sustituye, para la recuperación, el diseño `2026-09-18-legacy-member-recovery-design.md`
(aprobación manual obligatoria + verificación de email).

## Problema

- La recuperación exige verificación de email y aprobación manual del owner en todos los casos; la
  cola del owner no explica por qué **Approve recovery** está deshabilitado (sin candidato) y la
  búsqueda por nombre es exacta.
- Un socio antiguo no puede declarar qué le falta (suscripción, hijos, nivel) ni pagar desde el flujo.
- `/enrol` bloquea a los tutores hasta verificar el email y tiene fallos en el pago de los hijos
  (a localizar con Playwright).
- El waiver de `/account` (63ee24d) es un panel ignorable: nadie queda obligado a aceptarlo.

## Decisiones

| # | Decisión | Fuente |
|---|---|---|
| D1 | La recuperación pide **nombre completo + fecha de nacimiento + email antiguo (opcional)**. | Luis P1 |
| D2 | Una **coincidencia única** da acceso **al instante**. El owner la ve después en **Recovered – to confirm** (nombre, progreso/cinturón, email) con **Confirm** o **Undo** (Undo retira el enlace y el acceso). | Luis P2 |
| D3 | Coincidencia = nombre **parecido** (sin tildes ni mayúsculas, orden libre, admite que falte un segundo nombre/apellido, 1–2 errores de letra) **y** fecha de nacimiento **exacta**. Varias coincidencias, fecha distinta o email antiguo coincidente con nombre distinto → cola del owner con candidatos sugeridos. Sin nada parecido → aviso y botón **Register as a new member** (`/enrol`). Se acepta revelar que un nombre no existe. | Luis P3, P4 |
| D4 | Suscripción: la que ya exista en la app se conserva. Si el archivo Regyfit tiene un periodo vigente, se crea sola con el plan equivalente (tabla monto+edad aprobada, `equivalencias-planes.json`) como `previously-paid`, sin factura. Si el socio dice que pagó y el archivo no lo respalda, elige plan y fecha de fin; el owner confirma y **no reserva** hasta entonces. Sin suscripción → elige plan y paga por transferencia (referencia + justificante). | Luis P3 (ramas) |
| D5 | Primera pregunta: **Just me / Me and my children / Only my children**. Cada hijo se busca por nombre + fecha (regla D3). Hijo encontrado → se enlaza a la cuenta del tutor. Hijo no encontrado → alta como miembro nuevo por el registro normal (aprobación del owner, D13). Tutor sin registro propio → cuenta de tutor sin ser alumno. | Luis P5 |
| D6 | Nivel: el que ya tenga en la app; si no, el cinturón del archivo traducido al catálogo y preseleccionado en el selector de cinturón/grados de `/enrol`. El socio confirma o corrige; si difiere del archivo se aplica y se marca al owner en **Recovered – to confirm**. | Luis P6 |
| D7 | Acceso: email antiguo (mostrado enmascarado) + **contraseña nueva**; o **email nuevo** (escrito dos veces) + contraseña nueva; o **Continue with Google sin contraseña**. Si el email ya tiene cuenta → "Sign in to link it" + **Forgot password?**. | Luis P7 |
| D8 | **Sin verificación de email** en ningún flujo (recuperación y `/enrol`). | Luis P8 |
| D9 | En la recuperación, al enviar la transferencia la suscripción queda activa provisionalmente y **puede reservar al momento**. Si el owner rechaza el pago: se corta la suscripción y se cancelan las reservas futuras. | Luis P10 |
| D10 | Método: reglas de aceptación ejecutables (Playwright + unitarias) escritas antes del código; bucle inline contra emuladores hasta verde; revisión de Luis; commit a `main` y despliegue con su OK. Sin agentes externos ni `/build-loop` enjaulado. | Luis P9 |
| D11 | Toda la interfaz en inglés (UK), con `DESIGN.md`, `/impeccable` y `/taste-skill`. | Luis |
| D12 | Términos/waiver obligatorios para nuevos y antiguos: paso obligatorio en recuperación y `/enrol`; al iniciar sesión sin aceptación registrada, **pantalla bloqueante** con casilla; el servidor **rechaza las reservas del propio miembro** para alumnos sin waiver. | Luis P11 |
| D13 | En `/enrol` el owner **sigue aprobando** las altas (sin alta automática). D9 aplica solo a la recuperación. | Luis P12 |

### Decisiones técnicas por defecto (Claude, sin objeción)

- **Menores:** un menor de 18 no recupera solo; se le indica que lo haga su padre/madre.
- **Límite de intentos:** se conserva la cuota por IP (evita adivinar fechas de nacimiento).
- **Tickets anteriores:** las solicitudes ya existentes siguen visibles y aprobables en la cola.
- **D8 técnico:** el servidor marca `emailVerified: true` en la cuenta de cliente al completar el
  registro o la recuperación (precedente `0a1e8f9`), en vez de retirar las ~8 comprobaciones del
  servidor que también protegen al personal. Consecuencia aceptada: si alguien escribe el email de
  otra persona, esa persona ya no podrá "tomar" la cuenta con Google; el email se pide dos veces.
- **Waiver y oficina:** el bloqueo de reservas por waiver aplica a las reservas del propio miembro
  en `/account`; las reservas hechas por owner/administración no se bloquean (142 menores migrados
  aún sin tutor no podrían aceptar nada).
- **Aceptación registrada** = documento `enrolmentWaiverAcceptances/{studentId}__{version}` o
  solicitud de alta aprobada con esa versión de waiver; la aprobación de un alta escribe también el
  documento, para que el servidor consulte un único sitio.
- **Hijos nuevos en la recuperación:** usan el registro normal (`/enrol`, tutor precargado) y la
  aprobación del owner (D13); no se inventa un segundo flujo de alta.

## Fuera de alcance

- Pago con tarjeta (no existe proveedor; "pago online" = transferencia + justificante).
- Cambiar el alta de `/enrol` a automática (D13).
- Recuperar cuentas de personal/coach (siguen fuera del flujo).
