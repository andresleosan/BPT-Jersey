# SPEC-DISENO: BPT Jersey coach workspace

**Fuente:** `DESIGN.md`, `PRODUCT.md`, `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/admin/admin.css`, `apps/web/src/app/admin/admin-shell.tsx`.
**Fecha de extracción:** 2026-09-18. **Método:** lectura de fuente y cálculo WCAG; sin inferir cifras de capturas. Conversión px con raíz de 16px.
**En una frase:** Tablón de academia púrpura, claro y geométrico, con navegación y controles administrativos simplificados para el coach.

La referencia dominante es el panel administrativo. La landing aporta identidad, no composición de marketing. Se conserva el tema claro explícito de `layout.tsx`, las fuentes y los componentes propios. Las prohibiciones genéricas contra púrpura, canvas cálido o reglas laterales no sustituyen la identidad existente. Las cifras siguientes son fuente real; los objetivos adicionales se identifican como criterios de aceptación.

## 1. Paleta (roles, no lista de colores)

| Rol | Valor | Uso observado | Superficie |
| --- | --- | --- | --- |
| Fondo | `#f2f1ed` | Canvas del espacio de trabajo | Dominante; porcentaje no medido |
| Superficie | `#ffffff` | Cabecera, paneles y formularios | Dominante; porcentaje no medido |
| Tinta | `#1a1a18` | Texto y bordes estructurales | Texto |
| Secundario | `#65635d` | Ayuda y metadatos | Texto |
| Marca | `#2f2483` | Sidebar, acciones, foco | Sidebar y acentos |
| Marca hover | `#211965` | Hover de rellenos púrpura | Interacción |
| Resaltado | `#d9f36a` | Distinción puntual | Escaso |
| Línea | `#8a8880` | Divisores y campos | Bordes |
| Superficie seleccionada | `#f0efff` / `#d9d6ff` | Lavado y borde informativo | Puntual |
| Estado positivo | `#176b49` / `#e7f6ee` | Texto y fondo semánticos en DESIGN | Puntual |
| Estado negativo | `#8d1c2f` / `#fff0f2` | Texto/regla y fondo semánticos en DESIGN | Puntual |

**Estrategia:** restrained en el contenido, committed en la navegación púrpura. No convertir los colores de cinturón o de estado en nuevos acentos.
**Contrastes calculados:** tinta/canvas **15.42:1**; muted/blanco **6.01:1**; muted/canvas **5.31:1**; púrpura/blanco **12.35:1**; lima/púrpura **9.98:1**.
**Coherencia:** globals contiene 28 hex, 55 tamaños y 8 valores de sombra distintos; admin contiene 21 hex, 46 tamaños y 0 declaraciones de sombra. Son hojas de múltiples superficies: extraer los roles vivos, no reproducir cada excepción. Conteo estático de valores literales, no de estilos computados.

## 2. Tipografía

- Display: `var(--font-display), Impact, sans-serif`; `--font-display` se carga con Barlow Condensed, pesos 500/600/700.
- Cuerpo: `var(--font-body), Arial, sans-serif`; Source Sans 3. Cuerpo global `1rem` / interlineado `1.5`.
- Cabecera admin h1: `clamp(1.8rem, 4vw, 3.2rem)`, peso 600, interlineado `0.9`, tracking `-0.02em`, uppercase.
- Título de sección admin: `clamp(2.5rem, 5vw, 4.8rem)`, interlineado `0.9`, uppercase.
- Título de panel admin h3: `clamp(1.9rem, 3vw, 2.8rem)`, interlineado `0.9`, uppercase.
- Kicker admin: `0.7rem`, 700, tracking `0.14em`, uppercase. Es metadato corto, no cuerpo de lectura.
- Botón global: `0.9rem`, 700, tracking `0.025em`. Botón principal admin: `font: inherit`, 700.
- No mono adicional. Tiempos y cifras usan `font-variant-numeric: tabular-nums` donde corresponde.
- La referencia tiene varios tamaños pequeños heredados; el nuevo cuerpo y la ayuda de formularios deben mantener `1rem`, sin copiar la reducción de legibilidad. `overflow-wrap: anywhere` protege títulos y párrafos.

