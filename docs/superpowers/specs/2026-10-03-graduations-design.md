# Graduations — diseño

Fecha: 2026-10-03 · Estado: pendiente de revisión del operador
Fuentes: `Assets/Graduaciones.drawio.svg` (flujo y secciones), `Assets/Jersey Jiu-Jitsu Ltd.pdf`
(reglas de clases mínimas y días mínimos), respuestas del operador en la sesión del 2026-10-03.

## 1. Objetivo

Una pestaña **Graduations** en el panel admin que lleva a cada alumno desde «está a una clase de
graduarse» hasta «el owner lo promovió», y avisos animados en la app del miembro que lo motivan a no
perder clases para subir de nivel en el menor tiempo que permiten las reglas.

Éxito:
- El owner ve, sin calcular nada a mano, quién se gradúa pronto, quién tiene hoy la clase de
  graduación y a quién debe decidir.
- Al pulsar **Promote**, el alumno pasa al siguiente nivel, sus contadores vuelven a cero, el miembro
  ve la animación de nuevo nivel y el Overview del admin recibe el aviso.
- El panel del owner y la app del miembro nunca discrepan: una sola función de dominio decide.

## 2. Tabla de decisiones

| # | Decisión | Quién | Dónde |
|---|---|---|---|
| D1 | Las reglas salen del PDF; donde el catálogo discrepa, manda el PDF | Operador | Pregunta «PDF vs catálogo» |
| D2 | Excepción del PDF: adulto White belt → 1st stripe pide **20 clases / 60 días**; 2nd–4th stripe **25 / 90** | Operador | Pregunta «Ejemplo» |
| D3 | Cada fila del PDF es el requisito para **recibir** ese nivel (como ya funciona el código: criterios del nivel destino); los días son **mínimos** | Operador + código (`buildStudentProgressSummary`, nivel `sequence+1`) | Preguntas «Lectura PDF» y «Ejemplo» |
| D4 | Black belt, sus grados y Red&Black/Red&White/Red entran al flujo con los criterios del catálogo actual | Operador | Pregunta «Black/Red» |
| D5 | El flujo aplica a **todos** los niveles (cinturones y stripes/grados); el siguiente es siempre `sequence+1` | Operador | Pregunta «Alcance» |
| D6 | Solo cuentan **clases + tiempo**. Las técnicas son para enseñar: los coaches las ven por nivel; el alumno **no** las ve por ahora | Operador | Pregunta «Skills» |
| D7 | Pestaña en el menú admin (grupo Today) entre Overview y Attendance; la ven **owner y administrator**; no está en el menú del coach | Operador | Pregunta «Ubicación» |
| D8 | Solo la cuenta **owner** decide en Graduation Approval | Operador | Pregunta «Quién aprueba» |
| D9 | Botones **Promote** / **Not yet** | Operador | Pregunta «Botones» |
| D10 | Avisos al miembro solo dentro de la app (sin email/push) | Operador | Pregunta «Canal» |
| D11 | En niños, el tutor ve los avisos y la animación por cada hijo, con su nombre | Operador | Pregunta «Niños» |
| D12 | «Próxima clase probable» = las clases a las que **suele ir** (muchos no reservan; el coach marca asistencia). Una reserva confirmada también cuenta | Operador | Pregunta «Próxima clase» |
| D13 | Los avisos de progreso actuales (hitos 75 %/90 %/«una clase», stripe atado) **se mantienen**; los nuevos se suman | Operador | Pregunta «Avisos viejos» |
| D14 | Entran en esta versión: aviso «no pierdas el ritmo» y nota del owner en «Not yet» visible para el miembro | Operador | Pregunta «Mejoras» |
| D15 | Quedan para después: «fecha más rápida posible» y tarjeta para compartir | Operador (no elegidas) | Pregunta «Mejoras» |
| D16 | El estado de las tres secciones se **calcula al leer**; solo se guardan decisiones (Promote = promoción existente, Not yet = registro nuevo) | Claude, aprobado con el diseño | Mensaje de diseño |
| D17 | Una promoción por Promote queda fechada el día de la clase de graduación; el nuevo nivel cuenta desde ese día | Diagrama («se reinicia el contador») + modelo actual (`currentLevelStartedAt = promotedOn`) | Diagrama |

## 3. Cambios de catálogo (D1–D4)

El catálogo activo es el sistema editable `bpt-20261003-1` (adoptado el 2026-10-03). Cambios:

| Nivel | Hoy | Queda |
|---|---|---|
| Kids 7-10 (WHITE KIDS, GREY&WHITE, GREY, YELLOW&WHITE, YELLOW, YELLOW&BLACK 7-8/8-10) | 8 stripes | **6 stripes** (se quitan 7th y 8th de los 6 cinturones) |
| WHITE BELT TEENS 10-12/13-15 | 10 / 60 | **6 / 45** (sus stripes siguen 10 / 60) |
| Adulto WHITE BELT | 25 / 90 | **20 / 60** |
| White – 1st stripe | 20 / 60 | 20 / 60 (sin cambio) |
| White – 2nd, 3rd, 4th stripe | 25 / 75 | **25 / 90** |

