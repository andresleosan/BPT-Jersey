# Diseno: migracion funcional y de datos desde Regyfit

Fecha: 2026-08-07
Estado: aprobado por el operador para documentacion y planificacion
Proyecto: BPT Jersey Academy Platform
Sistema origen: Regyfit (`https://www.regyfit.com/admin2/index.php`)
Sistema destino: plataforma BPT Jersey en `Dev/`

## 1. Objetivo

Recrear en BPT Jersey las capacidades administrativas que la academia usa en
Regyfit, buscando paridad funcional casi completa en modulos, navegacion,
formularios, filtros, estados, permisos, mensajes, relaciones, historico y reglas
de trabajo observables. La interfaz de Regyfit se usa como referencia funcional y
de flujo, no como una copia visual pixel-perfect ni una copia de codigo o assets.
La nueva plataforma conserva el branding, la arquitectura y las reglas de
privacidad de BPT Jersey.

La migracion debe permitir continuar la operacion sin perder alumnos, familias,
asistencia, membresias, pagos, progreso, documentos, relaciones o historico que
sean accesibles y autorizados para migrar.

## 2. Contexto verificado

- BPT Jersey es un proyecto Nivel 3 con datos de menores, salud, asistencia,
  pagos, permisos, comunicaciones y auditoria.
- La base existente es un monorepo pnpm con Next.js, Firebase, Firestore,
  Functions y Cloudflare R2.
- El modelo de datos y las fronteras de Firestore ya estan documentados en
  `docs/superpowers/specs/2026-08-07-t013-firestore-data-model-design.md` y
  `docs/adr/ADR-004-firestore-aggregate-boundaries.md`.
- El producto y sus reglas de menores, tutores, pagos y auditoria estan definidos
  en `BRIEF.md`, `STACK.md` y `tasks.md`.
- No se conoce todavia si Regyfit ofrece API o exportacion oficial. La primera
  fase debe descubrirlo antes de automatizar el panel.
- El operador autorizo trabajar con datos reales para la extraccion y validacion,
  sujeto a staging privado cifrado, sin datos reales en el repositorio y sin
  escritura en produccion durante este subproyecto.
- `Dev/.claude/skills/*` contiene enlaces simbolicos hacia `Dev/.agents/skills/*`.
  El relevamiento del indice no debe atravesar esos enlaces ni incorporarlos como
  datos del proyecto.

## 3. Alcance

### Incluido

- Inventario de modulos, pestañas, roles, permisos, campos, acciones y flujos.
- Diccionario de datos Regyfit -> BPT Jersey.
- Identificacion de entidades, relaciones, estados, historico y adjuntos.
- Reproduccion funcional de alumnos, familias, tutores, coaches, clases,
  asistencia, check-in/out, membresias, pagos, progreso, CRM, comunicacion,
  documentos, consentimientos y auditoria.
- Paridad administrativa por lotes, incluyendo shell, navegacion, listados,
  formularios, filtros, estados, permisos y mensajes observables.
- Migracion de registros activos e historicos que sean accesibles y autorizados.
- Pruebas con datos sinteticos, migracion de staging, validacion y rollback.

### Excluido por seguridad

- Contraseñas, hashes de autenticacion, tokens y credenciales de Regyfit.
- Numeros crudos de tarjetas, CVV o secretos del proveedor de pagos.
- Copiar datos reales al repositorio Git, GitHub, fixtures, logs o documentacion.
- Modificar, borrar o corregir registros en Regyfit durante la extraccion.
- Acceder a bases internas, endpoints no autorizados, controles anti-bot o CAPTCHA.
- Copiar la identidad visual de Regyfit de forma exacta cuando no sea necesaria
  para la funcionalidad.

## 4. Decisiones de diseno

1. Regyfit es una fuente externa de referencia y migracion; BPT Firestore es la
   fuente canonica del sistema nuevo.
2. La primera interaccion autenticada sera read-only y se limitara al inventario
   funcional y a la deteccion de mecanismos oficiales de exportacion.
3. Se prioriza API o exportacion oficial. Si no existe, se usara automatizacion
   del panel con ritmo limitado, checkpoints y sin evadir controles.
4. Los datos reales se procesan primero en staging o Firebase Emulator con el
   proyecto seguro `demo-bpt-jersey`; produccion queda fuera hasta un checkpoint
   operativo posterior.
