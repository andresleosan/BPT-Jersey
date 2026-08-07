# Clasificación de datos, amenazas y matriz preliminar de acceso

## Estado y propósito

Este documento define el modelo preliminar de seguridad que debe guiar el diseño de dominio, datos, autorización, auditoría e integraciones de BPT Jersey Academy Platform.

No constituye asesoría legal, certificación de cumplimiento ni un esquema técnico definitivo. La política aplicable de retención, residencia, acceso y borrado para Jersey permanece bloqueada en `T011`. Las colecciones, índices e invariantes se definen en `T013`; los roles y claims en `T015`; y las Firebase Rules concretas en `T016`.

## Alcance y supuestos

El alcance comprende todos los datos previstos para el MVP descrito en `BRIEF.md`, incluidos usuarios, familias, menores, personal, agenda, asistencia, membresías, pagos, progreso, reconocimiento, CRM, comunicaciones, archivos, auditoría, reportes y backups.

Supuestos vigentes:

- El MVP opera para una sola academia y separa los entornos `dev`, `staging` y `production`.
- Los menores son sujetos protegidos, no usuarios autenticados; sus tutores administran la relación digital.
- Firestore será la fuente canónica. RTDB solo podrá contener estado efímero no canónico.
- Los archivos privados se almacenarán en R2 y solo se entregarán mediante autorización previa y URLs firmadas de corta duración.
- Ningún navegador, cliente o proveedor externo es una fuente de confianza para roles, importes, estados financieros, autorizaciones de salida o decisiones sensibles.
- Los proveedores de pagos y comunicaciones siguen pendientes de selección. Sus controles se describen como requisitos, no como capacidades ya verificadas.

Fuera de este documento:

- Definir colecciones, documentos, índices o rutas de objeto.
- Escribir Rules, custom claims, endpoints o contratos de API.
- Fijar plazos legales de retención o afirmar cumplimiento regulatorio.
- Sustituir una revisión jurídica y de safeguarding aplicable a Jersey.

## Principios de seguridad

1. **Denegación por defecto.** Todo acceso comienza prohibido y debe justificarse por rol, propósito operativo, relación familiar y, cuando corresponda, asignación de clase o responsabilidad.
2. **Mínimo privilegio y separación de funciones.** Leer datos no concede derecho a corregirlos, aprobarlos, exportarlos ni eliminarlos. Los roles financieros, operativos y deportivos conservan límites diferenciados.
3. **Prevalencia del dato más sensible.** Un campo `Restricted` eleva el manejo del registro, payload, exportación, caché o log que lo contenga. Los datos derivados heredan la clasificación más alta de sus fuentes salvo desclasificación documentada.
4. **Backend autorizado para acciones sensibles.** Roles, importes, estados de pago, refunds, consentimientos, autorizaciones de salida, exports, promociones y correcciones auditables no dependen de valores enviados por el cliente.
5. **Trazabilidad.** Los cambios sensibles registran actor, momento, propósito, entidad afectada y resultado. Los eventos de auditoría son append-only para usuarios interactivos.
6. **Historia preservada.** Finanzas, membresías, asistencia, consentimientos y evaluaciones usan estados, correcciones o soft delete hasta que `T011` defina retención y borrado aplicables.
7. **Protección reforzada de menores.** Los menores no tienen cuentas en el MVP; el acceso familiar exige relación vigente y la comunicación con coaches permanece visible al tutor.
8. **Control humano.** Belts, stripes, reconocimientos, refunds, correcciones financieras y decisiones de safeguarding requieren una persona autorizada; una automatización puede proponer, nunca decidir de forma final.
9. **Minimización.** Cada pantalla, función, exportación, log y proveedor recibe únicamente los campos necesarios para su finalidad declarada.
10. **Entornos aislados.** Datos y credenciales de producción no se reutilizan en desarrollo o pruebas. Los fixtures no contienen datos personales reales.

## Niveles de clasificación

| Nivel | Significado | Manejo mínimo |
|---|---|---|
| `Public` | Información publicada deliberadamente para acceso sin autenticación. | Control de integridad; ausencia de datos privados; indexación solo cuando sea intencional. |
| `Internal` | Operación no pública y de baja sensibilidad sin datos personales vinculados. | Acceso autenticado del personal que lo necesite; sin indexación pública; logging básico. |
| `Confidential` | Datos personales, comerciales, de progreso, CRM o finanzas administrativas. | Acceso limitado por rol/relación/asignación; cifrado en tránsito y reposo del proveedor; cambios sensibles auditados; exportación restringida. |
| `Restricted` | Datos de menores, salud, safeguarding, consentimientos, recogida, credenciales, pagos, auditoría o artefactos que los contienen. | Autorización explícita, enforcement de backend/Rules, auditoría reforzada, prohibición de exposición en logs y límites estrictos de exportación, retención y acceso. |

