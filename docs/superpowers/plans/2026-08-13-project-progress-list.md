# Project Progress List Implementation Plan

> **Para agentes de implementación:** usar `superpowers:executing-plans` o `superpowers:subagent-driven-development` para ejecutar este plan tarea por tarea. Cada tarea termina con verificación real antes de continuar.

**Goal:** Crear un panel estático e interactivo en `Lista/` que explique el avance real del proyecto BPT Jersey por fases, muestre evidencia y haga visibles las tareas pendientes.

**Architecture:** La interfaz estará separada en estructura (`Lista.html`), presentación (`Lista.css`) y estado/comportamiento (`Lista.js`). `Lista.js` contendrá una fotografía explícita de `tasks.md`, `BRIEF.md` y la evidencia relevante, y renderizará el panel desde esos datos sin backend ni persistencia. Será un script clásico local para compatibilidad directa con `file://` y expondrá `globalThis.ListaProject` para pruebas.

**Tech Stack:** HTML5 semántico, CSS3 responsive, JavaScript moderno sin frameworks ni dependencias externas.

## Global Constraints

- `tasks.md` es la fuente oficial de estados de tareas.
- `BRIEF.md` define Phase 0, MVP, v2 y v3.
- `STACK.md` define arquitectura, tecnologías y restricciones operativas.
- Las especificaciones y planes son evidencia de diseño, no estados de finalización.
- No usar frameworks, paquetes externos, CDN ni backend.
- No copiar secretos, credenciales, PDFs ni datos reales de miembros.
- El panel debe abrirse directamente desde el sistema de archivos.
- La interfaz visible seguirá la identidad BPT: disciplinada, enérgica y confiable; fondo `#F2F1ED`, purple `#2F2483`, mat ink `#1A1A18` y blanco `#FFFFFF`.
- Toda actualización futura de estado debe cambiar `tasks.md` y `Lista/Lista.js` en el mismo commit; HTML/CSS solo cambian si cambia la estructura o presentación.
- La aplicación principal usa inglés, pero todo el contenido visible de `Lista/` debe permanecer en español por decisión del operador: HTML, datos, títulos, descripciones, evidencias, tipos, líneas, navegación, estados, controles y mantenimiento.
- `Lista/Lista.html` debe funcionar al abrirse directamente desde el sistema de archivos, no únicamente mediante un servidor HTTP.
- Cada tarea se representará como checklist informativa con `input type="checkbox" disabled`; solo las tareas `aprobada` aparecerán marcadas y ningún estado podrá cambiarse desde el navegador.
- La composición de `.task` será compacta y conservará en pantalla el ID, título, descripción, dependencias, tipo, evidencia y referencias.
- `Lista.html` incluirá un botón flotante `Inicio`, con logo local BPT, texto visible y `aria-label="Volver al inicio"`; el script lo mostrará durante el desplazamiento y lo ocultará cerca del inicio.

---

### Task 1: Crear el modelo explícito de fases y tareas

**Files:**
- Create: `Lista/Lista.js`

**Interfaces:**
- Produces `projectData`, un objeto serializable con `cutoffDate`, `sourceFiles`, `statuses`, `stages` y `maintenanceSteps`.
- Cada etapa tendrá `{ id, track, title, description, status, items }`.
- Cada tarea tendrá `{ id, title, status, description, dependsOn, evidence, references, kind }`.
- `status` solo podrá ser `aprobada`, `revisión`, `pendiente`, `bloqueada` o `cancelada`.

- [ ] **Step 1: Definir la fotografía actual del proyecto**

  Cargar en `projectData` los grupos siguientes, sin inventar estados:

  - `phase-0`: `T008` pendiente, `T009` bloqueada, `T010` bloqueada y `T011` bloqueada.
  - `m0-foundations`: `T001-T007` aprobadas. `T008-T011` se muestran únicamente en `phase-0` para evitar duplicar tareas y falsear los conteos.
  - `m1-identity`: `T012` y `T013` aprobadas; `T014-T016`, `T018-T019` pendientes; `T017` cancelada y sustituida por el rediseño administrativo sin MFA.
  - `m2-people`: `T020`, `T020A`, `T021-T025` con los estados oficiales actuales, distinguiendo el trabajo visible ya realizado de lo todavía pendiente.
  - `m3-attendance`, `m4-memberships`, `m5-progress`, `m6-crm` y `m7-closeout`: tareas del backlog con estado oficial y dependencias.
  - Líneas especiales: Regyfit, importación de miembros PDF y panel administrativo visible, etiquetadas como `special` y con estado `revisión` cuando `tasks.md` las deja pendientes de aprobación.
  - Roadmap `v2` y `v3` como tareas futuras con estado `pendiente`.

  Cada entrada debe incluir una descripción en lenguaje claro y una referencia a `tasks.md` o al documento de diseño correspondiente.

