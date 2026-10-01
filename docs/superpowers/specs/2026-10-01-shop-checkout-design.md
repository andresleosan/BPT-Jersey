# Tienda: visibilidad, cesta, checkout con pago y centro de retiro

Fecha: 2026-10-01 · Estado: aprobado en conversación, pendiente de revisión escrita

## Objetivo

1. Que los productos publicados se vean en la tienda online (`/shop`).
2. Que cualquier persona con cuenta (cualquier rol) compre con sus datos; quien no tenga cuenta,
   mediante el registro rápido de comprador que ya existe (`shopper`).
3. Checkout con cesta multi-producto, sección de pago (transferencia con comprobante o pagar al
   recoger) y elección del centro de retiro (Town / West).
4. Reordenar los espacios de `/admin/shop` tras una auditoría visual contra `DESIGN.md`.
5. Pruebas unitarias de lo tocado + verificación final con Playwright MCP contra emuladores.

## Diagnóstico (2026-10-01)

- Los 5 productos de producción (`academies/demo-academy/shopProducts`) tienen `active: false`.
  El panel muestra "Hidden" y un stock "Made to order", lo que confunde: la tienda solo lista
  `active: true`. El id público `demo-academy` es correcto.
- `catalogRoles`/`customerRoles` en `shop-callables.ts` excluyen `teenStudent`, `headCoach` y
  `coach`: para ellos `listShopCatalog` responde `permission-denied` y toda la página entra en error.
- `/account` no enlaza a la tienda.
- Hay 0 documentos en `shopOrders`: el contrato del pedido puede cambiar sin migración.

## Decisiones

| Tema | Decisión |
|---|---|
| Pago | Transferencia bancaria + captura (patrón PAYG) o pagar al recoger. Sin pasarela de tarjeta. |
| Cesta | Multi-producto: un checkout = un pedido con `lines[]`, un pago, un centro. |
| Visibilidad | `active` sigue siendo el único interruptor, renombrado en UI a "Visible in shop". Se compra si `active && stockStatus !== "sold-out"`. Sold out se ve pero no se compra. |
| Quién compra | Todos los roles con cuenta: `owner`, `administrator`, `headCoach`, `coach`, `guardian`, `adultStudent`, `teenStudent`, `shopper`. Administración y comprobantes: solo `owner`/`administrator`. |
| Sin cuenta | Navega y llena la cesta; para pagar va a `/login?returnTo=/shop` (registro rápido o Google ya otorgan `shopper`). |
| Finanzas | Marcar "Paid" sigue siendo `paymentStatus` del pedido; no se crea factura. |
| Datos de pago | Los `paymentInstructions` existentes (mismos que inscripción/PAYG). |
| Centros | `locationIds` de `@bpt-jersey/domain/schedule` (`town`, `west`); direcciones de `academyContent.locations`. |

## Backend

### Dominio — `packages/domain/src/shop/shop-contracts.ts`

- `shopPaymentMethods = ["bank_transfer", "at_collection"]`.
- `shopPickupLocationSchema = z.enum(locationIds)`.
- `shopCheckoutRequestSchema` (strict):
  `requestId`, `lines` (1–10; cada una `{productId, size|null, quantity 1–10}`; sin repetir
  `productId+size`), `pickupLocationId`, `paymentMethod`, `proofId` (obligatorio con
  `bank_transfer`, `null` con `at_collection`), `contactName`, `contactPhone|null`, `note|null`.
- `shopOrderRecordSchema` pasa a `schemaVersion: "2"`: sustituye los campos de producto único por
  `lines[]` (`productId`, `productName`, `category`, `size`, `quantity`, `unitPriceMinor`,
  `lineTotalMinor`) y añade `pickupLocationId`, `paymentMethod`, `proofId|null`.
  Refinamientos: `lineTotalMinor = unitPriceMinor × quantity`; `totalMinor = Σ lineTotalMinor`.
- La proyección incluye todo lo anterior salvo `academyId`, `requestId`, `createdBy`, `updatedBy`,
  `schemaVersion`. Se elimina `shopPaymentMethodNote` y `shopOrderRequestSchema`.
- `isShopProductPurchasable(product)`.

### Functions — `apps/functions/src/shop/`

- `placeShopOrder` acepta el checkout. En una transacción: idempotencia por `requestId`
  (mismo payload → mismo pedido; distinto → `already-exists`), lee cada producto, rechaza ocultos o
  agotados (`failed-precondition` con mensaje seguro que nombra el producto), valida la talla contra
  `sizes`, congela nombre y precio desde Firestore, escribe el pedido y un evento de auditoría.
  Con `bank_transfer` verifica que el objeto del comprobante exista en R2 bajo la clave del
  propio comprador antes de aceptar.
