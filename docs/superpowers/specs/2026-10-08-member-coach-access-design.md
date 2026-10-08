# Acceso de coach para miembros adultos

Fecha: 2026-10-08. Estado: diseño aprobado en el chat; spec pendiente de revisión del operador.

## Objetivo

Cualquier miembro adulto puede ser también coach con **la misma cuenta**: el mismo correo y la
misma clave (o Google). En `/admin/staff` la oficina elige a un miembro existente y le da acceso
de coach sin crear otra cuenta ni fijar otra clave. La persona entra como coach por
`/staff/login` y como miembro por `/login`, según la página desde la que inicie sesión.

## Decisiones (trazables)

| # | Decisión | Quién | Dónde |
|---|----------|-------|-------|
| D1 | Cualquier miembro adulto puede tener también acceso de coach | Operador | Petición inicial |
| D2 | Se usan el nombre y el correo del miembro existente, no se crea otra cuenta | Operador | Petición inicial |
| D3 | Modo según la página: `/staff/login` → coach, `/login` → miembro; un modo a la vez | Operador | Pregunta «Modelo», opción recomendada |
| D4 | El miembro conserva su clave; el panel no pide ni fija clave: solo «elegir miembro y darle acceso» | Operador | Pregunta «Contraseña», respuesta libre |
| D5 | «Adulto» = cuentas con rol `adultStudent` o `guardian`; `teenStudent` queda fuera | Propuesta de Claude, aprobada con el diseño | Sección 1 del diseño |
| D6 | Puede darlo el owner o un administrator (igual que crear un coach hoy) | Propuesta, aprobada | Sección 1 |
| D7 | Cinturón obligatorio, como cualquier coach | Propuesta, aprobada | Sección 1 |
| D8 | Delete coach en cuenta doble solo quita el acceso de coach; la cuenta de login y el miembro quedan intactos | Propuesta, aprobada | Sección 4 |
| D9 | Deactivate coach en cuenta doble devuelve el rol de miembro (no deja la cuenta sin rol) | Propuesta, aprobada | Sección 4 |
| D10 | Change role a administrator/owner bloqueado en cuentas dobles | Propuesta, aprobada | Sección 4 |
| D11 | Delete account del miembro bloqueado mientras tenga acceso de coach («Remove coach access first») | Propuesta, aprobada | Sección 4 |
| D12 | Sin tests automáticos (regla del repo); verificación en emulador con cuenta sintética | AGENTS.md + aprobada | Sección 6 |

## Por qué hace falta cambiar el modo

Firebase Auth admite una sola cuenta por correo y la cuenta lleva **un** claim `role`. Todos los
permisos lo leen en `requireUserActor` (`apps/functions/src/auth/user-authorization.ts`), que
además rechaza cualquier claim desconocido. La ficha `academies/{a}/users/{uid}` tiene un único
`accountType` (`client` o `staff`) y el contrato de perfil de cliente es estricto. Por eso hoy
`createStaffWithPassword` falla con «the email is already in use».

Alternativas descartadas (D3): dos roles a la vez obligaba a reescribir ~50 controles de permisos
en functions y web; una cuenta de coach aparte no cumple D2.

## Modelo de datos

- `academies/{a}/users/{uid}`: **no cambia**. Sigue siendo `accountType: "client"` con todo lo
  del miembro (plan, reservas, waiver, alumnos).
- `academies/{a}/staff/{uid}`: ficha de coach normal (`role: "coach"`, `belt`, `active`), creada
  con `activateCoachProfile` como hoy.
- **Nuevo** `academies/{a}/coachMemberAccess/{uid}`:
  `{ userId, academyId, memberRole: "adultStudent" | "guardian", grantedAt, grantedBy, schemaVersion: "1" }`.
  Su existencia marca la cuenta como doble y guarda el rol al que se vuelve en modo miembro.
  Solo lo leen y escriben las functions (sin acceso de cliente en `firestore.rules`; las reglas
  actuales ya niegan por defecto).
- Claim `role`: `coach` en modo coach, `memberRole` en modo miembro. `academyId` no cambia.

## Componentes

### Dominio (`packages/domain/src/staff/team-access-contracts.ts`)
- Esquemas zod: `grantMemberCoachAccessInput { userId, belt }`, `switchAccessModeInput { mode: "coach" | "member" }`,
  y el de `coachMemberAccess`. Campo opcional `alsoMember: boolean` en la fila del Team directory.
- Regla compartida `memberRoleEligibleForCoach(role)` → `adultStudent | guardian`.

### Functions (`apps/functions/src/staff/`)
1. **`grantMemberCoachAccess`** (callable, `requireActiveOfficeActor`, owner o administrator):
   - La cuenta Auth existe, misma academia, no está deshabilitada, claim `role` en
     `adultStudent | guardian`, ficha `users` de cliente activa y aún sin `coachMemberAccess`.
   - En un batch: `coachMemberAccess/{uid}`, ficha de coach (`activateCoachProfile` con belt) y
     auditoría `staff.member_coach_access_granted`.
   - **No toca el claim**: la persona sigue en modo miembro hasta entrar por `/staff/login`.