Resto: coincide con el PDF (kids 4-7: 4/30 con 11 stripes; kids 7-10: 6/45; teens: 10/60; Blue
50/180; Purple 55/180; Brown 60/180) o no está en el PDF (D4).

Riesgo: un alumno que hoy esté en un stripe 7 u 8 de kids 7-10 se queda sin nivel. Antes de quitar
esos stripes, un script en modo simulación lista quién está ahí; si hay alguien, se le pasa al
6th stripe del mismo cinturón (conservando su fecha) antes de borrar las definiciones. Se aplica con
el editor de niveles existente o un script one-off con simulación previa y confirmación del
operador (es un cambio en producción).

## 4. La regla, en un solo sitio (dominio)

Módulo nuevo `packages/domain/src/graduations/graduation-contracts.ts`, sin Firebase. Una función
pura:

```
graduationStageOf({ catalog, head, countedClassInstants, habitualSlots, bookings,
                    reviews, now }) → GraduationStage
```

Definiciones, con `target` = nivel `sequence+1`, `minClasses`, `minDays` de `target.criteria`:
- `classesDone` = clases contadas desde `currentLevelStartedAt` (misma regla que hoy:
  `countedClassInstants` — sin open mat, sin cursos, sin correcciones, con fechas manuales).
- `periodEnd` = `currentLevelStartedAt + minDays` (día de Jersey).
- `nextLikelyClass(after)` = la primera sesión futura, a partir de `after`, que sea habitual para el
  alumno (2+ asistencias en 56 días a sesiones del mismo día de la semana y hora ±30 min, la regla de
  `pre-class-contracts.ts`) o que tenga reservada y confirmada (D12). Sin hábito ni reserva → `null`.
- Nivel sin criterio de clases (Red) → solo tiempo; sin siguiente nivel → `none`.

Etapas (exclusivas, en este orden):

1. **`approval`** — existe una asistencia contada en una sesión S tal que, contando S, el alumno
   cumple clases y tiempo (día de S ≥ `periodEnd` y `classesDone` hasta S ≥ `minClasses`), y no hay
   un `Not yet` del owner para esa S. La primera S que cumple es la «clase de graduación». Si el owner
   dijo Not yet en S, la siguiente asistencia contada después de S vuelve a abrir `approval`.
2. **`today`** — no está en `approval` y su `nextLikelyClass` cae **hoy** y cumpliría los requisitos
   en ella.
3. **`next`** — no está en `approval` ni `today`, y la próxima clase lo gradúa:
   - le falta **1** clase y `nextLikelyClass(periodEnd)` existe; o
   - ya tiene todas las clases y faltan **menos de 7 días** para `periodEnd`; o
   - tiene un `Not yet` reciente (vuelve aquí con su siguiente clase probable).
   Fecha mostrada: `nextLikelyClass(max(hoy, periodEnd))`, o «Next class not predicted» si es `null`.
4. **`twoLeft`** — ya cumplió el tiempo y le faltan exactamente **2** clases (solo genera aviso al
   miembro; no aparece en el panel).
5. **`none`** — cualquier otro caso.

Si en `today` no vino a la clase, al día siguiente la función recalcula `nextLikelyClass` y vuelve a
`next` (diagrama: «sigue apareciendo en Next Graduation»). No hace falta ningún proceso programado.

## 5. Backend

Carpeta `apps/functions/src/graduations/` con la capa habitual:

- `graduation-service.ts` — lee cabezas de nivel, asistencia contada, sesiones de las últimas 8
  semanas y próximas 3 semanas, reservas confirmadas y reviews; aplica `graduationStageOf` a cada
  alumno activo.
- `graduation-firestore.ts` — adaptador.
- `graduation-callables.ts` (europe-west9, exportadas en `src/index.ts`):
  - `listGraduations` — owner o administrator. Devuelve las tres listas con: nombre, edad, nivel
    actual → siguiente (con visual), clases hechas/mínimo, días hechos/mínimo, fecha probable, clase
    de graduación (sesión, hora, coach), última nota de Not yet.
  - `decideGraduation` — **solo owner** (D8). Entrada `{ studentId, sessionId, decision:
    "promote" | "not-yet", note? }`. Revalida en servidor que el alumno sigue en `approval` para esa
    sesión.
    - `promote`: reutiliza la escritura de `assignLevel` (promoción `approved`, cabeza al nuevo
      nivel, `currentLevelStartedAt` = día de la clase de graduación, auditoría) y crea un
      `adminNotifications` de tipo nuevo `level` («Ana López reached Blue – 1st stripe»).
    - `not-yet`: crea `academies/{id}/graduationReviews/{studentId}__{sessionId}` con
      `{ studentId, sessionId, definitionKey, decision: "not-yet", note, decidedBy, decidedAt }`.
      Nota opcional, máx. 280 caracteres, misma validación de texto libre que las notas de nivel.
  - `getMyGraduationNotices` — el miembro (o tutor, por cada hijo vinculado) recibe por alumno:
    etapa (`twoLeft`/`next`/`today`/`approval`), fecha probable, última nota de Not yet del nivel
    actual, y la última promoción (`promotionId`, nivel nuevo, nivel anterior, fecha) para la
    animación. Nunca devuelve datos de otros alumnos ni técnicas (D6).