La clasificación se aplica al dato durante todo su ciclo: captura, tránsito, almacenamiento, caché, búsqueda, logs, exportación, backup, restauración y eliminación. Un identificador se clasifica por lo que permite inferir o recuperar, no solo por su formato.

## Inventario de datos del MVP

| Dominio | Ejemplos | Sujetos | Clase | Usuarios primarios | Retención dependiente de | Tareas de enforcement |
|---|---|---|---|---|---|---|
| Contenido público de academia | Marca, descripción, programas publicados, horarios públicos, contacto comercial | Academia | `Public` | Visitantes y personal autorizado para publicar | Política editorial | `T020`, `T026` |
| Configuración operativa no personal | Plantillas de clase, salas, ubicaciones internas, parámetros no sensibles | Academia | `Internal` | Owner, administración, head coach | Necesidad operativa | `T013`, `T026` |
| Identidad de usuarios adultos | Nombre, email, teléfono, estado de cuenta, foto | Adultos, tutores, staff | `Confidential` | Propio usuario y personal autorizado | `T011` | `T014-T016`, `T021`, `T025` |
| Identidad de menores | Nombre, fecha de nacimiento, edad, foto, identificador interno | Menores | `Restricted` | Tutores vinculados y personal con propósito vigente | `T011` y safeguarding | `T016`, `T021-T023` |
| Familias y relaciones | Hogar, tutores, dependientes, relación y vigencia | Familias | `Confidential`; vínculo con menor tratado como `Restricted` en exports/logs | Tutores vinculados y administración | `T011` | `T016`, `T022` |
| Contactos de emergencia y recogida | Contacto, adulto autorizado, salida independiente, confirmación de entrega | Menores y adultos autorizados | `Restricted` | Tutores y recepción; coaches solo cuando la operación lo exige | `T011` y safeguarding | `T022`, `T030` |
| Salud y soporte | Alergias, lesiones, medicación, necesidades de apoyo, notas médicas | Estudiantes | `Restricted` | Tutor/adulto titular y personal expresamente autorizado | `T011` y obligación de cuidado | `T016`, `T023` |
| Safeguarding | Reporte de incidente, caso, personas involucradas, acciones y resolución | Menores, adultos y staff | `Restricted` | Personal expresamente autorizado; intake separado de lectura del caso | `T011` y política de safeguarding | `T019`, `T047`, `T055` |
| Consentimientos y waivers | Versión, texto aceptado, firmante, momento, revocación, evidencia | Estudiantes y tutores | `Restricted` | Titular/tutor y administración autorizada | `T011` y defensa legal | `T018`, `T024` |
| Personal y coaches | Perfil, rol, estado, disponibilidad, asignaciones, credenciales profesionales | Staff | `Confidential` | Propio staff, owner y administración limitada | `T011` y relación laboral | `T015`, `T025` |
| CRM | Enquiry, lead, contacto, fuente, notas, owner, next action, estado | Prospectos y familias | `Confidential` | Owner y personal CRM autorizado | `T011` y opt-out | `T043`, `T044` |
| Agenda y reservas | Clase, sesión, roster, booking, cancelación, elegibilidad | Estudiantes y staff | `Confidential`; plantilla sin personas puede ser `Internal` | Participante/tutor y staff asignado | `T011` y operación | `T026`, `T027` |
| Asistencia | Present, absent, no-show, puntualidad, correcciones y autor | Estudiantes | `Confidential` | Participante/tutor y staff asignado | `T011` y trazabilidad | `T028`, `T029` |
| Presencia y salida de menores | Check-in activo, ubicación operativa, estado de salida, adulto receptor | Menores | `Restricted` | Tutor, recepción y staff con responsabilidad actual | `T011` y safeguarding | `T030`, `T031`, `T049` |
| Membresías | Plan, trial, vigencia, pause, overdue, cancelación, historial | Estudiantes y familias | `Confidential` | Titular/tutor y finanzas/administración | `T011` y obligaciones comerciales | `T032`, `T033`, `T038` |
| Finanzas administrativas | Facturas, recibos, balances, pagos manuales, importe, moneda, refund | Pagadores y academia | `Confidential`; refund/aprobación e historial sensible tratados como `Restricted` | Pagador vinculado y personal financiero autorizado | `T011` y obligaciones financieras | `T037`, `T038`, `T050`, `T051` |
| Evidencia del proveedor de pagos | Customer/payment/subscription IDs, eventos, firma verificada, claves de idempotencia, payload mínimo | Pagadores | `Restricted` | Backend e integración; vistas humanas minimizadas | `T010`, `T011` y contrato del proveedor | `T034-T036` |
| Evaluaciones y progreso | Ratings, notas basadas en evidencia, checklist técnico, correcciones | Estudiantes | `Confidential`; notas de safeguarding separadas como `Restricted` | Estudiante/tutor y coaches autorizados | `T011` y política deportiva | `T039`, `T040` |
| Reconocimiento | Candidatos, explicación, revisión, aprobación del head coach | Estudiantes | `Confidential` | Estudiante/tutor y staff deportivo autorizado | `T011` y política de reconocimiento | `T041`, `T042` |
| Comunicaciones | Announcement, audiencia, mensaje, entrega, opt-out | Usuarios y prospectos | `Confidential`; comunicación sobre menores tratada como `Restricted` | Emisor autorizado y destinatarios | `T011` y proveedor elegido | `T045-T048` |
| Archivos privados | Waivers firmados, documentos, comprobantes y medios autorizados | Usuarios y academia | `Restricted` | Titular/relación y staff expresamente autorizado | `T011` y naturaleza del documento | `T024` |
| Auditoría | Actor, acción, entidad, valores mínimos necesarios, momento, resultado, motivo | Usuarios y sistema | `Restricted` | Owner/auditor autorizado; escritura solo del sistema | `T011` y obligaciones de trazabilidad | `T019` |
| Reportes y exports | Agregados, listados, CSV/PDF, paquete de acceso del titular | Según fuente | Hereda la clasificación más alta de las fuentes | Roles expresamente autorizados | `T011` y propósito del export | `T051-T053` |
| Logs y telemetría | Errores, métricas, trazas, IDs de correlación | Sistema; usuarios si se filtran datos | `Internal`; pasa a `Restricted` si contiene datos personales o secretos | Operación autorizada | `T011` y política de observabilidad | `T055`, `T057` |
| Backups y restauraciones | Snapshots, exports administrados, manifiestos de restauración | Todos los sujetos incluidos | `Restricted` | Operación autorizada bajo runbook | `T011` y recuperación | `T054` |
| Autenticación y autorización | UID, proveedor, claims, factores MFA, sesiones y revocación | Usuarios | `Restricted` | Usuario para enrolamiento; backend/admin autorizado para control | `T011` y seguridad de cuenta | `T014`, `T015`, `T017` |

