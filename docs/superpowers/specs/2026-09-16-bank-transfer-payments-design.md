# Pagos por transferencia con referencia automática y ciclo de suscripción — diseño

Fecha: 2026-09-16 · Estado: diseño aprobado por el operador (Luis) en chat el 2026-09-16 (7
decisiones de alcance), pendiente de la ronda `/grill-me` y del plan de implementación · Rama
de trabajo: una rama nueva `feature/bank-transfer-payments` desde la cabeza que el operador
indique (este documento se guarda en la rama activa del checkout por no perturbar la
integración en curso de Classes/Services).

Requisito de origen (texto del operador, 2026-09-16, resumido): todos los pagos del sitio
(suscripciones, sesiones sueltas, merchandising) se hacen **solo por transferencia bancaria**.
El sistema debe dar a cada pago una **referencia** con la que el administrador sepa qué
miembro paga, si es Town o West y qué está pagando. Al terminar una suscripción sin pago
nuevo, la membresía vuelve a **pay-as-you-go**. Un pago hecho antes de que termine cubre
**solo el mes siguiente**, que empieza cuando acaba el actual.

## 0. Encuadre: no es un cambio de reglas

`firestore.rules` cierra todas las colecciones (`allow read, write: if false`) y todo acceso
pasa por callables con comprobación de rol. El trabajo vive en `packages/domain` (contratos),
`apps/functions` (servicios, callables, job) y `apps/web` (pantallas). Las reglas solo ganan
dos bloques `if false` para las dos colecciones nuevas (§2.4) y sus casos en `qa/rules`.

## 1. Qué existe y se reutiliza (verificado en el código el 2026-09-16)

| Pieza | Dónde | Estado |
| ----- | ----- | ------ |
| Facturas `invoices` con `invoiceReference`, estados `open / partially_paid / paid / void`, tipos `membership / payg_session / manual_adjustment`, por `familyId` | `packages/domain/src/finance/finance-contracts.ts`, `apps/functions/src/finance/finance-service.ts` | Office teclea la referencia a mano en `issue-invoice-dialog.tsx`; el store rechaza referencias duplicadas. |
| Pagos manuales `recordManualPayment` (`cash / bank_transfer / other`, `manualReference`, dedupe) | `finance-callables.ts`, `record-payment-dialog.tsx` | Solo `owner / administrator`. |
| Instrucciones bancarias (T035): un documento `settings/paymentInstructions` con cuenta única y `referenceHint`; pantalla "How to pay" en `/account/billing` | `finance-contracts.ts` §T035, `payment-instructions-panel.tsx` | Una sola cuenta para toda la academia. |
| Membresías: `planId`, `status` (`trial / active / paused / overdue / cancelled`), `startsAt`, `endsAt`, `nextBillingAt` | `packages/domain/src/memberships/membership-contracts.ts`, `membership-service.ts` | `endsAt` y `nextBillingAt` se crean a `null` y nada los usa; no existe vencimiento automático. |
| Catálogo de planes: `payg` (por sesión, 1000 p) y nueve planes mensuales por sede/edad (`classSites`) | `plan-contracts.ts`, `docs/data/firestore-data-model.md` §T032 | Todos los planes de pago son mensuales hoy. |
| Bloqueo por deuda PAYG (máximo 1 sesión impagada antes de bloquear reservas) | `schedule-contracts.ts` ~1422 (T038) | Cuenta facturas `payg_session` abiertas; funciona sin tocarlo. |
| Reservas: `requestBooking`, `cancelBooking`, corte de 1 h; sesión con `locationId` `town / west` | `schedule-callables.ts`, `schedule-contracts.ts` | La factura PAYG hoy la crea office a mano. |
| Tienda: pedidos `requested → confirmed → ready → collected / cancelled`, `paymentStatus unpaid / paid`, texto "se paga al recoger"; rol `shopper` (comprador sin ficha ni familia) | `shop-contracts.ts`, `shop-callables.ts` | Fuera del módulo de facturas. |
| Coaches: sin acceso a finanzas ni importes | `docs/adr/ADR-010-coach-office-powers.md` | Se enmienda (§3.7). |
| Job programado (`onSchedule`) | `member-callables.ts` `cleanupExpiredMemberImportSessionsSchedule` | Patrón a copiar. |
| `membershipNumber` es Restricted | ADR-009 §14 | La referencia **nunca** se deriva de él. |

