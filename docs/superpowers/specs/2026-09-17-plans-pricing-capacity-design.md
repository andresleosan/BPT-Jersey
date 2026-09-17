# Planes, precios, límites de reserva y aforo obligatorio — Diseño (T050V2)

Fecha: 2026-09-17 · Estado: aprobado en chat, pendiente de revisión escrita · Tarea: T050V2

## Objetivo

Ajustar el catálogo de membresías existente (`PLAN_CATALOG`) a las tarifas reales de la academia,
hacer que el aforo sea obligatorio en toda sesión, y que servidor y cliente apliquen de forma
coherente sede, audiencia, límite semanal y acceso a open mats. Mostrar planes y precios desde una
única fuente en la landing, `/enrol`, la ficha del socio y el editor de admin.

## Decisiones (grill 2026-09-17)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Alcance frente a T047V2 (planes dinámicos) | Ajustar el catálogo actual ahora; T047V2 migrará estas reglas después |
| 2 | `town-teens` no figura en las tarifas | Se conserva con `active: false` (membresías existentes no se rompen) |
| 3 | "£7.50 por clase individual" West Teens | Nuevo plan `west-teens-payg` £7.50 por sesión; `west-teens` pierde la tarifa de open mat |
| 4 | ¿Open mats cuentan para el límite semanal? | No. Solo las clases consumen cupo |
| 5 | Trimestre escolar | Nuevo `billingPeriod: "term"` (etiqueta); fechas del trimestre en `startsAt`/`endsAt` de la membresía |
| 6 | Aforo obligatorio | En toda sesión (crear, editar, copiar semana), entero 1–300 |
| 7 | Sesiones legadas con `capacity: null` | Se leen, pero no admiten reservas (`capacity-not-set`); admin las ve "Set capacity". Sin migración |
| 8 | Planes en la interfaz pública | Landing y `/enrol` (solo lectura) generados desde `PLAN_CATALOG`, solo planes activos |
| 9 | Planes ya guardados en Firestore con valores antiguos | Aviso "Differs from catalogue" + botón "Load catalogue values" que rellena el formulario; el admin guarda con `savePlan`. Sin escritura automática |

Fuera de alcance: despliegue, sincronización automática de planes, calendario de trimestres, cobro
por clase extra, selección de plan en `/enrol`, UI de "repetir cada semana" (la repetición sigue
siendo "Copy week"), sedes distintas de Town/West.

## Reglas de negocio (catálogo final)

Precios en peniques (`priceMinor`), `currency: "GBP"`.

| planId | displayName | priceMinor | billingPeriod | audiencia | classSites | weeklyClassLimit | openMatSites | openMatFeeMinor | active |
|---|---|---|---|---|---|---|---|---|---|
| bpt-jersey-adult | BPT Jersey Town & West | 12500 | monthly | adult | Town, West | null | Town, West | null | true |
| payg | West Pay as you go | 1000 | per-session | adult | West | null | — | null | true |
| west-adult | West Adult | 6500 | monthly | adult | West | 2 | Town | null | true |
| west-kids-1x | West Kids 1x | 9500 | term | kids | West | 1 | — | null | true |
| west-kids-2x | West Kids 2x | 11500 | term | kids | West | 2 | Town | null | true |
| west-teens | West Teens | 4500 | monthly | teens | West | 2 | — | null | true |
| west-teens-payg | West Teens single class | 750 | per-session | teens | West | null | — | null | true |
| town-adult | Town Adult | 8500 | monthly | adult | Town | null | Town | null | true |
| town-kids-1x | Town Kids & Teens 1x | 9500 | term | kids, teens | Town | 1 | — | null | true |
| town-kids-2x | Town Kids & Teens 3x | 13500 | term | kids, teens | Town | 3 | Town | null | true |
| town-teens | Town Teens | 4500 | monthly | teens | Town | 2 | Town | 750 | **false** |

Reglas derivadas:

- "Open mat infantil" = `openMatSites` incluye la sede + el control de audiencia ya existente
  (el `ageBand` del programa debe casar con la audiencia del alumno por fecha de nacimiento). No
  hay campo nuevo.
- `weeklyClassLimit` cuenta reservas confirmadas de **clases** (programas con
  `discipline !== "open-mat"`) de lunes a domingo. `null` = sin límite (sujeto a aforo).