### Datos prohibidos en almacenamiento de aplicación

- Número completo de tarjeta, CVV/CVC, PIN o track data.
- Contraseñas, códigos MFA reutilizables, secretos TOTP o tokens de recuperación en texto legible.
- Claves privadas, secretos de webhook, credenciales R2, service-account keys o secretos de proveedores en Firestore, RTDB, navegador, repositorio, logs o analytics.
- URLs públicas permanentes o URLs firmadas sin expiración para objetos privados.
- Copias de datos reales de producción en fixtures, capturas, videos E2E o entornos no productivos.

## Actores y fronteras de confianza

### Actores

| Actor | Condición de confianza |
|---|---|
| Visitante no autenticado | No confiable; solo puede acceder a contenido `Public` y formularios protegidos contra abuso. |
| `owner` | Rol humano de mayor alcance, no omnipotente; MFA obligatorio, acciones sensibles auditadas y secretos fuera de su interfaz normal. |
| `administrator/reception` | Operación diaria, familias, agenda, asistencia y finanzas delegadas; sin autoridad deportiva exclusiva ni acceso irrestricto a safeguarding. |
| `head coach` | Operación deportiva, evaluaciones y aprobación de reconocimiento/promoción; sin acceso innecesario a pagos o secretos. |
| `coach` | Acceso limitado a clases y estudiantes asignados, solo durante una finalidad operativa vigente. |
| `parent/guardian` | Acceso exclusivo a sí mismo y a menores con relación vigente; no puede alterar registros emitidos por staff. |
| `adult student` | Acceso exclusivo a sus propios datos y acciones de autoservicio permitidas. |
| Staff desactivado o anterior | No confiable para acceso interactivo; claims, sesiones y asignaciones deben revocarse. |
| Proveedor de pagos/email | Externo y no confiable por defecto; autenticidad, alcance, payload y reintentos deben verificarse. |
| Job o integración del sistema | Identidad técnica de mínimo privilegio; no equivale a un usuario humano y toda acción sensible debe correlacionarse. |
| Operador/CI | Acceso privilegiado excepcional bajo secretos cifrados, separación de entornos, aprobación y registro operativo. |

Los menores no son actores autenticados en el MVP. Son sujetos protegidos cuyos datos y decisiones deben permanecer bajo controles de tutor, academia y safeguarding.

