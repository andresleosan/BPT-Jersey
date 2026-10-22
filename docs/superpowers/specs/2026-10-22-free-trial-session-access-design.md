# Free Trial: acceso por sesión (2026-10-22)

## Por qué

El fin de semana del 17-18 de octubre el owner renombró el tipo «Introduction Class» a «Free Trail».
Hasta el 20 de octubre una sesión contaba como clase de prueba solo si el nombre de su tipo empezaba
por «Introduction Class» (`isIntroductionClassName`). La casilla «Introduction Class» que se añadió
el 20-oct a *Types* no está marcada en ningún tipo de producción. Resultado: los adultos en Free
Trial no pueden reservar nada.

Luis quiere dos cosas:

- Que el acceso no dependa nunca de un nombre.
- Que en cada sesión el owner/admin decida quién la reserva: miembros con plan pagado, miembros en
  Free Trial, o ambos.

## Decisiones

| # | Decisión | Quién | Dónde |
|---|----------|-------|-------|
| D1 | Cada sesión lleva dos interruptores: «Paid members» y «Free Trial». Se puede activar uno, el otro o los dos. Al menos uno tiene que estar activo. | Luis | Mensaje 2026-10-22 |
| D2 | Menores de 16 en Free Trial: reservan sesiones normales de su edad y su centro (las que tienen «Paid members») y también las que tienen «Free Trial» de su edad. El interruptor «Free Trial» solo restringe a los adultos. | Luis | Pregunta «Menores» |
| D3 | Adultos (16+) en Free Trial, principiantes o con experiencia: solo sesiones con «Free Trial» activado. Desaparece la regla «tu primera clase es una Introduction Class, la segunda puede ser normal». | Luis | Pregunta «Adulto exp.» |
| D4 | Se mantiene el cupo del trial: principiante 2 clases y con experiencia 1, a cualquier edad, con 30 días. Es lo que hay hoy (`enrolmentTrialAllowance`, `TRIAL_DAYS`). | Luis | Mensaje 2026-10-22 |
| D5 | Valor por defecto, en sesiones nuevas y en las existentes: Paid on / Free Trial off. Las sesiones del tipo de prueba actual («Free Trail» y las Introduction Class) quedan Free Trial on / Paid off. | Luis | Pregunta «Por defecto» |
| D6 | El owner corrige la errata «Free Trail» → «Free Trial» en *Types*. Ningún script toca datos de producción. | Luis | Pregunta «Renombrar» |
| D7 | Miembros con plan pagado = cualquiera que reserve por el camino de membresía (también PAYG y Transit Free). | Claude | — |
| D8 | Se deja de exigir experiencia en las clases de prueba: un menor con cinturón también puede reservar una sesión Free Trial de su edad. Sigue la línea de D3. | Claude | — |
| D9 | Se quita la casilla «Introduction Class» de *Types*. Con D5 ya no decide nada en las sesiones nuevas y confundiría. El campo guardado se sigue leyendo solo para las sesiones antiguas. | Claude | — |
| D10 | Las Open Mats siguen fuera del trial, como hoy. | Claude | — |
| D11 | Una sesión legado (`membership`) es Free Trial si el nombre de su tipo empieza por «introduction class», «free trial» o «free trail», **o** si su marcador es `true`. El nombre gana a un `false` guardado. No puedo leer producción para saber si «Free Trail» guardó `false` al editarse después del 20-oct. | Claude | Revisión |
| D12 | Una sesión que solo tiene «Free Trial» admite a un menor únicamente si su tipo es infantil (todas sus edades por debajo de 16, `introductionClassForChildren`). Si no, es de adultos (16+). Así el tipo de prueba de «todas las edades» no se abre a niños. En las sesiones con «Paid members», el menor sigue las edades del tipo como hoy. Un tipo sin `ageRange` y con `ageBand: "all"` no es clase de trial. | Claude | Revisión |
| D13 | Cambiar los interruptores no toca las reservas ya hechas. Las reglas se aplican en el momento de reservar, igual que en cualquier otra edición de sesión de hoy. | Claude | Revisión |
| D14 | Copiar semana y generar copian el valor guardado. Las sesiones legado siguen como legado y las aplica D11. | Claude | Revisión |
| D15 | Quien no tiene ni plan ni trial activo no ve las sesiones que solo tienen «Free Trial», como hoy con la Introduction Class. | Claude | Revisión |
| D16 | Un miembro con plan que hace check-in en una sesión solo Free Trial va por el camino de membresía y recibe «This class is for Free Trial members». Se quita el `intro ||=` de `schedule-callables.ts:1178`. | Claude | Revisión |

