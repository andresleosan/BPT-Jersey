# LECCIONES.md

Registro de cierre de BPT Jersey Academy Platform. Cada lección se escribe **con el caso que la
produjo**, porque una lección sin su caso es una frase que suena bien y no cambia nada. Todas
ocurrieron en este proyecto y están trazadas al ledger (`tasks.md`) o al runbook
(`docs/operations/t058-release-rollback-runbook.md`).

El orden es por cuánto costaron.

---

## 1. Un bloqueo que no se ha medido no es un bloqueo: es una hipótesis

Tres casos, y los tres estaban **escritos en un runbook**, que es lo que los hizo caros: una nota
declarativa se lee después como un hecho comprobado.

- «Las alertas están bloqueadas.» Resultó falso desde el primer día. Costó releases enteras de
  espera.
- «La alerta 4 no es creable hoy.» Era cierto **de una forma concreta** —umbral sobre una métrica sin
  descriptor publicado— y falso de otra: una condición de coincidencia de registro no valida contra
  descriptor alguno y se creó en minutos.
- «Las *build watch paths* exigirían un token que no se pidió.» La sesión OAuth que ya estaba en la
  máquina llevaba scope `pages (write)`.

**Qué hacer distinto:** una nota que declara un bloqueo lleva al lado **la comprobación que lo
midió**, con fecha y comando. Si no la lleva, la siguiente persona la mide antes de creerla. Y
distinguir siempre «no se puede» de «no se puede así».

## 2. El sitio donde se ve el síntoma casi nunca es el sitio donde está la causa

Cinco casos, cuatro de ellos en una sola noche:

| Se veía | Era |
| --- | --- |
| `scheduled` en el inventario | una etiqueta sin job que la disparase |
| `journal unavailable` | un índice compuesto ausente |
| `401` en el navegador | un permiso IAM que le faltaba **al servidor** |
| un fichero que volvía al grafo | una entrada en un manifest, no en el ignore |
| `Only a frozen bootstrap tuple` al reintentar | una operación ya completada, que abre la congelación al terminar |

El `401` es el más instructivo: se lee como «no estás autenticado» y el operador estaba
perfectamente autenticado. Tres capas de indirección entre lo que se ve y lo que pasa.

**Qué hacer distinto:** antes de razonar sobre el que llama, **leer el log del que falla**. Dos
hipótesis cayeron esa noche antes de mirar un log que decía la respuesta en texto plano, con enlace
al troubleshooter incluido, a un comando de distancia.

## 3. Una precondición se mide por unidad desplegada, no por lote

La precondición 6 del runbook —«si el mecanismo que entrega los parámetros no existe, la función no
entra en el lote»— se midió para las 31 callables del primer lote y **no** para la programada que se
añadió al final. Esa fue justo la que salió rota: ligaba un secreto de los cinco que su configuración
de R2 necesitaba. **El añadido de última hora es el que nadie vuelve a mirar.**

## 4. Una comprobación de existencia no es una comprobación de funcionamiento

Varias formas del mismo error, todas encontradas aquí:

- `toBeDefined()` no prueba una configuración; prueba que hay algo.
- Un doble que descarta sus argumentos no puede ver lo que le pasan, así que no puede fallar.
- Un vigilante buscó el texto «AppCheck token was rejected» cuando el mensaje real era «Failed to
  validate AppCheck token», y concluyó que no había rechazos habiéndolos.
- Una consulta de logs pidió una ventana que empezaba **en el futuro** y devolvió cero resultados,
  que se leyeron como cero fallos.
- El inventario decía `scheduled` leyendo una etiqueta, no comprobando el job.

**Qué hacer distinto:** un filtro que no encuentra nada y una ventana vacía **se parecen mucho a un
éxito, y no lo son**. Antes de creerse un cero, comprobar que la consulta encontraría algo si lo
hubiera. Y la comprobación honesta de una función programada son **dos** lecturas: la etiqueta dice
que se desplegó con intención de programarse, y solo `gcloud scheduler jobs list` dice si algo la va
a llamar.

## 5. Un guarda que ninguna prueba mata es una intención, no una regla

En la rebanada 9 de T108, el parser de tuplas exigía que el `keyId` llevase su propia `kind` como
prefijo. Desactivarlo **no hacía fallar ninguna prueba**. La regla estaba escrita, razonada y
comentada; lo único que no estaba era sujeta.

**Qué hacer distinto:** la comprobación por mutación, sistemáticamente, sobre cada regla nueva que
importe. Es barata —desactivar el guarda y contar muertes— y es la única que distingue una regla de
un comentario. En esa rebanada, cinco reglas, cinco mutaciones, cinco muertes; la quinta solo después
de escribirle la prueba que le faltaba.

## 6. Un segundo guarda para una regla que ya vive un nivel más abajo no es defensa en profundidad

