# DPIA — Evaluación de impacto en protección de datos (BORRADOR)

**Estado: borrador sin aprobar. No es asesoría legal ni una certificación de cumplimiento.**
**Fecha:** 2026-09-06 · **Redactado por:** el asistente, a partir del código y de los documentos de
T011 · **Aprueba:** el controller (Vladimiro "Miro" Afonso) · **Revisor independiente:** ninguno,
por decisión expresa del operador del 2026-09-06.

Este documento cierra el único criterio de T011 que es analítico y no decisional. De los otros dos,
las diez decisiones se firmaron el 2026-09-07 (acta `t011-controller-approval-acta-draft.md`, firma
por poder: Andres Santiago, p.p. Vladimiro Afonso, sobre la instrucción del operador de esa fecha).
De la razón social completa, el 2026-09-07 el operador declaró la forma jurídica —entidad no
incorporada (sole trader / asociación sin registrar)—, con lo que el número de registro queda
cerrado por inexistencia, y ese mismo día aportó el domicilio: `Office 9, 13 Library Place, St Helier`.
Sigue abierta **la precisión de cuál de las dos formas es**, y con ella si el controller es una
persona física que comercia bajo ese nombre: es un dato del controller y este borrador no lo
suple.

**Qué NO hace este documento:** no abre producción, no autoriza datos reales, no decide una base
legal, no aprueba una transferencia y no sustituye la consulta a la JOIC si el riesgo residual sigue
siendo alto. Un valor que aquí aparezca como propuesta es una propuesta.

---

## 1. Por qué esta evaluación es obligatoria

No es una formalidad. El proyecto combina, en un mismo sistema, cinco factores que la guía de la
JOIC señala por separado como indicadores de riesgo alto:

1. **Menores de edad** como titulares principales, con datos aportados por un tutor.
2. **Datos de salud y apoyo**: `HealthProfile` con códigos de apoyo operativo mínimo y estados de
   revisión (`packages/domain/src/health/health-contracts.ts`), aunque el MVP prohíba el dato de
   salud salvo caso de uso aprobado.
3. **Datos financieros**: planes, cuotas, facturas, pagos y penalizaciones.
4. **Control de acceso y asistencia**, incluida geolocalización: `location.geofence.saved`,
   `attendance.proximity_override` y el geocercado por sede son monitorización de presencia física
   de menores.
5. **Datos reales ya importados**: 249 registros de miembros reales de Regyfit están en el proyecto
   de producción `bptjersey-f5a25` desde el 2026-09-04, y 243 fichas más desde la importación PDF
   del 2026-08-12.

El quinto punto es el que cambia la naturaleza del ejercicio: **esto no es una evaluación previa a
un tratamiento hipotético.** Ya hay tratamiento de datos personales reales de menores en
producción. La evaluación llega tarde y debe leerse así.

---

## 2. Inventario de tratamiento, derivado del código

Cada fila se comprobó contra los contratos del dominio, no contra la memoria.

| Categoría                          | Dónde vive                                         | Sensibilidad declarada | Titulares         |
| ---------------------------------- | -------------------------------------------------- | ---------------------- | ----------------- |
| Identidad del estudiante           | `students/{id}`                                    | General                | Adultos y menores |
| Perfil administrativo              | `studentAdminProfiles/{id}`                        | Confidencial           | Adultos y menores |
| Contacto de emergencia y dirección | dentro del perfil administrativo                   | Confidencial           | Adultos y menores |
| Documento de cliente               | `users/{uid}`                                      | General                | Adultos           |
| Familias y parentesco              | `families`, `familyRelationships`                  | General                | Tutor y menores   |
| Solicitudes de inscripción         | `enrolmentRequests`, `enrolmentRequestHolds`       | Confidencial           | Adultos y menores |
| Asistencia y presencia             | asistencia, geocercas, anulaciones por proximidad  | Confidencial           | Adultos y menores |
| Progresión y evaluaciones          | niveles, promociones, bajas médicas                | Confidencial           | Adultos y menores |
| Salud y apoyo                      | perfiles y cambios de `HealthProfile`              | **Categoría especial** | Adultos y menores |
| Finanzas                           | membresías, facturas, pagos, penalizaciones        | Confidencial           | Adultos y tutores |
| Consentimientos y waivers          | waivers, disclaimers, evidencias                   | Confidencial           | Adultos y tutores |
| Personal                           | `staff`, permisos, disponibilidad                  | Confidencial           | Empleados         |
| Auditoría                          | `auditEvents`                                      | Metadatos              | Todos             |
| **Importación Regyfit**            | `regyfitMemberRecords`, `regyfitAccessRecords`     | **Ver §4.1**           | Adultos y menores |
| Claves de identidad                | `studentIdentityKeys` (HMAC-SHA256, no reversible) | Seudonimizado          | Adultos y menores |

