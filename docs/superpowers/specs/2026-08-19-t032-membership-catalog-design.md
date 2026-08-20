# T032 Catálogo y reglas base de membresías

## Objetivo

Implementar el catálogo persistente de planes aprobado para el piloto y una
función pura de elegibilidad que pueda ser reutilizada por reservas,
membresías y finanzas posteriores. T032 define productos y acceso base; no
crea membresías activas, pagos ni deuda.

## Alcance aprobado

- Persistir los diez planes de `BRIEF.md` bajo la academia.
- Representar precio en peniques enteros y moneda `GBP`.
- Representar sedes, tipos de participante, límites semanales y acceso a Open
  Mat sin reglas implícitas.
- Exponer lectura autenticada del catálogo activo.
- Permitir a `owner`/`administrator` activar, desactivar o corregir planes por
  comandos backend.
- Evaluar elegibilidad sin crear una membresía ni consultar pagos.
- Probar aislamiento por tenant, roles, reglas y valores monetarios.

## Fuera de alcance

- Membresías asignadas a personas o familias.
- Estados `trial`, `active`, `paused`, `overdue` o `cancelled` de una membresía;
  pertenecen a T033.
- Facturas, recibos, balances, refunds, deuda PAYG o pagos manuales; pertenecen
  a T037.
- Hosted checkout, suscripciones, webhooks o proveedor de pagos; pertenecen a
  T034-T036 y no forman parte del piloto manual.
- Descuentos, congelaciones, prorrateos, promociones, horarios concretos o
  capacidades de clases.
- UI de compra o una pantalla general de membresías.
- Hard delete, migración de datos existentes o despliegue productivo.

## Modelo de datos

### Colección `plans`

Ruta canónica:

```text
academies/{academyId}/plans/{planId}
```

Cada plan tiene un ID estable del catálogo y puede desactivarse, pero nunca se
elimina físicamente durante el piloto.

Campos exactos:

| Campo                      | Tipo y restricciones                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `planId`                   | Enum cerrado del catálogo. Igual al ID del documento.                                  |
| `academyId`                | Tenant derivado por backend.                                                           |
| `displayName`              | Nombre visible en inglés, fijado por el catálogo aprobado.                             |
| `priceMinor`               | Entero no negativo en peniques; nunca decimal ni string monetario.                     |
| `currency`                 | Literal `GBP`.                                                                         |
| `billingPeriod`            | `per-session` o `monthly`.                                                             |
| `eligibleParticipantTypes` | Lista no vacía, ordenada y sin duplicados de `adult`, `kids`, `teens`.                 |
| `classSites`               | Lista no vacía, ordenada y sin duplicados de `Town`, `West`.                           |
| `weeklyClassLimit`         | `1`, `2` o `null`; `null` significa ilimitado.                                         |
| `openMatSites`             | Lista ordenada y sin duplicados de `Town` y/o `West`.                                  |
| `openMatFeeMinor`          | Entero no negativo, `null` cuando no hay tarifa separada o la sesión usa `priceMinor`. |
| `active`                   | Booleano server-controlled.                                                            |
| `schemaVersion`            | Literal `1`.                                                                           |
| `createdAt`, `createdBy`   | Envelope server-owned.                                                                 |
| `updatedAt`, `updatedBy`   | Envelope server-owned.                                                                 |

Los arrays se normalizan a orden canónico y rechazan duplicados. Los campos
extra, símbolos propios, propiedades no enumerables, prototipos ajenos, IDs
desconocidos, moneda distinta y precios decimales se rechazan.

## Catálogo cerrado

Estos son los únicos planes válidos para T032:

| `planId`           | Nombre           | Precio | Periodo       | Participantes            | Clases     | Límite | Open Mat                        |
| ------------------ | ---------------- | -----: | ------------- | ------------------------ | ---------- | -----: | ------------------------------- |
| `payg`             | Pay as you go    |   1000 | `per-session` | `adult`, `kids`, `teens` | Town, West | `null` | Town, West; usa `priceMinor`    |
| `bpt-jersey-adult` | BPT Jersey Adult |  12500 | `monthly`     | `adult`                  | Town, West | `null` | Town, West; sin tarifa separada |
| `west-kids-1x`     | West Kids 1x     |   9500 | `monthly`     | `kids`                   | West       |    `1` | West; sin tarifa separada       |
| `west-kids-2x`     | West Kids 2x     |  11500 | `monthly`     | `kids`                   | West       |    `2` | Town; sin tarifa separada       |
| `west-adult`       | West Adult       |   6500 | `monthly`     | `adult`                  | West       | `null` | West, Town; sin tarifa separada |
| `west-teens`       | West Teens       |   4500 | `monthly`     | `teens`                  | West       |    `2` | West; 750 por sesión            |
| `town-adult`       | Town Adult       |   8500 | `monthly`     | `adult`                  | Town       | `null` | Town; sin tarifa separada       |
| `town-kids-1x`     | Town Kids 1x     |   9500 | `monthly`     | `kids`                   | Town       |    `1` | Town; sin tarifa separada       |
| `town-kids-2x`     | Town Kids 2x     |  13500 | `monthly`     | `kids`                   | Town       |    `2` | Town; sin tarifa separada       |
| `town-teens`       | Town Teens       |   4500 | `monthly`     | `teens`                  | Town       |    `2` | Town; 750 por sesión            |

