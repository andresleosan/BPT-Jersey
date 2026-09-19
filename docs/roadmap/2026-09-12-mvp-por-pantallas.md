# MVP por pantallas — coaches, clases, cinturones y owner, organizados como se hizo con miembros

Fecha: 2026-09-12 · Fuente: `BPTJ FUNCTIONS APP.docx` (nuevo) frente a `BPTJ FUNCTIONS APP Viejo.docx` ·
Estado: propuesta para revisar con Luis/Miro · No cambia `BRIEF.md` ni ningún ledger; señala dónde chocan.

## 0. Qué es este documento

El docx nuevo reorganizó **solo** la parte de miembros: la partió por edad, puso una pantalla por
situación, nombró el elemento dominante de cada pantalla (un botón, un calendario, dos barras) y pegó
a cada una su referencia visual (`Assets/`). El resto del documento —coaches, clases, cinturones, grupos,
owner— sigue siendo una lista de frases sin pantalla ni orden.

Aquí se aplica el mismo patrón al resto del MVP, se cruza cada pantalla con lo que **ya existe en el
repositorio** (para no rehacer lo hecho), se ordena por prioridad y se deja una búsqueda Mobbin con
referencias elegidas por pantalla, para pasar directamente a diseñar las interfaces que faltan.

## 1. Qué cambió entre el docx viejo y el nuevo

### 1.1 Miembros — el bloque reorganizado

| Tema | Viejo | Nuevo | Consecuencia |
| --- | --- | --- | --- |
| Estructura | Una lista plana "Interface Registered Members" | Dos secciones: **under 12** (tutor) y **over 12** (cuenta propia) | Coincide con D1 del ledger v2 y con la enmienda a la decisión 6 del BRIEF (suelo 12 años) |
| Menores de 12 | Nada específico | Tutor ve **tarjetas** para elegir alumno; al elegir entra en la interfaz completa con botón arriba-izquierda "Select another student" | Pantalla nueva (ME-2). El docx dice "watch the Assets folder" pero no hay captura de tarjetas en `Assets/` |
| Clock-in | "Members can only clock in when < 50 m" al final de la lista, sin UI | **Botón slider** "Ready for Jiu Jitsu" (dos líneas, fuente enorme negra bold), arriba del todo, **aparece solo cuando la próxima sesión está a 1 h**, 50 m, registra puntualidad | Pantalla nueva (ME-3); referencia `Assets/ReadyForJiuJitsu.png` (Lifesum slider) |
| Calendario | Hoy+mañana en móvil, lun–sáb en desktop | Igual + **"SUNDAY IS OFF"** explícito | Ya construido en `feature/member-calendar` (sin domingos) |
| Corte de reserva | 2 h antes, **excepto** open mat | **1 h incluyendo open mats** | Coincide con decisión 2 del BRIEF y con el dominio (`cutoffMinutes = 60`). El calendario ya lo aplica |
| Registro: franjas | "elige 1 o 2 franjas: mañanas/tardes/noches" | **No se eligen cuántas veces** (full membership); la franja queda como **preferencia** por disponibilidad | El campo pasa de restricción a preferencia. Revisar cómo lo trata `enrol/page.tsx` |
| Streak / progreso | "track attendance, total hours, class streak, notifications" | Pantalla especificada: título "Streak", **barra de próximo Goal** y **barra de próximo Reward** (color más intenso y texto "Just x1 missing to get goal/reward!" cuando falta 1), **animación de llama** `Soguk Seri Atesi.json` con multiplicador "x2, x3…", debajo **Total hours since September** | Pantalla nueva (ME-5); referencia `Assets/StreakBar.png` (Blinkist) |
| Leaderboard | Un "Competitors": 2 arriba / 2 abajo, cinturón+stripes, racha, técnicas que uno tiene y el otro no | **Dos leaderboards**: asistencia y progresión de cinturón, mismo detalle | Pantalla nueva (ME-6); referencia `Assets/Leaderboard.png` (HQ Trivia). **Choca con la decisión 7 del BRIEF** (comparación solo adultos opt-in; menores solo ven su progreso) |
| Account settings | No existía | 18+ edita todo; <18 solo foto de perfil, **con aprobación del tutor** | Pantalla nueva (ME-7) |
| Frase suelta | — | "Make a progress bar on top of the Car/Section t" | Incompleta: preguntar a Miro |

### 1.2 Cambios fuera de miembros