---

## 3. Mitigaciones que el sistema ya tiene

Se listan porque son reales y verificables, no porque basten.

- **Aislamiento por inquilino por ruta.** Todo cuelga de `academies/{academyId}/…` y el `academyId`
  sale del claim, nunca del payload.
- **Denegación por defecto en Rules**, con una prueba que la fija (`qa/rules/default-deny.test.ts`,
  92/92 el 2026-09-06). Ninguna colección sensible es alcanzable desde un cliente.
- **App Check obligatorio** en los callables, y en el camino canónico verificado además dentro del
  handler y no solo en las opciones.
- **Proyecciones separadas por superficie.** Una cola o un listado nunca llevan fecha de nacimiento,
  dirección ni contacto de emergencia; el detalle Confidencial se lee de uno en uno.
- **Lectura restringida con propósito declarado, evento de auditoría y presupuesto** de 20 lecturas
  cada 5 minutos por actor, para `member.detail.read`, `member.identity.lookup` y
  `enrolment.request.detail.read`.
- **Sonda de vitalidad**: el camino canónico revalida contra Auth y el documento de staff que la
  cuenta sigue activa, de modo que un administrador revocado no escribe con un token aún no
  expirado.
- **Identificadores seudonimizados**: los números de socio, documento e IVA se reservan como claves
  HMAC, no como valores en claro.
- **Auditoría que no repite el valor**: los eventos de lectura restringida apuntan al contador del
  lector, nunca al dato leído.

---

## 4. Riesgos residuales

Ordenados por gravedad. Ninguno tiene todavía una decisión del controller.

### 4.1 Contraseñas de miembros reales almacenadas en claro — **ALTO (aceptado por decisión)**

`packages/domain/src/members/regyfit-member-record-contracts.ts:65` define
`password: canonicalText(64).optional()` dentro del bloque de acceso del registro Regyfit, y
`getRegyfitMemberRecord` (`apps/functions/src/regyfit/member-records.ts:105-120`) **devuelve el
registro completo**, contraseña incluida, a cualquier claim de administrador. Los 249 registros
importados a producción el 2026-09-04 son de personas reales, entre ellas menores.

Comparado con el directorio canónico, a esta lectura le faltan tres controles que allí sí existen:

| Control                         | `getMemberDetail` | `getRegyfitMemberRecord` |
| ------------------------------- | ----------------- | ------------------------ |
| Propósito declarado             | sí                | **no**                   |
| Evento de auditoría por lectura | sí                | **no**                   |
| Límite de lecturas por actor    | sí                | **no**                   |
| Sonda de vitalidad del actor    | sí                | **no**                   |

Consecuencias que hay que decir sin rodeos: nadie puede saber después quién leyó una contraseña,
porque no queda rastro; un administrador revocado la sigue leyendo mientras su token no expire; y
como la gente reutiliza contraseñas, el alcance del daño no se limita a Regyfit.

**Decisión del controller, tomada el 2026-09-07: opción (c).** De las tres opciones planteadas —(a)
borrar el campo de los registros importados y del contrato; (b) conservarlo fuera de la proyección de
detalle, tras un camino restringido con propósito y auditoría; (c) conservarlo como está,
documentando la aceptación del riesgo— el controller elige la tercera. Razón dada: son datos reales
que la operación necesita para usar y hacer el seguimiento de la ficha, el administrador ya tiene
permiso de uso, y esa es la razón por la que se migra lo real.

