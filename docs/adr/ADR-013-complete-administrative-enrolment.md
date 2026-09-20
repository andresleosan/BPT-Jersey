# ADR-013: alta administrativa completa y gestión operativa

Fecha: 2026-09-20. Estado: Functions publicadas con autorización explícita; web pendiente.

## Decisión del operador

Administrator gestiona miembros y coaches, incluidos datos personales, nivel, suscripción,
pagos manuales y expediente médico. La única distinción de gestión operativa frente al owner
es conceder o retirar acceso administrativo, que sigue reservado al owner. Esto confirma
ADR-011; no convierte cuentas históricas headCoach automáticamente ni modifica el acceso de coach.
Los controles de autenticación vigente, academia, integridad y validación siguen aplicándose.

## Alta y reanudación

El alta de adulto guarda los campos personales canónicos y, en la misma pantalla, permite abrir
su nivel inicial y asignar un plan, sus fechas y el pago (pagado, pendiente o gratuito con motivo).
Se reutilizan los editores y servicios de nivel y suscripción existentes. El alta ya crea una
familia de oficina sin usuario y el servicio manual ya admite esa familia: se elimina el texto
obsoleto que exigía una cuenta online. No se cambia el contrato del servicio histórico
createMembership; esta pantalla usa manageMemberSubscription.

Los menores conservan el alta con tutor en Familias y desde allí continúan al mismo editor de
nivel y suscripción. No se inventa un usuario ni una relación de tutela al asignar un plan.

La pantalla solo declara el registro completo tras verificar nivel y suscripción y confirmar
el guardado médico, si se aportó. No hay transacción global: cada paso puede quedar pendiente,
con indicación explícita y reintento. El alta y el pago conservan sus identificadores de
idempotencia. La URL guarda únicamente studentId y una marca de tarea médica pendiente;
permite recargar sin crear otra persona y no contiene datos médicos ni de contacto.
El texto médico no se persiste en el navegador: se conserva en memoria mientras la página esté
abierta; al abandonar se avisa. Si se recarga pese al aviso, la tarea sigue pendiente y hay que
reintroducir el texto. El nivel se relee antes de mostrar el formulario y se puede comprobar tras
una respuesta incierta, sin abrir otro nivel.

## Expediente médico

El bloqueo global de piloto impedía guardar cualquier nota médica administrativa en producción.
Con la autorización funcional de este trabajo, owner y administrator pasan por App Check y
requireActiveOfficeActor, que consulta Firebase Auth y rechaza cuentas desactivadas, cambios de
rol y academia. Solo después se leen o escriben los documentos privados de su academia, usando
el almacenamiento y auditoría existentes. Las otras categorías conservan el límite de piloto y
sus proyecciones restringidas. No se abre Firestore directo, no se cambian reglas ni IAM.

La publicación debe actualizar exclusivamente estos seis callables médicos:
getHealthProfile, saveHealthProfile, deactivateHealthProfile, reviewHealthProfileChangeRequest,
listHealthReferences y saveHealthReferenceLabel. El flujo de solicitudes del tutor no cambia.
La activación productiva necesita aprobación explícita de este alcance, además del push de web.
No se han consultado ni modificado expedientes reales durante este trabajo.

## Evidencia

- Pruebas de alta y reintentos: datos de formulario, campos administrativos, guardado parcial,
  continuidad del mismo miembro y finalización condicionada a los pasos guardados.
- Pruebas de roles: owner/administrator gestionan perfiles, disponibilidad, asignaciones y
  activación de coaches; administrador no concede acceso administrativo.
- Pruebas médicas: acceso de oficina fuera del piloto, App Check requerido, cuenta vigente,
  revocación, academia distinta, proyección restringida y auditoría.
- Navegador con llamadas interceptadas y datos sintéticos: móvil/escritorio, teclado, estados
  de carga y error, reanudación y ausencia de desbordamiento.
- Resultados finales y limitaciones de publicación: BACKLOG.md, T058V2.

Resultados finales: 4.342 pruebas unitarias en 404 archivos, 10 pruebas Playwright (móvil y
escritorio) y 3 de integración Firestore en demo-bpt-jersey pasan. TypeScript, lint, formato,
compilación de dominio y Functions pasan. Se retiraron temporalmente, por separado, la consulta
de autoridad vigente y la condición de registro completo: las pruebas fallaron en ambos casos
y se restauraron los controles antes de la verificación final.

Evidencia local: `.tmp/complete-enrolment-full-final.log`,
`.tmp/complete-enrolment-browser-polish.log`,
`.tmp/complete-enrolment-health-integration-final.log`,
`.tmp/complete-enrolment-types-final.log`, `.tmp/complete-enrolment-lint-final.log`,
`.tmp/complete-enrolment-format-final.log` y `.tmp/complete-enrolment-functions-build.log`.
Capturas con datos sintéticos: `.tmp/enrolment-*.jpg`.

## Orden de publicación propuesto

1. Aprobación explícita del operador para habilitar la gestión médica administrativa fuera del
   piloto y publicar esta entrega.
2. Desplegar únicamente los seis callables indicados, proyecto bptjersey-f5a25, us-central1;
   verificar respuesta no autenticada y no crear expedientes reales como prueba.
3. Avanzar main con este cambio probado y realizar el push por el flujo SSH del operador.
4. Confirmar Success del commit en Cloudflare Pages, proyecto bptjersey, y probar el registro
   con sesión administrativa. Hasta entonces no se declara implementado en producción.

## Publicación de Functions verificada

El operador autorizó en chat esta publicación («autorizo y haz /compact»). El 2026-09-20 se
publicaron exactamente las seis funciones sobre el código 3fc9bbe: cuatro actualizaciones y
creación de deactivateHealthProfile y reviewHealthProfileChangeRequest. Firebase finalizó con
exit 0 y Deploy complete. Log: `.tmp/complete-enrolment-deploy.log`.

Un POST vacío sin sesión por función devolvió HTTP 401 en las seis. Evidencia con horas:
`.tmp/complete-enrolment-post-deploy.json`. Esta comprobación verifica disponibilidad y rechazo
sin sesión; no sustituye la comprobación funcional con una sesión administrativa.
No se modificaron expedientes reales. La web requiere el push del operador y Success en Pages.
