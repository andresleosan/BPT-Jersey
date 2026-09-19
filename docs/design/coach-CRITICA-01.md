# Crítica del coach workspace

**VEREDICTO: PASA**. Cero hallazgos BLOQUEA o GRAVE abiertos en el alcance visual inspeccionado.

Método: spec previa, lectura de código, capturas 1440/390/320px y acceso móvil, comprobaciones independientes de estilos computados y foco a 390×844. Vista local con datos sintéticos; no representa validación de autenticación real ni datos de producción.

## Tabla diff de tokens

| Token / anatomía | Spec admin | Build coach | Coincide |
| --- | --- | --- | --- |
| Canvas | `#f2f1ed` | `var(--canvas)` | Sí |
| Panel | `#ffffff`, regla ink `0.3rem` | `.admin-panel-card` compartida | Sí |
| Marca | `#2f2483` | `var(--bpt-purple)` | Sí |
| Cuerpo | Source Sans 3, 1rem | Fuente computada Source Sans 3; párrafos heredan 1rem | Sí |
| Títulos | Barlow Condensed, uppercase | Barlow Condensed computada, uppercase | Sí |
| Escala títulos | Cabecera admin clamp; secciones grandes | Header compartido; contenido `clamp(2rem,3vw,3rem)`, panel `1.65rem` | Adaptación aceptada para densidad coach |
| Forma | Cuadrada, sin sombras difusas | Radio 0; paneles compartidos | Sí |
| Sidebar | Púrpura, rutas por rol | AdminShell compartido, rutas coach | Sí |
| Selección | Púrpura sobre purple wash | Púrpura sobre canvas, `aria-pressed` | Adaptación aceptada |
| Acción principal | Púrpura/blanco | `.admin-auth-button`, 48.375px computados en acceso | Sí |
| Acción secundaria | Púrpura sobre superficie clara | Púrpura sobre gris UA `rgb(239,239,239)` cuando es button | No, menor |
| Campos | Blancos, radio0, alto ≥44px | 50px computados, fuente Source Sans 3 | Sí |
| Error | Rojo marca `#8d1c2f` | `#a12b20` | No, menor |
| Mobile | Sidebar plegable, una columna | Columna única; menú con foco/Escape | Sí |

## Familiarización y evaluación

Las tres diferencias mayores frente al estado inicial son estructurales: sidebar real en lugar de cabecera ocupando la columna izquierda; controles visibles púrpura sobre superficies claras; paneles y títulos con anatomía administrativa. Desktop presenta tareas principales a la izquierda y preparación a la derecha. Móvil apila secciones, convierte el registro en filas etiquetadas y conserva las acciones completas.

D1/D2: recorrido sede → sesión → registro identificable; Google y contraseña son grupos diferenciados. D3/D4: marca tipográfica restaurada y contraste de la paleta principal conservado (púrpura/blanco 12.35:1, muted/canvas 5.31:1). D5/D6: espaciado coherente; botones de acceso ≥44px y campos 50px. D7: no animaciones nuevas ni dependencia de reveals. D8: copy funcional sin interfaz financiera; logo, fuentes y shell propios.

Verificación adversarial: la escala algo menor de títulos no implica identidad rota porque familia, peso y mayúsculas están preservados y evita recortes móviles. La selección canvas no es azul ajeno y sigue siendo inequívoca por borde/regla púrpura y estado accesible; no se eleva a GRAVE. No se penalizan reglas laterales, canvas cálido ni púrpura porque son patrones de la referencia del propio proyecto.

## Hallazgos por severidad

**[MENOR] D6 · `.coach-button.admin-home-link` renderizado como button.** Frecuencia: secundarias de acción.

Estándar: superficie explícita de la paleta BPT. Brecha: Chromium computa `rgb(239,239,239)` para Link Google account, fondo de UA. Fix mínimo: background transparente o `var(--gi-white)` en la variante secundaria de coach, preservando hover existente. El texto sí es Source Sans 3 y el contraste es suficiente.

**[MENOR] D4 · `.notification-error` en coach.css.** Frecuencia: avisos de error.

Estándar: rojo de marca `#8d1c2f` documentado. Brecha: `#a12b20` introduce un rojo distinto. Fix mínimo: sustituir color y borde por `#8d1c2f`. No impide comprender el error ni rompe contraste.

## TOP-3 acciones

1. Fijar el fondo de los botones secundarios para eliminar variación entre navegadores.
2. Unificar el rojo de error con el token documentado de la marca.
3. Medir rendimiento real tras despliegue; el lazy load del panel headCoach está implementado, pero no hay una métrica de producción que permita cuantificar mejora.

## Evidencia y límites

- Capturas inspeccionadas: `/tmp/coach-1440.png`, `/tmp/coach-390.png`, `/tmp/coach-320.png`, `/tmp/coach-access-mobile.png`.
- Comprobación propia: acceso a 390×844 sin overflow; Google44px, campos50px, contraseña48.375px; familias correctas; apertura del menú enfoca Cerrar; Escape devuelve foco a Abrir.
- Builder reporta 39 tests pasando y cero overflow en 320/390/768/1440px. Es evidencia del builder, no una repetición independiente de esos tests.
- No se han medido Core Web Vitals, Lighthouse de producción ni login real. Las capturas usan mocks de Auth y servicios. Esta crítica aprueba diseño/estructura, no afirma nuevas garantías backend.
- Sin código modificado por el crítico; solo documentación de spec y evaluación.

## Cierre de implementación

Los dos hallazgos menores se corrigieron después de esta revisión: el fondo secundario ahora es explícitamente transparente, con hover púrpura, y el rojo de error es `#8d1c2f`. No se añadieron dependencias. El navegador confirmó que una sesión de rol coach no solicita el módulo de herramientas de head coach. Esto demuestra carga diferida, no un porcentaje de mejora de velocidad.

Las pruebas de interacción con datos sintéticos comprobaron cambio de sede, drawer móvil, Escape y devolución del foco, Google vinculado, cambio de contraseña y limpieza de sus campos. No modifican permisos ni acceden a cuentas reales.