## 2. Decisiones (trazables)

### 2.1 Decisiones de alcance del operador (chat 2026-09-16)

| # | Pregunta | Decisión |
| - | -------- | -------- |
| A | ¿Quién dispara la renovación mensual? | **Ambos**: el job diario la emite 7 días antes de `endsAt`, y el miembro puede adelantarla con "Pay next month now". Misma guarda, mismo servicio. |
| B | ¿Un pedido de tienda puede recogerse antes de pagarse? | **No**: el pedido genera factura + referencia al crearse; `confirmed → ready` exige factura `paid`. |
| C | ¿Qué poder tienen los coaches sobre pagos? | **Registrar pagos en efectivo** contra una referencia. Siguen sin ver importes agregados, historial ni `/admin/billing`. Enmienda a ADR-010. |
| D | ¿Cuándo nace la factura PAYG? | **Al reservar**: `requestBooking` la emite y devuelve importe + referencia; `cancelBooking` dentro del corte la anula. |
| E | ¿Modelo cobro → periodo? | **"La factura manda"**: factura de periodo con `planId / periodStart / periodEnd`; pagarla activa o extiende la membresía. Primera compra y renovación son una sola ruta. PAYG hasta que se paga. |
| F | ¿Town/West: dos cuentas o etiqueta? | **Una cuenta**; la sede va en la referencia y en la factura. |
| G | ¿Shoppers sin familia? | **También por transferencia con referencia**: la factura admite pagador por usuario. |

### 2.2 Decisiones de diseño

