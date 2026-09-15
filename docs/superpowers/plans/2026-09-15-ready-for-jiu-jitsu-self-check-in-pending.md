# Ready for Jiu Jitsu — qué falta para terminar

Estado revisado el **15 de septiembre de 2026** sobre el commit `c507c9227d33048a5cd6d152a90cbfe03fb2b06a`.

**Cierre del plan del workbench: 2026-09-15 (noche).** Los cuatro bloques de abajo quedaron hechos: Playwright 8/8 en :9471 (desktop + mobile), ocho capturas renovadas e inspeccionadas, `T040V2` en `aprobada` con la distinción callable-probada / adaptador-sin-ejecutar en ledger, tablero, auditoría y comentario del adaptador, y contenedor desechable retirado. Solo queda la sección de producción.

Plan de referencia: [2026-09-15-ready-for-jiu-jitsu-self-check-in.md](./2026-09-15-ready-for-jiu-jitsu-self-check-in.md).

## Resumen

La implementación de las tareas 1–11 está terminada. También están terminadas las revisiones de código y las correcciones de la tarea 12. **No hay defectos críticos o importantes abiertos en la revisión final.** Falta cerrar la validación visual y funcional del navegador después de las últimas correcciones, actualizar los registros de evidencia y entregar el informe final.

La última ejecución del emulador **sí pasó: 3 pruebas, 56,4 segundos, código de salida 0**. Los informes anteriores que dicen que el emulador no llegó a ejecutar las pruebas han quedado superados por ese resultado.

Hay dos metas distintas: terminar el plan en el workbench `:9471/accounts` y publicar la función para miembros reales en producción. La segunda requiere pasos de despliegue adicionales.

## Lo que ya está terminado

| Tareas                              | Resultado                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2: dominio                        | Ventanas de asistencia, open mat, selección de reserva, validación de entrada, precisión y distancia.                                                                   |
| 3–5: servidor                       | Rol adolescente, alcance por miembro, transacción, puntualidad, protección contra duplicados, prioridad del registro del coach y callable `selfCheckIn`.                |
| 6–7: integración web                | Geolocalización tras el gesto, mensajes de rechazo, repositorio fixture persistente y adaptador Firebase implementado.                                                  |
| 8–9: interfaz                       | Slider, estados, teclado, selección de hijo, confirmación y actualización del calendario cada 60 segundos. `/accounts` funciona como ruta compatible con `/account`.    |
| 10: primera validación de navegador | 8/8 pruebas anteriores y ocho capturas a 390 y 1280 px. Deben actualizarse porque después hubo correcciones visuales.                                                   |
| 11: documentación y controles       | Ledger, tablero y documentación implementados; formato, lint, tipos, pruebas y compilación pasan. Falta reconciliar los resultados finales en los registros.            |
| 12: revisiones y emulador           | Revisiones de diseño, seguridad y simplificación realizadas; correcciones aprobadas; emulador final aprobado. Falta cerrar la evidencia visual y el informe de entrega. |

Evidencia sobre el commit indicado:

- Suite completa: **308 archivos, 2.828 pruebas aprobadas**.
- Formato, lint y comprobación de tipos: aprobados.
- Compilación: Functions y Next aprobados; 42 páginas estáticas, incluidas `/account` y `/accounts`.
- Revisión final de código: aprobada, incluidas las correcciones de permisos de adolescentes.
- Emulador aislado: **3/3 pruebas aprobadas**, con flujo de agenda, rechazo por distancia, asistencia válida, repetición segura, rechazo del owner, privacidad y controles de App Check/sesión/entrada.
- Workbench: `/login`, `/account` y `/accounts` responden HTTP 200. Esto acredita disponibilidad de rutas, no una sesión autenticada ni el aspecto de la tarjeta.

## Pendiente para cerrar el plan del workbench

### 1. Repetir la validación autenticada del navegador

La evidencia anterior de la tarea 10 precede a las últimas correcciones de contraste, texto, pista de hermanos, animación y movimiento reducido.

- [x] Ejecutar `qa/tests/account-self-check-in.spec.ts` sobre el workbench actual a 390 y 1280 px.
- [x] Confirmar los casos de ubicación dentro y fuera del radio, permiso denegado y tutor con hijo seleccionado.
- [x] Confirmar teclado, umbral 94/95, gesto de puntero, ausencia de llamadas duplicadas y persistencia tras recargar.
- [x] Confirmar `/account` y `/accounts`, ausencia de errores del navegador y actualización inmediata de la asistencia en la lista.
- [x] Comprobar el cambio a confirmación cuando el coach ya ha registrado asistencia y el comportamiento del sondeo.

**Cierre:** resultados del navegador asociados a la revisión actual, con cualquier fallo corregido y vuelto a comprobar.

**Situación de acceso:** la ejecución autenticada quedó pendiente de autorización tras un rechazo anterior de la revisión automática de aprobación. Esta nota registra ese bloqueo; no supone que se haya resuelto. No afecta a las pruebas unitarias ni al emulador que ya han pasado.

### 2. Renovar las capturas y cerrar la revisión visual

