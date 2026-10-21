# T097: eliminar las lecturas legacy de `members` (runbook del operador)

Luis: esta guía ejecuta T097 según [ADR-009, Enmienda 2026-10-21](../adr/ADR-009-students-canonical-member-directory.md).
Pone `globalLegacyReadEliminated=true` y `rollbackProtocolVersion=disabled` en una sola transacción, y
así el directorio deja de rechazar altas por capacidad (400/400). Son 15 pasos: preparación (1-6),
dry-run (7), confirmación en el chat (8), seguros previos (9-10), aplicación (11-12) y verificación
(13-15).

Requisitos: terminal SSH del VPS como `root`, el commit que contiene el CLI
`apps/functions/scripts/eliminate-legacy-member-reads.mjs` en `/root/BPT-Jersey`, Application Default
Credentials del proyecto con permiso para leer el secreto `MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET`
y para exportar Firestore. Ningún paso de esta guía se ha ejecutado todavía. No pegues el secreto, el
token ni datos de alumnos en el chat.

## Qué cambia y qué NO

- **No se borra nada.** T097 no borra alumnos, progreso, cinturones, asistencia, membresías, pagos ni
  ningún otro documento. Su transacción escribe solo cuatro documentos de control del directorio: el
  estado (`memberDirectoryStates/current`), la cabecera del guard, un evento nuevo del guard y un evento
  de auditoría nuevo.
- El contador se queda en 400 como histórico y deja de ser un límite.
- ⚠️ El paso 11 es una escritura de producción **irreversible**: el marcador nunca vuelve a false. Solo
  se ejecuta después de la confirmación del operador en el chat, justo antes, a una hora tranquila.
- ⚠️ Después de T097, **nunca restaures la base entera a un momento anterior a T097**: volvería el tope
  de 400 y se perderían las altas nuevas. La copia del paso 10 sirve para recuperar datos concretos,
  no para deshacer T097.

## Preparación

Usa la misma terminal durante toda la guía: las variables duran esa sesión.

### 1. Sitúate en el repositorio

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
cd /root/BPT-Jersey && git log --oneline -1
```

Qué hace: entra en el repositorio y muestra el commit actual. Salida esperada: el commit que contiene
T097 (te lo diré en el chat). Si es otro, detente.

### 2. Construye el artefacto de funciones

⚠️ Reescribe `.firebase-functions/`. No lo hagas mientras haya un `firebase deploy` en curso.

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
node apps/functions/scripts/build-deploy-artifact.mjs
```

Qué hace: compila el dominio y las funciones y prepara `.firebase-functions/`, desde donde se lanzan
los CLI de operador. Salida esperada: termina sin error y vuelve el prompt. Si muestra `error TS`,
detente y pásamelo.

### 3. Entra en el artefacto

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
cd /root/BPT-Jersey/.firebase-functions && ls scripts/eliminate-legacy-member-reads.mjs
```

Qué hace: el CLI carga `../lib/src/...` compilado; desde `apps/functions` fallaría. Salida esperada:
la ruta del script.

### 4. Fija el destino de producción

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
unset FIRESTORE_EMULATOR_HOST && export GCLOUD_PROJECT=bptjersey-f5a25 T097_ACADEMY_ID=demo-academy
```

Qué hace: quita el emulador (el CLI rechaza producción si la variable existe) y fija proyecto y
academia. `demo-academy` es el id real de la academia en producción (así se llama desde el principio).
Salida esperada: ninguna.

### 5. Prepara el acceso de `gcloud` con tus credenciales (ADC)

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
export CLOUDSDK_AUTH_ACCESS_TOKEN_FILE="$(mktemp)" && chmod 600 "$CLOUDSDK_AUTH_ACCESS_TOKEN_FILE" && /root/google-cloud-sdk/bin/gcloud auth application-default print-access-token > "$CLOUDSDK_AUTH_ACCESS_TOKEN_FILE" && echo TOKEN-OK
```

Qué hace: `gcloud` no tiene cuenta activa en el VPS, así que le presta el token de tus Application
Default Credentials en un fichero privado, sin mostrarlo. Salida esperada: `TOKEN-OK`. Si falla:
`/root/google-cloud-sdk/bin/gcloud auth application-default login`, después
`/root/google-cloud-sdk/bin/gcloud auth application-default set-quota-project bptjersey-f5a25`, y repite
el paso. El token dura una hora: si más adelante un comando de `gcloud` dice que ha caducado, repite
este paso.

### 6. Carga el secreto de integridad sin mostrarlo

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
S="$(/root/google-cloud-sdk/bin/gcloud secrets versions access latest --secret=MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET --project=bptjersey-f5a25; printf x)" && export MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET="${S%x}" && unset S && test -n "$MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET" && echo SECRET-OK
```

Qué hace: lee la versión vigente del secreto de Secret Manager a una variable de esta sesión, sin eco
y byte a byte (el `printf x` evita que se pierda un salto de línea final), igual que lo reciben las
funciones con `defineSecret(...).value()`. Salida esperada: `SECRET-OK`. Si sale un error de `gcloud`
y no `SECRET-OK`, detente y pásame solo el mensaje de error.

## Dry-run

