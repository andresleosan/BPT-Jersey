# T051V2 - Runbook de purga de contraseñas Regyfit almacenadas

Estado: **redactado el 2026-09-17 como entregable de la Tarea 8 del plan
`2026-09-17-member-profile-a-e0-security`**. Este documento describe cómo se cuenta y cómo se borra la
contraseña heredada de Regyfit que quedó guardada en Firestore; **no autoriza ninguna ejecución**.
Cada paso contra producción exige la confirmación explícita del operador en el chat (regla de
`CLAUDE.md`). Ningún agente ejecuta los pasos 3 a 6: los ejecuta el operador desde una máquina con
credenciales de producción.

## 1. Contexto: por qué existe esta purga

La captura original de Regyfit traía, por cada socio, las credenciales de su app: `appAccess.login` y
`appAccess.password`. Esa contraseña se importó tal cual a
`academies/<academyId>/regyfitMemberRecords` y quedó almacenada en claro. Es un dato que la academia
no necesita, que no debería existir en Firestore y que ninguna pantalla vuelve a mostrar.

El trabajo E0 de T051V2 ya cerró el problema **hacia adelante**, en este orden:

- `regyfitAppAccessSchema` (en `packages/domain`) ya no declara `password`.
- `parseStoredRegyfitMemberRecord` descarta la contraseña heredada **antes** del parseo estricto, de
  modo que los documentos antiguos se siguen leyendo pero el campo nunca sale del backend.
- El importador ya no escribe el campo.
- El panel de administración ya no dibuja la fila de contraseña.

Queda el resto **hacia atrás**: los documentos ya escritos siguen conteniendo la clave. Este runbook
la elimina. Como el camino de lectura ya la filtra, purgar es invisible para la aplicación.

## 2. Qué hace el script

Script: `qa/scripts/purge-regyfit-record-passwords.mjs`

- Recorre `academies/<academyId>/regyfitMemberRecords` y cuenta cuántos documentos conservan la clave.
- **Por defecto solo cuenta.** Es una lectura pura: sin `REGYFIT_PURGE_APPLY=yes` no escribe nada.
- Al aplicar, borra **únicamente** la clave `appAccess.password` con `FieldValue.delete()`, en lotes
  de 400 escrituras. No toca ningún otro campo ni borra documentos.
- Imprime una sola línea JSON:
  `{"target","projectId","academyId","scanned","withPassword","purged"}`.

Rechaza por diseño, y así está probado en `qa/unit/regyfit-password-purge.test.ts`:

| Guardia                                                             | Efecto                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `REGYFIT_PURGE_TARGET` ausente o distinto de `emulator`/`production` | Aborta                                                     |
| `target=emulator` sin `FIRESTORE_EMULATOR_HOST` en loopback          | Aborta                                                     |
| `target=production` con `FIRESTORE_EMULATOR_HOST` definido           | Aborta (evita mezclar entornos)                            |
| `target=production` sin `GCLOUD_PROJECT=bptjersey-f5a25`             | Aborta                                                     |
| Aplicar en producción sin el token de confirmación del operador      | Aborta; sin él el script **solo** puede contar             |

### Notas sobre el alcance del conteo

- **Una academia por ejecución.** El escaneo cubre el `REGYFIT_ACADEMY_ID` que se le pase y nada más.
  Si hubiera más de una academia con registros importados, hay que repetir el ciclo completo (contar,
  confirmar, aplicar, verificar) para cada `academyId`.
- **El conteo mira `appAccess.password` en concreto.** `withPassword` cuenta los documentos en los que
  existe esa clave, aunque su valor sea la cadena vacía. Una contraseña guardada en cualquier otro
  sitio del documento no la ve este script y requeriría su propia revisión.

## 3. Prerrequisitos

1. Tareas 1 a 7 de T051V2 fusionadas.
2. **Functions y web desplegados primero**, con el OK explícito del operador: `getRegyfitMemberRecord`,
   `listRegyfitMemberRecords` y `revealRegyfitRecordField`. Purgar antes del despliegue es inofensivo,
   pero es el esquema estricto nuevo el que deja los documentos antiguos legibles solo a través del
   filtrado; por eso **se despliega primero**.