Es el que se pudre en silencio cuando el de abajo cambia. En la rebanada 8 se escribió un chequeo de
línea base ya grabada junto al de cobertura; era inalcanzable, porque el esquema de estado ya ligaba
ambas cosas. Se borró y en su lugar quedó una prueba que fija la regla donde de verdad vive.

En la rebanada 9 la misma decisión se tomó de antemano: el runner rechaza pronto **solo lo que no
puede expresar** —un documento ausente, ilegible o de otro inquilino— y deja que todo lo demás muera
en la comparación de MAC, que es el único sitio donde esa regla vive.

## 7. Un monitor mal construido genera el error que vigila

El uptime check inicial fabricó, con un `GET` desnudo, la única entrada de error del proyecto. **Un
monitor que produce ruido no es un monitor: es la primera fuente de ruido que hará ignorar el
canal.**

## 8. Las alertas se pagan solas, y antes de lo que parece

La política de `5xx` creada una mañana cazó **una hora después de existir** una función que llevaba
rota desde agosto. El coste de crearla era menor que el de la reunión en la que se discutió si hacía
falta.

## 9. No se aprueba por instrucción, se aprueba por evidencia

La regla que más veces evitó un cierre falso. Se aplicó incluso contra la conveniencia: T058 se
aprobó **con una casilla vacía escrita en su fila** —el aviso a office y coaches, que no consta— en
vez de rellenarla por inferencia. Aprobar no es declarar que todo salió perfecto: es declarar que la
evidencia que la fila pedía existe y se puede abrir.

Corolario que hizo honesto el porcentaje: **partir una fila suma en los dos lados del ratio.** Cerrar
entera una fila dejando caer lo que falta es exactamente lo que el tablero existe para impedir.

## 10. El código escrito no es una capacidad hasta que está desplegado

La lección más grande, y solo se ve al final. El tablero marca **118 de 121 (98 %)** y producción
sirve el **44 %** de lo que la web invoca: 66 de 149. Ninguno de los dos números miente; miden cosas
distintas, y **el proyecto midió durante meses el primero**.

La consecuencia acumulada está en `docs/operations/t059-capability-gap-analysis.md`: producción sirve
hoy al 100 % las dos cosas que el BRIEF puso **fuera** del MVP —retail, CRM y retención— y al 0 % la
capacidad 6 y al 6 % la capacidad 3, ambas por delante de aquéllas en el propio orden RICE del BRIEF.
Nadie decidió eso. Salió solo, eligiendo cada lote por lo que estaba listo y era barato.

**Qué hacer distinto:** que el tablero lleve, junto al porcentaje de filas aprobadas, **el porcentaje
de capacidad disponible en producción**. Son dos columnas, no una, y la segunda es la que le importa
a quien va a usar el producto.

## 11. Un fichero que describe algo no es ese algo

Existe un borrador del aviso a office y coaches. La casilla del §4.0(10) **sigue vacía**, porque un
documento que describe un aviso no es un aviso. Vale igual para runbooks que nadie ha ejecutado y
para planes que nadie ha aprobado.

---

## Lo que este proyecto hizo bien y conviene repetir

No todo es corrección. Cuatro cosas se sostuvieron y pagaron:

1. **El ledger narrativo.** Cada decisión con su porqué, incluidas las incómodas. Ha permitido
   retomar el trabajo entre sesiones sin reconstruir el estado, y ha impedido más de una vez
   repetir una hipótesis ya descartada.
2. **Puertos y adaptadores en la migración.** Las siete rebanadas de T108 fueron piezas puras
   primero, cableado después. Las reglas se prueban sin Emulator y el Emulator prueba lo que ningún
   doble puede: que las cosas caen en una transacción o en ninguna.
3. **Escribir por qué, no solo qué.** Los comentarios del código de migración explican la decisión y
   la alternativa descartada. Es lo que hizo posible, meses después, saber si un guarda podía
   borrarse.
4. **Rechazar en vez de reparar.** Ante un dato que no cuadra, fallar cerrado y dejar la congelación
   en pie. Resolver una identidad reasignada necesita una persona, no una heurística.

## Lo que queda pendiente al cerrar esta fila

- **T108** — la migración del directorio canónico. Van dos ejecutores de siete y nueve rebanadas.
- **T127** — la renovación digital del waiver, esperando una decisión de producto.
- **Los lotes de release** que cierran la brecha del §5 del análisis de capacidades.
- **Rotar la access key de R2**, que exige redespliegue porque las funciones fijan la versión del
  secreto.
- **Dos `catch` que descartan la causa** —`member-directory-empty-initialize.mjs` y el de
  `previewStore.listExpired`—, que costaron tiempo real de diagnóstico y siguen ahí.
- **`no-show-penalties-client.ts` sin fichero de pruebas**, y es justo la callable que se vio fallar
  en producción.
- **El aviso a office y coaches**, sin enviar.
