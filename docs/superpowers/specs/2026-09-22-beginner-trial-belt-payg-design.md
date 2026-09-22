# Trial de principiantes, cinturón declarado, conversión a membresía y PAYG con pago al llegar

Fecha: 2026-09-22 · Rama: `main` · Estado: diseño aprobado por Luis (pendiente de plan de implementación)

## 1. Contexto y objetivo

Hoy el registro público (`/enrol`, ADR-016) obliga a elegir un plan por alumno y, salvo PAYG de West,
a subir un comprobante de transferencia. La clase Intro gratuita (spec 2026-09-21) permite exactamente
**una** clase a quien ya tiene cuenta y alumno canónico, pero no existe forma pública de registrarse
"solo para probar". Tampoco el alumno puede declarar su cinturón, y una sesión PAYG la cobra la
oficina a mano después.

Resultado observable que se entrega:

`Registro (Beginner por defecto | "I'm not a Beginner" → cinturón+rayas) → Enrolment Request sin
pago → aprobación fija nivel + Trial → reserva clases Intro (o del grupo de edad si <16) →
1ª asistencia → aviso in-app → elegir plan (incl. PAYG en West) → captura → Enrolment Requests
(owner/admin) → membresía activa`. Al agotar el Trial: West adulto/teen pasa a PAYG solo; Town queda
bloqueado hasta tener plan. Al reservar con PAYG el miembro elige "pagar online" (transferencia +
captura) o "pagar al llegar"; el coach marca "Paid at venue" en la lista.

## 2. Decisiones (trazables a la conversación 2026-09-22)

| # | Decisión | Origen |
|---|----------|--------|
| D1 | En el paso de planes del registro aparece por defecto la tarjeta **"I am a beginner"** (Trial, 2 Introduction Classes, £0). Un botón **"I'm not a Beginner"** despliega selección de **Belt** y **Stripes**. | mensaje inicial |
| D2 | Un **no principiante** recibe Trial de **1** clase; un **principiante**, Trial de **2**. | respuesta 2 |
| D3 | La lista de cinturones depende de la edad (catálogo kids <16 / adultos 16+ de `level-catalog-v2`). El cinturón declarado queda **preseleccionado** en la revisión de oficina; la oficina confirma. Beginner → White Belt del catálogo correspondiente a su edad. | respuestas 1, 3, 12 |
| D4 | "Intro" y "Introduction Class" son la misma cosa: sesiones con `accessMode: "intro"`. | respuesta 4 |
| D5 | El estado de suscripción del alumno en Trial se muestra como **"Trial"**. **No es una membresía** (ver §3). | respuesta 5 |
| D6 | **≥16 años**: solo puede reservar sesiones `intro` de su sede. **<16 años**: sesiones de su sede cuyo programa tenga `ageBand` igual a su banda (kids o teens), cualquier `accessMode`. La sede es la elegida al registrarse (`trainingCenter`). | mensaje inicial, respuestas 4, 5 |
| D7 | El Trial caduca a los **30 días** de la aprobación **o** al completar su cupo (2 ó 1 clases asistidas). | respuesta 6 |
| D8 | El registro Trial pasa por **Enrolment Requests** (datos, waiver, tutor) pero **sin comprobante, sin plan ni periodo**. | respuesta 7 |
| D9 | Tras la **primera** asistencia aparece el aviso **"Did you enjoy training with us? Tap here to get a membership and keep training with us."** Persiste hasta enviar la solicitud de membresía. | respuestas 9, 10 |
| D10 | El botón lleva a la pantalla de elección de plan (`/account/membership?from=intro`): sede + plan elegible + captura. **PAYG (solo West) se permite sin captura.** | mensaje inicial + hallazgo |
| D11 | Las solicitudes de membresía post-Trial se revisan en **Enrolment Requests**, visibles solo para **owner y administrator**. Los coaches no ven solicitudes ni capturas. | respuesta 11 |
| D12 | **West**: al completar el cupo del Trial, el alumno adulto o teen pasa **automáticamente** a membresía PAYG (`payg` o `west-teens-payg`). **Town**: bloqueado hasta tener plan. West **kids (<12)**: no existe PAYG kids → bloqueado como Town (⚠ asunción, ver §8). | respuesta 8 |
| D13 | PAYG solo existe en West (ya es así en el catálogo). Transit Free nunca se ofrece a miembros (ya oculto) y en el admin solo lo ve/asigna el **owner**. | interrupción de Luis |
| D14 | Al reservar una sesión con plan PAYG, el miembro elige **"Pay online (bank transfer)"** (captura + referencia) o **"Pay at the academy"**. | respuesta 13 |
| D15 | El coach marca **"Paid at venue"** en la lista de la sesión: un tick, sin importes. La oficina sigue registrando transferencias en Billing. | respuesta 14 |
| D16 | Nuevas reservas PAYG se bloquean si hay **una** sesión ya celebrada sin pagar. Facturas de sesiones futuras no cuentan como deuda. | respuesta 15 |
| D17 | Se trabaja en `main` y se despliega web + functions (europe-west9). | respuesta 16 |

