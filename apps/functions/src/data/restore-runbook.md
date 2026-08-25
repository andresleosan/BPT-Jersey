# Runbook de backup y restauración de tenant

Este runbook define el control operativo de T054. La implementación disponible en
el repositorio es una frontera fail-closed y un rehearsal aislado. No se ejecuta
ningún backup o restore de producción desde el código actual.

## Alcance del backup

El backup usa únicamente las colecciones declaradas en
`backup-contracts.ts`, siempre bajo `academies/{academyId}`. Cada operación genera:

- `backups/operations/{operationId}/manifest.json` con versión, tenant, fechas,
  conteos, checksum SHA-256, estado y referencia de rollback.
- `backups/academies/{academyId}/{operationId}/tenant-backup.json` con los
  documentos ordenados de forma determinista.
- `backups/academies/{academyId}/{operationId}/rollback-manifest.json` como
  destino reservado para la captura previa a un restore.

No se incluyen Firebase Auth, secretos de Functions, credenciales, tokens,
datos de tarjetas, archivos privados sin su metadata autorizada ni el nodo
RTDB de `presence`. El validador rechaza campos sensibles, IDs inválidos,
duplicados y documentos cuyo `academyId` cruce el tenant de la ruta.

La retención de siete días es un valor provisional para staging/rehearsal. La
retención productiva, cifrado, residencia, ACL y eliminación final requieren la
decisión operativa de T011 y el proveedor aprobado.

## Backup y verificación

1. Ejecutar el rehearsal únicamente con el proyecto Firebase `demo-bpt-jersey`
   y emuladores locales.
2. Generar una operación con `createTenantBackup`; conservar el `operationId`.
3. Ejecutar `verifyTenantBackup` y comprobar `verified: true`, conteos esperados
   y un checksum de 64 caracteres hexadecimales.
4. Si el checksum, el conteo o la versión no coinciden, marcar la operación como
   fallida y no continuar. No corregir el artifact manualmente.
5. Registrar solo operación, tenant, conteos, checksum y estado; nunca filas,
   nombres, tokens o credenciales.

El servicio productivo permanece no configurado deliberadamente. Los callables
requieren autenticación, rol `owner`/`administrator` y App Check, pero responden
`failed-precondition` hasta que exista una decisión explícita de almacenamiento
privado y exportación aprobada.

## Restore y rollback

Un restore destructivo requiere, inmediatamente antes de ejecutarlo:

1. `operationId` exacto de un backup reciente con verificación exitosa.
2. Confirmación humana explícita del operador responsable.
3. Token de confirmación exacto `RESTORE:{operationId}`.
4. Captura del estado actual en `rollbackManifestPath`.
5. Comparación de tenant, conteos y checksum antes de aplicar.
6. Aplicación en un namespace aislado, nunca desde un navegador ni con una ruta
   de colección suministrada por el cliente.

Si falla una escritura, detener la operación, conservar los artifacts y aplicar
el manifest de rollback al mismo namespace. El rehearsal automatizado de T054
ejercita precisamente `apply -> error -> rollback` y exige que el estado previo
quede idéntico. En producción, cualquier restore destructivo queda bloqueado
hasta disponer de ese mecanismo, un backup verificado y la confirmación del
operador; no se autoriza borrado manual desde la consola.

## Evidencia local

```text
corepack pnpm exec vitest run apps/functions/src/data/backup-service.test.ts apps/functions/src/data/backup-callables.test.ts
corepack pnpm test:rules
```

La prueba de rehearsal no contacta un proyecto Firebase real ni escribe en
producción.