- Toda reserva está sujeta al aforo de la sesión; el aforo se comprueba siempre.
- Nombres (`displayName`) son propuesta; se ajustan en la revisión escrita si hace falta.

## Arquitectura y cambios por capa

### Dominio — `packages/domain`

- `memberships/plan-contracts.ts`
  - `planIds` + `"west-teens-payg"`.
  - `billingPeriods = ["per-session", "monthly", "term"]`.
  - `weeklyClassLimit: 1 | 2 | 3 | null` en tipo, allowlist y parser.
  - `retiredPlanIds = ["town-teens"]` exportado junto a `PLAN_CATALOG` (el contrato `PlanDraft` no cambia);
    `PLAN_CATALOG` según la tabla. `openMatSites` puede ser vacío (hoy el parser exige al menos una sede).
  - `evaluatePlanAccess`: sin cambios de forma; tests tabulares por plan.
- `schedule/schedule-contracts.ts`
  - `parseCreateSessionInput` / `parseUpdateSessionInput`: `capacity` obligatorio, entero 1–300.
  - `SessionRecord.capacity: number | null` se mantiene solo para lectura de legado.

### Servidor — `apps/functions`

- `schedule/booking-transaction-service.ts`
  - Sesión con `capacity === null` ⇒ rechazo `capacity-not-set` antes de evaluar el plan.
  - `weeklyUsage` excluye reservas cuyo programa sea open mat.
  - Capacidad comprobada siempre dentro de la transacción existente (`sessionCapacityStates`).
- `schedule/schedule-service.ts`: `copyWeek` rechaza (`failed-precondition`) si alguna sesión origen
  no tiene aforo; el admin ya ve esas sesiones marcadas "Set capacity".
- `schedule/advanced-booking-service.ts`: sin cambios (la lista de espera ya exige aforo numérico).
- `memberships/plan-service.ts`: `seedPlanCatalog` crea los planes de `retiredPlanIds` con `active: false`.
- Códigos de error de reserva nuevos `capacity-not-set` y `weekly-limit`, que viajan al cliente como
  `details.reason` del `failed-precondition` existente.
- Firestore rules/indexes: sin cambios (colecciones `if false`, todo vía callables).

### Web — `apps/web` (reglas de `DESIGN.md`)

- `src/lib/plan-copy.ts` (nuevo, puro, con test): `formatPlanPrice(plan)` ("£135 per term",
  "£7.50 per class", "£65 per month"; `Intl.NumberFormat("en-GB")`) y `describePlanAccess(plan)`
  ("3 classes a week at Town · kids open mat at Town"). Única fuente de texto de planes.
- Admin `classes-services/classes/session-panel.tsx`: `<input type="number" required min="1"
  max="300">`, etiqueta arriba, ayuda "Maximum people on the mat", error debajo con regla izquierda
  roja. `list-view.tsx`, `calendar-view.tsx`, `coach/page.tsx`: sesión sin aforo ⇒ "Set capacity"
  (texto), nunca "∞". `week-actions.tsx`: aviso "Set a capacity on every session in this week
  before copying it." cuando "Copy week" se rechaza.
- Admin `memberships/page.tsx` + `lib/membership-admin-client.ts`: opción "Per term"; límite
  Unlimited/1/2/3; banda ámbar "Differs from catalogue" + botón secundario "Load catalogue
  values" (solo rellena el formulario); columnas de precio vía `plan-copy`.
- Socio `account/membership/page.tsx`: precio y derechos vía `plan-copy`; nota "Open mats don't
  count towards your weekly classes".
- Calendario del socio (`lib/calendar/*`, `account/calendar/*`, `account/classes/page.tsx`):
  participante con `weeklyClassLimit`; semana llena ⇒ tarjeta de clase en estado locked con línea
  "Weekly class limit reached"; sesión sin aforo ⇒ closed. El calendario carga semanas completas
  (lunes–domingo) para poder contar el cupo aunque el móvil muestre dos días. Audiencia: si el plan admite una sola, esa;
  si admite varias, por fecha de nacimiento del alumno (familia), no `eligibleParticipantTypes[0]`. Validación
  de cliente es orientativa; el servidor decide.
- Mensajes seguros: `capacity-not-set` ⇒ "This session isn't open for booking yet.";
  `weekly-limit` ⇒ "You've used this week's classes on your plan." Nunca errores crudos.