### Fronteras de confianza

1. **Navegador/PWA -> Firebase Auth.** El cliente inicia autenticación, pero no decide roles, claims, estado MFA ni revocación.
2. **Navegador/PWA -> Firestore/RTDB.** Cada lectura/escritura atraviesa Rules; RTDB nunca se convierte en fuente canónica de pagos, membresías, asistencia, evaluaciones o auditoría.
3. **Navegador/PWA -> Cloud Functions.** Toda entrada se valida; Auth, App Check cuando aplique, autorización, rate limits y tamaño de payload se verifican en backend.
4. **Cloud Functions -> Firebase Admin.** El Admin SDK omite Rules; cada función debe aplicar autorización de aplicación antes de acceder a datos.
5. **Cloud Functions -> R2.** Las credenciales permanecen en secretos de servidor y cada URL firmada exige autorización actual, objeto permitido, método fijo y expiración corta.
6. **Proveedor externo -> webhook.** La red no autentica al emisor; se exige firma, timestamp, tolerancia acotada, idempotencia, orden independiente y reconciliación.
7. **CI/operador -> entornos cloud.** Producción requiere aprobación, identidad separada, permisos mínimos y secretos no expuestos en logs o artefactos.
8. **Sistema -> export/backups -> destinatario/restauración.** Una exportación conserva clasificación, propósito, destinatario y auditoría; una restauración valida entorno y autorización antes de aplicar datos.

## Modelo de amenazas

Escala inherente: `Critical` puede causar daño grave a un menor, compromiso masivo, fraude o pérdida de trazabilidad; `High` produce exposición o abuso significativo; `Medium` tiene alcance acotado o requiere condiciones adicionales; `Low` tiene impacto menor. La severidad residual es el objetivo después de implementar los controles; no afirma que ya existan.

