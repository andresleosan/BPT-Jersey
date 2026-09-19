# Registro con selección de planes

El registro público `/enrol` tiene dos pasos: datos completos y aceptación del waiver, y selección de un plan por alumno. El adulto elige para sí mismo; el tutor elige por cada hijo, según su centro (Town/West) y edad. El botón de envío aparece en el segundo paso. La solicitud queda pendiente de aprobación, con las preferencias visibles al administrador; no se crea una suscripción ni un cobro al elegir.

`planSelections` es obligatorio en las nuevas solicitudes y se valida en el servidor contra el catálogo vigente, el centro y la edad. En registros almacenados es opcional para conservar las solicitudes antiguas. Las elecciones de los menores se guardan en el mismo orden que `minors`. Un tutor que no entrena puede enviar sus datos sin preferencias horarias propias.

## Validación

- 125 pruebas enfocadas del registro, contratos, cliente, almacenamiento, callables y aprobación.
- Typecheck de domain, web y functions; lint de los archivos modificados.
- Compilación estática de Next.js con configuración sintética de Firebase.
- Artefacto de Functions preparado con `node apps/functions/scripts/build-deploy-artifact.mjs`.
- La revisión visual con Playwright está pendiente: el navegador de este entorno no pudo iniciar con su aislamiento habilitado.

## Publicación coordinada

No basta con publicar la web. Las Functions anteriores rechazan `planSelections`; además, sus lectores usan un esquema estricto y no pueden leer las nuevas solicitudes hasta actualizarse. Publicar juntas las siete funciones del registro:

- `submitEnrolmentRequest`
- `listMyEnrolmentRequests`
- `withdrawEnrolmentRequest`
- `listEnrolmentRequests`
- `getEnrolmentRequestDetail`
- `approveEnrolmentRequest`
- `returnEnrolmentRequest`

Coordinar una ventana de publicación para actualizar estas Functions y publicar el frontend desde `main`. El frontend anterior no envía el campo nuevo, por lo que tampoco puede enviar solicitudes al backend actualizado; los formularios abiertos durante el cambio tendrán que recargarse. Seguir el runbook T058 y solicitar autorización para la release productiva antes de desplegar. No se requieren cambios de Rules, índices, roles ni suscripciones existentes.

Comprobar después: adulto en Town y West, tutor con hijos en centros distintos, solicitud visible con todos los planes en la revisión y apertura de una solicitud histórica. Revertir solo el frontend no revierte el contrato del servidor; cualquier rollback debe mantener compatibles ambas capas y preservar los registros que ya incluyen `planSelections`.