- `firestore.rules`: `graduationReviews` sin lectura/escritura de cliente (solo funciones).
- Índices: ninguno compuesto previsto (consultas por igualdad + rango sobre un campo); si el
  adaptador necesita uno, se añade a `firestore.indexes.json` y se dice en la entrega.

## 6. Web — panel admin

- `apps/web/src/app/admin/graduations/page.tsx`, item **Graduations** en `admin-shell.tsx` entre
  Overview y Attendance, visible para owner y administrator, ruta no permitida a coaches (D7).
- Tres secciones apiladas, con contador cada una:
  1. **Next graduation** — fila: alumno, nivel actual → siguiente (chip de color del cinturón),
     clases `n/min`, días `n/min`, «Likely next class: Thu 9 Oct, 18:00 Adults». Orden: fecha
     probable.
  2. **Today's graduations** — misma fila con la hora de la clase de hoy; marca «Checked in» si ya
     llegó (en ese caso ya estará en la sección 3).
  3. **Graduation approval** — fila con la clase de graduación y botones **Promote** y **Not yet**
     (solo owner; el administrator los ve deshabilitados con «Owner decides»). Not yet abre un campo
     de nota opcional «What to work on (the member will see this)». Promote abre la confirmación
     existente de nivel (nivel → siguiente, fecha de la clase).
- Overview: el panel de notificaciones muestra el tipo `level`.

## 7. Web — app del miembro (`/account`)

Componente nuevo `GraduationNotices` dentro de la pestaña de progreso, encima de las barras; para
tutores, una tarjeta por hijo con su nombre (D11). Los avisos actuales se quedan (D13).

| Etapa | Aviso | Animación |
|---|---|---|
| `twoLeft` | «Only 2 classes to your next graduation» | entrada suave, dos marcas de clase que laten |
| `next` / `today` | «Your next class could be a graduation — Thu 9 Oct, 18:00» | cinta del siguiente stripe/cinturón que brilla |
| `approval` | «Graduation class done — your coach will confirm soon» | pulso tranquilo |
| Not yet | «Keep going: <nota del owner>» (si hay nota) | sin animación de celebración |
| «No pierdas el ritmo» (D14) | En `next`, si su clase probable pasó sin asistencia: «We missed you on Thursday — your graduation is still one class away. Next: Mon 13 Oct, 18:00» | entrada suave |
| Nueva promoción | Pantalla de celebración una sola vez por `promotionId`: cinturón nuevo, nombre del nivel, y las barras de clases y días vuelven a cero animadas | cinturón que entra, barras que se vacían y rebotan |

- «Visto» de la celebración: `localStorage` por `promotionId` (mismo patrón que
  `promotion-bar.tsx`), envuelto en try/catch; si falla, la celebración aparece una vez por sesión.
- `prefers-reduced-motion`: todas las animaciones se sustituyen por cambios sin movimiento.
- Animación con CSS (keyframes) en `progress.css`, sin librerías nuevas.
- Técnicas: se quita la lista de técnicas de la vista del miembro (`member-progress.tsx`,
  `beltSkills`/`stripeSkills`) (D6). Coaches y owner las siguen viendo en el syllabus.

## 8. Errores y bordes

- Alumno sin nivel inicial (`state !== "initialized"`) → no entra al flujo.
- Asistencia corregida o anulada después de entrar en `approval` → al recalcular sale de `approval`;
  `decideGraduation` revalida y responde «This graduation is no longer pending».
- Dos clics en Promote → la revalidación y la transacción de promoción impiden un segundo ascenso.
- Owner hace un ascenso manual desde Manage mientras el alumno está en el flujo → la cabeza cambia y
  el cálculo arranca desde el nuevo nivel.
- Edad fuera de la franja del siguiente nivel → se muestra en la fila como aviso para el owner; no
  bloquea (el owner decide, ADR-012).

## 9. Pruebas

Según `AGENTS.md` de BPT, no se añaden ni corren tests salvo petición del operador. Verificación por
inspección, compilación de lo que se despliega y comprobación en producción con datos del owner o
sintéticos. Se dirá claramente qué no se probó.

## 10. Fuera de alcance

Email/push (D10), fecha más rápida posible y tarjeta para compartir (D15), permisos de coach para
graduar (D8), cambios en el cálculo de clases contadas.