| ID | STRIDE | Activo | Escenario | Inherente | Mitigación requerida | Residual objetivo/bloqueo | Tarea propietaria |
|---|---|---|---|---|---|---|---|
| `THR-001` | Spoofing | Cuentas y sesiones | Account takeover por credenciales reutilizadas, robo de sesión o enrolamiento MFA débil, especialmente de owner/admin. | `Critical` | Auth administrado, MFA obligatorio para owner/admin, reautenticación sensible, revocación y alertas. | `Medium`; bloquear producción sin MFA probado. | `T014`, `T017`, `T055` |
| `THR-002` | Elevation of privilege | Roles y claims | Cliente modifica rol, custom claim o usa una sesión antigua después de desactivación. | `Critical` | Claims solo desde backend privilegiado, matriz probada, revocación de tokens y estado activo verificado. | `Low`; bloquear si un rol puede autoelevarse. | `T015`, `T016`, `T025` |
| `THR-003` | Information disclosure | Familias y estudiantes | Un usuario cambia un ID, enumera rutas o consulta datos de otra familia/estudiante. | `Critical` | Autorización por relación vigente en cada query/comando, reglas negativas y tests multi-tenant/family. | `Low`; bloquear ante cualquier lectura cruzada. | `T016`, `T021`, `T022`, `T055` |
| `THR-004` | Information disclosure / Elevation | Roster, asistencia, progreso, salud | Coach consulta estudiantes no asignados o conserva acceso fuera de la clase/finalidad. | `High` | Scope por asignación y tiempo, campos médicos mínimos por necesidad, revocación al cambiar asignación. | `Medium`; el criterio médico exacto depende de `T011`. | `T016`, `T023`, `T025-T029` |
| `THR-005` | Spoofing / Tampering | Presencia y child check-out | Se falsifica check-in/out o se entrega un menor a una persona no autorizada. | `Critical` | Verificación de staff, autorización vigente, estado transaccional, evidencia del receptor, correcciones auditadas y alertas de cierre. | `Medium`; bloquear piloto sin E2E de todos los estados. | `T029-T031`, `T049`, `T055` |
| `THR-006` | Information disclosure | Salud, safeguarding, consentimientos, waivers, evaluaciones | Datos restringidos aparecen en vistas, exports, logs o archivos accesibles por roles amplios. | `Critical` | Separación de campos/documentos sensibles, mínimo privilegio, URLs privadas, redacción de logs y pruebas negativas por rol. | `Medium`; retención/residencia bloqueada por `T011`. | `T016`, `T018`, `T023`, `T024`, `T053` |
| `THR-007` | Information disclosure / Denial of service | Directorios, reportes y exports | Scraping, enumeración o exportación masiva excede la finalidad autorizada. | `High` | Queries acotadas, paginación, rate limits, permisos de export separados, propósito y auditoría. | `Medium`; límites se afinan con medición. | `T016`, `T053`, `T055` |
| `THR-008` | Spoofing / Tampering / Repudiation | Pagos y membresías | Webhook falso, repetido, duplicado o fuera de orden crea cargos, refunds o estados incorrectos. | `Critical` | Hosted checkout, firma y timestamp, idempotencia, máquina de estados, reconciliación y payload mínimo. | `Medium`; proveedor y contrato bloqueados por `T010`. | `T034-T038`, `T055` |
| `THR-009` | Tampering / Repudiation | Pagos, asistencia, membresías y evaluaciones | Staff corrige un registro sin conservar autor, motivo, antes/después o momento. | `High` | Comandos autorizados, historial inmutable, reason obligatorio y audit log append-only. | `Low` después de pruebas de alteración. | `T019`, `T029`, `T036-T039` |
| `THR-010` | Information disclosure / Repudiation | Comunicaciones con menores | Coach mantiene conversación privada u oculta con un menor o elimina evidencia. | `Critical` | Sin cuenta infantil, guardian visibility, canales por clase, historial de entrega y prohibición técnica de audiencia privada menor-coach. | `Low`; bloquear piloto si existe bypass. | `T045-T047`, `T055` |
| `THR-011` | Information disclosure | Archivos R2 | URL firmada pública, demasiado larga, reutilizable para otro método/objeto o emitida tras perder autorización. | `High` | Bucket privado, autorización por solicitud, expiración corta, método/objeto fijos, CORS mínimo y logs sin URL completa. | `Medium`; jurisdicción/retención depende de `T011`. | `T024`, `T055` |
| `THR-012` | Information disclosure / Elevation | Secretos, logs y artefactos | Credenciales o datos personales llegan a Git, consola, CI, screenshots, videos, trazas o fixtures. | `Critical` | Secret Manager, secretos cifrados de CI, `.gitignore`, escaneo de historial, redacción, datos sintéticos y rotación ante exposición. | `Low`; toda credencial expuesta exige rotación. | `T002-T006`, `T024`, `T055`, `T057` |
| `THR-013` | Tampering / Denial of service | Formularios, endpoints y uploads | Inyección, HTML peligroso, payload sobredimensionado, tipo de archivo falso o contenido malicioso. | `High` | Zod/validación server-side, límites de tamaño/tipo, nombres generados, sanitización por contexto y análisis de archivos según riesgo. | `Medium`; controles concretos por endpoint. | `T012`, `T024`, `T055` |
| `THR-014` | Denial of service | Endpoints públicos, Auth y operaciones Firebase | Bots o clientes defectuosos amplifican lecturas, SMS, Functions, emails o costos. | `High` | App Check cuando aporte, rate limits por identidad/IP, cuotas de operación, CAPTCHA en flujos públicos, presupuestos y alertas. | `Medium`; phone auth queda fuera salvo justificación. | `T014`, `T043`, `T046`, `T055`, `T057` |
| `THR-015` | Tampering / Repudiation | Audit log | Usuario o función sobrescribe, elimina o registra auditoría insuficiente para atribuir cambios. | `Critical` | Escritura solo de sistema, eventos append-only, campos mínimos obligatorios, acceso de lectura restringido y pruebas de alteración. | `Low`; bloquear si una UI puede mutar eventos. | `T019`, `T055` |
| `THR-016` | Information disclosure / Tampering | Backups y restauración | Backup queda expuesto, se restaura en entorno equivocado o se pierde integridad/rollback. | `Critical` | Cifrado y acceso mínimo, inventario, prueba de restauración en staging, validación de destino, runbook y evidencia. | `Medium`; plazos dependen de `T011`. | `T054`, `T057` |
| `THR-017` | Tampering / Elevation | Dependencias y supply chain | Paquete, script de build o Action comprometida ejecuta código o roba secretos. | `High` | Lockfile, versiones/commits fijados, allowBuilds mínimo, audit, revisión de advisories y permisos CI mínimos. | `Medium`; dos advisories moderadas permanecen monitorizadas. | `T001-T006`, `T055`, `T057` |

### Cruce con `security-baseline`

