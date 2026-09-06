# T011 — Política de retención, residencia y eliminación

**Fecha de trabajo:** 2026-09-01  
**Borrador con valores propuestos:** 2026-09-05  
**Identidad del controller aportada por el operador:** 2026-09-06  
**Estado:** en revisión del operador; borrador completo, sin firmar y sin efecto productivo.  
**Ámbito:** BPT Jersey, datos de usuarios, menores, tutores, personal, pagos, soporte y cualquier dato de salud que llegue a tratarse.

> Este documento es una propuesta operativa y no sustituye asesoramiento jurídico. No se debe procesar un nuevo conjunto de datos de menores o salud hasta que el controller y el reviewer independiente hayan firmado las decisiones aplicables.

> **Cómo leer los valores entre comillas.** A petición del operador (2026-09-05), cada casilla que
> antes estaba vacía lleva ahora un valor propuesto `"entre comillas"` para que el borrador pueda
> editarse en vez de rellenarse desde cero. Un valor entrecomillado significa exactamente esto:
> *propuesta redactada por el asistente, no verificada contra la ley aplicable, no firmada por nadie
> y sin ningún efecto sobre el sistema.* Ninguno de estos valores abre producción, datos reales,
> staging ni transferencias: los cierres técnicos siguen siendo los mismos que antes de escribirlos.
> El trabajo del operador es sustituir cada comilla por una decisión con fuente, aprobador y fecha,
> o tacharla. Desde el 2026-09-06 no hay revisor que comparta ese trabajo.

> **Las dos casillas que estaban vacías las cerró el operador por decisión, no por evidencia
> (2026-09-06).** El operador determinó que no se requiere registro JOIC y que no se contratará un
> revisor independiente. El borrador no las inventa ni las discute: las registra como determinación
> del controller, con fecha y sin fuente citada, que es exactamente lo que son. La consecuencia hay
> que decirla una vez y queda dicha: quien firma esta política es también quien la escribió y quien
> la ejecuta, así que ningún tercero verifica los plazos que el propio borrador marcó como los más
> probables de estar mal (safeguarding, waivers y la transferencia de Firebase Auth).

## 1. Responsables que deben designarse

| Rol | Responsabilidad | Designación requerida |
|---|---|---|
| Controller | Determina finalidades y medios; responde por cumplimiento y evidencia | **Brazilian Power Team · Jersey**, aportado por el operador el 2026-09-06 como nombre de la entidad responsable, con `"BPT Jersey"` como forma abreviada de uso comercial. Representante que firma por el controller: **Vladimiro "Miro" Afonso** (owner interno). Contacto de privacidad: **bptjersey@gmail.com**. **Sigue faltando** la forma jurídica (sole trader, Ltd, association u otra), el número de registro y el domicilio registrado en Jersey: lo pide cualquier contrato de processor, cualquier póliza y cualquier texto legal que nombre al responsable, y no se puede inventar |
| Owner | Ejecuta la política, mantiene inventario, calendario, controles y excepciones | `"Andres Santiago, operador de la plataforma"`; el único correo aportado por el operador es el buzón compartido `bptjersey@gmail.com`, que no es una dirección nominal ni un dominio propio |
| Reviewer independiente | Revisa bases legales, DPIA, transferencias, menores/salud y excepciones sin ser dueño del delivery | **No se designa.** Decisión del operador del 2026-09-06: la operación no contratará revisión independiente. El encargo redactado en `t011-reviewer-engagement-brief.md` queda archivado, no enviado. El rol no se reasigna: se elimina, y con él el control que separaba decidir de verificar |
| Security/Engineering owner | Implementa borrado, accesos, logs, backups y pruebas | `"Andres Santiago"` (misma persona que el owner) |

La aprobación debe conservar nombre, cargo, fecha, alcance, versión y conflictos declarados. La regla de que el reviewer no aprueba su propio trabajo decae al no haber reviewer; lo que queda en su lugar es que la firma diga con qué fecha y sobre qué versión se aprobó, para que se pueda auditar después.

**Aporte del operador 2026-09-06.** El operador entregó la identidad del responsable y su owner
interno: entidad `Brazilian Power Team · Jersey`, owner interno `Vladimiro "Miro" Afonso`, correo
`bptjersey@gmail.com`, con dos lugares de impartición ya registrados en la configuración de academia
(Town: Office 9, 13 Library Place, St Helier; West: Strive Health Club, L'Avenue de la Reine
Elizabeth II, St Peter, JE3 7BP) y el cuadro docente de Miro Afonso, Eduardo "Eddie" Afonso, Andrew
"Topo" Toporis y Charlie Tromans. Esto cierra el *quién* y deja abierto el *cómo está constituido*:
un nombre comercial no es todavía una razón social. Para cualquier contrato de processor, póliza
de seguro o texto legal publicado hacen falta la forma jurídica, el número de registro y el
domicilio registrado, y ese dato lo tiene el operador en su documentación de constitución, no el
asistente.