| # | Tema | Decisión |
| - | ---- | -------- |
| 1 | Formato de referencia | `BPT-<S><K>-<CODE>-<NN>`, p. ej. `BPT-TM-K7Q2-017`. 15 caracteres, dentro del límite de 18 del campo de referencia de Faster Payments. Mayúsculas, guiones fijos; se acepta entrada sin guiones y en minúsculas al buscar. |
| 2 | Letra de sede `S` | `T` Town, `W` West, `J` cuando no es atribuible a una sede (plan de ambas sedes `bpt-jersey-adult`, pedidos de tienda, ajustes). Origen: plan de una sede → esa; sesión PAYG → `locationId` de la sesión; tienda → `J`. Cuando las sedes pasen a ser dinámicas (spec Classes/Services §4), la letra es la inicial de `abbreviation` y `J` sigue siendo el neutro. |
| 3 | Letra de tipo `K` | `M` periodo de membresía, `S` sesión PAYG, `O` pedido de tienda, `A` ajuste manual. |
| 4 | Código de pagador `CODE` | 4 caracteres del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin `0 O 1 I`), generado al azar la primera vez que un pagador necesita una referencia y fijo después. Pagador = `familyId` (miembros y tutores) o `userId` (shoppers). Se asigna en transacción con `payerCodes/{code}` como testigo de unicidad; si colisiona se reintenta. |
| 5 | Secuencia `NN` | Contador por pagador, empieza en 1, sin límite de dígitos (`017`, `118`). Unicidad global garantizada por `(CODE, NN)`; el rechazo de `invoiceReference` duplicada del store queda como segundo seguro. |
| 6 | Quién genera | Solo el servidor, dentro del servicio de facturas. `issueManualInvoice` deja de aceptar `invoiceReference` como entrada; el campo desaparece del diálogo de office. Las facturas ya existentes conservan su referencia manual. |
| 7 | Modelo de factura | `chargeKind` gana `membership_period` (campos `planId`, `periodStart`, `periodEnd`) y `shop_order` (`sourceRef` = `orderId`). Campos nuevos en todas: `site` (`town / west / null`), `payerKind` (`family / user`), `payerId`. `familyId` pasa a admitir `null` solo cuando `payerKind = "user"`. El tipo `membership` existente se mantiene para facturas manuales ligadas a una membresía. |
| 8 | Periodo | `periodEnd = periodStart + 1 mes de calendario` (misma fecha del mes siguiente; si no existe, último día). Cuando los planes dinámicos traigan `paymentCycle`, el periodo se calcula desde él; hasta entonces todos los planes de pago son mensuales y el cálculo vive en una sola función de dominio `nextPeriod(planCycle, start)`. |
| 9 | Primera compra | El miembro elige un plan en `/account/membership` → factura `membership_period` con `periodStart = hoy` (o la fecha de inicio que elija, no anterior a hoy). La membresía sigue en `payg` (o `trial`) hasta que la factura está `paid`. Al pagarse: `planId := factura.planId`, `startsAt` no cambia, `endsAt := periodEnd`, `trial → active`. |
| 10 | Renovación | Misma factura con `periodStart = endsAt actual`. La emite el job 7 días antes de `endsAt` o el miembro con "Pay next month now". Al pagarse: `endsAt := periodEnd`. Nunca se acorta un periodo ya pagado. |
| 11 | Un periodo por delante | Guarda de dominio: una membresía tiene como máximo **una** factura `membership_period` que esté `open`, `partially_paid` o `paid` con `periodStart > hoy`. Cumple "cada pago es un periodo nuevo" y evita pagar dos meses por adelantado. |
| 12 | Vencimiento | Al pasar `endsAt` sin factura de renovación pagada: `planId := "payg"`, `endsAt := null`, `status` sigue `active`, evento de auditoría `membership_reverted_to_payg` con el plan anterior. Sin periodo de gracia sobre el acceso: desde ese instante reserva como PAYG. |
| 13 | Gracia de la factura | La factura de renovación **no se anula al vencer**: sigue `open` 7 días más, porque una transferencia hecha el último día tarda en verse en el banco. Si se registra dentro de la gracia: se restaura `planId` y `endsAt = periodEnd` de la factura y se anulan las facturas `payg_session` de ese pagador con sesión dentro del periodo restaurado. Pasada la gracia el job la anula (`void`) y un pago tardío se trata como una primera compra nueva. |
| 14 | Job diario | `financeDailySchedule` (`onSchedule`, 03:00 `Europe/Jersey`): (a) emitir renovaciones para membresías `active` con plan de pago y `endsAt ≤ hoy + 7 d` sin factura de periodo pendiente; (b) vencer las que tienen `endsAt < ahora` sin renovación pagada; (c) anular renovaciones `open` cuya gracia expiró. Cada paso relee el estado en transacción; ejecutar dos veces no duplica nada. Salta `paused`, `cancelled` y `trial` sin factura. |
| 15 | PAYG en reserva | `requestBooking` de un alumno cuya membresía está en `payg` emite una factura `payg_session` (`sourceRef = bookingId`, `site` = sede de la sesión, `dueAt` = inicio de la sesión) y devuelve `paymentReference` y `amountMinor` en la respuesta. `cancelBooking` dentro del corte de 1 h anula la factura si no tiene pagos; con pagos queda como crédito manual a resolver por office. |
| 16 | Tienda | `placeShopOrder` emite la factura `shop_order` en la misma transacción y guarda `invoiceId` y `paymentReference` en el pedido. `updateShopOrder` rechaza `confirmed → ready` si la factura no está `paid` (regla en `shop-contracts.ts`, no en la UI). `cancelled` anula la factura sin pagos. Al registrarse el pago completo, `paymentStatus := "paid"` en el pedido. |
| 17 | Conciliación | Nuevo callable `findInvoiceByReference` (staff): devuelve referencia, estado, importe pendiente, tipo, sede, nombre del alumno o comprador y periodo si aplica. `/admin/billing` gana un buscador por referencia que abre el diálogo "Record payment" existente. Importes distintos siguen como hoy (`partially_paid`). |
| 18 | Coaches | `recordManualPayment` se abre a `coach / headCoach` **solo** con `method = "cash"` y solo contra una factura localizada por referencia; cualquier otro método o el resto de callables de finanzas siguen en `owner / administrator`. Ruta nueva `/admin/cash` (referencia → importe pendiente → confirmar), añadida a `admin-routes.ts` para coaches. Enmienda a ADR-010 en el mismo cambio. |
| 19 | Miembro | `/account/membership`: plan actual, `endsAt`, factura de periodo pendiente con importe + referencia + "How to pay", botón "Pay next month now" (deshabilitado si ya hay una pendiente o el plan es `payg`), selector de plan para primera compra. `/account/calendar` (reserva PAYG) y `/shop` (pedido) muestran importe + referencia + datos bancarios al confirmar. Los datos bancarios salen de `paymentInstructions` como hoy. |
| 20 | Pagador para menores | El pagador es la familia (`familyId`); la referencia identifica a la familia y la factura identifica al alumno (`membershipId → studentId`) y la sede. Dos hijos en la misma familia comparten `CODE` y se distinguen por `NN` y por la factura. |
| 21 | Estado `overdue` | No se usa para vencimientos de periodo (el vencimiento revierte a PAYG en vez de marcar deuda). Se conserva tal cual para lo que T038 ya hace con deuda PAYG. |
| 22 | Sin migración | Las facturas existentes con referencia manual siguen válidas y buscables. Las membresías con `endsAt = null` en plan de pago se consideran **sin periodo pagado**: el job no las vence ni las renueva hasta que office les emita una primera factura de periodo desde `/admin/billing` (acción "Issue period invoice", que usa la misma ruta que el miembro). Esto evita revertir a PAYG a todo el mundo el primer día. |
| 23 | Auditoría | Cada emisión, pago, vencimiento, restauración y anulación escribe un `auditEvents` con `actorId` (o `system:financeDailySchedule`), `invoiceId` y `invoiceReference` como `correlationId`, como ya hace el store de finanzas. |