| Control mínimo | Estado de diseño | Enforcement previsto |
|---|---|---|
| Autenticación y autorización de endpoints | Deny-by-default, relación/asignación y backend para acciones sensibles. | `T014-T017`, `T034-T036`, `T045-T047` |
| Datos sensibles en respuestas, logs y consola | Minimización, clasificación heredada, redacción y prohibición de URLs/secretos. | `T016`, `T023`, `T024`, `T053`, `T055` |
| Secretos | Prohibidos en cliente, datos y repositorio; rotación si se exponen. | `T024`, `T034-T036`, `T046`, `T057` |
| `.gitignore` e historial | `.gitignore` existe; la revisión de historial y rotación sigue siendo un gate periódico. | `T001-T006`, `T055`, `T057` |
| Validación y sanitización | Toda entrada externa se valida por tipo, tamaño, estado y contexto en backend. | `T012`, `T024`, `T034-T036`, `T055` |
| Integraciones externas | Firmas, idempotencia, mínimo payload, timeouts/reintentos con criterio y aislamiento de credenciales. | `T024`, `T034-T036`, `T046` |
| Dependencias vulnerables | Audit high/critical bloqueante; moderadas registradas y revisadas. | `T001-T006`, `T055`, `T057` |
| Rate limiting y abuso | Requisito por endpoint/flujo público, con presupuesto y alertas de costo. | `T014`, `T043`, `T046`, `T055`, `T057` |

## Matriz preliminar de acceso

### Notación

Operaciones: `R` read, `C` create, `U` update/correct, `P` approve, `X` export y `D` delete/retain. Alcance: `F` dentro de toda la academia, `S` limitado por identidad, relación familiar, asignación o responsabilidad, `A` solo mediante flujo de aprobación explícito y `-` prohibido. Por ejemplo, `R/S,U/S,X/-` permite lectura/actualización acotadas y prohíbe exportar.

`D` nunca significa hard delete libre: representa ejecutar el estado, anonimización o borrado que autorice la futura política `T011`. Ningún `F` evita las excepciones de campos `Restricted`, la necesidad de propósito, la separación de funciones ni la auditoría.

| Dominio | `owner` | `administrator/reception` | `head coach` | `coach` | `parent/guardian` | `adult student` | `system/integration` |
|---|---|---|---|---|---|---|---|
| Identidad y cuentas adultas | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,U/S,P/-,X/-,D/-` | `R/S,U/S,P/-,X/-,D/-` | `R/S,U/S,P/-,X/S,D/-` | `R/S,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Roles, claims y MFA | `R/F,C/-,U/-,P/A,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/F,C/A,U/A,P/-,X/-,D/A` |
| Familias y vínculos de tutela | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/F,C/S,U/S,P/A,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/-,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Perfil de menor | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/F,C/S,U/S,P/A,X/-,D/-` | `R/S,C/-,U/S,P/-,X/-,D/-` | `R/S,C/-,U/S,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Salud y necesidades de apoyo | `R/S,C/-,U/-,P/-,X/A,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,C/-,U/S,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Safeguarding y casos | `R/A,C/S,U/A,P/A,X/A,D/-` | `R/S,C/S,U/-,P/-,X/-,D/-` | `R/S,C/S,U/-,P/-,X/-,D/-` | `R/-,C/S,U/-,P/-,X/-,D/-` | `R/-,C/S,U/-,P/-,X/-,D/-` | `R/-,C/S,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/-` |
| Contactos y child check-out | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/F,C/S,U/S,P/A,X/-,D/-` | `R/S,C/S,U/S,P/S,X/-,D/-` | `R/S,C/S,U/S,P/S,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Staff, disponibilidad y asignaciones | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,C/S,U/S,P/S,X/-,D/-` | `R/S,C/-,U/S,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Programas, clases y sesiones | `R/F,C/F,U/F,P/A,X/A,D/A` | `R/F,C/F,U/F,P/S,X/-,D/A` | `R/F,C/F,U/F,P/S,X/-,D/A` | `R/S,C/-,U/S,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Bookings y roster | `R/F,C/S,U/S,P/A,X/A,D/-` | `R/F,C/S,U/S,P/S,X/-,D/-` | `R/S,C/S,U/S,P/S,X/-,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Asistencia y puntualidad | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/F,C/S,U/A,P/A,X/-,D/-` | `R/S,C/S,U/A,P/A,X/S,D/-` | `R/S,C/S,U/A,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/S,D/-` | `R/S,C/-,U/-,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/-` |
| Membresías | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/F,C/S,U/S,P/A,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Pagos, facturas, balances y refunds | `R/F,C/A,U/A,P/A,X/A,D/-` | `R/F,C/S,U/A,P/A,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/S,U/-,P/-,X/S,D/-` | `R/S,C/S,U/-,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/-` |
| Evidencia del proveedor de pagos | `R/A,C/-,U/-,P/-,X/A,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/-` |
| Consentimientos y waivers | `R/F,C/-,U/-,P/A,X/A,D/-` | `R/F,C/S,U/A,P/A,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/S,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Evaluaciones y progreso | `R/F,C/-,U/-,P/-,X/A,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/F,C/S,U/A,P/A,X/S,D/-` | `R/S,C/S,U/A,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/S,D/-` | `R/S,C/-,U/-,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/-` |
| Reconocimiento y promociones | `R/F,C/-,U/-,P/-,X/A,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/F,C/S,U/S,P/A,X/S,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,C/-,U/-,P/-,X/S,D/-` | `R/S,C/-,U/-,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/-` |
| CRM | `R/F,C/F,U/F,P/A,X/A,D/-` | `R/F,C/S,U/S,P/S,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Comunicaciones e historial de entrega | `R/F,C/F,U/S,P/A,X/A,D/-` | `R/F,C/S,U/S,P/S,X/-,D/-` | `R/S,C/S,U/S,P/S,X/-,D/-` | `R/S,C/S,U/S,P/-,X/-,D/-` | `R/S,C/-,U/S,P/-,X/S,D/-` | `R/S,C/-,U/S,P/-,X/S,D/-` | `R/S,C/A,U/A,P/-,X/-,D/A` |
| Archivos privados R2 | `R/S,C/A,U/-,P/A,X/A,D/-` | `R/S,C/S,U/-,P/A,X/-,D/-` | `R/S,C/S,U/-,P/-,X/-,D/-` | `R/S,C/S,U/-,P/-,X/-,D/-` | `R/S,C/S,U/-,P/-,X/S,D/-` | `R/S,C/S,U/-,P/-,X/S,D/-` | `R/S,C/A,U/-,P/-,X/-,D/A` |
| Audit log | `R/A,C/-,U/-,P/-,X/A,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/F,U/-,P/-,X/-,D/-` |
| Logs y telemetría | `R/A,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/S,C/F,U/-,P/-,X/-,D/A` |
| Reportes y exports | `R/F,C/A,U/-,P/A,X/A,D/-` | `R/S,C/A,U/-,P/-,X/A,D/-` | `R/S,C/A,U/-,P/-,X/A,D/-` | `R/S,C/-,U/-,P/-,X/-,D/-` | `R/S,C/A,U/-,P/-,X/S,D/-` | `R/S,C/A,U/-,P/-,X/S,D/-` | `R/S,C/A,U/-,P/-,X/-,D/A` |
| Backups y restauración | `R/A,C/-,U/-,P/A,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/-,C/-,U/-,P/-,X/-,D/-` | `R/A,C/A,U/-,P/-,X/-,D/A` |