3. El operador ejecuta desde la raíz del repositorio, en una máquina con Application Default
   Credentials de producción. Ningún agente crea, lee ni copia esas credenciales.
4. `<production academy id>` es el único dato que aporta el operador; no está en el repositorio.

## 4. Procedimiento

El orden es obligatorio: **desplegar → contar → OK del operador citando N → aplicar → verificar cero.**

### Paso 1 - Desplegar (prerrequisito 2)

Functions y web desplegados con el OK explícito del operador.

### Paso 2 - El operador confirma el conteo en el chat

Texto exacto: `OK dry run purge contraseñas Regyfit producción`.

### Paso 3 - Contar (dry run, solo lectura)

```bash
REGYFIT_ACADEMY_ID=<production academy id> REGYFIT_PURGE_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 node qa/scripts/purge-regyfit-record-passwords.mjs
```

Salida esperada: una línea JSON con `scanned` ≈ 249, `withPassword` = N y `purged` = 0. Anotar N en la
evidencia de T051V2; ese número responde además al conteo abierto de T125. Si `purged` no es 0, algo
va mal: detenerse y revisar, porque un dry run no escribe.

### Paso 4 - El operador confirma la aplicación en el chat, citando N

Texto exacto: `OK aplicar purge de N contraseñas`, con el N medido en el paso 3.

### Paso 5 - ⚠️ Aplicar (borrado irreversible)

```bash
REGYFIT_ACADEMY_ID=<production academy id> REGYFIT_PURGE_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 REGYFIT_PURGE_APPLY=yes REGYFIT_OPERATOR_CONFIRMATION=regyfit-password-purge-production-v1 node qa/scripts/purge-regyfit-record-passwords.mjs
```

Salida esperada: una línea JSON con `withPassword` = N y `purged` = N.

### Paso 6 - Si la aplicación se interrumpe

El script imprime el JSON **al final**, después del bucle de lotes. Si un `batch.commit()` falla a
mitad de camino, el operador ve un mensaje de error y **ninguna línea de conteo**, mientras que los
lotes ya confirmados quedan borrados de forma permanente. No es un estado corrupto, es un borrado
parcial.

Qué hacer: **volver a ejecutar el paso 3 para recontar y después repetir el paso 5.** El borrado del
campo es idempotente — borrar una clave que ya no existe no hace daño y los documentos ya limpios
dejan de contarse — así que repetir es seguro y el conteo converge a cero. Repetir tantas veces como
haga falta hasta que el paso 7 dé cero.

### Paso 7 - Verificar cero

Repetir exactamente el comando del paso 3.

Salida esperada: `withPassword` = 0 y `purged` = 0.

## 5. Criterio de "hecho"

La purga está completa cuando, para cada `academyId` tratado:

- el paso 7 devuelve `withPassword` = 0;
- N (el valor medido en el paso 3) queda anotado en la evidencia de T051V2 junto con la fecha y el
  `academyId`;
- la confirmación del operador de los pasos 2 y 4 queda registrada en el chat.

## 6. Irreversibilidad y retención

El borrado no se deshace: la contraseña no se puede recuperar desde Firestore una vez aplicado el paso
5. La captura original fuera del repositorio todavía las contiene; qué se hace con esa captura es una
decisión de retención separada del operador y no la resuelve este runbook.

## 7. Evidencia previa (emulador, datos sintéticos)

El camino de aplicación se probó únicamente contra el emulador local (proyecto `demo-bpt-jersey`, sin
red, dos documentos sintéticos), con el resultado esperado: dry run `purged` 0, aplicación `purged` 1,
reejecución `withPassword` 0. Las guardias están cubiertas por
`qa/unit/regyfit-password-purge.test.ts` (3 pruebas). Nada de esto tocó producción.