- Público `content/academy.ts` + `app/page.tsx`: se eliminan precios escritos a mano; sección de
  tarifas generada desde `PLAN_CATALOG` activos, agrupada Town & West / West / Town; filas nombre ·
  derechos · precio (tabular-nums, alineado a la derecha); sin fila de tres tarjetas iguales, sin
  pills, radio 0; una columna por debajo de 50rem.
- `enrol/page.tsx`: tras elegir sede, bloque de solo lectura "Plans at <site>" (incluye Town &
  West) con el mismo componente.

Reglas de diseño aplicables (de `DESIGN.md`): paleta púrpura/lima + neutros cálidos, sin azul ni
degradados; estado = texto + regla izquierda; inputs con etiqueta arriba y foco 3px púrpura;
botones `min-height 3.15rem`, radio 0 (salvo `/account`, radio 1rem); inglés británico llano; sin
spinners (skeleton); `prefers-reduced-motion` respetado; objetivos táctiles ≥ 44px; sin scroll
horizontal.

## Seguridad

- El servidor es la única autoridad: la reserva vuelve a leer plan, membresía, sesión y uso dentro
  de la transacción; la UI nunca autoriza.
- Inputs validados en callable (parsers de dominio) y en cliente (zod) antes de llamar.
- Sin `dangerouslySetInnerHTML`, sin URLs construidas con datos; datos públicos de planes son
  constantes tipadas sin información personal.
- Errores mapeados a cadenas seguras en `*-client.ts`.

## Pruebas y criterios de aceptación

Unitarias (TDD, beside source):

- `plan-contracts.test.ts`: parser acepta 3 y `"term"`, rechaza 4; tabla por plan de
  `evaluatePlanAccess` (límite 3, open mat permitido/denegado por sede, `town-kids-2x` para teens,
  `payg` denegado en Town y para kids, `town-teens` inactivo).
- `schedule-contracts.test.ts`: crear/editar sesión sin aforo, con 0 o 301 ⇒ error.
- `booking-transaction-service.test.ts`: open mat no consume cupo; 3.ª clase con `west-adult` (límite 2) ⇒
  `weekly-limit`; `capacity: null` ⇒ `capacity-not-set`; aforo lleno ⇒ rechazo.
  Para cada guardia nueva: desactivarla y confirmar test rojo (`LECCIONES.md` §4).
- `plan-copy.test.ts`: textos exactos por plan.
- Componentes: session-panel exige aforo; editor muestra "Differs from catalogue" y el botón
  rellena valores; landing/enrol listan "£135 per term" y no `town-teens`.

E2E Playwright contra emuladores (`demo-bpt-jersey`, Docker `bpt-emu:local`). El entorno E2E solo
tiene una cuenta de adulto sintético, así que el recorrido de servidor usa `west-adult`; los planes
infantiles quedan cubiertos por los tests tabulares de dominio y de calendario.

1. `saveSession` sin aforo ⇒ `INVALID_ARGUMENT`.
2. Socio `west-adult` reserva el open mat de Town y 2 clases de West; la 3.ª ⇒ `weekly-limit`
   (demuestra también que el open mat no consumió cupo).
3. El open mat de West ⇒ `ineligible`.
4. Aforo lleno ⇒ ya cubierto por la integración `booking-transaction.test.ts` (último hueco
   disputado).
5. Landing muestra "£125 per month", "£135 per term", "£7.50 per class" y no "Town Teens".
6. Capturas escritorio y móvil de landing, `/enrol`, panel de sesión y editor de planes.

Gate: `typecheck`, `lint`, `format:check`, `test`, `test:rules`, build web, `test:e2e:smoke` y los
specs anteriores en verde, con evidencia registrada en `tasksv2.md` (T050V2).

## Proceso de entrega

Rama `feature/plans-pricing-capacity` en worktree. Tras construir: `/ponytail-review`, crítica
`/impeccable` + `/taste-skill` contra `DESIGN.md` (`/redesign-skill` solo si hay hallazgos),
`/security-best-practices` + `/frontend-security-coder`, luego verificación Playwright. Nota en
`2026-09-16-regyfit-classes-services-clone-design.md` (decisiones 7 y 15): T047V2 debe migrar
estas reglas. Nada se despliega sin confirmación explícita.