Lo que la aceptación cubre, enumerado para que signifique algo: el campo sigue en claro en los 249
registros de producción; `getRegyfitMemberRecord` sigue devolviéndolo a cualquier claim de
administrador y `member-profile-panel.tsx:92` sigue imprimiéndolo como una fila más de la ficha; y
los cuatro controles de la tabla anterior siguen ausentes, de modo que una lectura de contraseña no
deja rastro y un administrador revocado la sigue leyendo mientras su token no expire.

Aceptar un riesgo no lo reduce: **este apartado sigue siendo ALTO** y sigue contando como tal en el
§5. Lo que cambia es que ya no está sin decidir. La aceptación quedó registrada en la sección 3.1 del
acta (`t011-controller-approval-acta-draft.md`), **firmada el 2026-09-07 por poder**: Andres
Santiago, p.p. Vladimiro Afonso, sobre la instrucción del operador de esa fecha. Es una atestación
tipeada, no la firma de puño del controller; la autorización escrita del propio Vladimiro no consta
como documento aparte. Que él firme el mismo archivo en su nombre mejoraría la evidencia sin cambiar
la decisión.

Tres precisiones que se anotaron al decidir, verificadas contra el código y no contra la memoria:

- El seguimiento de uso lo dan `login`, `logins` y `lastLogin`. `password` no lo lee ningún camino
  del sistema: solo se imprime en la ficha.
- La proyección de listado no lo lleva (`toRegyfitMemberDirectoryRow`); solo el detalle lo expone.
- `regyfitMemberRecords` no está en `TENANT_BACKUP_COLLECTIONS` y `assertSafeData` rechaza cualquier
  documento con una clave que case `password`: no hay copias que purgar, pero esa colección tampoco
  puede entrar al backup mientras el campo exista.

**Dos cifras que esta evaluación no tiene y debería tener:** cuántos de los 249 registros traen un
`password` no vacío —el campo es `.optional()`— y cuántos titulares son menores. La frase "entre
ellas menores" de este documento es una inferencia a partir de `birthDate` y del tipo de academia, no
un recuento. Ambas se obtienen con una lectura, sin borrar nada, y precisan el alcance de lo que se
acaba de aceptar.

### 4.2 T011 aprobada como borrador, y bloqueando — **ALTO**

La política de retención, residencia y borrado está aprobada como _borrador con valores
propuestos_. Ninguno de los doce plazos está implementado en el sistema: no hay proceso de borrado
al vencimiento, ni tratamiento de retención legal, ni purga de copias. Es decir, hoy el principio de
limitación del plazo de conservación no se cumple para ningún dato real que ya está almacenado.

### 4.3 Sin revisor independiente — **ALTO (aceptado por decisión)**

Por decisión del operador del 2026-09-06 no se contrata revisión independiente. Se retira el control
que separaba decidir de verificar: quien firma las decisiones es el mismo que las toma. Este
borrador tampoco es una revisión independiente, y la ausencia se hace más pesada precisamente porque
hay hallazgos como el §4.1.

### 4.4 Sin registro JOIC y sin exención citada — **MEDIO/ALTO**

El operador determinó el 2026-09-06 que no procede registrarse. La exención concreta en que se apoya
no consta. Mientras no se cite, es una decisión, no evidencia.

### 4.5 Sin contrato de encargado con ningún proveedor — **MEDIO/ALTO**

No hay DPA firmado con Google/Firebase ni con Cloudflare, pese a que ambos ya tratan datos reales.
La guía de la JOIC exige contrato escrito con instrucciones, confidencialidad, seguridad,
subencargados, asistencia en derechos y brechas, y devolución o borrado al terminar.

### 4.6 Firebase Auth sin región seleccionable — **MEDIO**

El mapa de regiones propone "ninguna transferencia fuera de UK/EEA", pero Firebase Auth no permite
elegir región y necesita una evaluación real. Afecta a correo, nombre y teléfono de todas las
cuentas, incluidas las de tutores de menores.

### 4.7 Secretos placeholder en producción — **RESUELTO el 2026-09-07**

