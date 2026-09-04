# T011 — Política de retención, residencia y eliminación

**Fecha de trabajo:** 2026-09-01  
**Estado:** bloqueada; paquete preparado para designación y aprobación.  
**Ámbito:** BPT Jersey, datos de usuarios, menores, tutores, personal, pagos, soporte y cualquier dato de salud que llegue a tratarse.

> Este documento es una propuesta operativa y no sustituye asesoramiento jurídico. No se debe procesar un nuevo conjunto de datos de menores o salud hasta que el controller y el reviewer independiente hayan firmado las decisiones aplicables.

## 1. Responsables que deben designarse

| Rol | Responsabilidad | Designación requerida |
|---|---|---|
| Controller | Determina finalidades y medios; responde por cumplimiento y evidencia | `[razón social exacta de BPT Jersey / representante autorizado]` |
| Owner | Ejecuta la política, mantiene inventario, calendario, controles y excepciones | `[nombre, cargo y correo corporativo]` |
| Reviewer independiente | Revisa bases legales, DPIA, transferencias, menores/salud y excepciones sin ser dueño del delivery | `[abogado/a o profesional de privacidad independiente]` |
| Security/Engineering owner | Implementa borrado, accesos, logs, backups y pruebas | `[nombre, cargo y correo corporativo]` |

La aprobación debe conservar nombre, cargo, fecha, alcance, versión y conflictos declarados. El reviewer no puede aprobar su propio trabajo.

## 2. Las diez decisiones que deben resolverse

| # | Decisión | Propuesta segura para aprobación | Evidencia de cierre |
|---:|---|---|---|
| 1 | Controller y finalidad | BPT Jersey es controller de las finalidades propias; cada finalidad se registra por separado, sin finalidades abiertas o “por si acaso” | Registro de tratamiento y firma del controller |
| 2 | Inventario y minimización | Recoger solo identidad/contacto, datos académicos u operativos estrictamente necesarios; no recoger salud ni identificadores sensibles por defecto | Inventario campo-a-finalidad y revisión de formularios |
| 3 | Base legal de datos ordinarios | Seleccionar una base legal por finalidad antes de recogerla; contrato, obligación legal, función pública, intereses legítimos o consentimiento solo cuando encaje y pueda demostrarse | Matriz de bases legales y texto de privacidad |
| 4 | Datos de salud | Prohibidos en el MVP salvo caso de uso aprobado en una DPIA; si fueran necesarios, seleccionar además una condición de categoría especial, acceso restringido y separación lógica | Decisión específica, DPIA, condición legal y control de acceso |
| 5 | Menores y tutores | Tratar a menores como grupo vulnerable; verificar edad cuando sea relevante, documentar capacidad y usar tutor/responsable cuando legalmente corresponda; no depender automáticamente del consentimiento del menor | Flujo de edad/tutor, registro de consentimiento y revisión de UX |
| 6 | Retención por tipo de dato | Definir un plazo o criterio por finalidad, no un plazo único global; al vencer, borrar o anonimizar y conservar solo la evidencia mínima de cumplimiento | Calendario versionado con trigger, plazo, acción y owner |
| 7 | Excepciones y legal hold | Suspender borrado solo por obligación legal, reclamación, investigación o safeguarding documentado; toda excepción tiene motivo, alcance, aprobador, fecha de revisión y expiración | Registro de holds y prueba de liberación |
| 8 | Residencia y transferencias | Jersey/UK/EEA como ruta preferida; no transferir a tercer país sin confirmar adecuación o salvaguarda válida, TIA, contrato y transparencia actualizada | Mapa de proveedores, ubicación, DPA, TIA/SCC/Addendum si aplica |
| 9 | Eliminación técnica | Borrado autenticado e idempotente en base primaria, índices, objetos, colas, exportaciones y proveedores; backups expiran por ciclo y no se restauran a producción sin purga | Runbook, logs de borrado sin datos sensibles y prueba end-to-end |
| 10 | Derechos, auditoría y aprobación | Registrar solicitudes, accesos, cambios, borrados, fallos y excepciones; revisión trimestral y revalidación ante cambio de proveedor/finalidad | Auditoría, métricas, pruebas y acta de aprobación |

Las propuestas anteriores no están aprobadas hasta que consten las designaciones y la firma del controller y reviewer independiente.

## 3. Calendario inicial para aprobación

No se fijan plazos legales inventados. El owner debe completar esta tabla con la necesidad documentada, obligación aplicable y validación del reviewer:

| Clase de registro | Trigger de retención | Plazo/criterio propuesto | Acción al vencer | Estado |
|---|---|---|---|---|
| Cuenta y contacto | Cierre de cuenta o última actividad | `[definir según finalidad]` | Borrar o anonimizar | Pendiente |
| Datos de menores | Fin de finalidad educativa/operativa o solicitud válida | El menor plazo compatible con safeguarding y obligación aplicable | Borrar; comunicar a procesadores | Pendiente |
| Salud | Fin de caso o finalidad expresamente aprobada | No conservar fuera de la finalidad; plazo específico firmado | Borrado reforzado y revisión de accesos | Pendiente; prohibido por defecto |
| Pagos/reconciliación | Operación cerrada | `[confirmar con legal/finance]` | Minimizar; nunca conservar PAN/CVV | Pendiente |
| Soporte/incidentes | Cierre del caso | `[definir según riesgo y obligación]` | Borrar o anonimizar | Pendiente |
| Auditoría de privacidad | Última acción o cierre de investigación | `[definir con reviewer]` | Destruir/transferir según necesidad | Pendiente |
| Backups | Fin del ciclo técnico | `[confirmar ciclo real de infraestructura]` | Expiración automática; no restaurar datos vencidos | Pendiente |

