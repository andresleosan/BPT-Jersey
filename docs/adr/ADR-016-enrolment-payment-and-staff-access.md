# ADR-016 · Registro con comprobante, membresía y nivel; alta de Staff unificada

Fecha: 2026-09-20. Estado: implementado localmente; publicación pendiente.

## Decisión

El registro público tiene tres pasos: datos y waiver, elección de planes, pago y envío.
La sugerencia usa edad y sede; el solicitante confirma un plan elegible por alumno.
La frecuencia libre se conserva para revisión, sin inferir automáticamente un contrato de ese texto.
Todos los planes requieren captura PNG/JPEG de hasta 2 MiB, fecha y referencia de transferencia,
excepto los planes por sesión de West (`payg` y `west-teens-payg`). En familias mixtas solo se suman
los planes que requieren transferencia. El servidor calcula y verifica el importe del catálogo.
Se muestran los datos bancarios configurados en Billing; si faltan, se indica contactar a la academia.

La captura se guarda en R2 privado con clave derivada de academia, cuenta, UUID y huella del archivo.
La solicitud solo acepta evidencia que existe bajo esa misma cuenta y solicitud. El detalle de oficina
expone un enlace firmado de diez minutos, renovable mediante Reload full request. Las capturas no se
incluyen en la cola, en notificaciones ni en la vista de coach. Se conserva el evento de auditoría
existente, que alimenta las notificaciones administrativas; no se crea una segunda notificación.

Owner/administrator revisa datos, waiver, planes y transferencia. Elige cualquier nivel publicado
por alumno, sin filtrar por edad ni requisitos deportivos, y confirma inicio/fin del periodo y dos
casillas de revisión. El plan debe coincidir con el elegido por el solicitante; cambiar el nivel no
cambia el importe. Los planes mensuales sugieren un mes de vigencia; el fin de trimestre debe indicarse.

La aprobación valida antes de bloquear y fija la configuración en el primer intento. Guarda miembro,
nivel inicial, suscripción y pago antes de finalizar. West PAYG queda activo, sin factura, sin pago
inventado y sin marcar acceso gratuito; el cobro por clase conserva sus reglas existentes. Los IDs y
recibos permiten reanudar sin duplicar. Los escritores canónicos de adulto y familia reciben un
ámbito interno de solicitud, separado de la identidad del revisor: permiten que otro administrador
activo retome el proceso, conservando el actor real en el recibo y su auditoría. Ese campo no forma
parte de los payloads públicos de creación manual. Una aprobación en curso bloquea otro intento durante dos
minutos. La aprobación fallida sigue visible, incluso si un tutor ya recibió su rol durante el alta
familiar. Una solicitud antigua sin evidencia debe devolverse para completar un nuevo envío; no se
inventa una transferencia. Las solicitudes ya aprobadas no se migran automáticamente.

## Staff

Create staff profile incorpora correo y rol. Owner puede autorizar Coach, Administrator u Owner;
administrator solo Coach. El acceso se activa con la cuenta Google verificada correspondiente y la
invitación dura siete días. No se envía correo automáticamente. El directorio contiene nombre, correo,
rol y Change role para que el owner ascienda coaches existentes. La edición deportiva conserva
activación, disponibilidad, asignaciones y permisos específicos; se retira su selector de rol que solo
ofrecía Coach y daba la impresión de permitir administrar roles de cuenta.

Se reutilizan los servicios existentes de aprovisionamiento, comprobación de autoridad vigente,
bloqueo, auditoría y compensación. No se elimina la vinculación Google ni la protección del último
owner. Conceder o retirar acceso administrativo sigue reservado al owner.

## Verificación y publicación

Las pruebas cubren datos/formulario, excepción PAYG, importe exacto, evidencia ligada a cuenta,
reintentos, nivel y suscripción, aprobación parcial, autoridad y flujo móvil/escritorio. Capturas
sintéticas locales en `.tmp/enrolment-*.png`. No son pruebas con cuentas o transferencias reales.
Dos pruebas adicionales reprodujeron y corrigieron el relevo entre revisores en los escritores
canónicos (`.tmp/enrolment-reviewer-red.log`, `.tmp/enrolment-reviewer-green.log`). La evidencia final y el orden de publicación se registran en el runbook de esta entrega.