## 3. Espaciado y ritmo

- Escala observada dominante: `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2rem` (8/12/16/20/24/32px), con excepciones propias admin `0.65 / 0.8 / 1.15rem`. No existe una cuadrícula estricta universal.
- Densidad: producto diaria, no hero. Panel admin padding `1.15rem`; heading de panel margen inferior `1rem`; acciones gap `0.65rem`; acciones cabecera gap `0.75rem`.
- Main admin máximo `100rem`, padding vertical `clamp(2rem, 5vw, 5rem)`, lateral `clamp(1.25rem, 4vw, 4.5rem)`.
- Landing máximo `90rem`, ritmo `clamp(4.5rem, 9vw, 8rem)`: no trasladar estos espacios de marketing al registro de asistencia.

## 4. Forma y elevación

- UI cuadrada, radio `0`; no trasladar radios de la app de miembros al coach.
- Panel principal `.admin-panel-card`: blanco, regla superior `0.3rem solid var(--mat-ink)`, padding `1.15rem`, `min-width: 0`.
- Inputs admin: `1px solid var(--line)`, radio `0`, mínimo `3rem`, padding `0.5rem 0.7rem`.
- Botones y enlaces administrativos: borde `1px`; sin sombra difusa.
- Las sombras duras de fotografía de landing son identidad de marketing, no requisito del producto. Los paneles admin no declaran `box-shadow`.

## 5. Componentes con carácter

- **Shell:** reutilizar `AdminShell`; `.admin-shell` son sidebar + `.admin-workspace`. No colocar una cabecera suelta en la columna reservada a la sidebar.
- **Navegación:** fondo púrpura y texto blanco; enlaces `min-height: 2.8rem`, padding `0.75rem 0.7rem`, gap `0.55rem`; selección con fondo blanco a opacidad `0.13` y regla blanca `2px`; `aria-current="page"`.
- **Principal sobre blanco:** `.admin-auth-button`: púrpura/blanco, mínimo `2.9rem`, padding `0.7rem 1rem`, radio `0`. Quitar su margen superior de `2rem` cuando se sitúe en filas de acciones, como hace la referencia.
- **Secundario sobre blanco:** `.admin-home-link` o equivalente tokenizado: borde y texto púrpura, padding `0.65rem 0.8rem`; hover púrpura/blanco. Asegurar objetivo mínimo de 44px.
- **Botón global:** mínimo `3.15rem`, padding `0.8rem 1.15rem`; `.button-secondary` usa texto y borde **blancos**, adecuado para púrpura. Requiere variante explícita sobre panel blanco; no reutilizarlo sin cambiar contexto.
- **Campos:** label visible superior, texto `1rem`, ayuda debajo, errores junto a la acción pertinente. Mantener autocomplete y semántica de contraseñas/ID.
- **Sesiones:** selección púrpura con texto y `aria-pressed`; lista operable por teclado con controles nativos, tiempo y capacidad legibles. Conservar datos de mínimos/máximos reales.
- **Registro:** tabla semántica con cabeceras o lista accesible en móvil; acciones a la vista, nombres/IDs largos ajustados sin recortar controles.
- **Avisos:** texto explícito y color semántico. Carga/éxito/error/vacío distintos; sin spinner ni emoji decorativo.

## 6. Motion

- Global `.button`: background/border/color/transform `160ms ease`, hover `translateY(-2px)`, activo `translateY(0)`.
- Nav admin: background/border/color `160ms ease`; sin `transition: all`.
- Landing actual incluye `hero-reveal 360ms ease-out` y demora `80ms` en ubicación. Esto difiere del resumen estático de DESIGN: no copiar reveal al panel de tareas.
- Coach debe presentar datos inmediatamente y respetar `prefers-reduced-motion`. No introducir librerías de animación ni entradas que oculten contenido.