## 3. Enfoques descartados

- **Membresía real con estado `trial`**: la spec 2026-09-21 §3.1 ya lo descartó; además cualquier
  documento de membresía bloquea la reserva Intro (`assertNoMembershipHistory`) y las reservas
  ordinarias aceptan `trial` como elegible, con lo que un alumno de Trial podría reservar clases
  normales. El Trial se modela como un documento propio (§4.2) y la UI lo etiqueta "Trial".
- **Plan £0 "trial" en el catálogo** (como Transit Free): forzaría periodo, factura y elegibilidad de
  plan para algo que no es un plan; mismo problema anterior.
- **Grants `studentGroupAccess`**: exigen membresía y no cuentan clases.

## 4. Modelo de datos

### 4.1 Enrolment request (`enrolmentRequests/{id}`)
Por alumno (applicant y cada minor) se añaden:
- `experience: "beginner" | "experienced"` (por defecto `beginner`).
- `declaredLevelKey: string | null` — `definitionKey` de un **belt** publicado del catálogo, con
  `stripeNumber` resuelto a la definición stripe correspondiente (si declara rayas). Solo cuando
  `experienced`. El servidor valida que exista, esté publicado y sea acorde a la edad.
- Selección de plan: se admite el valor `"trial"` además de un `PlanId`. `enrolmentNeedsPayment`
  devuelve `false` para `trial`; el importe total lo excluye.

### 4.2 Trial (`academies/{a}/trialAccess/{studentId}`) — nuevo, solo servidor
```
{ studentId, academyId, site: "Town"|"West", allowance: 1|2, attendedCount, status: "active"|"exhausted"|"expired"|"converted",
  startsAt, expiresAt (startsAt + 30 días), createdBy (enrolment request id), updatedAt, schemaVersion: "1" }
```
Se crea en la aprobación del Enrolment Request. `attendedCount` lo actualiza el trigger de asistencia
(§5.4). Es la fuente de verdad de elegibilidad Intro; sustituye a los booleanos `hasAttendedIntro`.

### 4.3 Reservas PAYG (`bookings/{id}`, schema 1 con membresía per-session)
Campo nuevo `paygPayment: { method: "bank_transfer" | "at_venue", proofId: string | null, reference: string | null }`.
La factura `payg_session` se emite **en la transacción de reserva** (reutiliza `issuePaygInvoice`,
mismo `sourceRef`/`invoiceReference` que `preparePaygClassPayment`, que sigue existiendo para casos
antiguos y es idempotente sobre la misma factura).

### 4.4 Solicitud de membresía (`membershipApplications/{id}`)
`billingPeriod` admite `"per-session"`; entonces `proofId` y `bankReference` son `null` y el importe
mostrado es "£X per class, pay when you book".

### 4.5 Aviso (`memberNotifications`)
Mismo `kind: "intro_membership_ready"`; `title`/`body` con el copy de D9. Se muestra mientras la
conversión esté en `ready` (no depende de `readAt`).

## 5. Flujos