Restricciones prevalentes:

- `coach` no accede a pagos, CRM, audit logs, backups, exports masivos ni expedientes médicos/safeguarding completos. Su acceso operativo siempre queda limitado a estudiantes y clases asignados.
- `parent/guardian` solo accede a sí mismo y a menores con vínculo vigente. Puede solicitar correcciones, pero no sobrescribir asistencia, evaluaciones o decisiones de staff.
- `adult student` solo accede a sí mismo y no puede usar IDs ajenos para ampliar alcance.
- `administrator/reception` no aprueba belts, stripes ni reconocimiento reservado al `head coach`.
- `head coach` no obtiene secretos financieros ni acceso general a pagos por su rol deportivo.
- `owner` tampoco recibe secretos en interfaces normales ni puede alterar audit logs; las acciones privilegiadas conservan aprobación y trazabilidad.
- `system/integration` no es un bypass universal: cada identidad técnica tiene alcance mínimo y no actúa como humano aprobador.
- Staff desactivado pierde inmediatamente acceso interactivo, asignaciones efectivas y sesiones/claims vigentes.
- Toda comunicación relativa a un menor mantiene visibilidad del tutor; no existe audiencia privada menor-coach.

## Controles transversales obligatorios

1. **Autenticación:** email/password y Google inicialmente; MFA obligatorio para `owner` y `administrator/reception`; phone auth solo si se justifica costo y abuso.
2. **Autorización:** roles/claims emitidos por backend, estado activo verificado, relación familiar/asignación comprobada y Rules default-deny.
3. **Validación:** esquemas server-side, límites de tamaño, estados válidos y rechazo de campos no permitidos. Ningún importe, rol, destinatario o autorización sensible se toma del cliente sin recomputar/verificar.
4. **Auditoría:** eventos append-only con actor, acción, entidad, propósito, resultado y correlación; no copiar secretos ni payloads completos innecesarios.
5. **Exports:** permiso separado, propósito, filtros mínimos, clasificación heredada, generación backend, expiración, destinatario y evento de auditoría.
6. **Archivos:** R2 privado, credenciales server-side, autorización por solicitud, URLs firmadas cortas, método/objeto fijos, tipo/tamaño permitidos y CORS mínimo.
7. **Integraciones:** firma/timestamp, idempotencia, reconciliación, retries acotados, timeouts, payload mínimo y secretos rotables.
8. **Abuso y costo:** rate limits, paginación, límites de query/payload, App Check/CAPTCHA cuando aporten, presupuestos y alertas antes de staging.
9. **Privacidad operativa:** redacción de logs, datos sintéticos, artefactos E2E sin datos reales, cachés controladas y ausencia de analytics sobre campos `Restricted`.
10. **Continuidad:** backups restringidos, restauración probada en staging, destino validado y rollback documentado.
11. **Dependencias/CI:** lockfile, scripts de build mínimos, Actions fijadas, permisos CI reducidos, audit y registro visible de riesgos aceptados.
12. **Desactivación:** revocar sesiones/claims y asignaciones cuando cambia o termina la relación de staff, tutor o usuario.