| Sección | Cambio | Efecto en este documento |
| --- | --- | --- |
| Coaches | "Belts tracking… **under 16 years old needs to track behaviour**" | Dato nuevo sin definir (qué se registra, quién lo ve). Va a CO-8 como pregunta abierta |
| Coaches | Se **quita** "Coaches can create seminars" | Los seminarios pasan a Owner/Admin |
| Classes | Nueva línea cortada: "When a class is started, needs to show a new temporary interface for…" | Pantalla CO-5 "clase en curso", contenido por confirmar |
| Belts | Nueva tabla de **reglas de stripes por franja de edad** y "check belt database document" | Motor de propuestas BE-2. Coincide con T113 (aprobada) |
| Owner | Pasa a "Owner/**Admin**" y absorbe seminarios "to be introduced in the calendar for coaches and members" | CL-3 |
| Not MVP | Charlie también edita plantillas core; torneos con **round robin**; Leads = regyfit.com; merchandising elige centro Town/West al comprar; leaderboard también mornings y lunchtime | Fuera del MVP; el centro de retirada ya está en T019V2 |

### 1.3 Lo que el docx nuevo deja sin cerrar

1. La interfaz "temporary" al iniciar una clase: la frase está cortada.
2. "Progress bar on top of the Car/Section t": cortada.
3. "West members have different pay-as-you-go rules (need to specify)": sigue sin especificar desde el docx viejo.
4. Behaviour tracking para menores de 16: qué se anota, escala, quién lo ve, si el tutor lo ve.
5. **Reward**: la barra de "next Reward" presupone un catálogo de recompensas que no está en ningún documento.
6. **Leaderboards para 12+** contra la decisión 7 del BRIEF (solo adultos opt-in). Es una decisión de
   producto **y** de DPIA (T011): los menores verían nombre, foto y progreso de otros menores.
7. Stripes: kids 8-12 y teens 12-15 se solapan en 12. La decisión 6 del BRIEF ya lo resuelve (a los 12
   el head coach asigna Kids o Teens) y T113 lo implementa; conviene decirlo en el docx.

## 2. El patrón que se usó con miembros y que se replica aquí

1. **Partir por quién y en qué momento**, no por función: tutor de <12 / miembro 12+ / coach en el
   tatami / staff en la oficina.
2. **Una pantalla, una decisión**, con el elemento dominante nombrado: "un botón slider", "un
   calendario de dos días", "dos barras".
3. **La regla de negocio pegada a la pantalla donde se siente**: el corte de 1 h y las £15 viven en la
   tarjeta de sesión, no en un anexo.
4. **Una referencia visual por pantalla**, tomada de Mobbin y guardada en `Assets/` (GO Club para la
   cabecera, MacroFactor para la tira de días, Lifesum para el slider, Blinkist para la racha, HQ
   Trivia para el leaderboard).
5. **En código**: spec con decisiones numeradas y trazables
   (`docs/archive/superpowers/specs/2026-09-10-member-calendar-design.md`), reglas puras en `packages/domain`,
   un puerto con implementación `fixture` (viva en el banco :9471) e implementación `firebase`
   (escrita, sin conectar), y la UI encima. Cada pantalla nueva de abajo debería salir así.

## 3. Mapa de pantallas del resto del MVP

Leyenda de **estado**: `hecho` (UI + backend), `parcial`, `solo-backend` (callable y dominio existen,
sin UI o con UI mínima), `nada`. Leyenda de **prioridad** en la sección 4.

<!-- SECCION-3:INICIO -->
### 3.1 Coach — el turno en el tatami (móvil primero)

Hoy todo esto vive en **una sola página de 832 líneas** (`apps/web/src/app/coach/page.tsx`) con
seis bloques apilados: cabecera con selector de sede, clases de hoy, roster preclase (señal GPS +
tabla + panel de nivel + alta PAYG en efectivo), sugerencias "Before class", cumpleaños y un enlace
a `/coach/levels`. Funciona, pero es una lista de funciones, no un turno. La reorganización de abajo
la parte por **momento**: antes de entrar, antes de la clase, durante, después.

