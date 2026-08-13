# Project Progress List Design

## Objetivo

Crear un panel estático e interactivo para que el equipo pueda revisar el avance real de BPT Jersey Academy Platform, identificar qué fases están completas, qué se hizo en cada una y qué trabajo queda pendiente.

El panel vivirá en `Lista/` y se podrá abrir directamente en un navegador sin instalar dependencias.

Aunque la aplicación principal exige interfaz en inglés, `Lista/Lista.html` y todo el contenido visible de este panel serán en español para facilitar la revisión del equipo.

## Fuente de verdad

- `tasks.md` es la fuente oficial de estados de tareas.
- `BRIEF.md` define el producto, Phase 0, MVP, v2 y v3.
- `STACK.md` define la arquitectura, tecnologías, restricciones y riesgos operativos.
- `docs/superpowers/specs/` y `docs/superpowers/plans/` sirven como evidencia de diseño y planificación, pero no convierten por sí solos una tarea en terminada.
- La sección de evidencia de `tasks.md` se usará para explicar qué se hizo y qué verificaciones existen.

## Archivos

```text
Lista/
├── Lista.html
├── Lista.css
└── Lista.js
```

- `Lista.html`: estructura semántica, navegación, resumen, filtros y contenedores de contenido. Usa un script clásico local (`Lista.js`) para que la vista se abra directamente con `file://` en Chrome.
- `Lista.css`: identidad visual BPT, estados, layout responsive, accesibilidad visual y componentes interactivos.
- `Lista.css`: mantiene una composición compacta de tareas para reducir espacio vertical sin ocultar campos, y adapta el botón flotante de retorno al inicio a escritorio y móvil.
- `Lista.js`: datos de la fotografía actual del proyecto, cálculo de métricas, filtros, búsqueda, expansión de detalles y navegación interna. No usa módulos ES y expone `globalThis.ListaProject` para pruebas sin DOM y de navegador.

No se usarán frameworks, paquetes externos, CDN ni backend.

## Organización del panel

1. Encabezado con nombre del proyecto, fecha de corte y advertencia de que es una vista de seguimiento.
2. Resumen global con conteos de `aprobada`, `revisión`, `pendiente`, `bloqueada` y `cancelada`.
3. Barra de búsqueda y filtros por estado, etapa y tipo de trabajo.
4. Vista de fases del producto:
   - Phase 0: decisiones operativas.
   - MVP: módulos `M0-M7`.
   - Líneas especiales: Regyfit, importación de miembros y panel administrativo.
   - Roadmap v2.
   - Roadmap v3.
5. Cada fase tendrá progreso, descripción, estado general, tareas agrupadas y detalles desplegables.
6. Cada tarea relevante se mostrará como checklist informativa y no editable: la casilla será `disabled`, marcada solo para `aprobada`, y acompañada por una etiqueta textual para cada estado. También mostrará descripción, dependencia, estado, evidencia y archivos relacionados cuando estén disponibles.
7. Sección final de mantenimiento para explicar cómo actualizar los tres archivos junto con el avance de `tasks.md`.

Todo el contenido visible del panel, incluidos títulos, descripciones, evidencias, tipos, líneas, navegación, estados, controles y mantenimiento, se mantiene en español.

El panel incluye un botón flotante `Inicio` con `aria-label="Volver al inicio"` y el logo local de BPT (`../apps/web/public/bpt-jersey-logo.png`). Se muestra después de desplazarse y vuelve al principio mediante una acción de botón accesible por teclado.

## Reglas de representación

- `aprobada` se presenta como trabajo aceptado según `tasks.md`.
- `revisión` se presenta como implementado o verificado, pero pendiente de aprobación explícita.
- `pendiente` se presenta como trabajo no iniciado o sin evidencia suficiente.
- `bloqueada` se presenta con la decisión o dependencia que impide avanzar.
- `cancelada` se presenta con su sustitución o motivo documentado.
- Una especificación, plan o evidencia de prueba se muestra como referencia, no como sustituto del estado oficial.
- Los datos de miembros, PDFs, credenciales y secretos no se copiarán al panel.

## Interacciones

- Buscar por ID, título, fase o texto de estado.
- Filtrar por estado, etapa y tipo de trabajo.
- Expandir y contraer fases y detalles de tareas.
- Navegar desde el resumen a los grupos afectados.
- Mostrar un estado vacío cuando ningún resultado coincida.
- Mantener usable el panel con teclado y en pantallas pequeñas.

## Actualización y GitHub

Cada cambio de estado o evidencia relevante se actualizará en este orden:

1. Actualizar `tasks.md` y la evidencia del trabajo.
2. Actualizar los datos de `Lista/Lista.js`.
3. Ajustar `Lista/Lista.html` o `Lista/Lista.css` solo si cambia la estructura o presentación.
4. Verificar el panel abriendo `Lista/Lista.html` y ejecutando las comprobaciones disponibles.
5. Incluir `tasks.md` y los archivos modificados de `Lista/` en el mismo commit.

El panel será estático y no editará `tasks.md` desde el navegador. Las casillas son únicamente informativas y están deshabilitadas para evitar que una edición local del navegador se confunda con el registro oficial del proyecto.

## Verificación

- La página abre directamente desde el sistema de archivos mediante `Lista.js` como script clásico local.
- No hay errores de sintaxis en `Lista.js`.
- El resumen coincide con los datos cargados.
- Búsqueda y filtros combinados funcionan.
- Las fases y detalles se pueden expandir y contraer.
- La navegación interna funciona.
- La vista es legible en escritorio y móvil.
- No se exponen secretos ni datos personales reales.