### 7. Ejecuta el dry-run (no escribe nada)

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
node scripts/eliminate-legacy-member-reads.mjs --project=bptjersey-f5a25 --target=production --academy-id="$T097_ACADEMY_ID"
```

Qué hace: cuenta los historiales anidados legacy (solo rutas), lee estado, cabecera del guard, último
evento y `members` (límite 1), verifica la cadena con MAC y muestra el plan. No escribe nada. Salida
esperada (JSON): `"mode": "dry-run"`, `"status": "ready"`, `"globalLegacyReadEliminated": false`,
`"legacyMemberDocuments": 0`, los tres conteos de `nestedLegacyHistory` a 0,
`"unmetPreconditions": []`, `nextState` con `stateRevision` = actual + 1, marcador `true`, protocolo
`disabled`, contador y límite 400, y `expectedConfirmation` con la forma
`ELIMINATE LEGACY MEMBER READS demo-academy r<revisión> e<evento> <16 hex>`.

Si ves `"status": "blocked"`, un conteo distinto de 0 o `The member directory control plane could not
be verified`, detente: no se aplica. Pásame el mensaje. Un aviso `MetadataLookupWarning` antes del
JSON es inofensivo (la librería busca un servidor de metadatos de Google que el VPS no tiene).

## Confirmación

### 8. Confirmación del operador en el chat

Pega en el chat la salida del paso 7 (no contiene secretos ni datos de alumnos). Espera mi revisión y
tu confirmación explícita. Una edición de perfil entre el dry-run y la aplicación cambia la revisión:
entonces repite el paso 7.

## Seguros previos

### 9. Comprueba PITR y anota la hora

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
/root/google-cloud-sdk/bin/gcloud firestore databases describe --database='(default)' --project=bptjersey-f5a25 --format='value(pointInTimeRecoveryEnablement,earliestVersionTime)' && date -u +%Y-%m-%dT%H:%M:%SZ
```

Qué hace: muestra si la copia continua (PITR, 7 días) está activa y la hora UTC de ahora. Salida
esperada: `POINT_IN_TIME_RECOVERY_ENABLED` con una fecha, y en la línea siguiente la hora actual.
Anota la hora. Si PITR no está activo, detente.

### 10. Haz una copia completa de Firestore

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
/root/google-cloud-sdk/bin/gcloud firestore export "gs://bptjersey-f5a25-backups/pre-t097-$(date -u +%Y%m%d-%H%M)" --project=bptjersey-f5a25
```

Qué hace: exporta toda la base (alumnos, progreso, pagos…) al bucket de copias, como seguro adicional
antes de tocar nada. No modifica la base. Salida esperada: termina con `done.` y un `outputUriPrefix`
que empieza por `gs://bptjersey-f5a25-backups/pre-t097-`. Si muestra `PROCESSING` después de `done.`,
copia el `name:` de la operación que imprime y ejecuta
`/root/google-cloud-sdk/bin/gcloud firestore operations describe <NAME> --project=bptjersey-f5a25`
(cambia `<NAME>` por ese valor) hasta que diga `SUCCESSFUL`. Si falla, detente.

## Aplicación

### 11. Aplica T097

⚠️ Escritura de producción irreversible. Solo tras la confirmación del paso 8 y con los pasos 9 y 10 bien.

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
node scripts/eliminate-legacy-member-reads.mjs --project=bptjersey-f5a25 --target=production --academy-id="$T097_ACADEMY_ID" --apply --actor-id=<ACTOR_ID> --production-confirmation=T097-GLOBAL-LEGACY-ELIMINATE-PRODUCTION-APPLY --confirmation="<CONFIRMACION>"
```

Qué hace: en una sola transacción relee y revalida todo, planifica y escribe estado, cabecera del
guard, evento del guard y auditoría; nada más. Cambia `<ACTOR_ID>` por tu UID de Firebase (te lo daré
en el chat junto con la confirmación; queda en la auditoría como autor) y `<CONFIRMACION>` por
`expectedConfirmation` del paso 7, exacta, entre comillas. Salida esperada: `"mode": "apply"`,
`"status": "eliminated"`, `stateRevision` = revisión del paso 7 + 1 y `eventId` igual. Si responde
`already-eliminated`, ya estaba hecho y no escribió nada.

### 12. Ante un resultado incierto

Si hay error, timeout o no ves respuesta, repite solo el paso 7 y actúa según lo que muestre:

- `"status": "already-eliminated"`: se confirmó; pasa a verificar.
- Marcador `false` y la misma revisión: no se escribió nada; repite el paso 11 igual.
- Marcador `false` y revisión cambiada: usa la confirmación nueva tras el paso 8.

Un mensaje «The confirmation does not match the directory as read now; rerun the dry run.» significa
lo mismo que el último caso. Nunca abras otro camino.

## Verificación

### 13. Repite el dry-run

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
node scripts/eliminate-legacy-member-reads.mjs --project=bptjersey-f5a25 --target=production --academy-id="$T097_ACADEMY_ID"
```

Salida esperada: `"status": "already-eliminated"`, `"globalLegacyReadEliminated": true`,
`"rollbackProtocolVersion": "disabled"`, `"rollbackEligibleStudentCount": 400`,
`"rollbackCapacityLimit": 400`, `stateRevision` = la del paso 11 y, si nadie escribió después,
`"lastEventTransitionKind": "global-legacy-eliminate"`. El dry-run verifica la cadena con MAC.

### 14. Cierra la sesión del secreto y del token

📍 Terminal del VPS · root · `/root/BPT-Jersey/.firebase-functions`.

```bash
rm -f "$CLOUDSDK_AUTH_ACCESS_TOKEN_FILE" && unset CLOUDSDK_AUTH_ACCESS_TOKEN_FILE MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET T097_ACADEMY_ID && cd /root/BPT-Jersey && echo CLEAN-OK
```

Qué hace: borra el fichero temporal del token y quita el secreto de la sesión. Salida esperada:
`CLEAN-OK`.

### 15. Comprobación final

Avísame en el chat: compruebo en solo lectura el estado, la auditoría
(`academies/demo-academy/auditEvents/t097-global-legacy-elimination-<REVISION>`) y que el número de
alumnos y su progreso siguen iguales que antes de aplicar. Después, solo con tu autorización, la
oficina reaprueba una solicitud aparcada real para confirmar que el alta ya no se rechaza.