La retención debe ser proporcional a la finalidad. La JOIC describe el principio de storage limitation como no conservar datos identificables más tiempo del necesario y recomienda borrarlos o anonimizarlos cuando ya no se necesitan: <https://jerseyoic.org/guidance/data-protection/definitions-principles-and-lawful-bases/definitions-the-data-protection-principles-and-lawful-bases>.

## 4. Registro JOIC y DPIA

Antes de procesar datos personales como controller o processor establecido en Jersey:

1. Confirmar la entidad, rol controller/processor, actividades, categorías de datos, sujetos, procesadores y contacto de privacidad.
2. Completar o actualizar el registro JOIC y conservar número, fecha, alcance y cargo pagado o exención. La JOIC indica que controllers y processors establecidos en Jersey deben registrarse salvo una exención aplicable: <https://www.jerseyoic.org/guidance/data-protection/registration/registration-1>.
3. Completar la DPIA con naturaleza, alcance, contexto, finalidades, necesidad, proporcionalidad, riesgos y mitigaciones.
4. Incluir en la DPIA el uso de datos de menores, salud, perfiles, decisiones automatizadas, proveedores, accesos administrativos, transferencias y borrado.
5. Si queda un riesgo alto no mitigado, consultar a JOIC antes de iniciar el procesamiento; la plataforma de DPIA de JOIC indica que no debe iniciarse el tratamiento mientras la consulta esté abierta: <https://portal.jerseyoic.org/dpia>.

## 5. Residencia y transferencias

El owner debe mantener un mapa de cada proveedor y cada flujo: origen, destino, región de almacenamiento, subprocesadores, soporte remoto, backup, categoría de datos, finalidad y contrato.

- Jersey y EEA tienen reconocimiento de adecuación según la guía JOIC, pero la adecuación no elimina la necesidad de base legal, necesidad, transparencia, contrato y seguridad.
- Para una jurisdicción sin adecuación, detener el flujo hasta documentar salvaguarda válida, TIA y contrato aplicable. La guía JOIC identifica SCC más Jersey Addendum como una vía habitual y exige evaluar los riesgos de la transferencia: <https://jerseyoic.org/guidance/data-protection/international-transfers/transferring-personal-data-outside-jersey>.
- No usar “data residency” del proveedor como afirmación contractual: conservar región exacta, subprocesadores y política de cambio/notificación.

## 6. Controles obligatorios para menores y salud

- Prohibir campos de salud libres, documentos médicos y diagnósticos en formularios generales.
- Clasificar cualquier dato de salud como categoría especial; exige una condición específica además de la base legal ordinaria: <https://jerseyoic.org/guidance/data-protection/definitions-principles-and-lawful-bases/definitions-the-data-protection-principles-and-lawful-bases>.
- Separar datos de salud en una colección/servicio con acceso por rol, cifrado, auditoría y exportación restringida.
- No incluir menores en analítica, entrenamiento, marketing o perfilado por defecto.
- Verificar edad y autoridad parental/tutelar cuando el servicio y la base legal lo requieran. La JOIC señala protección reforzada para datos de menores y especial consideración al borrado de datos recogidos durante la infancia: <https://www.jerseyoic.org/guidance/data-protection/individual-rights/individual-rights-what-they-are-how-to-exercise-them-and-how-to-manage-them>.
- No realizar decisiones automatizadas con efecto significativo sobre menores o basadas en salud sin revisión específica, salvaguardas y aprobación legal.

## 7. Runbook de eliminación

1. Recibir solicitud, vencimiento o instrucción de hold; autenticarla y crear un `deletion_case_id` sin copiar datos innecesarios.
2. Resolver identidad y alcance; localizar primario, índices, archivos, colas, exports, logs y procesadores.
3. Comprobar hold legal/safeguarding. Si existe, congelar solo el alcance necesario y registrar expiración; no congelar toda la cuenta por defecto.
4. Ejecutar borrado idempotente y por fases; no registrar payloads, tokens, salud, PAN ni datos de menores.
5. Propagar la instrucción a procesadores y registrar confirmación o impedimento.
6. Verificar ausencia en lecturas, búsquedas, exports y nuevas restauraciones; documentar hashes/contadores técnicos, no contenido personal.
7. Cerrar el caso con resultado, actor, timestamps, errores y revisión del owner. Escalar fallos al reviewer.

Si falla el borrado, el sistema debe quedar en estado de excepción visible y no afirmar cumplimiento. No se debe hacer una migración destructiva ni purga masiva sin backup verificado, plan de rollback y confirmación explícita del operador.

## 8. Criterio de cierre de T011

T011 solo puede pasar a **aprobada** cuando existan:

- controller, owner y reviewer independiente designados;
- diez decisiones firmadas y calendario de retención completo;
- registro JOIC confirmado o exención documentada;
- DPIA aprobada y consulta JOIC si el riesgo residual lo exige;
- mapa de residencia/transferencias, DPA y TIA/SCC/Addendum aplicables;
- controles de menores y salud implementados;
- runbook, auditoría y matriz de pruebas ejecutados con evidencia real;
- rollback y restauración segura probados.

## Fuentes primarias

- Ley vigente: <https://www.jerseylaw.je/laws/current/l_3_2018>
- Registro JOIC: <https://www.jerseyoic.org/guidance/data-protection/registration/registration-1>
- DPIA JOIC: <https://portal.jerseyoic.org/dpia>
- Transferencias internacionales JOIC: <https://jerseyoic.org/guidance/data-protection/international-transfers/transferring-personal-data-outside-jersey>