### 5.1 Registro público `/enrol`
1. Paso 2 (planes): por cada alumno, tarjeta por defecto **"I am a beginner — Trial: 2 free
   Introduction Classes"** seleccionada. Botón **"I'm not a Beginner"** → aparecen `Belt` (select, por
   edad) y `Stripes` (0–4) y el texto pasa a "Trial: 1 free Introduction Class". Debajo, los planes
   elegibles de siempre (PAYG solo si sede West, por catálogo). Transit Free nunca aparece.
2. Paso 3 (pago): si todos los alumnos son Trial o PAYG, no se pide captura ni importe (regla
   `enrolmentNeedsPayment` ampliada). Mixto: solo suma los prepago, como hoy.

### 5.2 Enrolment Requests (owner/administrator)
- Detalle: muestra "Beginner" o "Experienced · Blue belt · 2 stripes" por alumno.
- Aprobación: para alumnos Trial no hay plan, periodo ni casilla de pago; el nivel inicial viene
  **preseleccionado** (declarado o White Belt por edad) y el revisor puede cambiarlo. Al aprobar, el
  servidor crea alumno + nivel (`openStudentLevel`, como hoy) + `trialAccess` (§4.2). Reintentos
  idempotentes por request id.
- Sección nueva **"Membership requests"** en la misma página: mueve el panel actual de
  `/admin/billing` (`intro-applications-panel`) sin cambiar su lógica de aprobación. Solo
  owner/administrator (mismas claims que hoy). Coach: sin acceso.

### 5.3 Calendario y reserva del alumno en Trial
- `/account` muestra estado "Trial · N of M classes left · ends DATE" (o "Trial ended").
- `getMemberCalendarWeek` incluye en el contexto `trial: {site, allowance, attendedCount, futureBookings, expiresAt}`.
  `lockedReasonFor`: si hay Trial activo y no hay membresía: elegible si (edad ≥16 y sesión `intro`)
  o (edad <16 y `program.ageBand === banda`), sede coincide, y `attendedCount + futureBookings < allowance`;
  si no → `paid_period` (con texto "Your trial has ended — choose a membership" cuando el Trial está
  `exhausted`/`expired`). Edad para la regla 16: `memberAgeOn(dateOfBirth, fecha de la sesión)`.
- `requestIntroBooking`: la transacción reevalúa lo mismo con `trialAccess` en lugar de
  `assertNoIntroAttendance`; permite hasta `allowance` reservas futuras confirmadas. Los menores <16
  reservan sesiones `membership` de su banda con **origen intro** (`source.kind: "intro"`), sin
  membresía; capacidad, ventana, waiver y sede como hoy. Ordinarias (con membresía) no cambian.

### 5.4 Asistencia y conversión
- Trigger `introAttendanceCreated` (ya existe): además de crear la conversión + aviso en la **primera**
  asistencia (copy D9), incrementa `attendedCount` en `trialAccess`. Cuando `attendedCount >= allowance`:
  - West y edad ≥12 → crea membresía PAYG (`payg` si ≥18, `west-teens-payg` si 12–17) vía
    `saveManualSubscription` con settlement `pay-as-you-go`, `trialAccess.status = "converted"`, y un
    aviso "You're now on Pay as you go at West. Book classes and pay online or at the academy."
  - Otro caso → `status = "exhausted"`.
- Caducidad por tiempo: se evalúa al leer (`expiresAt < now` ⇒ tratado como `expired`); no hace falta cron.
- Todo idempotente por `attendanceId`; correcciones no descuentan ni duplican.

### 5.5 Solicitud de membresía (`/account/membership?from=intro`)
- Igual que hoy, más: plan PAYG seleccionable si sede West y edad elegible; sin captura. Prepago:
  captura obligatoria como hoy. El aviso desaparece al enviar (`conversion.status = application_pending`).
- Aprobación (mismo callable `reviewIntroMembershipApplication`): crea membresía; PAYG con settlement
  `pay-as-you-go` y sin factura. `trialAccess.status = "converted"`. El nivel no cambia (ya fijado en 5.2).

