# ADR-015: carga progresiva y agenda móvil del calendario

Fecha: 2026-09-20. Estado: implementación local; publicación web pendiente.

## Problema y decisión

Tras publicar `418d9b7`, el operador confirmó que veía el calendario, pero los datos reales
seguían tardando en aparecer. En móvil indicó que todo quedaba pequeño o exigía demasiado
desplazamiento. La revisión encontró que `loadRange` esperaba tanto las sesiones como sus
conteos de reservas antes de mostrar cualquiera. Además, el total anual lanzaba cinco lecturas
adicionales de hasta 90 días; esas lecturas también materializan las series semanales en servidor.

Se muestran las sesiones al recibirlas. Los conteos llegan independientemente y se representan
como desconocidos (`—`) mientras cargan o si fallan, nunca como cero. Un error de reservas permite
seguir usando las clases y reintentar solo los conteos. El catálogo tiene su propio error y
reintento. El total anual se conserva bajo `Calculate year total`, sin consultarlo automáticamente.

La caché sigue siendo en memoria, por ventana y durante 30 segundos, con ocho entradas por tipo
de lectura. Guardar o refrescar invalida sesiones y conteos. Los resultados abandonados no
actualizan la vista. Cambiar usuario, academia o rol remonta el contenido y descarta todo su estado,
incluidos catálogo, personal, diálogos, total y peticiones pendientes. No hay almacenamiento de
estos datos en localStorage ni cambios de autenticación, App Check o autorización del servidor.

## Móvil

Hasta 50 rem, semana y día usan una agenda con sesiones a ancho completo y texto de 1 rem.
Un selector nativo muestra un día de la semana sin realizar nuevas consultas. Today, el selector
de fecha y la vista Day conservan una selección coherente. Crear desde la agenda utiliza ese día.
Las sesiones simultáneas se apilan sin superposición; se muestra hora, título, sede e inscritos.

El mes móvil ofrece filas de semanas que abren la semana correspondiente. El escritorio conserva
la cuadrícula. Las secciones de Classes / Services y los filtros/opciones son desplegables nativos,
cerrados inicialmente en móvil y abiertos en escritorio. Se mantienen creación desde mes/lista,
acciones de semana, filtros, exportación y consulta de historial. Coach conserva su vista limitada.

## Evidencia

- Dos pruebas fallaron antes del cambio: datos de sesiones retenidos por conteos pendientes o
  fallidos (`.tmp/calendar-loading-red.log`).
- La medición usa ocho sesiones sintéticas con una demora de 2.000 ms en la respuesta de conteos.
  Se mide desde enviar la respuesta de sesiones hasta encontrarlas en el DOM del navegador.
  Antes: 2.372 ms escritorio y 2.369 ms móvil. Después: 93 ms escritorio y 52 ms móvil. Los resultados se guardan en
  `.tmp/calendar-loading-after-{desktop,mobile}-chromium.json`. La espera por reservas desaparece.
  Son mediciones locales en Next dev, no tiempos de Firebase ni una promesa de latencia real.
- Pruebas focalizadas: 141/141 en 14 archivos, `.tmp/calendar-loading-focused.log`. Incluyen conteos desconocidos,
  reintento independiente, respuestas tardías, cambio de identidad, catálogo y total bajo demanda.
- Navegador: 15/15 escenarios aplicables (uno exclusivo móvil omitido en escritorio), `.tmp/calendar-loading-browser-final.log`. Incluye owner/administrator/coach,
  alta/edición/retirada, recuperación de errores, teclado, caché y móvil de 320 px. El escenario
  de 1.400 sesiones las reparte entre días y horas; no se compara ese escenario con la medición
  mensual anterior, que colocaba las 1.400 sesiones en el mismo instante.
- TypeScript de todos los paquetes, lint y formato: `.tmp/calendar-loading-types-final.log`,
  `.tmp/calendar-loading-lint-final.log`, `.tmp/calendar-loading-format-final.log`.
  Últimos ajustes web: `.tmp/calendar-loading-web-types-final.log` y
  `.tmp/calendar-loading-web-lint-final.log`.
- Capturas sintéticas para revisión: `.tmp/calendar-agenda-320.jpg`,
  `.tmp/calendar-loading-after-mobile-chromium.jpg`, `.tmp/calendar-month-mobile-chromium.jpg`,
  `.tmp/calendar-counts-error-*.jpg` y capturas de editor/escritorio de la misma ejecución.

## Publicación

Solo cambia la web; no requiere desplegar Functions, reglas o índices. El operador realiza el
push, que publica mediante Pages. Falta confirmar Success del nuevo commit y comprobar velocidad
y usabilidad en su dispositivo con sesión real. La latencia de las propias llamadas de Firebase
no se midió en esta entrega y puede requerir una investigación posterior si el retraso persiste.