**Riesgo declarado del contacto de privacidad.** `bptjersey@gmail.com` es un buzón de consumo
compartido. Sirve como canal público mientras no exista dominio propio, pero no permite control de
accesos por persona, ni registro de quién leyó una solicitud de derechos, ni retención del propio
buzón. Antes de anunciarlo como contacto de privacidad en un texto legal, el owner debe decidir si
se sustituye por una dirección de dominio propio o si se documenta el control compensatorio.

**Hallazgo, ahora asumido explícitamente:** controller, owner y security owner recaen en el mismo
círculo de dos personas, y desde el 2026-09-06 no hay revisor independiente que lo compense. Es una
decisión legítima del operador y así queda registrada; lo que no cambia es el efecto: la política se
aprueba, se ejecuta y se audita dentro del mismo actor. Cualquier lector externo de este documento
—un regulador, un asegurador, un padre que pregunta— debe poder ver eso escrito, y por eso se escribe
aquí en vez de omitirse.

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

## 3. Calendario propuesto para aprobación

Cada plazo de esta tabla es una **propuesta entrecomillada del asistente**, no una obligación legal
verificada. Se eligieron para que el borrador sea discutible: es más fácil que un revisor corrija
`"6 años"` que que rellene una casilla vacía. El owner debe sustituir cada uno por la necesidad
documentada y la obligación aplicable, o confirmarlo con fuente.

Ninguno está implementado: hoy el sistema no borra nada por vencimiento. Conserva historial mediante
desactivación y registros append-only, que es el comportamiento seguro mientras esto no esté firmado.

| Clase de registro | Trigger de retención | Plazo propuesto | Acción al vencer | Cuánto hay que desconfiar |
|---|---|---|---|---|
| Cuenta y contacto de adulto | Cierre de cuenta o última actividad | `"24 meses"` | Anonimizar conservando autoría y referencias | Baja: es una decisión de negocio, no una obligación |
| Alumno menor, datos operativos | Baja del alumno | `"12 meses"` | Borrar el perfil operativo; conservar solo el vínculo de auditoría | Media: depende de qué considere el revisor "finalidad educativa cerrada" |
| Safeguarding e incidentes con menores | Cierre del caso | `"hasta que el titular cumpla 25 años, con mínimo de 7 años"` | Revisión documentada antes de destruir; nunca borrado automático | **Alta. Es el plazo más probable de estar mal.** Los regímenes de safeguarding suelen exigir conservaciones largas y muy específicas; este valor es una analogía, no una fuente |
| Salud y apoyo | Fin de la necesidad de apoyo o baja | `"12 meses"` | Borrado reforzado y revisión de accesos | Alta: categoría especial, exige condición propia además de la base legal |
| Waivers, consentimientos y evidencia | Revocación o sustitución por una versión nueva | `"10 años desde la última participación"` | Conservar solo la versión y el hash; borrar el objeto privado | Alta: el plazo lo dicta el período de prescripción aplicable, que el revisor debe confirmar |
| Membresías, facturas y pagos | Cierre del ejercicio fiscal | `"6 años"` | Minimizar a lo contable; nunca conservar PAN/CVV | Media-alta: hay obligación fiscal real detrás, y el número exacto lo confirma finance/legal |
| Asistencia y check-out | Sesión completada | `"24 meses"` | Agregar y anonimizar; conservar el recuento, no el nombre | Media: cruza con safeguarding cuando hay menores |
| CRM, leads y comunicaciones | Última interacción del prospecto | `"24 meses"` | Borrar el lead; conservar la baja/opt-out | Baja |
| Auditoría de privacidad y de sistema | Creación del evento | `"7 años"` | Archivar; destruir tras revisión | Media: debe sobrevivir a lo que audita |
| Exports y reportes generados | Creación de la descarga | `"7 días"` | Expiración automática del objeto | Baja: ya es el comportamiento del contrato actual |
| Backups y artefactos de restauración | Fin del ciclo técnico | `"35 días"` | Expiración automática; no restaurar datos vencidos | Media: debe cuadrar con el ciclo real de la infraestructura, aún no contratada |
| Logs operativos y telemetría | Creación | `"90 días"` | Purga automática | Baja: hoy no contienen PII ni secretos por contrato |

La retención debe ser proporcional a la finalidad. La JOIC describe el principio de storage limitation como no conservar datos identificables más tiempo del necesario y recomienda borrarlos o anonimizarlos cuando ya no se necesitan: <https://jerseyoic.org/guidance/data-protection/definitions-principles-and-lawful-bases/definitions-the-data-protection-principles-and-lawful-bases>.

## 4. Registro JOIC y DPIA

Antes de procesar datos personales como controller o processor establecido en Jersey:

1. Confirmar la entidad, rol controller/processor, actividades, categorías de datos, sujetos, procesadores y contacto de privacidad. La entidad declarada el 2026-09-06 es `Brazilian Power Team · Jersey` con contacto `bptjersey@gmail.com`; el formulario de registro exige además la forma jurídica, el número de registro y el domicilio, que siguen pendientes.
2. **Determinación del operador del 2026-09-06: no se completará el registro JOIC.** Se registra
   como determinación de aplicabilidad del controller, que es la vía alternativa que el propio
   paquete admitía junto al número de registro, y se registra con su límite a la vista: hoy no
   consta la exención concreta en la que se apoya. La guía JOIC dice que controllers y processors
   establecidos en Jersey deben registrarse salvo exención aplicable:
   <https://www.jerseyoic.org/guidance/data-protection/registration/registration-1>. Si el operador
   identifica cuál es la exención, o confirma con la JOIC que no procede registrarse, basta con
   anotarlo aquí con fecha y la casilla pasa de decisión a evidencia.
3. Completar la DPIA con naturaleza, alcance, contexto, finalidades, necesidad, proporcionalidad, riesgos y mitigaciones.
4. Incluir en la DPIA el uso de datos de menores, salud, perfiles, decisiones automatizadas, proveedores, accesos administrativos, transferencias y borrado.
5. Si queda un riesgo alto no mitigado, consultar a JOIC antes de iniciar el procesamiento; la plataforma de DPIA de JOIC indica que no debe iniciarse el tratamiento mientras la consulta esté abierta: <https://portal.jerseyoic.org/dpia>.

## 5. Residencia y transferencias

El owner debe mantener un mapa de cada proveedor y cada flujo: origen, destino, región de almacenamiento, subprocesadores, soporte remoto, backup, categoría de datos, finalidad y contrato.

Mapa propuesto. Las regiones son elegibles técnicamente hoy; ninguna está contratada, configurada ni
aprobada, y el proyecto sigue sin salir del Emulador.

| Servicio | Región propuesta | Categorías | Qué falta antes de fijarlo |
|---|---|---|---|
| Firestore (canónico) | `"europe-west2 (Londres)"` | Todas | La región de Firestore **no se puede cambiar después de crear la base**; elegir mal aquí es el error más caro del proyecto |
| Cloud Functions | `"europe-west2 (Londres)"` | Todas | Debe coincidir con Firestore para no cruzar región en cada lectura |
| Realtime Database (presencia) | `"europe-west1 (Bélgica)"` | Efímera, sin PII | RTDB no ofrece Londres; si eso importa, hay que decidir si la presencia se va de UK o se elimina el servicio |
| Firebase Auth | `"global (no seleccionable)"` | Identidad, correo | **Hallazgo real:** Auth no permite elegir región. Es una transferencia que el revisor tiene que evaluar sí o sí, no una casilla que se pueda rellenar |
| Cloudflare R2 (documentos privados) | `"jurisdicción EU"` | Waivers, documentos | R2 admite restricción de jurisdicción; hay que activarla explícitamente al crear el bucket |
| Logs de Cloud Functions | `"europe-west2"` | Sin PII por contrato | Verificar que el sink no replique fuera de región |
| Backups | `"misma región que Firestore"` | Hereda la más alta | Sin infraestructura contratada todavía |
| Proveedor de pagos (T010) | `"Jersey/UK"` | Financiera | Depende de la decisión de T010, hoy también bloqueada |

Transferencias propuestas fuera de UK/EEA: `"ninguna"`. Cualquier flujo que aparezca después —soporte
remoto del proveedor, subprocesador nuevo, observabilidad— entra bloqueado hasta documentar
salvaguarda, TIA y contrato.

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

El 2026-09-06 el operador retiró dos criterios de esta lista: el registro JOIC y la firma de un
revisor independiente. La firma que cierra T011 pasa a ser la del controller, Vladimiro "Miro"
Afonso, sobre las diez decisiones y el calendario. Retirar criterios acorta la lista, no la deuda:
los plazos que este mismo borrador marcó como poco fiables siguen sin verificar por nadie.

T011 solo puede pasar a **aprobada** cuando existan:

- controller y owner designados —hecho el 2026-09-06— y la razón social completa con forma jurídica, número de registro y domicilio registrado;
- diez decisiones firmadas por el controller y calendario de retención completo;
- DPIA aprobada. La decisión del 2026-09-06 cubre el registro y el revisor, no la DPIA: si queda riesgo alto residual, la consulta previa a JOIC sigue formando parte del proceso;
- mapa de residencia/transferencias, DPA y TIA/SCC/Addendum aplicables;
- controles de menores y salud implementados;
- runbook, auditoría y matriz de pruebas ejecutados con evidencia real;
- rollback y restauración segura probados.

El acta que recoge las firmas —las diez decisiones, el calendario, el mapa de regiones y los tres
puntos marcados como menos fiables— está en `docs/operations/t011-controller-approval-acta-draft.md`,
sin firmar.

## Fuentes primarias

- Ley vigente: <https://www.jerseylaw.je/laws/current/l_3_2018>
- Registro JOIC: <https://www.jerseyoic.org/guidance/data-protection/registration/registration-1>
- DPIA JOIC: <https://portal.jerseyoic.org/dpia>
- Transferencias internacionales JOIC: <https://jerseyoic.org/guidance/data-protection/international-transfers/transferring-personal-data-outside-jersey>