- [x] Ejecutar `qa/scripts/account-self-check-in-shots.mjs` para obtener los estados `idle`, `locating`, `done` y `refused`, en móvil y escritorio.
- [x] Actualizar las ocho imágenes `qa/screenshots/ready-{idle,locating,done,refused}-{phone,desktop}.png`.
- [x] Inspeccionar contraste durante el recorrido del slider, foco visible, texto, pista de hermanos, alineación de la animación y movimiento reducido.
- [x] Sustituir la valoración visual provisional por una conclusión basada en estas capturas y el navegador actual.

**Cierre:** ocho capturas actuales revisadas y ningún problema visual pendiente que impida aceptar la tarjeta.

### 3. Actualizar el estado y las evidencias

- [x] Actualizar el registro `T040V2` en `Listav2/Listav2.data.js`, el tablero generado y `tasksv2.md` con el resultado real del emulador.
- [x] Reconciliar la auditoría de entrega: aún contiene filas que dicen que la prueba de `selfCheckIn` en emulador está pendiente.
- [x] Distinguir claramente «callable probado en emulador» de «flujo del navegador conectado a Firebase verificado».
- [x] Actualizar los comentarios del adaptador para reflejar exactamente la cobertura existente, sin atribuir al emulador API una prueba completa del adaptador web.
- [x] Cerrar `T040V2` como `aprobada` cuando se hayan resuelto las comprobaciones anteriores. El requisito de emulador de la tarea 12 ya está satisfecho; `desplegada` requiere además el despliegue real.

**Cierre:** plan, ledger, tablero y auditoría describen el mismo estado, sin pendientes del emulador ya resueltos ni afirmaciones de validación que no se hayan ejecutado.

### 4. Preparar la entrega final y cerrar los recursos temporales

- [x] Entregar un informe con commits, totales de pruebas, resultado Playwright, rutas de capturas, revisiones y resultado del emulador.
- [x] Incluir las decisiones que se apartaron del ejemplo del plan y sus costes o limitaciones, ya registrados en los informes de trabajo.
- [x] Conservar las evidencias necesarias antes de retirar recursos temporales.
- [x] Retirar el contenedor desechable de pruebas cuando ya no sea necesario. Los procesos de emulador ya están detenidos; el contenedor seguía disponible al terminar la prueba.

**Cierre:** entrega trazable y sin recursos temporales innecesarios. No hace falta repetir toda la suite si no cambia el código; cualquier corrección nueva necesita la validación proporcional a su alcance.

## Pendiente adicional para producción

Estos pasos pertenecen a la puesta en servicio real. No son prueba de que falte implementar el slider o el servidor.

- [ ] Autorizar y realizar el despliegue de `functions:selfCheckIn` y de los demás cambios necesarios para los permisos y contratos incluidos en esta implementación.
- [ ] Configurar y comprobar las geocercas de Town y West en los datos del entorno de destino. Sin configuración válida, la función devuelve `site_not_ready`.
- [ ] Comprobar el flujo completo con el adaptador Firebase desde una sesión autenticada: reserva confirmada → gesto → ubicación → callable → asistencia → recarga.
- [ ] Validar la configuración de autenticación y App Check del entorno de destino.
- [ ] Asegurar que las cuentas reales, especialmente las de adolescentes, tienen el rol y el vínculo correcto con su perfil. El aprovisionamiento general de adolescentes no queda resuelto solo por añadir soporte al rol en esta función.
- [ ] Registrar la evidencia del entorno publicado y solo entonces marcar el trabajo como `desplegada`.

**El despliegue de producción no se ha realizado ni está autorizado en el trabajo registrado.** El emulador aprobado usa datos sintéticos; el workbench usa el repositorio fixture para el calendario.

## Límites conocidos para la entrega

- La ubicación del dispositivo no demuestra resistencia a una ubicación falsificada. Se aplican los límites de precisión y distancia acordados.
- El registro del coach puede tardar hasta el siguiente sondeo de 60 segundos en aparecer en la tarjeta.
- El flujo completo del adaptador Firebase en un navegador sigue sin evidencia de ejecución, aunque su código tiene pruebas y el callable ha pasado el emulador.
- Las lecturas de anuncios para adolescentes se deniegan hasta que exista una implementación filtrada por destinatario; sus lecturas de membresía quedan limitadas al menor vinculado y no permiten crear membresías.
- Si falla la consulta auxiliar de penalizaciones, el calendario puede mostrarse sin esa información; la autorización del servidor para reservar se mantiene.

## Fuentes de evidencia

- [Plan original](./2026-09-15-ready-for-jiu-jitsu-self-check-in.md).
- [Especificación](../specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md).
- Informes locales en `.superpowers/sdd/2026-09-15-ready-for-jiu-jitsu-self-check-in/`: `completion-audit.md`, `task-12-emulator-report.md`, `final-whole-feature-review.md`, `final-fix-wave-report.md`, `final-fix-round-2-report.md` y `progress.md`. Este directorio está ignorado por Git; conservar o incorporar la evidencia necesaria en la entrega permanente.

Las casillas sin marcar del plan original no reflejan por sí solas el avance: varias corresponden a trabajo ya implementado y probado. Esta nota describe el pendiente real según las evidencias revisadas.