5. Cada entidad importada conserva `sourceSystem` y `sourceId`, junto con un
   manifiesto de ejecucion, para soportar idempotencia, deduplicacion y auditoria.
6. Las reglas de BPT sobre menores, tutores, pagos, evaluaciones, promociones y
   auditoria prevalecen sobre cualquier comportamiento observado en Regyfit.
7. La extraccion real solo comienza despues de verificar el destino privado
   cifrado, su retencion, acceso restringido y procedimiento de eliminacion.

## 5. Arquitectura de la migracion

La solucion se separa en componentes con responsabilidades acotadas:

### 5.1 Discovery de Regyfit

Relevamiento autenticado read-only de navegacion, pantallas, tabs, roles,
formularios, filtros, acciones, estados, mensajes y reglas observables. Las
capturas, si se necesitan, deben estar redactadas y no incluir PII.

### 5.2 Captura de origen

Adaptador que usa, por este orden, exportacion oficial, API documentada o
automatizacion del panel. Cada corrida genera checkpoints por modulo, conteos y
un manifiesto. Los errores transitorios tienen reintentos limitados con backoff;
los errores de permisos, autenticacion o cambios de UI detienen el modulo y
requieren revision.

### 5.3 Almacenamiento temporal privado

Los archivos de origen y adjuntos se guardan cifrados fuera del repositorio,
con permisos limitados y retencion definida para la migracion. Ningun archivo
real se coloca bajo `Dev/`, `qa/`, `docs/` o `F:\Proyectos\Analista`.
El staging conserva el lote original, su hash, modulo, timestamp, checkpoint y
resultado de validacion; los nombres de archivo y logs usan identificadores
tecnicos y no nombres, emails, telefonos ni valores de registros.

### 5.4 Transformacion y mapeo

La transformacion normaliza fechas, estados, telefonos, relaciones familiares,
IDs externos, memberships, historico y adjuntos. Los conflictos no se resuelven
silenciosamente: se registran como rechazados o pendientes para revision manual.

### 5.5 Carga de destino

El cargador escribe primero contra Emulator/staging y usa operaciones idempotentes.
Las entidades restringidas aplican las Rules y el contexto de actor del sistema
BPT; los documentos privados usan R2 y referencias autorizadas, no URLs publicas.

### 5.6 Validacion

Un reporte compara conteos, relaciones, estados, duplicados, campos obligatorios,
adjuntos, errores y muestras anonimizadas. La carga no se considera lista hasta
que las diferencias tengan explicacion y aprobacion.

Flujo resumido:

```text
Regyfit read-only
    -> discovery / export / captura controlada
    -> almacenamiento temporal cifrado fuera del repo
    -> mapeo y transformacion idempotente
    -> Firebase Emulator / staging
    -> validacion y reporte
    -> checkpoint operativo
    -> migracion final aprobada
```

## 6. Mapa funcional inicial

| Dominio Regyfit observado o por relevar | Destino BPT | Riesgo principal |
|---|---|---|
| Alumnos, adultos y menores | perfiles y familias Firestore | identidad duplicada y privacidad infantil |
| Tutores y contactos | relaciones familiares autorizadas | acceso cruzado entre familias |
| Coaches y personal | usuarios, roles y asignaciones | minimo privilegio |
| Programas, grupos y clases | academia, programas, sesiones y roster | timezone y capacidad |
| Asistencia y check-in/out | attendance y estados de salida | custodia de menores y correcciones auditadas |
| Membresias y suscripciones | membership lifecycle | estados incompatibles y fechas |
| Pagos, balances, recibos e invoices | pagos y ledger sin tarjeta cruda | idempotencia y conciliacion |
| Evaluaciones, belts y stripes | progreso y revision del coach | no promover automaticamente |
| Leads y seguimiento | CRM | historico de acciones y consentimiento |
| Comunicaciones | announcements y mensajes visibles al tutor | safeguarding |
| Documentos y consentimientos | R2 privado + metadatos Firestore | acceso, retencion y residencia |
| Auditoria e historico | audit log append-only | integridad y autor de cambios |

Este mapa se completa solo con evidencia del panel o de una exportacion; no se
inventan campos o reglas faltantes.

## 7. Fases y entregables

