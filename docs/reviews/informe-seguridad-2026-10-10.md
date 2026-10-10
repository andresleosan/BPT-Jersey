# Informe de remediación de seguridad

**Proyecto:** BPT Jersey

**Fecha de cierre:** 10 de octubre de 2026

**Commit de remediación:** `37d64794fcba5458e3f4415429f44233d32e9166`

**Alcance:** aplicación web Next.js/React, Firebase Callable Functions y dependencias usadas por la importación de miembros desde PDF.

## Resumen ejecutivo

La revisión identificó cuatro hallazgos: dos de severidad alta relacionados con autorización y repetición de solicitudes, uno alto relacionado con un parser PDF obsoleto y uno medio relacionado con la política de seguridad de contenido del sitio web. Los cuatro fueron corregidos, probados y publicados.

No se encontró evidencia de explotación, acceso indebido ni exposición de secretos durante esta revisión. Esa ausencia de evidencia no equivale a una investigación forense; el trabajo evaluó el código, sus dependencias, las pruebas relevantes y el estado del despliegue.

| ID | Hallazgo | Severidad inicial | Estado | Exposición actual |
| --- | --- | --- | --- | --- |
| SEC-01 | Callables privilegiados podían confiar en claims antiguos del token | Alta | Resuelto y desplegado | Cerrada |
| SEC-02 | Tokens App Check consumidos no se rechazaban de forma centralizada | Alta | Resuelto y desplegado | Cerrada |
| SEC-03 | Parser PDF obsoleto con una versión antigua integrada de PDF.js | Alta | Resuelto y desplegado | Cerrada |
| SEC-04 | CSP web incompleta y permiso amplio para scripts inline | Media | Resuelto y desplegado | Cerrada |

**Estado total del alcance revisado:** 0 hallazgos críticos abiertos, 0 altos abiertos, 0 medios abiertos y 0 bajos abiertos. Permanecen observaciones operativas que se detallan al final y que no reabren los cuatro hallazgos.

## SEC-01 — Validación insuficiente de la autoridad vigente

**Severidad inicial:** Alta

**Estado:** Resuelto y desplegado

### Hallazgo

Algunos callables administrativos validaban la identidad y los roles incluidos en el token presentado por el cliente, pero no todos volvían a consultar el estado actual del usuario en Firebase Auth antes de ejecutar la operación. Un token todavía vigente podía conservar claims anteriores durante un intervalo después de deshabilitar al usuario, revocar su sesión, cambiar su academia o retirarle el rol.

El riesgo afectaba operaciones de administración de planes, disclaimers, tienda y CRM. El impacto potencial era que una identidad con autoridad retirada siguiera ejecutando acciones privilegiadas hasta que su token dejara de ser aceptado.

### Resolución aplicada

