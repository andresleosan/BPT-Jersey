# Publicación de registro y Staff · 2026-09-20

Estado: cambios locales en `feat/enrolment-payment-staff`; sin publicación de esta entrega.

## Alcance revisable

- Web: `/enrol`, `/admin/members/requests`, `/admin/staff`.
- Functions nuevas: `uploadEnrolmentPaymentProof`, `getEnrolmentPaymentInstructions`.
- Functions que requieren actualización: `submitEnrolmentRequest`, `listMyEnrolmentRequests`,
  `withdrawEnrolmentRequest`, `listEnrolmentRequests`, `returnEnrolmentRequest`,
  `getEnrolmentRequestDetail`, `approveEnrolmentRequest`, `createStaffInvitation`,
  `acceptStaffInvitation`, `listStaffInvitations`, `cancelStaffInvitation`.
  Lectores y mutaciones deben publicarse juntos: los contratos estrictos antiguos no reconocen
  los campos de pago/revisión ni las invitaciones Coach.
- Actualizar también `changeTeamRole` en el lote para asegurar que producción usa la transición
  existente de coach a administrador/owner mostrada ahora en la interfaz.
- `manageMemberSubscription` utiliza la nueva modalidad interna PAYG; incluirla en el lote para
  mantener el contrato del servidor coherente. El lote consta de 15 funciones (2 nuevas y 13 actualizadas).
- No hay migración, cambios de reglas, índices, cuentas ni permisos de infraestructura.
- `adminOperationalNotificationCreated` ya convierte el evento de envío en notificación; comprobar
  que está desplegada en el inventario de producción antes de publicar. Si falta, añadirla al alcance
  revisado, sin crear notificaciones manuales duplicadas.

## Orden

1. Obtener la aprobación explícita de producción exigida por CLAUDE.md. No ejecutar este paso por
   una aprobación histórica de otra entrega.
2. Compilar dominio y Functions con los scripts existentes. Publicar solo el lote anterior mediante
   el artefacto `.firebase-functions/`; no usar directamente `apps/functions/lib`.
3. Las funciones de evidencia requieren las mismas cinco referencias R2 de almacenamiento privado
   ya usadas por el proyecto. Verificar disponibilidad sin imprimir valores. Si falta configuración,
   parar el despliegue afectado y comunicar el requisito; no crear credenciales ni políticas nuevas.
4. Publicar la web por el flujo Git/Cloudflare Pages del operador y confirmar Success del commit.
   Las llamadas de aprobación antiguas no incluyen la revisión nueva: recargar las pestañas abiertas.
5. Con sesión real: comprobar datos bancarios configurados en Billing; realizar un alta de prueba
   autorizada de pago y otra West PAYG; revisar evidencia, elegir nivel, aprobar y comprobar miembro,
   plan, fechas, nivel, factura/pago y ausencia de factura inicial PAYG.
6. Con owner: cambiar un coach con Google vinculado a Administrator; autorizar otro correo y verificar
   activación en `/staff/login`. Administrator debe poder invitar Coach y seguir sin conceder admin/owner.

## Evidencia local

- Suite general (4.382/4.383; fallo intermitente del calendario que pasa al repetir): `.tmp/enrolment-all-tests-verified.log`. La primera ejecución detectó un selector obsoleto y un timeout de importación bajo carga; se corrigió el selector y se repitió con dos workers.
- Pruebas finales focalizadas: 409/409, 22 archivos, `.tmp/enrolment-final-focused.log`. Incluyen los escritores canónicos adulto/familia y el caso intermitente de calendario.
- Navegador con fixtures (12/12): `.tmp/enrolment-browser-verified.log`; incluye error de subida, reintento,
  espera, pantalla de 320 px, revisión completa, devolución, coach y cambio de rol.
- TypeScript y lint: `.tmp/enrolment-types-verified.log`, `.tmp/enrolment-lint-verified.log`.
- Formato y compilación: `.tmp/enrolment-format-verified.log`, `.tmp/enrolment-runtime-build.log`, `.tmp/enrolment-functions-build-final.log`, `.tmp/enrolment-web-build.log`.
- Las comprobaciones locales no demuestran disponibilidad de secretos R2, vinculación Google de
  cuentas reales ni despliegue. No se ha medido latencia de producción en esta entrega.
