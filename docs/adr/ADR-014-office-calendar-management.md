# ADR-014: gestión administrativa completa del calendario

Fecha: 2026-09-20. Estado: backend desplegado; publicación web y validación autenticada pendientes.

## Decisión del operador

Owner y administrator pueden crear tantas sesiones como necesiten, corregir sesiones en cualquier
estado y retirarlas del calendario activo. El operador confirmó que retirar una sesión debe
conservar sus reservas y asistencia en el historial. Se reutiliza la cancelación existente; no
hay borrado físico ni cambios masivos de sesiones reales. Conceder acceso administrativo sigue
reservado al owner y se conservan los permisos históricos del coach y headCoach.

La consulta puntual de Firebase Auth del 2026-09-20 confirmó que la cuenta indicada por el
operador, admin@admin.com, ya tiene role=owner y está habilitada. No se modificó la cuenta ni
su academia. Este rol no elimina validación de datos, autenticación o aislamiento por academia.

## Cambios

- No existía una cuota de creación por usuario. Se prueba la creación, edición y cancelación de
  450 sesiones por cada rol de oficina, incluso con fecha histórica y horario coincidente.
- Se elimina el tope artificial de 400 ocurrencias guardadas al editar una serie. Se conserva la
  transacción atómica, sus reintentos y las excepciones/cancelaciones individuales. Una prueba
  con Firestore local modifica y detiene una serie con 600 ocurrencias conservando una reserva.
- El servidor deriva del rol autenticado la capacidad de corregir sesiones active, completed
  y cancelled. El cuerpo de la petición no puede conceder ese permiso. La edición conserva
  estado, identidad, reservas y autor de la corrección.
- Repetir una sesión histórica conserva su estado en esa fecha y programa las siguientes;
  el estado completed/cancelled no se copia a las futuras ocurrencias.
- La oficina puede cambiar sede y tipo de clase desde el editor, sin copiar la sesión. El tipo
  nuevo actualiza el título con el nombre del catálogo. Los identificadores se validan.
- Las clases simultáneas tienen columnas independientes; se elimina la superposición de la
  tercera clase sobre la primera. El desplazamiento se mantiene dentro del calendario.
- El resumen mensual cuenta cada sesión una vez, en la fecha local de Jersey, y excluye las
  canceladas. La distribución semanal y el filtrado se memorizan entre renders.
- Caché de hasta ocho ventanas, durante 30 segundos, ligada a identidad, academia y rol; se
  invalida al modificar y al pulsar Refresh schedule. Una ventana abandonada no reemplaza la
  actual. Cambiar de fecha no deja tarjetas de la semana anterior durante un error; se ofrece
  Retry schedule. Una fecha vacía no rompe la página. El total anual no reinicia su lectura con
  cada navegación y descarta respuestas abandonadas.
- El editor bloquea envíos simultáneos mientras guarda; la respuesta guardada se incorpora
  inmediatamente a la vista y después se revalida.

No se cambian reglas, IAM, App Check, Google linking, asistencia ni límites de reservas de los
miembros. Los límites técnicos de tamaño/tiempo de Firestore siguen aplicándose: no hay una
promesa de capacidad informática infinita. Referencia oficial consultada:
https://firebase.google.com/docs/firestore/quotas#writes_and_transactions

## Medición y comprobación

Con 1.400 sesiones sintéticas y diez muestras tras calentamiento, la mediana del cálculo mensual
pasó de 53,9 ms a 4,4 ms en el mismo entorno local. Se compara el cálculo anterior de cinco
semanas completas con el conteo mensual nuevo. Evidencia `.tmp/calendar-layout-before.json` y
`.tmp/calendar-layout-after.json`. No mide red ni latencia real de producción.

La evidencia de navegador utiliza una vista local en loopback con todas las peticiones externas
interceptadas y datos sintéticos. Resultados finales se registran en BACKLOG.md, T059V2.

## Publicación

El operador autorizó explícitamente esta publicación en el chat el 2026-09-20. Se desplegó
exclusivamente `functions:updateSession` en `bptjersey-f5a25`, región `us-central1`, desde el
commit de código `8aa611f`. Firebase confirmó Successful update operation y Deploy complete,
con código de salida 0. Evidencia: `.tmp/calendar-deploy.log`.

Una petición POST vacía, sin autenticación, devolvió HTTP 401 el 2026-09-20 a las 07:32 UTC;
evidencia `.tmp/calendar-post-deploy.json`. Esta comprobación verifica el rechazo del acceso
anónimo; no sustituye la comprobación funcional con sesión administrativa. No se modificaron
sesiones reales, cuentas, reglas o IAM. Las otras callables no requirieron redespliegue.

La web queda preparada en `main` para el push del operador. Siguen pendientes el push, Success
del commit correspondiente en Cloudflare Pages y comprobar creación, edición y retirada
conservando el historial desde una sesión administrativa en producción.

## Evidencia final

- Suite completa: 4.351 pruebas en 404 archivos (`.tmp/calendar-full.log`). Después de esa
  ejecución, revisión de caché y repetición histórica: 321 pruebas focalizadas pasan
  (`.tmp/calendar-focused-final.log`); el ajuste final de permisos de sede/tipo se comprueba
  en `.tmp/calendar-final-server.log`.
- Navegador: 10/10 escenarios, móvil/escritorio, owner/administrator/coach, interacción por
  teclado, ocho clases simultáneas sin superposición, altas, edición, retirada, reintento y
  regreso a una semana sin nuevas lecturas (`.tmp/calendar-browser-verified.log`).
- Firestore: 3/3 escenarios con datos sintéticos, incluyendo 600 ocurrencias, conservación de
  reserva y asistencia, cambios concurrentes y repetición desde una sesión cancelada
  (`.tmp/calendar-integration-reviewed.log`). Emulador detenido al terminar.
- TypeScript, lint, formato y compilación de dominio y Functions correctos; última compilación
  `.tmp/calendar-functions-build-final.log`. Tras cambiar solamente pruebas, tipos de QA
  `.tmp/calendar-qa-types-reviewed.log`.
- Mutación del permiso histórico: concederlo temporalmente a todos los managers hace fallar
  las pruebas; código restaurado y pruebas normales posteriores correctas
  (`.tmp/calendar-authority-mutation.log`).
- Capturas reales con fixtures, inspeccionadas: `.tmp/calendar-editor-*.jpg`,
  `.tmp/calendar-month-*.jpg`, `.tmp/calendar-error-*.jpg` y `.tmp/calendar-owner-*.jpg`.
- Consulta de la cuenta limitada al correo solicitado: `.tmp/calendar-owner-verification.json`.