| ID | Pantalla | Qué ve / hace el coach (elemento dominante) | Reglas pegadas | Estado en código | Prio |
| --- | --- | --- | --- | --- | --- |
| CO-1 | **Elegir sede** al entrar | Dos tarjetas a toda anchura: TOWN / WEST. Todo lo que sigue se filtra por la elegida; se puede cambiar desde la cabecera | La sede elegida se recuerda en el dispositivo | `hecho` como radiogroup dentro del dashboard (`coach/page.tsx:372-397`, `localStorage`). Falta: que sea la **primera** pantalla y que el filtro sea también del servidor (hoy `sessions.filter` en cliente) | P0 |
| CO-2 | **Hoy** y la próxima clase | Tira de días arriba (igual que `/account`), la **próxima clase como tarjeta grande**: hora, grupo, sede, reservados/aforo, semáforo de quórum (4 mín.), notas de la clase; debajo, el resto del día en filas | Quórum ≥ 4 una hora antes; si no, se cancela (T024V2, hoy no programado) | `parcial`: lista de hoy con hora, aforo y badge de quórum (`:416-491`). El roster muestra **Student ID / Status / Action** sin nombre, **sin cinturón y sin notas** (`:601-664`); `SessionOperationalView` no lleva cinturón | P0 |
| CO-3 | **Pase de lista** (preclase) | Aparece sola cuando la próxima clase está a **X minutos** (docx: 5; T014V2: 15). Lista de reservados con **toggle presente/ausente por fila**, contador "N de M dentro", bloque "Sugeridos" (habituales no reservados) con un toque para añadir, **aviso de condición** con etiqueta corta (T017V2) | Marcar manual queda auditado; contador de 20 min tras el inicio (T015V2) | `hecho (casi)`: panel "Before class" con reservados + sugeridos (`:707-765`, `getPreClassView`) y check-in manual por fila (`:649-657`). Falta el **disparo por tiempo**, el toggle en una sola pantalla y el aviso de condiciones | P0 |
| CO-4 | **Clock-in** QR / manual / PAYG efectivo | Un botón "Scan" abre la cámara; debajo campo "Membership ID" para el manual; para West PAYG: registrar **£10 en efectivo**, crear/enlazar el ID de membresía y **enviar recibo por email** | West PAYG paga al llegar, antes de empezar; Town no | `parcial`: solo manual. **QR no existe** en ningún sitio (ni generación ni lectura; el backend lo rechaza: `schedule-callables.ts:542`). El alta PAYG en efectivo solo hace check-in manual y remite a Billing (`:338-348`); no registra pago, ni ID, ni email | P0 (manual+PAYG), P1 (QR) |
| CO-5 | **Clase en curso** (interfaz temporal) | *Contenido por confirmar con Miro (frase cortada en el docx).* Propuesta mínima: cronómetro desde el inicio, lista de presentes, marcar tardíos, contador de 20 min para los que no marcaron, botón "Cerrar clase" | Los que no marcan a los 20 min pierden la plaza y generan propuesta de fee (T015V2, nunca en open mat) | `nada`: `sessionStatuses` incluye `"active"` pero nada lo activa | P0 (esqueleto) |
| CO-6 | **Asistencia** del día / historial | Por sesión: presentes, tardíos, no-show; corrección con motivo; marcar no-shows | Correcciones auditadas | `hecho` pero bajo `/admin/attendance`, no en `/coach` | P1 (enlazar) |
| CO-7 | **Cumpleaños** próximos | Lista por proximidad ("in N days · turns X"), filtrada por sede | Sin fecha de nacimiento en la respuesta | `hecho` (`:767-811`, T112) | — |
| CO-8 | **Progreso de un alumno** y avisos de promoción | Ficha del alumno: cinturón + stripes, barra de clases hacia el siguiente stripe, horas totales, clases totales, racha; **bandeja de candidatos** a promoción (por asistencia) para que el head coach apruebe o rechace; <16: comportamiento (sin definir) | Solo head coach aprueba; el contador de clases se reinicia al promocionar, técnicas y total no | `solo-backend`: `getStudentProgressSummary`, `listRecognitionCandidates`, `approvePromotion`/`rejectPromotion` existen; **ningún listado de candidatos** en UI; racha solo en un panel de admin; **reinicio del contador no existe** en el dominio (solo `totalAttendedClasses`); **comportamiento: nada** | P2 |
| CO-9 | **Currículo de la clase** | Desde la tarjeta de clase: qué se enseña hoy (plan de lección), visible a todos los instructores | — | `parcial`: panel admin que carga un plan **tecleando su id** y lo aprueba (`admin/lesson-plans/lesson-plan-admin-panel.tsx:69-108`); no hay listado ni **vínculo plan↔clase** | P1 |

### 3.2 Clases, grupos y seminarios (staff, escritorio y móvil)