`Pay as you go` usa `priceMinor` como precio de cada sesión, incluida una
sesión Open Mat. La regla de deuda y el bloqueo de una nueva reserva no se
implementan en T032.

## Autorización y proyecciones

Firestore permanece `deny-by-default`; no hay lectura directa desde navegador.
Las Functions derivan `academyId`, actor y envelope de servidor.

| Actor                               | Lectura de planes activos  | Comandos de catálogo           |
| ----------------------------------- | -------------------------- | ------------------------------ |
| `owner`                             | Sí, dentro de su tenant    | Activar, desactivar y corregir |
| `administrator`                     | Sí, dentro de su tenant    | Activar, desactivar y corregir |
| `guardian`                          | Sí, solo proyección activa | No                             |
| `adultStudent`                      | Sí, solo proyección activa | No                             |
| `headCoach`, `coach`                | Sí, solo proyección activa | No                             |
| Anónimo, tenant ajeno u otros roles | Denegado                   | Denegado                       |

Las proyecciones de lectura no incluyen actores, timestamps internos ni campos
de control. Los comandos administrativos no pueden cambiar `planId`,
`academyId`, `createdAt`, `createdBy` ni `schemaVersion`.

## Reglas de elegibilidad

`evaluatePlanAccess(plan, input)` es una función pura y no hace I/O. Recibe el
plan y un contexto estructurado con tipo de participante, sede y tipo de sesión.

- El participante debe pertenecer a `eligibleParticipantTypes`.
- Una clase debe usar una sede incluida en `classSites`.
- `weeklyClassLimit` `1` o `2` limita la elegibilidad semanal; `null` no limita.
- Open Mat requiere que la sede esté en `openMatSites`.
- `openMatFeeMinor` indica la tarifa separada; `null` significa que se usa el
  precio base por sesión o que no hay tarifa separada.
- Un plan inactivo nunca es elegible.
- La función devuelve una decisión estructurada con `allowed` y un código de
  rechazo estable; no calcula deuda, cobros ni estado de membresía.

## API backend

Los handlers se separan del wiring Firebase para pruebas unitarias.

- `listPlans`: devuelve planes activos ordenados en el orden del catálogo.
- `getPlan`: devuelve un plan activo por ID seguro.
- `savePlan`: solo `owner`/`administrator`; acepta campos editables mediante
  allowlist exacta y conserva el ID/envelope inmutables.
- `activatePlan`: solo `owner`/`administrator`; marca `active: true` sin reescribir
  el envelope.
- `deactivatePlan`: solo `owner`/`administrator`; marca `active: false`.
- `evaluatePlanAccess`: ejecuta la regla pura sin crear documentos.

Los errores públicos son genéricos y no revelan documentos de otros tenants.
Payloads vacíos, campos de autoridad, IDs desconocidos y precios inválidos se
rechazan antes de acceder a Firestore.

## Seed y persistencia

El catálogo constante del dominio es la fuente de verdad de los diez planes.
Un seed idempotente compara por `planId`, crea ausentes y actualiza únicamente
los campos aprobados sin tocar el envelope histórico. Se ejecuta en tests,
Emulator o staging aislado; no se autoriza ejecutarlo en producción en T032.

No se agregan índices compuestos. Las lecturas del catálogo usan la colección
tenant-scoped y filtros simples. El rollback del seed consiste en desactivar o
retirar los documentos en Emulator/staging; no se hace hard delete ni se
modifican datos de producción.

## Pruebas

- Dominio: catálogo exacto, precios en peniques, moneda, periodos, enums,
  arrays canónicos, duplicados, campos extra, prototipos y símbolos.
- Elegibilidad: cada plan, tipo de participante, Town/West, límites 1x/2x,
  ilimitado, Open Mat, tarifa de 750 y plan inactivo.
- Store: tenant, seed repetido, preservación de envelope, desactivación y
  actualización administrativa.
- Callables: Auth, owner/admin, lectura de roles, payloads hostiles y errores
  públicos.
- Emulator/Rules: lectura y escritura directa denegadas para los roles; ningún
  plan de otra academia es observable.
- Regresión: confirmar que T032 no crea membresías, pagos, facturas ni deuda.
- Gates: suite completa, Rules, lint, typecheck, build, formato, diff y audit
  high/critical, además de autocrítica de seguridad.

## Seguridad y límites operativos

- No se almacenan datos de tarjeta, secretos, tokens, proveedores ni PII en los
  planes.
- Los precios son datos del catálogo, no autorización de cobro.
- El frontend no puede convertir un plan en membresía ni enviar actor, tenant o
  precio efectivo como autoridad.
- No hay migración destructiva, despliegue ni gasto nuevo en APIs de pago.
- T033 y T037 deben consumir este contrato sin duplicar precios ni reglas.