### 5.6 Reserva PAYG con elección de pago
- Al reservar con membresía per-session, el diálogo pide `method`. `bank_transfer`: muestra datos
  bancarios (`paymentInstructions`), importe del plan, referencia `payg-<sesión corta>` y subida de
  captura (reutiliza `uploadEnrolmentPaymentProof` con namespace `payg-proofs/{uid}/{bookingId}`).
  `at_venue`: solo confirma.
- La transacción emite la factura y guarda `paygPayment`. Cancelar la reserva anula la factura si no
  tiene pagos (`void`), como ya hace la oficina a mano.
- Lista del coach (`session-registrations`): etiqueta "PAYG · pay at venue" / "PAYG · transfer sent" /
  "PAYG Paid". Tick **"Paid at venue"** (callable nuevo, rol coach o superior, App Check): registra un
  pago manual `cash` por el saldo de la factura de esa sesión. Sin importes en la UI del coach.
  ⚠ Excepción acotada a la regla "coach sin finanzas": un solo tick sobre su propia sesión; queda auditado.
- Oficina en Billing: ve la captura (URL firmada, como enrolment) y registra el pago `bank_transfer`.
- Deuda: `calculatePaygDebt(invoices, payments, asOf)` cuenta solo facturas `payg_session` con `dueAt < asOf`.
  `evaluateFinancialAccess` bloquea con deuda > 0 (mensaje "Pay your previous class before booking").

### 5.7 Transit Free
- Ya está fuera del catálogo público. En `member-subscription-editor` y en la aprobación manual solo
  el owner puede seleccionarlo; el servidor (`saveManualSubscription`) rechaza `transit-free` si el
  actor no es owner.

## 6. Seguridad e invariantes
- Todo por callables con App Check; ningún write directo desde el cliente. `trialAccess` y
  `paygPayment` los escribe solo el servidor.
- Elegibilidad Trial, edad, sede, cupo y caducidad se recalculan en la transacción de reserva.
- Capturas PAYG: PNG/JPEG ≤ 2 MiB, hash SHA-256, R2 privado, propiedad verificada; nunca en payloads
  de coach.
- Coaches: roster + tick "Paid at venue" (auditado). Enrolment Requests y Membership requests:
  owner/administrator. Transit Free: owner.
- Mensajes en inglés británico, sin IDs internos ni estado de otros miembros.

## 7. Interfaz
- Miembro: estilo redondeado (DESIGN.md §9). Aviso = banda de estado con una acción. Tarjeta "I am a
  beginner" y botón "I'm not a Beginner" con selects nativos; 44 px táctiles; errores asociados.
- Admin: lenguaje cuadrado BPT; la sección "Membership requests" reutiliza tabla y controles del panel
  existente.

## 8. Asunciones a confirmar (no bloquean)
- A1 West kids (<12) sin PAYG kids en el catálogo → al agotar el Trial quedan bloqueados como Town.
- A2 Un alumno de 16–17 es `teens` para planes, pero para el Trial cuenta como "≥16" (solo Intro).
- A3 Rayas declaradas 0–4; si el catálogo no tiene esa raya para ese cinturón, se guarda el cinturón sin raya.
- A4 Caducidad de 30 días también aplica a Trial de 1 clase.

## 9. Verificación y despliegue
- Tests de dominio: `enrolmentNeedsPayment` con `trial`; validación de `declaredLevelKey` por edad;
  `lockedReasonFor` con Trial (≥16/<16, sede, cupo, caducidad); `calculatePaygDebt(asOf)`.
- Tests de servicio (emulador): aprobación Trial crea nivel + `trialAccess`; reserva Intro hasta cupo;
  trigger incrementa, avisa una vez y convierte a PAYG en West; solicitud PAYG sin captura; reserva
  PAYG emite factura, tick del coach la salda, deuda vencida bloquea; owner-only Transit Free.
- Despliegue: push a `origin/main` (Cloudflare Pages publica la web) + `firebase deploy --only functions`
  (europe-west9), en ese orden, tras compilar `apps/functions`.