| ID | Pantalla | Qué hace | Reglas pegadas | Estado en código | Prio |
| --- | --- | --- | --- | --- | --- |
| CL-1 | **Crear / editar clase** | Formulario: tipo de servicio (programa), sede, día y hora, duración, instructores, **descripción/notas opcional**, aforo opcional (toggle + número), **mínimo (4 por defecto, subible)** | mín ≤ aforo; mín nunca < 4 | `parcial`: todo salvo **descripción/notas** (`ClassRecord` no tiene campo) (`admin/classes/page.tsx`, `classes-dialog.tsx`) | P1 |
| CL-2 | **Grupos y open sessions** recurrentes | Crear/editar/quitar grupos de clases y open sessions, repetir semanal, elegir periodo | Open mat no cuenta para el contador de 20 min | `parcial`: recurrencia semanal (**un solo día por clase**) + `generateSessions(desde, hasta)`; no hay entidad "grupo" ni "open session" distinta de clase (open mat = programa `open-mat`); no hay borrado, solo `active:false` | P1 |
| CL-3 | **Seminario** (owner/admin) | Alta con **precio**, hora, **técnicas que se enseñan**; aparece en el calendario de coaches y miembros | — | `parcial`: checkbox `isSeminar` al crear sesión y etiqueta "Seminar" en el lado del miembro; **sin precio ni técnicas** | P3 |
| CL-4 | **Semana completa** del staff (estilo Regyfit) | Vista lun–sáb de todas las sesiones de la sede, con aforo y quórum | — | `nada` como vista; T016V2 pendiente. El calendario de miembros ya resuelve la rejilla de seis columnas: reutilizar | P2 |
| CL-5 | Cancelación automática por quórum | No es pantalla: estado "Cancelled · quorum" en CO-2/CL-4 y aviso in-app a los reservados | 1 h antes, < 4 reservas | `solo-backend`: `decideQuorumSweep` + `reconcileSessionQuorum` probados, **nada los dispara** (T024V2); no se emite aviso | P1 (backend) |

### 3.3 Cinturones (belt management)

| ID | Pantalla | Qué hace | Reglas pegadas | Estado en código | Prio |
| --- | --- | --- | --- | --- | --- |
| BE-1 | **Técnicas por cinturón** (editor) | Camino vertical: cada tramo = un cinturón, cada nodo = técnica; el siguiente cinturón **hereda** las del anterior; head coach/owner añade y edita | 27 belts / 144 stripes / 171 definiciones (BRIEF) | `parcial`: navegador **solo lectura** en `/coach/levels` y `/admin/levels` (`levels-browser.tsx`); **sin editor ni herencia** | P2 |
| BE-2 | **Reglas de stripes** por franja | Tabla del docx (4-7: 4 clases/1 mes; 8-12: 6/45 d; 12-15: 10/2 meses; blanco 16+: 25/90 d; azul 50/180; morado 55/180; marrón 18+: 60/180) → motor de propuestas | Solo propone; nunca otorga | `hecho` como **datos** (`docs/data/ibjjf-levels-business-criteria.sanitized.json`, T113) y evaluado al abrir el nivel | — |
| BE-3 | **Revisión de promociones** | Bandeja del head coach: candidato, evidencia (clases, tiempo, racha), aprobar/rechazar; al aprobar, el contador de clases vuelve a cero | Decisión 8 del BRIEF | `solo-backend`: callables listas, sin bandeja; reinicio de contador **no modelado** | P2 |

### 3.4 Owner / Admin (escritorio)

| ID | Pantalla | Qué hace | Estado en código | Prio |
| --- | --- | --- | --- | --- |
| AD-1 | **Miembros**: alta, edición, condiciones | Tabla con filtros, ficha completa, texto de condición (1000) + **etiqueta de 25 caracteres** para coaches, bandeja "conditions to review" | `hecho` salvo **eliminar** (no existe borrado; solo transiciones de estado) (`admin/members/*`, `health-support-admin-panel.tsx`, límite 25 en `health-contracts.ts:239`) | — |
| AD-2 | **Coaches** y permisos delegados | Alta/edición/desactivar coach; conceder permisos | `parcial`: head coach/coach, desactivar; permisos delegables solo **dos** (`reviewPenalties`, `manageClasses`), no "admin" en general | P3 |
| AD-3 | **Disclaimers** | Publicar versión, retirar, ver aceptaciones | `hecho` (editar = nueva versión + retirar, que es lo correcto) | — |
| AD-4 | Seminarios | = CL-3 | `parcial` | P3 |
| AD-5 | Owner ve todo lo del coach | Un solo shell con conmutador de vista, no dos árboles de rutas | `parcial`: `/coach/*` y `/admin/*` separados; el owner navega a mano | P3 |

### 3.5 Miembros — ya reorganizado; solo el estado