- [ ] **Step 2: Añadir métricas y funciones puras de resumen**

  Implementar funciones pequeñas y exportables para facilitar la verificación:

  ```js
  function flattenItems(stages) {}
  function countStatuses(items) {}
  function getStageProgress(stage) {}
  function normalizeText(value) {}
  function itemMatches(item, filters) {}
  ```

  `getStageProgress` debe calcular el porcentaje de tareas aprobadas sobre el total de tareas de la etapa y devolver también el conteo total. Las tareas canceladas no cuentan como aprobadas.

- [ ] **Step 3: Ejecutar comprobación de sintaxis**

  Run: `node --check Lista/Lista.js`

  Expected: exit code `0`, sin errores de sintaxis.

### Task 2: Construir la estructura semántica del panel

**Files:**
- Create: `Lista/Lista.html`

**Interfaces:**
- Consume `Lista.css` mediante `<link rel="stylesheet" href="Lista.css">`.
- Consume `Lista.js` mediante `<script src="Lista.js"></script>` para soportar apertura directa con `file://`.
- Exposes stable IDs: `#app`, `#summary-grid`, `#filters`, `#phase-list`, `#empty-state`, `#maintenance`, `#last-updated`.

- [ ] **Step 1: Crear el documento HTML base**

  Incluir `<!doctype html>`, `lang="es"`, metadata viewport, título, skip link y landmarks `header`, `main`, `nav` y `footer`. La página debe funcionar sin servidor y no incluir scripts inline.

- [ ] **Step 2: Añadir el encabezado y el resumen**

  Crear un encabezado con nombre del proyecto, etiqueta `Project review`, fecha de corte y aviso explícito de que el panel es una vista de seguimiento basada en documentación versionada.

  Añadir tarjetas con los cinco estados y un indicador global de progreso, dejando los valores como contenedores que `Lista.js` rellenará.

- [ ] **Step 3: Añadir controles de revisión**

  Crear búsqueda accesible, select de estado, select de track y botón para limpiar filtros. Los controles deben tener `label` asociado y los resultados deben anunciarse mediante una región `aria-live`.

- [ ] **Step 4: Añadir contenedores de fases y mantenimiento**

  Crear la navegación interna a Phase 0, MVP, líneas especiales, v2 y v3; un contenedor para fases; un estado vacío; y una sección que explique el proceso de actualización junto con `tasks.md` y el mismo commit.

### Task 3: Implementar estilos y lenguaje visual responsive

**Files:**
- Create: `Lista/Lista.css`

**Interfaces:**
- Styles `Lista.html` without requiring classes generated by a framework.
- Supports the states `status-approved`, `status-review`, `status-pending`, `status-blocked` and `status-cancelled`.

- [ ] **Step 1: Definir tokens y base visual**

  Definir variables CSS para la paleta BPT, tipografía de sistema segura, espaciado, bordes, sombras y focus ring. Usar alto contraste y evitar gradientes genéricos o un mosaico excesivo de cards.

- [ ] **Step 2: Diseñar el layout de escritorio**

  Crear una composición con navegación lateral o superior compacta, encabezado editorial, resumen de métricas, barra de filtros y lista de fases. Las tareas deben leerse como elementos de revisión, no como tarjetas decorativas.

- [ ] **Step 3: Diseñar estados y detalles**

  Diferenciar visualmente estado, evidencia, dependencia y referencias. Mantener una señal de color acompañada siempre por texto, para no depender solo del color.

- [ ] **Step 4: Añadir responsive y reduced motion**

  Bajo `48rem`, convertir navegación y grillas a una sola columna, permitir scroll horizontal controlado únicamente en bloques tabulares si existieran, y aplicar `@media (prefers-reduced-motion: reduce)` para eliminar transiciones no esenciales.

- [ ] **Step 5: Verificar formato CSS básico**

  Run: `node --check Lista/Lista.js`

  Expected: sigue pasando después de los cambios visuales; CSS se validará al abrir la página y revisar que no haya recursos externos fallidos.

### Task 4: Implementar renderizado, filtros e interacción

