# ADR-003: Cloudflare R2 para archivos privados

Fecha: 2026-08-06  
Estado: aceptada

## Contexto

El sistema almacenará waivers, documentos, comprobantes y eventualmente medios. Algunos pueden contener información sensible y requieren acceso controlado, auditoría y costos predecibles de descarga.

## Decisión

Usar un bucket privado de Cloudflare R2 Standard mediante un adaptador S3; Firebase Functions emitirá URLs firmadas de corta duración después de autorizar cada solicitud.

## Alternativas consideradas

- Firebase Cloud Storage: integración nativa, pero no fue la opción solicitada y su egress puede ser más costoso.
- URLs públicas de R2: descartadas para documentos personales o médicos.
- Guardar blobs en Firestore: descartado por límites, costo y falta de adecuación para objetos.

## Consecuencias

R2 reduce el costo de egress y desacopla archivos de Firestore. A cambio, añade un segundo proveedor, credenciales S3, CORS, URLs firmadas y una revisión obligatoria de jurisdicción, retención y borrado antes de producción.
