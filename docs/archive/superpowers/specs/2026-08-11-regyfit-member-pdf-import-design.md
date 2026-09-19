# Importación de miembros desde informes PDF de Regyfit

## Estado

Diseño aprobado por el operador el 2026-08-11. La inspección de formato se realizó
localmente sobre ocho PDFs ubicados fuera del repositorio. No se copiarán PDFs reales,
filas, nombres, teléfonos, emails, capturas ni texto extraído al repositorio, tests,
logs o artefactos de QA.

## Objetivo

Completar la importación de miembros desde los informes PDF que Regyfit produce para
BPT Jersey. El flujo debe reconocer el layout real, mostrar una previsualización segura
y exigir una confirmación administrativa antes de crear o actualizar miembros.

La primera versión soporta únicamente informes de miembros exportados por Regyfit. No
acepta PDFs arbitrarios ni incorpora OCR o mapeo manual de columnas.

## Formato observado

Los informes son PDFs con texto seleccionable y varias páginas. Cada página repite:

- Título del informe con contador, por ejemplo `TOTAL DE ATLETAS NA BASE DE DADOS (N)`.
- Encabezado de tabla: `Member Nº`, `Name`, `ID Card Nº`, `Birthdate`, `VAT Number`,
  `Mobile nº`.
- Filas con campos opcionales y espacios vacíos.
- Footer `Document produced by www.regyfit.com on DD-MM-YYYY at HH:MM Page X/Y`.

El informe `Inactive` agrega `Data inativo`. Las filas pueden continuar en páginas
siguientes sin repetir el número de miembro. Algunos informes tienen títulos en inglés,
otros en portugués, y los teléfonos pueden contener entidades HTML o caracteres de
control visibles.

## Informes soportados

Se reconocen ocho layouts por título normalizado:

- Total.
- Active.
- With member number (`COM NÚMERO DE SÓCIO`).
- Without member number (`No number`).
- Inactive.
- Regularized.
- Active regularized.
- Suspended.

El parser rechaza títulos desconocidos, encabezados ausentes, columnas incompatibles,
filas imposibles o footers que no correspondan al formato esperado. Los contadores del
título se validan contra las filas reconocidas, pero nunca se usan para fabricar filas.

## Modelo de fila

El parser extrae únicamente estos campos:

- `membershipNumber`, cuando la columna contiene un valor.
- `fullName`.
- `idCardNumber`, cuando contiene un valor.
- `birthDate`, normalizado desde `DD Mon YYYY` a fecha ISO `YYYY-MM-DD`.
- `vatNumber`, cuando contiene un valor.
- `mobileNumber`, después de decodificar entidades HTML y limpiar caracteres de control.
- `inactiveAt`, solo desde el informe `Inactive`, normalizado a fecha ISO.

No se extraen contraseñas, tokens, IPs, claims, cookies, metadata de autenticación ni
contenido fuera de las columnas aprobadas.

El estado derivado del título se conserva como metadata de importación:

- `Inactive` produce `membershipStatus = inactive` y usa `inactiveAt` si está presente.
- `Suspended` produce `membershipStatus = suspended`.
- Los demás informes de miembros producen `membershipStatus = active`.
- `Regularized` produce `paymentStatus = regularized`.
- `Active regularized` produce ambos estados.
- Un informe sin señal de pago no sobrescribe el estado de pago existente; para una alta
  nueva se usa `unknown`.

## Conciliación y cambios

La conciliación usa esta prioridad:

1. `membershipNumber` exacto y normalizado.
2. `email` únicamente si un futuro layout aprobado lo proporciona.
3. Sin identificador: alta nueva con `memberId` generado server-side; `membershipNumber`
   y `email` pueden quedar vacíos.

La misma persona repetida en varios informes se deduplica antes de clasificar cambios.
Si un identificador apunta a varios miembros, una fila aparece en `conflicts` y bloquea
la confirmación. Si el mismo identificador aparece con valores contradictorios, también
es conflicto. Los campos vacíos nunca borran valores existentes.