## Modelo: reutilizar `accessMode` de la sesión

`accessMode` ya viaja por crear, editar, copiar semana, generar e invitaciones. Por eso no se añade
ningún campo nuevo: se añaden dos valores y una función de dominio.

| `accessMode` guardado | Paid | Free Trial | Notas |
|---|---|---|---|
| `paid` (nuevo) | sí | no | Lo que escribe el panel nuevo para «solo pagados» |
| `intro` (existente) | no | sí | Lo que escribe el panel nuevo para «solo Free Trial» |
| `trial-and-paid` (nuevo) | sí | sí | |
| `membership` (legado, valor por defecto de clientes antiguos) | si el tipo NO es intro | si el tipo es intro | El tipo se lee con `isIntroductionClass({}, program)` |
| `private-lesson` | — | — | Sin cambios |

Hay una única regla en el dominio, `sessionAudience(session, program) → { paid, trial }`, en
`packages/domain/src/schedule/schedule-contracts.ts`. Todos los puntos que hoy preguntan
`isIntroductionClass` para decidir quién puede reservar pasan a usarla.

Arreglo inmediato de los datos actuales sin migración: `isIntroductionClassName` acepta también los
nombres que empiezan por «free trial» o «free trail». Así las sesiones `membership` del tipo «Free
Trail» quedan Free Trial on / Paid off en cuanto se despliega (D5). Cuando el owner renombre el tipo,
`mergeProgramV2` congela el marcador a partir del nombre anterior, y la regla sigue en pie.

## Reglas por camino

- **Reserva de membresía** (`booking-transaction-service.ts`): se rechaza si `!paid`, con el mensaje
  «This class is for Free Trial members».
- **Reserva de trial** (`intro-booking-service.ts`): se mantienen sede, estado del trial, waiver, sin
  historial de membresía, cupo y corte de 60 min. Las reglas nuevas:
  - Adulto (16+): exige `trial`. Si el tipo tiene `ageRange`, debe admitir su edad y su centro.
  - Menor (<16): exige `paid || trial` y que el tipo admita su edad y su centro.
  - En los dos casos se rechazan las Open Mats.
  - Ya no se miran ni la experiencia ni la regla de la «primera clase Intro».
- **Calendario del miembro** (`member-calendar-contracts.ts`): `trialLockedReason` aplica las mismas
  reglas que el servidor. `lockedReasonFor` con plan oculta las sesiones con `!paid` (como hoy hace
  con intro). Desaparecen el motivo `trial_intro_first` y su texto.
- **Walk-in / self check-in** (`schedule-callables.ts:1178`), **botón Reservar**
  (`member-calendar.tsx:567`): la sesión va por el camino de trial cuando el miembro está en trial o
  cuando `!paid`, que es lo mismo que hacen hoy con intro.
- **Límites por edad y listas de espera** (`age-capacity.ts`, `schedule-callables.ts:679/684`,
  `waitlist-invitations.ts`): «ordinaria» pasa a significar solo pagados (`paid`, o `membership` de
  un tipo normal). `trial-and-paid` e `intro` quedan fuera, como hoy la Introduction Class; así no
  cambia cómo cuentan las reservas de trial en esas funciones.
- **Etiquetas para el miembro** (`session-card.tsx`, requests, membership): «Introduction Class» pasa
  a «Free Trial».

## UI de admin

En el panel de sesión (`session-panel.tsx`), el selector de acceso queda en «Class / Private lesson».
Con «Class» aparecen dos interruptores (`<input type="checkbox" role="switch">`, el mismo patrón que
`account/settings`):

- «Paid members: members with an active paid plan can book».
- «Free Trial: members on their Free Trial can book».

No se pueden apagar los dos: el que queda encendido se bloquea. Una sesión legado se muestra con su
valor efectivo (`sessionAudience`). Si se guarda, se escribe el valor explícito, pero solo cuando el
owner cambió algo.

En *Types* se quitan la casilla y la insignia «Introduction Class» (D9).

## Despliegue

1. Primero las functions que leen o escriben `accessMode`, porque los parsers estrictos antiguos
   lanzarían un error con los valores nuevos.
2. Después la web.

Las nuevas lecturas solo existen cuando la web nueva las escribe, así que este orden no tiene ventana
de error. No hay índices ni migraciones.

## Fuera de alcance

- Pagos online.
- Cambiar el cupo o los días del trial.
- Insignias Free Trial en las vistas de admin de calendario y lista. Se añaden si el owner lo pide.