**Files:**
- Modify: `Lista/Lista.js`

**Interfaces:**
- Reads DOM nodes by the stable IDs from `Lista.html`.
- Renders all phase content from `projectData`.
- Uses event delegation for filters and expandable details.

- [ ] **Step 1: Implementar renderizado de resumen**

  Renderizar conteos por estado y progreso global. Cada tarjeta de resumen debe enlazar mediante `data-filter-status` al filtro correspondiente.

- [ ] **Step 2: Implementar renderizado de fases y tareas**

  Renderizar una sección por etapa con encabezado, track, descripción, barra de progreso y conteo. Cada tarea debe mostrar ID, título, badge de estado, descripción, dependencias, evidencia y referencias. Escapar contenido usando `textContent` o nodos DOM, nunca concatenar HTML con datos no controlados.

- [ ] **Step 3: Implementar búsqueda y filtros combinados**

  Aplicar `itemMatches` sobre ID, título, descripción, dependencias, evidencia y referencias. Los filtros de texto, estado y track deben combinarse y actualizar resumen, fases visibles y contador de resultados.

- [ ] **Step 4: Implementar expansión y navegación**

  Permitir expandir/contraer detalles de una fase y activar el foco en el grupo correspondiente cuando se pulsa una métrica o ancla de navegación. Los controles deberán usar `button`, `aria-expanded` y `aria-controls`.

- [ ] **Step 5: Implementar estado vacío y reset**

  Mostrar `#empty-state` cuando no existan coincidencias, ocultar fases vacías y restaurar todos los controles con el botón de limpieza.

- [ ] **Step 6: Ejecutar comprobación de sintaxis**

  Run: `node --check Lista/Lista.js`

  Expected: exit code `0`.

### Task 5: Verificar el panel completo y dejar instrucciones de mantenimiento

**Files:**
- Modify: `Lista/Lista.html`
- Modify: `Lista/Lista.css`
- Modify: `Lista/Lista.js`

- [ ] **Step 1: Ejecutar validaciones estáticas**

  Run:

  ```powershell
  node --check Lista/Lista.js
  Test-Path Lista/Lista.html
  Test-Path Lista/Lista.css
  Test-Path Lista/Lista.js
  ```

  Expected: sintaxis válida y los tres archivos existen.

- [ ] **Step 2: Verificar comportamiento en navegador**

  Abrir `Lista/Lista.html` directamente y comprobar:

  - El resumen muestra los conteos cargados.
  - Buscar `T013` deja visible la tarea correcta.
  - Filtrar `bloqueada` muestra Phase 0 y las decisiones bloqueantes.
  - Limpiar filtros restaura todas las fases.
  - Las fases se expanden y contraen con teclado.
  - La navegación interna llega a cada grupo.
  - No aparecen errores de consola ni recursos CDN faltantes.

- [ ] **Step 3: Verificar responsive**

  Comprobar viewport de escritorio y móvil, incluyendo ausencia de overflow horizontal accidental, legibilidad de badges y targets accionables.

- [ ] **Step 4: Ejecutar revisión de seguridad del contenido**

  Buscar en `Lista/` patrones que no deben aparecer: `.env`, `password`, `secret`, `token`, números de tarjeta, PDFs o nombres de miembros reales. Confirmar que solo se incluyen datos sintéticos y referencias documentales.

- [ ] **Step 5: Documentar el mantenimiento visible**

  Confirmar que la sección de mantenimiento indica explícitamente: actualizar primero `tasks.md`, después `Lista.js`, ajustar HTML/CSS solo cuando corresponda, verificar y subir los archivos juntos en el mismo commit.

- [ ] **Step 6: Revisar diff antes de entregar**

  Run: `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check -- Lista docs/superpowers/specs/2026-08-13-project-progress-list-design.md docs/superpowers/plans/2026-08-13-project-progress-list.md`

  Expected: salida vacía y exit code `0`. No crear commit ni hacer push automáticamente.

## Self-Review Checklist

- [x] La especificación queda cubierta por las tareas de modelo, HTML, CSS, interacción y verificación.
- [x] Los estados proceden de `tasks.md`; no se confunde diseño con finalización.
- [x] El plan no introduce backend, dependencias ni persistencia innecesaria.
- [x] Las funciones de resumen y filtrado tienen nombres y contratos consistentes.
- [x] La verificación incluye sintaxis, navegador, responsive, contenido sensible y diff.
- [x] El proceso de actualización por commit queda explicado tanto en el plan como en la interfaz.