2. **`listCoachEligibleMembers`** (callable, mismos permisos): busca por nombre/correo entre los
   miembros adultos activos sin acceso de coach. Devuelve solo `userId`, nombre y correo.
   Recorre `auth.listUsers` filtrando por claim, como `listTeamDirectoryHandler`, y filtra
   por texto en memoria: no necesita índice compuesto. Su límite son unos pocos miles de cuentas.
3. **`switchAccessMode`** (callable, usuario autenticado):
   - Exige `coachMemberAccess/{uid}`. En modo `coach` exige además una ficha de coach activa.
   - Fija `role` a `coach` o a `memberRole` conservando el resto de claims. Idempotente:
     si ya está en ese modo, no escribe nada.
   - Una cuenta sin acceso doble recibe `failed-precondition` y el login sigue su flujo actual.
4. **Ajustes a lo existente:**
   - Las comprobaciones de coach que exigen `accountType === "staff"` aceptan también
     `client` cuando existe `coachMemberAccess/{uid}` y la ficha de coach está activa:
     `staff-service.ts` (`assertUserIdentity`), `level-service.ts:738`,
     `level-authorization.ts` (`activeStaffUser`).
   - `listTeamDirectoryHandler` (`team-access.ts`) incluye las cuentas con
     `coachMemberAccess`, sea cual sea su modo, como `coach` con `alsoMember: true`.
   - Sincronizar claims del coach (`staff-callables.ts` ~L285, usado por
     `setStaffActive`/`updateStaffProfile`): en cuenta doble, activar **no** toca el claim (el
     modo lo decide el login); desactivar fija `role = memberRole` (D9).
   - `deleteCoachAccount`: en cuenta doble hace las mismas comprobaciones (clases futuras) y
     el mismo borrado de ficha, disponibilidad, asignaciones, web y foto. Además borra
     `coachMemberAccess` y fija `role = memberRole`. **No** marca `users` como inactivo ni
     borra la cuenta Auth (D8).
   - `changeTeamRole`: rechaza cuentas dobles (D10).
   - `deleteMemberAccount` (`member-delete-callables.ts`): rechaza si existe
     `coachMemberAccess` con «Remove coach access first» (D11).
   - Exportar las 3 callables nuevas en `src/index.ts` (región `europe-west9`).

### Web
- `apps/web/src/lib/team-access-client.ts`: clientes de las 3 callables con errores legibles.
- `/admin/staff`: botón «Give coach access to a member» junto al alta actual. Abre un panel
  con buscador de miembros, selector de cinturón y botón de confirmar. Reutiliza los controles
  y estilos del panel de alta. La fila del directorio muestra «Also a member».
- `/staff/login` y `/login` (`login-form.tsx`, `login-flow.ts`): tras iniciar sesión, si el rol
  del token no corresponde a la página, llaman a `switchAccessMode` con el modo de la página.
  Si responde bien, fuerzan `getIdToken(true)` y siguen el destino de siempre. Si responde
  `failed-precondition`, siguen el flujo actual sin cambios.

## Errores y casos límite

- Miembro adolescente, inactivo, staff ya existente o de otra academia → `failed-precondition`
  con mensaje claro; no se escribe nada.
- Dos oficinas dando acceso a la vez → `batch.create` de `coachMemberAccess` falla en la segunda.
- Otro dispositivo en el otro modo: pasa al modo nuevo al renovar el token (≤1 h); en el área
  equivocada verá la pantalla actual de «inicia sesión de nuevo». Límite aceptado (D3).
- `passwordChangeRequired` no se usa para cuentas dobles (D4).
- Alumno de 17 que cumple 18 (teen → adulto): podrá recibir acceso después de su promoción
  normal; no hay lógica nueva.

## Fuera de alcance

- Dos roles a la vez en la misma sesión.
- Cuentas dobles de administrator u owner.
- Login con Staff ID (`staffLoginCredentials`) para cuentas dobles: entran con correo/clave o Google.

## Verificación (D12)

Sin tests automáticos. En el emulador (`demo-bpt-jersey`), con un script Node y una cuenta
sintética `adultStudent`:

1. Dar acceso → aparece `coachMemberAccess` y ficha de coach; el claim sigue `adultStudent`.
2. `switchAccessMode coach` → claim `coach`; una callable de coach responde.
3. `switchAccessMode member` → claim `adultStudent`; una callable de miembro responde.
4. Deactivate → claim `adultStudent`.
5. Delete coach → la cuenta Auth y `users` siguen; `coachMemberAccess` y la ficha de coach desaparecen.
6. Delete account del miembro con acceso de coach → rechazado.

En producción, solo tras confirmación explícita: push a `main` (web) y después
`firebase deploy --only functions:<cambiadas>` en tandas.
