# ADR-019: acceso propio de los hijos desde los 12 años

Fecha: 2026-09-24. Estado: vigente.

## Contexto

Hasta ahora un alumno sólo podía entrar con su propia cuenta desde los 16 años
(`teenAccountMinimumAge = 16` en `packages/domain/src/members/member-access-contracts.ts`); por
debajo, todo lo hacía el tutor desde su cuenta. El 23-sep Luis decidió (D5 del plan
`docs/superpowers/plans/2026-09-23-member-features-parallel-sessions.md`) que los hijos de 12 a 17
años puedan tener acceso propio al área de miembros para ver su calendario, su racha y su progreso.
La cohorte teen de la academia empieza a los 12, y la franja `participantBandAt` también.

## Decisión

- La edad mínima de acceso propio baja a **12** (`teenAccountMinimumAge = 12`).
- El acceso propio de un menor lo **crea el tutor** desde Settings (email + contraseña de al menos 10
  caracteres, rol `teenStudent`) y el tutor lo puede **revocar** en cualquier momento (cuenta
  deshabilitada y tokens revocados).
- **Sin verificación de email**: la cuenta se crea con `emailVerified: true` porque la crea el tutor,
  que ya es un titular verificado; el menor no recibe correos de alta.
- Entre 12 y 17 el tutor mantiene el control: la foto, la visibilidad y los consentimientos siguen
  siendo del tutor (D10). El menor sólo puede **proponer** una foto, que el tutor aprueba.
- A los 18, **bloqueo único** (Q4): la primera entrada propia muestra «You're 18 — this account is
  now yours. Set a new password.» y, tras cambiarla, la cuenta pasa a ser del alumno
  (`needsAdultClaim`). Las credenciales no caducan por edad.

## Consecuencias

- Hay datos de menores de 12 a 15 años con credencial propia (email y hash de contraseña en Firebase
  Auth). Queda anotado en el inventario de la DPIA (`docs/operations/t011-dpia-draft.md` §2) con base
  legal el consentimiento del tutor.
- Salud y datos médicos siguen siendo **16+ para el acceso propio**: el perfil de salud, las
  solicitudes de cambio de salud y la descarga del waiver firmado exigen `ownHealthAccessMinimumAge`
  (16) cuando el actor entra como `self`; el acceso del tutor no cambia.
- `decideMemberAccess` concede `via: "self"` desde los 12; el acceso del tutor (`via: "guardian"`)
  sigue hasta los 18. Cualquier callable que permita a un miembro cambiar algo de sí mismo debe
  distinguir `self` < 18 de `self` adulto.
- Lo que ve un menor de otros miembros sigue limitado a su cohorte (kids, teens, adults) a través de
  `MemberPublicCard`.
