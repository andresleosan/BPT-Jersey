# Aviso a office y coaches — release del primer lote de T058

**Estado: borrador para enviar. La casilla del §4.0(10) sigue vacía hasta que se envíe, y este
fichero no la rellena por sí solo.**

El §4.0(10) del runbook pide avisar a office y coaches **antes de empezar y al terminar**. La release
del 2026-09-08 se hizo en ventana inmediata y ese aviso no consta. No se puede enviar "antes" de algo
que ya ocurrió, así que lo que sigue es el aviso **posterior**, escrito para enviarse tal cual, y que
dice con todas las letras que llega tarde. Rellenar la casilla como si el aviso previo se hubiera
dado sería inventar evidencia; dejarla vacía y mandar esto es lo que sí se puede hacer.

Para el siguiente lote, el aviso previo se manda con el mismo texto en futuro y la casilla se rellena
de verdad.

---

## Texto para enviar

**Asunto:** BPT Jersey — cambios en la plataforma del 8 de septiembre

Hola:

Os escribo para contaros un cambio que ya está publicado en la plataforma. Debería haber avisado
antes de hacerlo y no lo hice; lo cuento ahora con el mismo detalle.

**Qué se ha publicado.** 31 funciones nuevas del panel de administración. En lo que os toca:

- **Personal y permisos:** alta y edición de perfiles de staff, activar y desactivar personal,
  disponibilidad y asignaciones, y conceder o retirar permisos.
- **Familias:** crear, consultar y editar familias.
- **Seguimiento de interesados (CRM):** editar un contacto, moverlo de etapa y ver su historial.
- **Faltas sin avisar:** proponer penalizaciones, listarlas y resolverlas.
- **Catálogo público de la tienda.**
- **Anuncios y avisos:** los nueve de anuncios, más recordatorios de clientes, alertas de retención y
  próximos cumpleaños.

**Y un arreglo que os afecta aunque no lo pidierais.** Al comprobar la release en el navegador
apareció que **varias pantallas del panel llevaban tiempo dando error** al abrirse: el panel
financiero, los informes operativos, la agenda, copia de seguridad, exportación y el perfil de tutor.
No era un fallo de esta release: era un permiso que le faltaba al servidor **desde el principio**, y
la release fue lo que hizo que alguien mirara. Ya está corregido. Si alguna de esas pantallas os
venía fallando "desde siempre", probadla otra vez.

**Qué tenéis que hacer vosotros.** Nada. No hay que instalar ni cambiar nada, y no hay que volver a
entrar. Los datos de alumnos, asistencia y pagos no se han tocado.

**Qué mirar durante los próximos días.** Si al abrir una pantalla del panel os sale un error, o algo
que funcionaba deja de funcionar, avisad en cuanto lo veáis. Es más útil que espera a ver si se
arregla solo.

**A quién escribir si algo falla:** a Andrés, directamente. Contadme **qué pantalla**, **qué
estabais haciendo** y **la hora aproximada** — con eso se encuentra en los registros; sin eso, mucho
menos.

Perdón por el aviso tardío.

Un saludo,
Andrés

---

## Notas para la fila de release (no enviar)

- Release: primer lote de T058, commit `437e7a2`, 2026-09-08. 31 callables, cuatro lotes: `staff` (9),
  `core` (10), `comms` (12), `scheduled` (1).
- El arreglo mencionado es el permiso `firebaseappcheck.appCheckTokens.verify` que le faltaba a la
  cuenta de servicio; afectaba a toda callable con `consumeAppCheckToken`.
- **No** se menciona en el texto: los identificadores de despliegue, el rollback, ni las funciones que
  siguen sin desplegarse. No es información que office o coaches necesiten para actuar, y alargar el
  aviso es la forma más segura de que no se lea.
- Cuando se envíe: anotar la hora en la fila de release, en la línea "Aviso a office y coaches", como
  **posterior** y sin previo.