## 7. Layout y composición

- Desktop: `.admin-shell` grid `minmax(15rem, 18rem) minmax(0, 1fr)`, `min-height: 100vh`. Sidebar púrpura a la izquierda; cabecera blanca y main en la columna derecha.
- Header admin: mínimo `7rem`, gap `1rem`, padding `1.25rem clamp(1.25rem, 4vw, 4.5rem)`.
- A `48rem`: shell block, sidebar oculta, menú móvil; header mínimo `4.5rem`, padding `0.85rem 1rem`; controles menú/cerrar `2.75rem` cuadrados.
- Menú móvil existente: backdrop z20, navegación z21; foco contenido, Escape cierra, foco vuelve al botón. Reutilizar esa implementación.
- Contenido coach: sesión/sede antes del registro; ayudas de preparación/cumpleaños subordinadas. Columna secundaria colapsa en móvil, sin imponer mínimos que desborden.
- Acceso: mismo shell, formulario limitado a ancho legible; Google y cambio de contraseña separados con títulos y espacios del sistema.
- No cambiar rutas ni atribuciones del rol. El menú y la pantalla de coach excluyen pagos; la seguridad continúa en backend y reglas, no en ocultar enlaces.

## 8. Voz del contenido

- Inglés británico funcional: acciones como “Check in”, “Change password”, “Link Google account”.
- Encabezados cortos, nombres reales del usuario, datos reales de sesiones, sin tono promocional.
- Mensajes de error concretos sin detalles de infraestructura ni información privada adicional. Ayuda de ubicación honesta: señal, no prueba; mantener la explicación del motivo de excepción.
- Evitar emoji decorativo, mayúsculas en párrafos y requisitos ficticios como un mínimo fijo cuando cada sesión tiene el suyo.

## 9. Lo que NO hace

- No mezcla gris azulado y selección azul con la marca púrpura.
- No usa tarjetas redondeadas, sombras difusas, gradientes, glass ni familias nuevas.
- No convierte el dashboard en una landing con hero, fotografías o animación de presentación.
- No añade dependencias para reproducir componentes existentes.
- No elimina funciones de asistencia, ubicación, preparación, cumpleaños, niveles o acceso al simplificar la presentación.
- No carga módulos de pago o concede permisos para lograr parecido visual.

## 10. Assets EXCLUIDOS

- No incorporar fuentes, logos, fotos ni iconos de terceros. La referencia pertenece al mismo proyecto: reutilizar su logo propio y las fuentes ya instaladas/cargadas está autorizado.
- Mantener `next/image` y dimensiones del logo existente; no duplicar archivos ni descargar versiones nuevas.
- No hacen falta fotografías ni ilustraciones para el panel. Reutilizar iconos administrativos existentes solo donde comunican una acción.

## 11. Receta de replicación

Los siguientes tokens ya existen. El bloque es referencia copiable para una reproducción, **no duplicarlos** en coach.css.

```css
:root {
  --bpt-purple: #2f2483;
  --bpt-purple-dark: #211965;
  --bpt-lime: #d9f36a;
  --mat-ink: #1a1a18;
  --gi-white: #ffffff;
  --canvas: #f2f1ed;
  --line: #8a8880;
  --paper-edge: #e8e7e3;
  --muted: #65635d;
  --content-width: 90rem;
  --section-space: clamp(4.5rem, 9vw, 8rem);
}
```

1. Reutiliza el shell administrativo completo con navegación filtrada por rol.
2. Conserva los tokens y las dos fuentes compartidas, radio cero y ausencia de sombras difusas.
3. Usa controles de producto púrpura sobre blanco; reserva botones blancos para fondo púrpura.
4. Mantén sede, sesiones y asistencia como recorrido principal; mueve información secundaria a una columna que se apila.
5. Conserva todos los estados y validaciones de acceso/registro; simplifica presentación y elimina pagos del coach.
6. Verifica a 390×844 y 1440×900, más 320px y 768px para desbordes, con teclado y movimiento reducido.
7. Mantén contraste de cuerpo ≥4.5:1 y controles ≥44×44px; no copies deficiencias de accesibilidad de una referencia heredada.
8. Mide carga y bundle; no atribuyas mejoras a intuición ni añadas bibliotecas de diseño.