Se centralizó la validación en [`office-actor.ts`](../../apps/functions/src/auth/office-actor.ts#L12-L57):

1. Se obtiene el usuario vigente desde Firebase Auth mediante `getUser`.
2. Se verifica que la sesión continúe activa y no haya sido revocada.
3. Se rechazan usuarios deshabilitados.
4. Se comparan los claims vigentes de `academyId` y `role` con el actor autenticado.
5. Para los flujos de oficina se permiten únicamente `owner` y `administrator`.
6. Los wrappers detienen la ejecución antes de entrar al handler si falla cualquier control.

Los wrappers se aplicaron a los callables de planes, disclaimers, tienda y CRM. Algunos ejemplos están en [`plan-callables.ts`](../../apps/functions/src/memberships/plan-callables.ts#L302-L314), [`disclaimer-callables.ts`](../../apps/functions/src/consents/disclaimer-callables.ts#L204-L214), [`shop-callables.ts`](../../apps/functions/src/shop/shop-callables.ts#L384-L411) y [`crm-callables.ts`](../../apps/functions/src/crm/crm-callables.ts#L177-L189).

### Verificación

Las pruebas de [`office-actor.test.ts`](../../apps/functions/src/auth/office-actor.test.ts#L18-L86) cubren propietarios y administradores activos, cuentas deshabilitadas, roles retirados, academia diferente, claims ausentes y el bloqueo del handler cuando la autoridad vigente ya no coincide.

## SEC-02 — Repetición de tokens App Check ya consumidos

**Severidad inicial:** Alta

**Estado:** Resuelto y desplegado

### Hallazgo

Los callables sensibles tenían `enforceAppCheck` y, en las mutaciones revisadas, `consumeAppCheckToken: true`. Sin embargo, consumir el token permite a Firebase marcar una repetición mediante `request.app.alreadyConsumed`; el handler todavía debe rechazar expresamente ese estado. El uso directo de `onCall` no imponía esa decisión de manera uniforme.

Una solicitud válida capturada y repetida podía alcanzar nuevamente una operación de escritura. El impacto potencial incluía duplicar o repetir acciones financieras, reservas, asistencia, cambios de programación, restauraciones, permisos u otras mutaciones, sujeto a los demás controles e invariantes de cada handler.

### Resolución aplicada

Se creó el wrapper central [`onCallWithFreshAppCheck`](../../apps/functions/src/auth/app-check.ts#L9-L25), que:

1. Rechaza solicitudes sin un contexto App Check verificado.
2. Rechaza tokens marcados como `alreadyConsumed`.
3. Impide construir el wrapper si la opción `consumeAppCheckToken` no está activa.
4. Solo ejecuta el handler cuando el token es válido y fresco.

El wrapper se aplicó a las mutaciones revisadas de finanzas, horarios, reservas, grupos, listas de espera, asistencia, ubicaciones, programas, perfiles, copias de seguridad y permisos de personal. Ejemplos representativos pueden verse en [`finance-callables.ts`](../../apps/functions/src/finance/finance-callables.ts#L544-L582), [`schedule-callables.ts`](../../apps/functions/src/schedule/schedule-callables.ts#L1725-L1922), [`backup-callables.ts`](../../apps/functions/src/data/backup-callables.ts#L100-L114) y [`permission-grant-callables.ts`](../../apps/functions/src/staff/permission-grant-callables.ts#L159-L183).

Esta protección complementa la autorización, las transacciones y la idempotencia de cada dominio; no las sustituye. Tampoco modifica la política de reservas ADR-018.

### Verificación

Las pruebas de [`app-check.test.ts`](../../apps/functions/src/auth/app-check.test.ts#L7-L29) confirman el rechazo de contexto ausente, token repetido y configuración sin consumo, además de aceptar un token fresco una sola vez.

## SEC-03 — Parser PDF obsoleto

**Severidad inicial:** Alta

**Estado:** Resuelto y desplegado

### Hallazgo

La importación de miembros usaba `pdf-parse@1.1.1`, publicado con PDF.js `v1.10.100` como versión integrada predeterminada. Esa rama de PDF.js está dentro del rango afectado por [CVE-2024-4367 / GHSA-wgrm-67xf-hhpq](https://github.com/advisories/GHSA-wgrm-67xf-hhpq), una vulnerabilidad de severidad alta asociada a la apertura de PDF malicioso cuando la evaluación dinámica está habilitada.

El proyecto procesa contenido PDF no confiable en el backend. Mantener una versión antigua y empaquetada del motor reducía la capacidad de aplicar parches y aumentaba el riesgo frente a documentos manipulados.

### Resolución aplicada

Se eliminó `pdf-parse@1.1.1` y se fijó `pdfjs-dist@6.2.108` en [`apps/functions/package.json`](../../apps/functions/package.json#L17-L26) y en el lockfile. La extracción se trasladó a un módulo compartido y explícito, [`member-pdf-extractor.ts`](../../apps/functions/src/members/member-pdf-extractor.ts#L10-L47), que:

1. Usa recursos CMap, fuentes estándar y WASM locales.
2. Activa `stopAtErrors` para rechazar documentos dañados.
3. Valida que las coordenadas extraídas sean números finitos.
4. Destruye siempre la tarea de carga en `finally`.
5. Copia los bytes antes del parseo para conservar intacta la fuente que después se vincula mediante hash.

La versión instalada también se comprobó contra la alerta posterior [CVE-2026-16633 / GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j): el rango vulnerable es `>=5.6.83, <6.2.108` y la versión corregida es exactamente `6.2.108`. Por tanto, la versión desplegada no está dentro de ese rango.

### Verificación

Las pruebas de [`member-pdf-extractor.test.ts`](../../apps/functions/src/members/member-pdf-extractor.test.ts#L8-L30) usan datos sintéticos para confirmar la extracción multipágina, la conservación del hash de origen y el rechazo de un PDF malformado. No se utilizaron documentos ni datos reales de miembros.

## SEC-04 — Política CSP incompleta

**Severidad inicial:** Media

**Estado:** Resuelto y desplegado

### Hallazgo

La cabecera CSP anterior solo restringía `frame-ancestors`, `base-uri` y `object-src`. No definía una política por defecto ni limitaba adecuadamente scripts, formularios, conexiones, marcos, trabajadores, imágenes, fuentes y otros recursos. Una CSP parcial ofrecía menos contención ante un posible XSS o una carga de recursos no prevista.

### Resolución aplicada

Se añadió una política base completa en [`apps/web/public/_headers`](../../apps/web/public/_headers#L3-L7), incluyendo `default-src`, `base-uri`, `object-src`, `frame-ancestors`, `form-action`, `script-src`, `script-src-attr`, `connect-src`, `frame-src`, `worker-src` y `upgrade-insecure-requests`, junto con `nosniff`, protección de framing y política de referente.

El archivo fuente conserva temporalmente `script-src 'unsafe-inline'` como marcador compatible con la exportación estática. El paso `postbuild` definido en [`apps/web/package.json`](../../apps/web/package.json#L8-L14) ejecuta [`write-csp-headers.mjs`](../../apps/web/scripts/write-csp-headers.mjs#L19-L47), que:

1. Recorre todos los HTML generados.
2. Calcula un hash SHA-256 para cada script inline real.
3. Sustituye el marcador `unsafe-inline` por la lista ordenada de hashes.
4. Falla el build si no encuentra scripts, si la plantilla no contiene exactamente un marcador o si la cabecera resultante falta o supera el límite establecido.

El resultado publicado autoriza únicamente los scripts inline producidos por ese build. La directiva `script-src-attr 'none'` mantiene bloqueados los manejadores inline en atributos HTML.

### Verificación

El build de producción completó 62 rutas y el artefacto generado se revisó para confirmar que `script-src` ya no contenía `unsafe-inline` y sí contenía hashes SHA-256. Cloudflare Pages publicó correctamente el commit de remediación.

## Pruebas y comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas y focalizadas | 18 aprobadas: 4 App Check, 12 autoridad activa y 2 PDF |
| Typecheck de Firebase Functions | Aprobado |
| Build de producción web | Aprobado, 62 rutas |
| Comprobación del CSP generado | Aprobada; scripts inline autorizados por hash |
| Suite amplia seleccionada | 273 aprobadas y 40 fallidas por fixtures heredados no actualizados |

Los 40 fallos de la suite amplia no se originaron en las correcciones de seguridad y no afectaron a las 18 pruebas focalizadas. Aun así, impiden presentar toda la suite histórica como verde y deben tratarse como deuda de mantenimiento separada.

## Estado de publicación

### GitHub

El commit de remediación `37d64794fcba5458e3f4415429f44233d32e9166` quedó en `main` tanto local como remoto. Antes de crear este informe se verificó que `main` y `origin/main` no tenían divergencia.

### Cloudflare Pages

El despliegue automático correspondiente al commit de remediación terminó correctamente. La aplicación web publicada incluye el CSP generado durante `postbuild`.

### Firebase Functions

El despliegue inicial de todas las funciones alcanzó temporalmente la cuota regional de mutaciones de Cloud Functions y la cuota total de CPU de Cloud Run. No se eliminó ninguna función. Para completar el trabajo se esperaron 120 segundos entre despliegues y se reintentaron lotes de hasta cinco funciones.

Las 27 funciones relacionadas con la remediación que habían fallado en el intento masivo se actualizaron correctamente en esos lotes. Las dos últimas, `updateClass` y `updateProgram`, terminaron con confirmación individual de Firebase. Con ello, todas las funciones afectadas por los cambios de seguridad quedaron desplegadas.

## Estado residual y recomendaciones

1. **Suite histórica:** corregir los 40 fixtures obsoletos en una tarea separada para recuperar una señal completa de regresión. No deben mezclarse con esta remediación sin revisar primero qué comportamiento histórico representa cada fixture.
2. **CSP de build:** conservar `postbuild` como parte obligatoria del despliegue estático. Servir directamente la plantilla de `public/_headers` sin ejecutar el build dejaría el marcador de compatibilidad para scripts inline.
3. **Dependencias:** mantener `pdfjs-dist` sujeto a revisión de advisories y actualizarlo con pruebas del extractor antes de cada cambio de versión.
4. **App Check:** mantener autorización, validación de entrada, transacciones e idempotencia en cada dominio. La protección contra repetición es una capa adicional.
5. **Monitoreo:** revisar eventos de autorización denegada, repetición App Check y errores de parseo PDF para detectar cambios de patrón. Este informe no encontró evidencia de abuso previo.

## Conclusión

Los cuatro hallazgos detectados quedaron corregidos en el código y publicados. El estado de seguridad del alcance revisado es **resuelto**, con las validaciones focalizadas aprobadas y sin hallazgos de severidad crítica, alta o media pendientes. La principal limitación de confianza es la suite histórica parcialmente roja por fixtures anteriores; su saneamiento mejoraría la cobertura general, pero no cambia el cierre técnico de estas cuatro correcciones.
