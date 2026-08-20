# BPT Jersey UI Design Notes

## T021 Profile

- **Concepto:** "Mat-side registration card": una tarjeta de registro clara y firme, con un masthead morado que funciona como señal de orientación y una franja lima que marca avance sin convertir el formulario en un wizard.
- **Paleta:** `--bpt-purple` para autoridad y continuidad con el shell existente; `--bpt-purple-dark` para profundidad y estados activos; `--bpt-lime` para acciones/confirmacion; `--canvas` para separar la pagina del formulario; `--mat-ink` para lectura; blanco para la superficie editable.
- **Tipografia:** `Barlow Condensed` para titulos y etiquetas de caracter deportivo; `Source Sans 3` para instrucciones, inputs y mensajes largos. Se reutilizan las variables cargadas por el layout para mantener identidad entre rutas.
- **Layout:** composicion asimetrica en desktop con una columna editorial estrecha y una tarjeta de formulario amplia; en mobile se apila con la instruccion primero y conserva el contraste purple/white sin overflow horizontal.
- **Firma:** el bloque lateral "Your training base" muestra sede y preferencias como una lectura visual del perfil, mientras el formulario conserva una sola accion primaria: `Save profile`.
- **Accesibilidad:** labels visibles, `aria-describedby` por campo, `role=alert` para errores, focus ring morado de alto contraste, controles de sede cerrados y preferencias como checkboxes nativos; se respeta `prefers-reduced-motion`.
