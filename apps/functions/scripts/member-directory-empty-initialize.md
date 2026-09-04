# Empty canonical member-directory initializer

Runner interno y exclusivo del Emulator para inicializar una academia realmente vacía. No es una
Firebase Function ni está exportado por `src/index.ts`. Por ahora sólo admite el proyecto literal
`demo-bpt-jersey` y exige ambos emuladores configurados por el preflight compartido.

Antes de importar `firebase-admin`, el runner exige tres secretos base64url canónicos, distintos y
de 32 a 64 bytes:

- `MEMBER_DIRECTORY_IDENTITY_KEY_SECRET` (`identity-v1`)
- `MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET` (`integrity-v1`)
- `MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET` (`baseline-encryption-v1`)

El baseline vacío se crea con `wx` y modo `0600` bajo la ruta fija del repo
`.tmp/member-directory-baselines/`. El archivo es un envelope AES-256-GCM con IV aleatorio y AAD
ligada a proyecto, academia, artifact ID, esquema y versiones. El contenido incluye dos dominios
HMAC separados bajo el secreto de integridad: uno para el baseline de identidad vacío y otro para
el artefacto. El secreto de identidad sólo genera key IDs y su versión queda ligada; ningún secreto
se serializa. Un reintento sólo continúa si puede reabrir, descifrar y verificar exactamente el
artefacto existente.

Después de compilar Functions, ejecutar localmente con las variables anteriores ya cargadas:

```powershell
node apps/functions/scripts/member-directory-empty-initialize.mjs --academy-id=<academy-id-validado> --confirmation=T093-EMPTY-CANONICAL-INITIALIZE
```

La transacción rechaza cualquier documento de datos, autoridad o evidencia T093 existente y sólo
entonces crea `memberDirectoryStates/current`, el restore guard y su evento `0`.

Cleanup manual recuperable: con el runner detenido, mover o renombrar
`.tmp/member-directory-baselines/` a una carpeta de cuarentena fechada fuera del árbol de trabajo.
No borrar los artefactos hasta revisar que ninguna inicialización o auditoría dependa de ellos.