Las coincidencias se clasifican como `updates` y solo aplican campos permitidos no vacíos.
Las filas sin identificadores no se bloquean por ese motivo y se clasifican como
`additions` siempre que su nombre sea válido.

## Flujo backend

### Creación de sesión

`createMemberPdfImportSession` valida un máximo de cinco PDFs, tipo `application/pdf`,
nombre seguro y máximo de 10 MiB por archivo. Persiste primero una sesión temporal
server-side con `academyId`, object keys, expiración y journal de cleanup. Después emite
URLs `PUT` privadas de R2 con expiración corta.

### Previsualización

`previewMemberPdfImport` exige actor administrativo, sesión vigente y mismo tenant.
Lee únicamente los objetos temporales desde R2, extrae texto server-side con `pdf-parse`,
identifica el layout, normaliza filas, deduplica y consulta la proyección canónica para
clasificar `additions`, `updates`, `duplicates` y `conflicts`.

No escribe miembros. Persiste solo un preview server-side con:

- `previewId` opaco.
- `academyId` y actor autorizado.
- expiración corta.
- hash de archivos y layouts detectados.
- conteos y cambios clasificados sin PDF ni texto crudo.

### Confirmación

`confirmMemberPdfImport` exige `previewId`, `sessionId` y `confirm: true`, valida actor,
tenant y expiración, y rechaza cualquier preview con conflictos. La confirmación ejecuta
creaciones y actualizaciones en transacciones o batches acotados, conserva campos
existentes cuando la entrada esté vacía, genera IDs y timestamps server-side, y escribe
auditoría del actor y del resumen de cambios.

Si falla una validación o una escritura, la operación no se presenta como confirmada.
El endpoint no acepta valores de autoridad como `academyId`, estado, timestamps o actor.

### Cleanup

La expiración elimina PDFs temporales, previews y sesiones mediante el journal existente,
con leases, backoff acotado y compensación. No se conserva el texto extraído ni se
generan URLs públicas.

## Flujo web

La ruta `/admin/members/import` permite seleccionar hasta cinco PDFs, muestra validación
por archivo y estados de carga. Después presenta:

- Archivos y layouts reconocidos.
- Filas nuevas.
- Actualizaciones.
- Duplicados deduplicados.
- Conflictos y motivo.
- Estado de expiración del preview.

`Confirm import` queda deshabilitado mientras haya conflictos, errores, cargas activas,
preview expirada o ausencia de preview. La interfaz está en inglés, es responsive,
accesible por teclado y no muestra más datos de los necesarios para revisar el cambio.

## Errores y seguridad

- Usuario no autenticado o no administrativo: `permission-denied`.
- Sesión/preview de otro tenant: `permission-denied`.
- PDF inválido o layout no soportado: `invalid-argument` con mensaje genérico.
- Preview expirada o con conflictos: `failed-precondition`.
- Límite de archivos, tamaño o filas: `resource-exhausted`.
- Fallos internos: `internal` sanitizado; nunca se exponen detalles del parser o R2.
- No se registran filas, PII, bytes, texto crudo ni URLs firmadas en logs.

## Testing

Los tests usan texto sintético con la misma estructura observada, nunca los PDFs reales.
Cubren:

- Ocho títulos y variantes de idioma.
- Paginación por footer y filas sin número.
- Campos opcionales vacíos.
- Fechas válidas, imposibles y entidades HTML.
- Deduplicación entre informes.
- Matching por número, fallback email y alta sin identificadores.
- Actualizaciones que no sobrescriben con vacío.
- Conflictos que bloquean confirmación.
- Ausencia de escrituras antes de confirmar.
- Autorización, tenant scope, expiración, límites y cleanup.
- UI responsive, estados de error y confirmación explícita.

No se desplegará ni se aplicará migración real como parte de esta tarea.
