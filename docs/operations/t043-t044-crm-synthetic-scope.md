# T043/T044 — Alcance CRM sintético (f)

Estado: implementacion local sintetica verificada para Emulator/in-memory. No conecta proveedores,
no importa leads reales y mantiene T043/T044 en revision.

## Objetivo

Definir un pipeline mínimo para prospectos y una línea de tiempo idempotente que
permita probar el CRM después del piloto T056. El diseño usa los contratos de
tenant y roles existentes y conserva los datos como `Confidential`.

## Pipeline sintético

| Campo              | Valores permitidos (f)                                                      | Regla                                                    |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `status`           | `new_enquiry`, `trial_booked`, `trial_attended`, `follow_up`, `won`, `lost` | Transiciones explícitas; cualquier otro valor se rechaza |
| `ownerId`          | `reception-f`, `admin-team-f`, `owner-f`                                    | Debe pertenecer al mismo `academyId`                     |
| `nextActionAt`     | Timestamp ISO futuro o actual                                               | Obligatorio excepto en `won`/`lost`                      |
| `source`           | `website-f`, `walk_in-f`, `referral-f`                                      | Enum cerrado sintético                                   |
| `consentState`     | `unknown`, `granted`, `withdrawn`                                           | `withdrawn` impide comunicaciones externas               |
| `contactReference` | `lead-morgan-f`, `lead-jamie-f`, `lead-riley-f`                             | Referencia opaca; no contiene email ni teléfono          |

### Transiciones

```text
new_enquiry -> trial_booked -> trial_attended -> follow_up -> won
                                                    \-> lost
new_enquiry -> lost
trial_booked -> lost
```

Cada cambio debe registrar `previousStatus`, `nextStatus`, `actorId`, `occurredAt`
y un `eventKey` determinista. No se permite borrar el historial de transición.

## Fixtures sintéticos (f)

| `leadId`        | `contactReference` | Estado inicial | Owner          | Próxima acción (f)           |
| --------------- | ------------------ | -------------- | -------------- | ---------------------------- |
| `lead-morgan-f` | `lead-morgan-f`    | `trial_booked` | `reception-f`  | Confirmar clase del jueves   |
| `lead-jamie-f`  | `lead-jamie-f`     | `new_enquiry`  | `admin-team-f` | Devolver llamada hoy         |
| `lead-riley-f`  | `lead-riley-f`     | `follow_up`    | `reception-f`  | Enviar opciones de membresía |

Estos nombres y acciones son ficticios y no deben mezclarse con miembros reales.

## T044 — Timeline idempotente

Eventos mínimos: `lead_created`, `status_changed`, `owner_assigned`,
`next_action_set`, `trial_booked`, `trial_attended`, `consent_withdrawn` y
`note_added`. La clave `eventKey` debe ser única por `academyId` y lead; repetir
el mismo evento no crea una segunda entrada. La vista debe ordenar por
`occurredAt DESC` y mostrar únicamente la proyección autorizada al staff.

## Autorización y privacidad

- `owner` y `administrator`: lectura/escritura dentro de su academia.
- `headCoach`: lectura de leads asignados a su `userId`; no puede ampliar el filtro.
- `coach`, guardian y adultStudent: sin acceso al CRM.
- No almacenar en fixtures email, teléfono, dirección, salud, pagos ni notas de
  safeguarding.
- Toda mutación crea un evento de timeline tenant-scoped; la integración con el audit log institucional queda fuera de este corte.

## Gates de implementacion y limites

1. Contratos/parsers, stores in-memory/Firestore y callables RBAC implementados.
2. Pruebas focalizadas 10/10, suite 157/1076, typecheck, Rules 64/64, build y verify:mvp pasan.
3. La UI usa fixtures sinteticos por defecto; `NEXT_PUBLIC_CRM_BACKEND=true` es opt-in.
4. T043/T044 permanecen en `revision`; no se autoriza produccion, migracion, live/staging real, comunicaciones externas ni datos reales.