| ID | Pantalla | Estado en código | Prio |
| --- | --- | --- | --- |
| ME-1 | Registro | `parcial`: el formulario público (`enrol/page.tsx`) tiene nombre, DOB, teléfono, email, sede, franja preferida, hijos y waiver; **falta el texto de condición (1000)**, que solo está en el alta administrativa. T002V2 (asistente por pasos) pendiente | P1 |
| ME-2 | Tutor: tarjetas para elegir alumno + "Select another student" | `parcial`: el calendario ya tiene **chips** por hijo (decisión 12) y `/account/family` pinta tarjetas **solo lectura**. Convertir chips en pantalla de tarjetas de entrada es barato | P1 |
| ME-3 | Slider "Ready for Jiu Jitsu" (1 h antes, 50 m, puntualidad) | `nada` en el lado del miembro. La señal de 50 m y la puntualidad existen **del lado del coach** (`coach/page.tsx:521-599`, T109); hace falta una ruta de check-in del propio alumno | P1 |
| ME-4 | Calendario semáforo | `hecho` con fixtures en `feature/member-calendar` (sin push); adaptador Firebase escrito, sin probar | — |
| ME-5 | Streak: dos barras, llama Lottie, xN, horas desde septiembre | `nada`: `own-progress.tsx` muestra cajas de texto; racha solo en dominio; **sin reproductor Lottie** en dependencias; "Reward" sin definir | P2 |
| ME-6 | Dos leaderboards | `nada` (cero coincidencias de "leaderboard"); **bloqueado** por decisión 7 del BRIEF + DPIA | P3 / bloqueado |
| ME-7 | Ajustes de cuenta (18+ todo; <18 solo foto con aprobación) | `parcial`: perfil editable para adultos (`account/profile`); **no hay foto de perfil** en ningún sitio | P2 |
<!-- SECCION-3:FIN -->

## 4. Prioridades

Criterios, en este orden: (1) lo que el coach necesita **en el tatami cada día**; (2) lo que ya tiene
backend y solo le falta pantalla (barato y de bajo riesgo); (3) lo que el docx nuevo **cambió o
añadió**; (4) lo que depende de una decisión abierta (DPIA, datos del operador) va después, por muy
vistoso que sea.

<!-- SECCION-4:INICIO -->
### P0 — El turno del coach (la siguiente iteración, con el mismo patrón que el calendario)

CO-1 → CO-2 → CO-3 → CO-4 (manual + PAYG) → CO-5 (esqueleto). Es una sola pieza de trabajo, no cinco:
**rehacer `/coach` como una app por momentos**, igual que `/account` se rehizo como calendario.

Por qué va primero:
- Es lo que ocurre **cada día en el tatami**; el calendario de miembros no sirve de nada si el coach
  no puede pasar lista desde el móvil en treinta segundos.
- Casi todo el backend ya existe (`listSessions`, `getSessionOperationalView`, `getPreClassView`,
  `checkIn`, `listUpcomingBirthdays`): es la capacidad 4+5 del BRIEF, la más avanzada de las
  incompletas. Lo que falta es **pantalla y tres campos** (nombre y cinturón en el roster, notas en
  la clase).
- El ledger v2 ya apunta aquí: T013V2 (sesiones del día primero), T014V2 (botón de asistencia 15 min
  antes), T017V2 (confirmados + aviso de condiciones) describen CO-2 y CO-3 para el panel admin. Hacerlo
  en `/coach` con móvil primero resuelve las tres filas de una vez, y el shell admin puede reutilizar
  los mismos componentes.
- Lo que el docx **cambió** en esta zona (interfaz "clase en curso", comportamiento <16) solo se
  puede concretar con una pantalla delante de Miro.

Deuda que arrastra y hay que decidir al abrir la spec: (1) el minuto del disparo del pase de lista (5
del docx frente a 15 de T014V2); (2) el filtro de sede pasa al servidor o sigue en cliente; (3)
`SessionOperationalStudent` gana `displayName` + `currentLevel`, o CO-2 llama además a
`getStudentProgressSummary` por alumno (más caro).

### P1 — Lo que cierra el circuito de asistencia y las piezas baratas

