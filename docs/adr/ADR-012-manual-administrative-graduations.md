# ADR-012: graduación manual por decisión administrativa

Fecha: 2026-09-20. Decisión solicitada por el operador; función publicada con aprobación explícita, web pendiente.

Administrator y owner pueden graduar sin cumplir los requisitos deportivos del catálogo. En la
ficha, Manage → Assign next level → Review promotion permite confirmar con nota opcional aunque
falten clases, tiempo, habilidades o edad, o se salten niveles. Los requisitos siguen informando
y se conservan en el historial junto con el rol y usuario decisor. No se inventa una justificación.

El servidor recibe el rol de la autorización actual; el cliente no envía un permiso de excepción.
El cambio está en `assignLevel`, compartido por los almacenes Firestore y en memoria. No cambia
la autenticación, App Check, aislamiento entre academias, control transaccional del actor, estado
activo del alumno, referencias del nivel actual, fechas válidas ni protección contra duplicados.

Coach no adquiere permisos de graduación. Las cuentas históricas headCoach conservan el requisito
de nota cuando faltan criterios, hasta su conversión explícita a administrator (ADR-011). Si se
aporta una nota, se sigue validando su contenido. La anulación conserva su motivo obligatorio.

Esta decisión sustituye la exigencia de nota para owner/administrator de T051V2 G7. Publicar este
cambio requiere desplegar únicamente `assignLevel` y después la web, con aprobación explícita
para esta entrega. La autorización del lote anterior no se extiende a esta publicación.

## Validación local

4.320 pruebas en 402 archivos, TypeScript, lint, formato y compilación de contratos correctos.
Diez pruebas de navegador con datos sintéticos en móvil/escritorio verifican confirmación sin
nota, requisitos visibles, Escape/foco, bloqueo durante el guardado, errores y límites por rol.
La prueba de restricción de headCoach falla en ambos almacenes al retirar deliberadamente ese
control; el código original se restauró antes de la suite final. Capturas y registros en
`.tmp/manual-graduation-*`. La prueba antigua de integración se actualizó a esta política; no
se ejecutó su flujo optativo con emuladores en esta entrega. No se modificaron cuentas ni
graduaciones de producción.

## Publicación autorizada

El 2026-09-20 el operador autorizó desplegar `assignLevel` y preparar la web. Firebase CLI terminó
con salida 0 y confirmó la actualización de esa única función en `bptjersey-f5a25`, `us-central1`,
con el código de `d87fd9f`. Un POST sin sesión devolvió HTTP 401, sin reintentos. Evidencia:
`.tmp/manual-graduation-deploy.log` y `.tmp/manual-graduation-post-deploy.json`. No se realizaron
graduaciones de producción. La comprobación acredita disponibilidad y rechazo sin autenticación;
el flujo administrativo debe comprobarse tras el push de la web y Success en Cloudflare Pages.