**Resuelto el 2026-09-07:** los tres secretos (`MEMBER_DIRECTORY_IDENTITY_KEY_SECRET`,
`MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET`, `MEMBER_DIRECTORY_CURSOR_SECRET`) tienen ya una
versión 2 con material aleatorio de 48 bytes, generado sin pasar por chat, git ni logs. No hubo
migración que hacer: cada secreto tenía una sola versión, la del placeholder, y los callables que los
usan nunca se habían desplegado, así que en producción no existía ninguna clave derivada del valor
antiguo. Lo que sigue es el registro de por qué esto era un riesgo. Los tres secretos del directorio
canónico valían `placeholder-not-configured` en `bptjersey-f5a25`.
Fallan cerrado, comprobado (19 bytes decodificados frente a los 32 exigidos), así que no derivan
claves de una cadena pública: el servicio lanza al construirse. El riesgo no es de exposición sino
de disponibilidad, y bloquea cualquier despliegue del camino que liga ficha y cuenta.

### 4.8 Ausencia de operativa de derechos y brechas — **MEDIO**

No existe procedimiento documentado de acceso, rectificación, supresión o limitación, ni de triaje
de brecha con evaluación en 72 horas, ni de cómo se acredita la autoridad del tutor sobre el menor.
El sistema tiene la trazabilidad para soportarlos; la operativa no está escrita.

---

## 5. Riesgo residual y consulta a la JOIC

Con §4.1, §4.2 y §4.3 a la vez —credenciales en claro sin auditoría de lectura, sin plazos de
conservación implementados y sin contraparte que verifique— **el riesgo residual de este borrador es
alto.** La decisión del 2026-09-07 sobre §4.1 no lo baja: acepta el riesgo, no lo mitiga, y el
control técnico que faltaba sigue faltando. Se dice aquí porque un lector podría leer "decidido" como
"resuelto".

La guía consultada dice que, si tras las mitigaciones sigue habiendo riesgo alto probable, hay que
consultar a la JOIC **antes** de tratar. Aquí el tratamiento ya empezó, así que la pregunta al
controller no es si consultar antes, sino si procede notificar ahora y con qué alcance.

**Esta es una recomendación técnica, no una determinación legal.** Quien decide es el controller.

---

## 6. Qué hace falta para que esto deje de ser un borrador

1. ~~Decisión del controller sobre §4.1~~ — tomada el 2026-09-07 (opción (c), aceptación del
   riesgo), registrada en la sección 3.1 del acta y firmada allí el mismo día.
2. Razón social completa. Casi resuelta el 2026-09-07: forma jurídica declarada por el
   operador como **entidad no incorporada** (sole trader / asociación sin registrar), número de
   registro cerrado **por inexistencia** —no queda en blanco: no hay registro que citar— y domicilio
   aportado el mismo día, `Office 9, 13 Library Place, St Helier`. **Sigue abierta la precisión de cuál de
   las dos formas es**, porque un sole trader es una persona física y una asociación no lo es. Ese resto **dejó de ser criterio de cierre de T011
   el 2026-09-07, cuando T011 se cerró, y pasó a T126**, que es donde bloquea de verdad: cualquier
   contrato de encargado (punto 5), porque un DPA tiene que nombrar a quien responde con exactitud,
   cualquier póliza y el texto legal publicado de T117. No bloquea ninguna release.
3. ~~Las diez decisiones firmadas del acta~~ — firmadas el 2026-09-07 por poder (Andres Santiago,
   p.p. Vladimiro Afonso), con las once filas aceptadas sin enmiendas, los doce plazos confirmados y
   el mapa de regiones confirmado. La firma autoriza construir los plazos; ninguno existe todavía,
   que es exactamente lo que mide §4.2.
4. Base legal por actividad y condición de categoría especial para salud/apoyo.
5. Inventario de encargados con contrato firmado.
6. Evaluación de transferencia real para Firebase Auth.
7. Procedimiento de derechos y de brechas.
8. Determinación sobre la consulta o notificación a la JOIC.

Los puntos 2, 3 y 8 no los puede redactar el asistente. Los demás sí, en cuanto el controller decida
la dirección.