| Qué | Por qué ahora | Coste estimado |
| --- | --- | --- |
| **ME-3** slider "Ready for Jiu Jitsu" | Es la otra mitad de CO-3/CO-4: si el alumno marca solo, el coach solo confirma excepciones. Reusa la señal de 50 m ya escrita | Medio: hace falta una ruta de `checkIn` invocable por el propio alumno (hoy es de staff) |
| **ME-2** tarjetas de alumno para el tutor | El calendario ya tiene chips; es una pantalla de entrada + un botón | Bajo |
| **CL-1** descripción/notas en la clase | Campo nuevo en `ClassRecord` + formulario; CO-2 lo necesita para mostrar "things to keep in mind" | Bajo |
| **CO-9** currículo enlazado a la clase | Vínculo plan↔clase + listado; el panel de aprobación ya existe | Medio |
| **CL-5** barrido de quórum programado | T024V2: es un incumplimiento de la decisión 3 del BRIEF, y CO-2 mostrará un semáforo que hoy no cambia nunca | Bajo-medio (backend) |
| **ME-1** condición de salud (1000) en el registro público | El docx lo pide en el registro; hoy solo en el alta administrativa | Bajo |
| **CO-6** enlazar asistencia desde `/coach` | Ya existe bajo `/admin`; enlace + filtro por sede | Bajo |
| **CO-4 QR** | Generación del QR del miembro (en ME-7 o en la tarjeta de sesión reservada) + lector en CO-4. El backend hoy lo rechaza a propósito por falta de credencial verificable: hay que diseñar el token | Medio-alto; va detrás del manual |

### P2 — Progreso y cinturones

BE-1 (editor de técnicas con herencia), BE-3 (bandeja de promociones + reinicio del contador), CO-8
(ficha de progreso del alumno para el coach), ME-5 (streak con Lottie; exige definir "Reward"), ME-7
(foto de perfil con aprobación del tutor), CL-4 (semana del staff, reutilizando la rejilla del calendario).
Es la capacidad 6 del BRIEF, la única **a cero en producción**; toda la lógica de niveles existe y
está probada, pero conviene que el coach ya use la app a diario (P0) antes de pedirle que evalúe en ella.

### P3 — Bloqueado por decisión o de bajo valor inmediato

ME-6 leaderboards (decisión 7 del BRIEF + DPIA: decidir si los 12+ ven a otros 12+), comportamiento
<16 (sin definición), CL-3 seminarios con precio y técnicas, AD-2 permisos delegados más amplios,
AD-5 shell único owner/coach.
<!-- SECCION-4:FIN -->

## 5. Referencias Mobbin por pantalla

Búsquedas hechas el 2026-09-12 con el MCP de Mobbin (iOS salvo indicación). Se listan solo las que
sirven; las demás se descartaron a la vista.