### Fase 0 - Relevamiento y documentacion

- Inventario funcional de Regyfit.
- Inventario de roles y permisos.
- Deteccion de API/exportacion.
- Diccionario inicial de datos y relaciones.
- Lista de riesgos, campos restringidos y decisiones pendientes.
- Inventario de paridad administrativa: pantallas, navegacion, formularios,
  filtros, estados, roles y mensajes por modulo.

### Fase 1 - Contrato de migracion

- Esquema de origen versionado sin PII real.
- Mapeo completo a entidades BPT.
- Politica de IDs, deduplicacion, estados e historico.
- Politica de adjuntos, retencion y rechazo.
- Reporte de campos sin destino o con transformacion manual.

### Fase 2 - Migracion sintetica

- Fixtures sinteticos que representen familias, menores, pagos, asistencia,
  documentos y conflictos.
- Carga en Emulator.
- Pruebas de Rules, roles, auditoria, idempotencia y rollback.

### Fase 3 - Staging con datos reales

- Extraccion controlada y cifrada.
- Dry-run y reporte de diferencias.
- Importacion en staging.
- Validacion por conteo, muestra autorizada y operacion diaria.
- Eliminacion o retencion del staging privado segun la politica aprobada.

### Fase 4 - Migracion final

- Backup verificado y ventana aprobada.
- Freeze o regla de corte definida para cambios en Regyfit.
- Importacion idempotente.
- Validacion de salida y acta de aceptacion.
- Rotacion de credenciales inmediatamente despues.

## 8. Seguridad y manejo de fallos

- Los logs no imprimen nombres, emails, telefonos, direcciones, notas medicas,
  datos financieros ni valores de autenticacion.
- Un fallo de un modulo no continua silenciosamente: se marca el modulo,
  conserva el checkpoint y permite reanudar sin duplicar.
- Los reintentos se limitan a fallos transitorios; no se repiten errores de
  permisos o validacion sin intervencion.
- Los datos rechazados se guardan en un reporte privado con referencia tecnica,
  no en el repositorio.
- El rollback elimina o revierte solo la corrida identificada en staging; una
  migracion final necesita backup y aprobacion explicita.
- El sistema nuevo no queda operativo como migrado hasta que seguridad, Rules,
  pruebas por rol y validacion de conteos pasen.

## 9. Criterios de aceptacion

- Todos los modulos y pestañas relevantes tienen inventario y destino documentado.
- Cada entidad migrada conserva su identificador de origen y relaciones validas.
- No hay contraseñas, tarjetas crudas, credenciales ni PII real en Git, logs o
  fixtures versionados.
- La migracion repetida no duplica registros.
- Los datos de menores, salud, pagos y documentos quedan restringidos por rol.
- Los conteos de origen y destino se explican por modulo.
- Los rechazos y campos sin destino tienen responsable y siguiente accion.
- La carga puede reanudarse desde checkpoint y revertirse en staging.
- La academia puede ejecutar los flujos prioritarios sin depender de Regyfit,
  sujeto a la aprobacion del checkpoint final.
- La interfaz administrativa BPT cubre los flujos observados de Regyfit sin
  copiar identidad visual, codigo, credenciales o assets protegidos.

## 10. Decisiones pendientes

- Si Regyfit tiene exportacion oficial, API o solo interfaz web.
- Ubicacion y mecanismo concreto del staging cifrado privado antes de extraer.
- Cantidad real de registros, historico y adjuntos disponibles.
- Politica aprobada de retencion, residencia y borrado.
- Campos medicos y documentos que la academia desea conservar.
- Fecha de corte y ventana de migracion.
- Proveedor de pagos y conciliacion de historico financiero.
- Usuarios autorizados para validar la migracion y aprobar el cutover.

## 11. Prohibiciones operativas

- No iniciar una exportacion masiva antes de cerrar el diccionario de datos y el
  destino temporal.
- No copiar datos reales al repositorio `https://github.com/andresleosan/Analista`
  ni al repositorio de BPT Jersey.
- No ejecutar migracion final, borrado, freeze o cambio de credenciales sin
  confirmacion explicita del operador en ese momento.
- No tratar una inferencia del panel como regla de negocio aprobada: toda regla
  debe quedar marcada como observada, provisional o aprobada.