## 3. Arquitectura por capas (patrón del repo)

### 3.1 Dominio (`packages/domain/src/finance`)

- `payment-reference.ts`: `formatPaymentReference({ site, kind, code, sequence })`,
  `parsePaymentReference(text)` (tolerante a minúsculas y sin guiones), `payerCodeAlphabet`,
  `generatePayerCode(random)`, `siteLetterFor(...)`.
- `billing-period.ts`: `nextPeriod(cycle, start)` (hoy solo `monthly`), `renewalWindowDays = 7`,
  `invoiceGraceDays = 7`.
- `finance-contracts.ts`: `chargeKinds` + `membership_period`, `shop_order`; campos
  `site`, `payerKind`, `payerId`, `planId`, `periodStart`, `periodEnd`; parser con las
  invariantes (§2.2 #7, #11); `issueManualInvoice` sin `invoiceReference` en la entrada.
- `packages/domain/src/shop/shop-contracts.ts`: `invoiceId`, `paymentReference` en el pedido;
  transición `confirmed → ready` condicionada a `paymentStatus = "paid"`.

### 3.2 Servicios (`apps/functions/src`)

- `finance/payment-reference-store.ts`: `allocateReference(payer, site, kind)` en transacción
  sobre `payerReferences/{payerId}` `{ code, nextSequence }` y `payerCodes/{code}` `{ payerId }`.
- `finance/finance-service.ts`: `issueInvoice` llama a `allocateReference`; `recordManualPayment`
  aplica los efectos por tipo (§3.4); `findByReference`; `voidUnpaidPeriodInvoice`.
- `finance/subscription-service.ts`: `issuePeriodInvoice(membershipId, actor)` (guarda de un
  periodo, calcula periodo), `expireMemberships(now)`, `voidExpiredRenewals(now)`,
  `restoreFromGrace(invoice)`.
- `finance/finance-schedule.ts`: `financeDailySchedule` que encadena los tres pasos.
- `schedule/schedule-callables.ts`: `requestBooking` / `cancelBooking` llaman al servicio de
  facturas cuando el plan es `payg`.
- `shop/shop-service.ts`: `placeOrder` emite la factura; `updateOrder` valida el pago.

### 3.3 Callables nuevos o cambiados

| Callable | Roles | Cambio |
| -------- | ----- | ------ |
| `issueMembershipPeriodInvoice` | guardian, adultStudent (propia), owner, administrator (cualquiera) | Nuevo. Primera compra y "Pay next month now". |
| `findInvoiceByReference` | owner, administrator, headCoach, coach | Nuevo. Proyección mínima. |
| `recordManualPayment` | + headCoach, coach solo `cash` | Cambiado. |
| `issueManualInvoice` | owner, administrator | Ya no recibe `invoiceReference`. |
| `requestBooking` / `cancelBooking` | sin cambio de roles | Respuesta con `paymentReference` y `amountMinor` cuando aplica. |
| `placeShopOrder` / `updateShopOrder` | sin cambio de roles | Factura en la misma transacción; guarda de pago. |
| `getFamilyFinancialAccount` / `listMyShopOrders` | sin cambio | Devuelven la referencia y el periodo. |

### 3.4 Efectos al registrar un pago (una sola función, por `chargeKind`)

| Tipo | Al quedar `paid` |
| ---- | ---------------- |
| `membership_period` | `planId := invoice.planId`, `endsAt := periodEnd`, `trial → active`; si la factura estaba en gracia, además anular `payg_session` del periodo (§2.2 #13). |
| `payg_session` | Nada más (el bloqueo de T038 deja de contarla). |
| `shop_order` | `paymentStatus := "paid"` en el pedido. |
| `membership`, `manual_adjustment` | Como hoy. |

### 3.5 Reglas Firestore

```
match /academies/{academyId}/payerReferences/{payerId} { allow read, write: if false; }
match /academies/{academyId}/payerCodes/{code}        { allow read, write: if false; }
```

Casos nuevos en `qa/rules`: lectura y escritura denegadas para anónimo, miembro, coach y admin.

### 3.6 Índices

`invoices` por `(academyId, membershipId, chargeKind, status)` para la guarda de un periodo, y por
`(academyId, chargeKind, status, periodStart)` para el job. Se añaden a `firestore.indexes.json`
en el mismo cambio (un índice ausente aparece como error opaco en tiempo de ejecución).

### 3.7 Enmienda a ADR-010

Se abre a `coach / headCoach`: `findInvoiceByReference` y `recordManualPayment` con `cash`.
No se abre: `listFinancialAccount`, `getFamilyFinancialAccount`, `listRecentPayments`,
`issueManualInvoice`, `voidManualInvoice`, `getOperationalReport`, `/admin/billing`.

## 4. Pruebas (evidencia exigida por el ledger)

- **Dominio**: formato y parseo de referencia (ida y vuelta, entrada sucia, longitud ≤ 18);
  alfabeto sin ambiguos; `nextPeriod` con fin de mes (31 ene → 28/29 feb); guarda de un periodo;
  transiciones de pedido condicionadas al pago.
- **Servicios con fakes en memoria**: asignación de código con colisión forzada; pago activa
  (`trial → active`), pago extiende (`endsAt` desde `periodEnd`, no desde la fecha de pago);
  vencimiento revierte a PAYG y audita; pago en gracia restaura y anula PAYG del periodo; pago
  fuera de gracia rechazado; job ejecutado dos veces no duplica facturas ni eventos; reserva PAYG
  emite y cancelación anula; pedido no pasa a `ready` sin pago.
- **Callables**: coach con `cash` pasa, coach con `bank_transfer` falla, miembro no puede emitir
  para otra familia, shopper recibe referencia, `issueManualInvoice` con `invoiceReference` en la
  entrada se rechaza.
- **Rules**: dos colecciones cerradas para todos los roles.
- **Web**: `/account/membership` muestra referencia y deshabilita el botón con pendiente;
  `/admin/billing` busca por referencia; `/admin/cash` solo efectivo.
- **E2E smoke**: miembro elige plan y ve importe + referencia + datos bancarios.
- Para cada guarda nueva: desactivarla y comprobar que una prueba muere (`LECCIONES.md` §4).

## 5. Fuera de alcance (explícito)

Pasarela de pago (T010 sigue cerrada por decisión del operador del 2026-09-06/07); avisos por
email o SMS de vencimiento o de factura emitida; cambio de plan a mitad de periodo y prorrateos;
reembolsos automáticos; importación o conciliación automática de extractos bancarios; dos cuentas
bancarias por sede; descuentos y packs de créditos (spec Classes/Services #7).

## 6. Riesgos y dependencias

- La spec Classes/Services (2026-09-16) vuelve dinámicos planes y sedes. Este diseño aísla el
  ciclo en `nextPeriod` y la letra de sede en `siteLetterFor`, de modo que el cambio sea de una
  función cada uno.
- `familyId` nulo en facturas toca consultas existentes por familia; se acota a `shop_order` con
  `payerKind = "user"` y se cubre con pruebas de `getFamilyFinancialAccount`.
- El job corre con identidad de sistema; sus escrituras se auditan con `actorId` fijo.