### Brechas iniciales observadas antes de implementar

| Dimensión | Estándar | Brecha inicial | Corrección mínima |
| --- | --- | --- | --- |
| D2 shell | Sidebar + workspace de admin | Header ocupa la primera de dos columnas | Reusar AdminShell |
| D4 botones | Púrpura/blanco 12.35:1 | Secundario blanco sobre panel blanco, 1:1 | Variante de producto visible |
| D4 selección | `#2f2483` / `#f0efff` | `#2563eb` / `#eff6ff` | Tokens BPT |
| D6 forma | Radio 0, sin blur | Radios 6/8/10px, sombra 0 1px 3px | Anatomía admin |
| D3 cuerpo | 1rem legible | Ayudas inline 0.825/0.85rem | 1rem para instrucciones |
| D6 formulario | Label encima | PAYG con placeholder sin label | Retirar flujo financiero de coach según requisito |

Las brechas son lectura del estado inicial, no veredicto del resultado. El código puede cambiar durante el trabajo paralelo.

### Checklist de crítica final

- D1: la tarea de preparar/asistir una clase es identificable; Google y cambio de contraseña tienen acciones diferenciadas.
- D2: shell idéntico estructuralmente al admin; una columna móvil; cero overflow horizontal del documento.
- D3: fuentes exactas, cuerpo legible, ID/nombres largos, títulos sin recorte y encabezados semánticos.
- D4: tabla de tokens coincide; contrastes computados ≥4.5:1 en cuerpo y botones.
- D5: separación de grupos consistente con admin, sin doble padding del shell y dashboard.
- D6: targets ≥44px, foco visible, selección anunciada, menú Escape/foco, estados loading/empty/error/success.
- D7: transiciones acotadas, reduced-motion y contenido visible sin animación.
- D8: marca BPT y voz funcional; ningún pago en coach; sin nuevo sistema visual.
- Regresión: sesión/sede, check-in, justificación de ubicación, preparación, cumpleaños, niveles, Google, contraseña y logout siguen accesibles según rol.
- PASA únicamente con cero BLOQUEA y cero GRAVE abiertos, con limitaciones de evidencia declaradas.


### Evidencia de validación final (2026-09-18)

Revisión visual completada sobre `/tmp/coach-1440.png`, `/tmp/coach-390.png`, `/tmp/coach-320.png` y `/tmp/coach-access-mobile.png`. Son capturas de los componentes reales servidos por una vista local aislada con servicios, sesión y personas sintéticos; no acreditan un login real de producción. El builder reporta ausencia de overflow de documento en 320/390/768/1440px y 39 tests aprobados.

El crítico verificó directamente en Chromium a 390×844: acceso sin overflow; Barlow Condensed en título; Source Sans 3 en botones/campos; Google 44px de alto; campos 50px; guardar contraseña 48.375px. El menú móvil abre enfocando Cerrar; Escape lo cierra y devuelve el foco a Abrir. La marca y anatomía principales coinciden, y no hay controles financieros visibles.

Adaptaciones aceptadas: títulos coach `clamp(2rem, 3vw, 3rem)` y paneles `1.65rem` para reducir densidad frente al admin; línea de títulos 1.05/1.1 para evitar recortes; selección de sesión con canvas y borde/regla púrpura en vez de purple wash. Se conserva el mismo shell y las dos fuentes. Estas adaptaciones simplifican el panel sin introducir otra identidad.

El panel de niveles exclusivo headCoach carga con `lazy` + `Suspense`, sin dependencias nuevas. No se han medido Core Web Vitals ni rendimiento de producción; no se afirma una mejora porcentual de carga. Ver crítica con tabla diff y hallazgos en `coach-CRITICA-01.md`.