| Pantalla | Búsqueda usada | Referencias elegidas y por qué |
| --- | --- | --- |
| CO-1 Elegir sede | "choose your location screen with two large cards to select a gym branch" | [Careem — ciudades en tarjetas grandes con foto](https://mobbin.com/screens/5dd98988-53d0-4f5e-9400-11dd4e64ec0c): dos tarjetas a toda anchura, foto de cada gimnasio, cero texto extra. [The Infatuation — tarjetas con abreviatura grande](https://mobbin.com/screens/f9435c30-39cd-46dc-ac7d-e526d5209162): versión sin foto, "TOWN / WEST" en condensada encaja con el design system |
| CO-2 Hoy / próxima clase | "coach view of today's classes with the next upcoming class highlighted…" | [Open — lista del día con hora, título, duración e instructor](https://mobbin.com/screens/1e339d42-4e73-4aab-b876-429c65c0a3d7): tira de semana arriba, filas densas. [Peloton — Your Schedule con tira de días y tarjeta de la sesión](https://mobbin.com/screens/bd2d1f6d-21c1-405f-a1a9-849c8e25c2b2): días sin clase colapsados ("No classes"), útil para el coach de West |
| CO-3 Pre-clase / pase de lista | "attendance roll call list … present and absent toggle … count of checked in" | [Meetup — Attendees / Checked in 0 / Not checked in 1 con pestaña Scan](https://mobbin.com/screens/8fd2cc88-6d2d-4e01-a0da-0b2d4feb6d91): los tres contadores arriba y el conmutador List/Scan es exactamente CO-3 + CO-4. [Partiful — Check In Guests con botón por fila y "Undo check-in"](https://mobbin.com/screens/ea985466-4b63-4131-a55d-7f43a9985882): marcar y deshacer en la misma lista. [Luma — Guest List con ficha inferior y botón Check In](https://mobbin.com/screens/bf0994ca-cd25-48d0-9af0-ee31324ca47a): detalle del alumno (cinturón, condición) sin salir de la lista |
| CO-4 Clock-in QR / manual | "QR code scanner screen to check in an attendee with a manual search fallback" | [Forest — "Scan QR or type the ID" con hoja inferior](https://mobbin.com/screens/c0236081-d2d1-448d-900c-4b5a9de084d2): cámara arriba, campo de ID de membresía abajo, un solo gesto. [H&M — visor con "Enter product number"](https://mobbin.com/screens/f5bf0b83-06c5-4e2e-97cd-4e1daf45a5a3): mismo patrón con botón secundario. [Blackbird — "Swipe to check in"](https://mobbin.com/screens/90425290-6024-44a5-98e7-0385d63a83d5): el slider de confirmación, referencia adicional para ME-3 |
| CL-1 Crear/editar clase | "create event form with title, date and time, recurring weekly toggle, capacity limit toggle and notes" | [Strava — New Event: recurrente Weekly/Monthly, "Repeats on / Every", ubicación, descripción](https://mobbin.com/screens/17534492-7807-4e87-8900-606eab294f76): el formulario más cercano a CL-1/CL-2 (sede + recurrencia + notas). [Whering — Create event compacto con Start/End y Notes](https://mobbin.com/screens/af04d6e2-9854-4854-b512-8b5817c185a7): versión mínima |
| CL-3 Seminario | "workshop or seminar event detail page with date, price, instructor, topics covered list and a book button" | [Open — detalle de clase: eyebrow de disciplina, fecha, duración, TEACHER, ABOUT, botón Book fijo abajo](https://mobbin.com/screens/01d0ce8a-6818-4142-aa8e-2ac8f2dddf06): estructura del detalle que ven coach y miembro. [Zomato — fecha, horas, "Starting at ₹300", lista con viñetas de lo que incluye](https://mobbin.com/screens/8cd93b7b-480c-481f-aa61-b958b4e8153e): precio y "técnicas que se enseñan" como lista |
| BE-1 Técnicas por cinturón | "skill tree or level curriculum screen listing techniques per level with completed checkmarks and locked next level" | [Life Reset — Habit Academy: camino vertical de nodos con check](https://mobbin.com/screens/0d8849b9-6253-472b-9067-2b5f40c648b8): sobrio, sin mascota; cada nodo = técnica, cada tramo = cinturón. [Mimo — capítulo con % y nodos bloqueados](https://mobbin.com/screens/27a887e2-e968-4117-997f-4ce126f12fef): cabecera del cinturón con progreso y el siguiente cinturón bloqueado (herencia de técnicas) |
| CO-8 / ME-5 Progreso y racha | "student progress detail screen with a progress bar of sessions completed toward the next rank, total hours and streak stats" | [Mindvalley — Progress: racha semanal + cuadrícula de 4 contadores + barras "Learning Progress"](https://mobbin.com/screens/15b37d80-6b50-4618-82c6-06db8da02423): la vista del coach sobre un alumno (horas, clases, racha, barra hacia el siguiente stripe). [Duolingo — Streak con calendario y "Streak Goal" como barra con hitos](https://mobbin.com/screens/b7578a37-b5f0-4921-a9c2-3b42bad94eb9): la barra de Goal con hito siguiente marcado, complementa `Assets/StreakBar.png`. [Speak — llama + "New record" + calendario](https://mobbin.com/screens/c224e632-0ac2-4909-9f6f-f065eb9712af): llama con contador al lado, como pide el docx |
| CO-7 Cumpleaños | "upcoming birthdays list grouped by this week and this month with avatars and days until" | [Canopi — "Next / Past", "In 3 Days", tarjeta por evento](https://mobbin.com/screens/d88f4063-64d0-4234-9afc-433ca89af1be): agrupación por proximidad. [IMDb — Born today: foto, nombre y edad que cumple](https://mobbin.com/screens/58e2d472-4ea1-4238-9ca5-a893cb45e6ac): fila con la edad (`turningAge`, que T112 ya calcula) |
| ME-2 Selector de alumno (tutor) | "profile picker screen with cards to choose which family member or child profile to use" | [Prime Video — "Who's watching?" con avatares grandes](https://mobbin.com/screens/8ff4ad02-c2fd-4354-a7e6-ea8faf3da6c1) y [Netflix — Manage Profiles en tarjetas cuadradas](https://mobbin.com/screens/14657676-dde0-4b68-a058-c87ba8e2c473): el patrón de tarjetas que describe el docx. [Withings — "Who are you?" en lista](https://mobbin.com/screens/a0727bdc-a1a7-4290-8d03-4cce04b8abab): alternativa compacta si son muchos hijos |
| AD-1 Miembros (web) | "admin members table with status filters, health alert flag icon per row and inline edit actions" | [Asana — Users: filtros, fila seleccionada y menú de rol inline](https://mobbin.com/screens/5c8ac940-052c-4e8b-8598-52686804cbbd) y [Clerk — Members con selector de rol en la fila](https://mobbin.com/screens/489a3e32-c494-4f43-bffb-7ddc46d4abd5): para AD-1 y AD-2 (rol/permisos inline, sin kebab, como manda `DESIGN.md`). [Dropbox — chips de estado con recuento](https://mobbin.com/screens/9af320af-78c1-4796-bee5-efc08f08c933): filtros "Active / Conditions to review / Pending" |

Referencias ya guardadas en `Assets/` y a qué pantalla corresponden: `InterfaceStyle.png` (GO Club →
cabecera morada de `/account`), `Calendar.png` (MacroFactor → tira de días), `ReadyForJiuJitsu.png`
(Lifesum → slider ME-3), `StreakBar.png` (Blinkist → ME-5), `Leaderboard.png` (HQ Trivia → ME-6),
`Soguk Seri Atesi.json` (Lottie de la llama, ME-5).

## 6. Preguntas para Miro (o decisiones de Luis) antes de diseñar

<!-- SECCION-6:INICIO -->
Ordenadas por lo que bloquean. Cada una lleva una respuesta por defecto para no parar el trabajo.

| # | Pregunta | Bloquea | Por defecto si no hay respuesta |
| --- | --- | --- | --- |
| 1 | ¿Qué muestra la "temporary interface" cuando empieza la clase? | CO-5 | Cronómetro + presentes + tardíos + contador 20 min + "Cerrar clase" |
| 2 | ¿El pase de lista salta a 5 min (docx) o a 15 (T014V2)? | CO-3 | 15 min, con el aviso visible desde 30 |
| 3 | ¿Los miembros de 12-17 ven leaderboards con otros menores? La decisión 7 del BRIEF dice que no; el docx nuevo dice que sí | ME-6 | No (BRIEF), hasta que la DPIA de T011 lo cubra |
| 4 | ¿Qué es un "Reward" en la barra de racha? ¿Quién lo define y qué se da? | ME-5 | Solo barra de Goal (siguiente stripe); Reward oculto |
| 5 | Comportamiento <16: ¿qué se registra (escala, nota), quién lo ve, lo ve el tutor? | CO-8 | No se construye hasta tener definición |
| 6 | Reglas PAYG de West "(need to specify)": ¿solo efectivo al llegar, o también deuda de una sesión como Town? | CO-4 | Efectivo al llegar, sin deuda |
| 7 | "Make a progress bar on top of the Car/Section t": ¿de qué sección? | ME-5 | Se ignora hasta aclararlo |
| 8 | ¿"Remove" miembro/coach significa borrar o dar de baja? El sistema no borra (auditoría, menores) | AD-1, AD-2 | Baja con estado, nunca borrado |
| 9 | ¿La cuenta del menor de 12+ ve el mismo calendario que el tutor, y el tutor puede seguir reservando por él? (decisión 1 del calendario: sí a las dos) | ME-2, ME-3 | Sí a las dos |
<!-- SECCION-6:FIN -->

## 7. Siguiente paso propuesto

<!-- SECCION-7:INICIO -->
1. Luis/Miro responden las preguntas 1, 2 y 6 (las que tocan P0). Las demás pueden esperar.
2. Se escribe `docs/superpowers/specs/2026-09-xx-coach-shift-design.md` con el mismo formato que la
   spec del calendario: objetivo, tabla de decisiones numeradas, contratos puros en
   `packages/domain/src/schedule/` (derivar "momento del turno" a partir de `now` y las sesiones:
   `idle | pre-class | in-class | post-class`), puerto `CoachRepository` con `fixture` y `firebase`,
   y UI en `apps/web/src/app/coach/` partida por momento. Referencias: fila CO-1..CO-4 de la sección 5.
3. Se guardan en `Assets/` las capturas Mobbin elegidas para CO-1..CO-4 (misma convención que las
   cinco que ya hay), para que el modelo que construya tenga la referencia al lado del código.
4. Se construye contra el banco `:9471` con `NEXT_PUBLIC_*_SOURCE=fixture`, capturas Playwright en
   390 px y 1280 px con un usuario `coach@bpt.test` (hay que añadirlo a `deploy/seed-auth.mjs`, que hoy
   solo siembra adulto, tutor y teen), y se cierra igual que el calendario: tests de dominio +
   componentes + capturas.
5. Al terminar P0 se repite el ciclo con P1 empezando por ME-3, que cierra el circuito de asistencia
   entre alumno y coach.
<!-- SECCION-7:FIN -->