- Roles ampliados según la tabla de decisiones.
- `uploadShopOrderProof` (comprador): `{requestId, contentType: png|jpeg, base64 ≤ 2 MB}`;
  valida bytes mágicos (reutiliza el validador de comprobantes existente); guarda en R2 privado en
  `shopProofKey(academyId, userId, requestId, proofId)`; devuelve `{proofId}`.
- `getShopOrderProofUrl` (owner/administrator): `{orderId}` → URL firmada de 60 s.
- Los callables nuevos se re-exportan en `src/index.ts`.

## Web

### `/shop`

- Tarjeta de producto: talla + cantidad + "Add to basket"; sold out deshabilitado.
- Cesta en `localStorage` (`bpt-shop-basket`), solo `{productId,size,quantity}`; todo acceso en
  try/catch con respaldo en memoria. Al cargar se reconcilia con el catálogo y se avisa de lo
  retirado. Precio y nombre siempre del catálogo.
- Layout: ≥64rem catálogo + panel de cesta sticky (`minmax(0,1fr) 22rem`); <48rem una columna y
  barra inferior "Basket · N items · £X" con `env(safe-area-inset-bottom)`.
- Checkout en secciones fijas: Your basket → Your details (nombre/email de la sesión; teléfono de
  un dato de perfil ya expuesto si existe, si no, campo opcional vacío) → Collect from (Town/West
  con dirección) → Payment (transferencia: `EnrolmentBankDetails`, referencia, captura con vista
  previa; o pagar al recoger) → Place order.
- Sin sesión: las secciones de checkout se sustituyen por "Sign in or create a buyer account to
  check out" → `/login?returnTo=/shop`.
- Confirmación: banda verde con nº de pedido, centro, total y siguiente paso; se vacía la cesta.
- "Your orders": líneas, centro, método y estados.
- `/account`: acción "Club shop".

### `/admin/shop`

- Auditoría visual previa (capturas 390/768/1440 px) y corrección de espaciado y jerarquía.
- Orden: Orders → Products → editor (debajo de la tabla; dos columnas solo ≥64rem).
- Productos: columna "Visible in shop" (texto + franja), botones "Show in shop"/"Hide from shop",
  aviso con el número de productos ocultos.
- Pedidos: fila resumen (nº, cliente, centro, total, método, estado) + detalle desplegable (líneas,
  teléfono, nota, "View transfer screenshot", acciones de estado y pago). Filtros por estado y
  centro. Tablas sin scroll horizontal en tablet; filas apiladas en móvil; objetivos ≥44 px.
- Se elimina el texto "no online checkout exists".

## Reglas de diseño aplicables (DESIGN.md)

Radio 0; sin pills (estado = texto + franja izquierda); sin sombras con blur ni gradientes; morado
`#2F2483` único acento, lima solo en detalles; Barlow Condensed para títulos, Source Sans 3 cuerpo;
eyebrow en cada pantalla; importes en `tabular-nums`; inputs con etiqueta encima, ≥16 px;
skeletons en lugar de spinners; botones 3.15rem; grid con `minmax(0, …)`; `100dvh`;
`prefers-reduced-motion` respeta; inglés UK, voz de academia, sin clichés.

## Seguridad

- El servidor recalcula precios, nombres y totales; nunca confía en el cliente.
- Comprobante: tipo verificado por bytes, ≤2 MB, clave R2 ligada al uid del comprador, lectura solo
  por URL firmada de 60 s para owner/administrator.
- Errores al usuario como cadenas seguras; nada nuevo público; sin `dangerouslySetInnerHTML`.
- `localStorage` solo guarda ids y cantidades, nunca datos personales.

## Pruebas

- Dominio: schema v2 (totales, duplicados, regla de `proofId`), `isShopProductPurchasable`.
- Service: oculto/agotado/talla inválida rechazados, precios congelados, idempotencia, comprobante
  ausente rechazado.
- Callables: matriz de roles (todos compran; solo owner/admin administran y ven comprobantes),
  validación de archivo.
- Web: cesta (persistencia, reconciliación), checkout (validación, ruta sin sesión), admin.
- Cada guard nuevo: desactivarlo y confirmar que un test falla.
- Final: Playwright MCP contra emuladores (`demo-bpt-jersey`): visitante → cesta → registro →
  checkout con transferencia → owner ve pedido y comprobante → listo/pagado; capturas 390/768/1440.

## Entrega

Commits en `main` local. Push (publica la web) y deploy de functions (web y functions juntos, lotes
con 120 s) solo con confirmación explícita del operador. Publicar los 5 productos en producción:
desde el panel nuevo, o por script con confirmación.

## Fuera de alcance

Pasarela de tarjeta, facturas en finanzas, inventario numérico, envío a domicilio, emails de aviso.