## Riesgos y decisiones abiertas

| ID | Decisión/riesgo | Estado | Consecuencia actual |
|---|---|---|---|
| `OPEN-001` | Programas, ubicaciones, horarios, capacidad, precios y reglas de membership (`T008`). | Bloqueado por academia/operador. | Impide cerrar elegibilidad, roster, membresías y parte del acceso operativo por programa. |
| `OPEN-002` | Criterios y ponderaciones de evaluación/reconocimiento (`T009`). | Bloqueado por head coach. | Impide fijar campos mínimos, revisores y reglas de aprobación deportiva. |
| `OPEN-003` | Proveedor de pagos para Jersey (`T010`). | Bloqueado por selección externa. | Impide verificar firma, payload, residencia, retención, costos y capacidades concretas de webhook/checkout. |
| `OPEN-004` | Retención, residencia, acceso y borrado aplicable a Jersey (`T011`). | Bloqueado por asesoría aplicable. | Impide fijar plazos, anonimización/borrado y jurisdicción final de Firestore, R2, proveedores y backups. |
| `OPEN-005` | Necesidad de acceso médico por coaches. | Preliminar: solo mínimo operacional por asignación. | Debe validarse con safeguarding y `T011`; no autoriza expedientes completos. |
| `OPEN-006` | Rol de auditor independiente. | Fuera de roles iniciales. | Hasta definirlo, lectura de audit logs exige aprobación y queda limitada al owner/operación autorizada. |

Ninguna decisión abierta autoriza relajar los controles de este documento. Si una decisión externa exige una tensión real entre obligación operativa y mínimo privilegio, se escala al operador y se actualiza este modelo antes de implementar.

## Trazabilidad a tareas

| Control | Tareas |
|---|---|
| Contratos, errores y validación base | `T012` |
| Modelo de datos, índices, invariantes, migraciones y rollback | `T013` |
| Auth y revocación | `T014` |
| Roles, claims, mínimo privilegio y desactivación | `T015`, `T025` |
| Rules y aislamiento por rol/familia/asignación | `T016` |
| MFA owner/admin | `T017` |
| Consentimiento versionado | `T018` |
| Audit log append-only | `T019` |
| Datos médicos/restringidos | `T023` |
| Archivos privados y URLs firmadas R2 | `T024` |
| Correcciones de asistencia y child check-out | `T029`, `T030`, `T031` |
| Adaptador, checkout y webhooks de pago | `T034`, `T035`, `T036` |
| Safeguarding en comunicaciones | `T045`, `T046`, `T047` |
| Exportación autorizada y auditable | `T053` |
| Backups, restauración y rollback | `T054` |
| QA de seguridad, contratos, carga, accesibilidad y E2E por rol | `T055` |
| Gates, monitoreo, costo y producción | `T057`, `T058` |

## Criterio de revisión

`T007` puede pasar a `revisión` cuando:

- Los cuatro niveles tienen reglas de manejo y todos los dominios del MVP están clasificados.
- Los siete actores de la matriz tienen límites de lectura, creación, actualización, aprobación, exportación y retención.
- Menores, salud, pagos, consentimientos, safeguarding, credenciales, archivos, audit logs y backups tienen controles reforzados y reglas negativas.
- Cada amenaza `Critical` posee mitigación concreta o una tarea bloqueante explícita.
- El cruce con `security-baseline` no deja endpoints, secretos, logs, validación, dependencias o abuso sin tarea propietaria.
- Las decisiones legales/externas se mantienen como supuestos y no como afirmaciones de cumplimiento.
- No existen contradicciones entre la matriz, los principios, las prohibiciones del `BRIEF.md` y la trazabilidad a `tasks.md`.

La aprobación final de `T007` requiere revisión del operador. Este documento deberá actualizarse si `T008-T011` cambian un supuesto de clasificación, propósito o acceso.
