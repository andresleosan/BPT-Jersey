# Mapa de revisión de BPT Jersey

Abre **[mapa.html](./mapa.html)** en un navegador. Es un archivo autónomo: no necesita instalar dependencias, arrancar BPT ni iniciar sesión para usar la lista. Desde GitHub, descarga el archivo con **Download raw file** y ábrelo. Los enlaces «Abrir página» sí usan la web y sus permisos habituales.

## Archivos

- **[mapa.html](./mapa.html)**: árbol de áreas y páginas, checklist interactiva, búsqueda, filtros y notas.
- **[CHECKLIST-PAGES.md](./CHECKLIST-PAGES.md)**: lista breve de las 58 páginas y 149 recorridos agrupados, para copiar o imprimir.
- **[CHECKLIST.md](./CHECKLIST.md)**: inventario detallado con una casilla por elemento y enlaces a su código.
- **[inventory.json](./inventory.json)**: inventario generado y asociaciones con rutas.
- **[scenarios.json](./scenarios.json)**: recorridos descritos en lenguaje natural, mantenidos junto al código.

## Trabajar con la lista

1. En **Mapa de páginas**, elige un área y pulsa **Revisar** en una página.
2. Empieza por **Páginas y recorridos agrupados**. Después selecciona **Inventario completo** para encontrar pestañas, pasos, campos, acciones, diálogos, confirmaciones, variantes de rol, mensajes y estados.
3. Abre **Contexto, formatos y notas**. Registra móvil, escritorio y observaciones. Los nombres en inglés son los textos o identificadores originales de la aplicación.
4. Elige **En revisión**, **Diseño definido**, **Implementado** o **Hecho / aprobado**. La casilla principal equivale a **Hecho / aprobado**. Usa **No aplica** solo después de explicar el motivo en las notas.
5. Usa **Todo lo que falta** para retomar el trabajo. La aprobación global de una página es independiente del estado de sus piezas: no aprueba automáticamente sus controles ni otras páginas que comparten componentes.
6. Pulsa **Exportar avance** al terminar. El JSON contiene marcas, notas y elementos añadidos manualmente. **Importar avance** combina registros por fecha, conserva los demás y mantiene las revisiones antiguas que ya no figuran en el inventario.

El avance se guarda en `localStorage`, asociado al navegador y al origen del archivo. No se sincroniza con GitHub ni con otro equipo. Cambiar de carpeta, navegador, perfil u origen puede impedir recuperar ese guardado; usa la exportación. Si el navegador impide guardar, el visor lo indica y permite exportar el trabajo de la sesión.

Las listas Markdown son alternativas independientes: sus casillas no se sincronizan con el HTML. **Copia la lista antes de marcarla**, porque la regeneración sobrescribe los archivos generados.

Para una pestaña o diálogo sin URL propia, entra por la página asociada y abre el control indicado en el recorrido. Para fichas que necesitan un identificador, selecciona un registro desde el listado; el mapa no incluye datos personales ni identificadores reales. Las variantes se revisan con el rol autorizado y datos de ejemplo. Una revisión de diseño no implica ejecutar cobros, eliminaciones o cambios de permisos.

## Qué cubre

El generador lee archivos de código de `apps/web/src` y `packages/ui/src`, excluyendo tests. Encuentra las páginas del App Router y añade sus layouts y pantallas especiales existentes. Sigue las declaraciones importadas que utilizan las páginas, incluidos componentes dinámicos, para asociar cada pieza con sus rutas. Los componentes compartidos tienen un único registro y una única marca.

El inventario incluye:

- Las rutas canónicas, alias, redirecciones y páginas provisionales.
- Secciones, componentes, navegación, pestañas y desplegables.
- Formularios, campos, opciones, acciones y pasos declarados.
- Diálogos de la aplicación y confirmaciones nativas del navegador.
- Ramas de interfaz, variantes por rol y valores de estado declarados localmente.
- Mensajes de estado y errores específicos definidos en los clientes de acceso y datos.
- Recorridos agrupados manualmente para que no sea necesario empezar por cada control.

No es una auditoría visual ni una prueba de funcionamiento. Las ramas extraídas incluyen variaciones pequeñas de texto o estilo y pueden solaparse con un recorrido. Un valor declarado no demuestra por sí mismo que se pueda alcanzar. Los imports dinámicos se tratan de forma conservadora; las condiciones del servidor, los estilos y las combinaciones entre roles y datos pueden producir casos adicionales. El mapa no enumera todas las combinaciones cartesianas posibles.

La vista **Sin ruta asociada** conserva piezas cuya utilización no pudo demostrarse con este análisis. No se consideran automáticamente páginas activas ni se eliminan de la revisión. Usa **Añadir una parte descubierta** para conservar cualquier variante adicional. La generación no toca datos, autenticación, permisos ni despliegues.

## Actualizar después de cambiar la aplicación

Desde la raíz del repositorio, con sus dependencias ya instaladas:

```sh
node scripts/design-review/generate.mjs
```

Regenera HTML, JSON y las dos listas Markdown; no ejecuta pruebas ni compila la aplicación. Los identificadores de revisión se basan en archivo, tipo y contenido semántico, no en número de línea. Los elementos nuevos empiezan pendientes. Los eliminados se conservan dentro de las exportaciones anteriores de avance. Un cambio de etiqueta o archivo puede crear un identificador nuevo.

Las huellas del código permiten señalar **Código cambiado: revisar de nuevo** al cargar una marca antigua. Una página usa las huellas de sus archivos asociados y sus imports directos de CSS; un cambio en un componente o estilo compartido puede reabrir varias páginas. Las notas no revalidan una aprobación obsoleta: cambia explícitamente su estado tras revisarla. Los assets externos y estilos cargados por mecanismos distintos de esos imports necesitan revisión manual.

`inventory.json` guarda la revisión Git base y las diferencias frente a la generación anterior. Sus enlaces al código apuntan a esa revisión. Genera desde una revisión de código confirmada si necesitas enlaces inmutables que reproduzcan exactamente lo inspeccionado. No publiques copias de avance con información personal en el repositorio.

El visor y el generador están en `scripts/design-review/`. Las descripciones manuales se editan en `scenarios.json`; cada una conserva archivo y ancla de origen, y la generación se detiene si desaparecen.
