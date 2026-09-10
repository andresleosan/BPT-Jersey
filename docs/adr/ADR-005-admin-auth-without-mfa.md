# ADR-005: Acceso administrativo sin MFA en el rediseño inicial

Fecha: 2026-08-11
Estado: aceptada

## Contexto

El panel administrativo anterior exigia MFA TOTP para cuentas administrativas.
El operador priorizo un rediseño mas simple y eficiente, con login normal y una
capacidad separada para aprobar solicitudes de otros administradores. La decision
afecta Auth, Functions, Rules, QA y el flujo de recuperacion.

## Decision

La primera version del rediseño no usara MFA. El acceso se autorizara mediante
Firebase Auth, claims administrativos, `academyId` y validaciones server-side.
Los administradores aprobados tendran acceso operativo al panel, pero solo `owner`
podra conceder o revocar accesos administrativos. `owner` es un rol tecnico de
provisioning, no una etiqueta adicional para limitar la operacion diaria.

## Alternativas consideradas

- MFA TOTP obligatorio: se descarta por complejidad y friccion en la primera version.
- MFA opcional por cuenta: se reserva para una decision posterior y no se mezcla con
  el contrato inicial.
- Login sin autorizacion backend: se descarta porque permitiria que el navegador
  concediera acceso administrativo.

## Consecuencias

- Se reduce la friccion de acceso y el numero de estados de UI.
- Una cuenta administrativa comprometida no tiene una segunda barrera.
- La autoridad de provisioning queda concentrada en `owner`; el panel operativo
  sigue disponible para administradores aprobados.
- Claims, tenant scope, auditoria, rate limiting y recuperacion de cuenta son las
  mitigaciones obligatorias.
- Reactivar MFA requiere revisar este ADR, el contrato de Auth, las Functions, las
  pruebas E2E y el runbook de recuperacion.
