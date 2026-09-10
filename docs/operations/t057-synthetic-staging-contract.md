# T057 Synthetic Staging Contract

Estado: **enmendado el 2026-09-07 (ver "Enmienda" al final). El proyecto staging separado no se va a aprovisionar.** El contrato documental original se conserva completo debajo, porque describe lo que se decidio no hacer y por que, y porque sus gates siguen siendo la referencia si algun dia se retoma.

Fecha: 2026-08-28

## Resultado buscado

Validar una release sobre infraestructura separada de produccion, con datos exclusivamente sinteticos, acceso restringido y evidencia reproducible. El entorno debe parecerse a produccion lo suficiente para probar Auth, Rules, Functions, Firestore, RTDB y el frontend estatico, sin usar datos, credenciales ni recursos de bptjersey-f5a25.

## Ruta seleccionada

| Ruta                                                                                                | Friccion | Seguridad/reversibilidad                                                                        | Decision                                                              |
| --------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Emulator local existente                                                                            | Baja     | Muy seguro y reversible, pero no valida identidad cloud, regiones, IAM, dominios ni despliegue  | Conservar como gate local; insuficiente como staging real             |
| Proyecto Firebase separado + preview Cloudflare protegido, configurados manualmente una primera vez | Media    | Aisla produccion, permite borrar/recrear fixtures y produce evidencia real antes de automatizar | Elegida                                                               |
| CD completo con secretos y deploy automatico desde el inicio                                        | Alta     | Repetible, pero amplia permisos y superficie antes de demostrar el flujo                        | Diferir hasta que una corrida manual limpia justifique automatizacion |

## Identidad y fronteras obligatorias

- Produccion: bptjersey-f5a25. Nunca puede usarse como staging, alias, destino de test o fuente de fixtures.
- Local: demo-bpt-jersey con Emulator Suite loopback.
- Staging: proyecto Firebase/Google Cloud nuevo y separado. El ID real se registra solo despues de crearlo; no se reutiliza ningun ID productivo.
- Tenant inicial: demo-academy con fixtures sinteticos versionados o generados. Se prohiben exportaciones, copias, screenshots o restauraciones de datos reales.
- Frontend: preview de Cloudflare Pages no productivo, protegido con Cloudflare Access. Las previews son publicas por defecto hasta activar la politica.
- Variables web: NEXT_PUBLIC_FIREBASE_ENV=staging y NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false. NEXT_PUBLIC_LEVELS_BACKEND permanece false hasta desplegar y verificar explicitamente el callable y el seed sintetico.
- Integraciones externas: email, SMS, pagos, analytics y proveedores no esenciales permanecen deshabilitados/unconfigured. R2 real se difiere; si se prueba despues, requiere bucket staging separado y PDFs sinteticos.
- Secretos: nunca en chat, Git, logs o artefactos. La primera configuracion sera interactiva/manual; GitHub Environment se agrega solo cuando el flujo manual quede verificado.

## Decisiones irreversibles o con costo antes de aprovisionar

1. Operador de la cuenta y responsables IAM del proyecto staging.
2. Region/ubicacion de Firestore, Functions, RTDB, logs y cualquier objeto. La ubicacion de Firestore no puede cambiarse despues de aprovisionarla.
3. Plan de facturacion necesario para Functions y limites de presupuesto/alertas. No se habilita Blaze sin aprobacion explicita.
4. Dominio/origen staging y usuarios permitidos por Cloudflare Access.
5. Relacion controller/processor, ubicaciones y transferencias revisadas dentro de T011, aunque el entorno inicial use solo datos sinteticos.
6. Politica de destruccion de fixtures, logs, artefactos y backups de staging.

## Secuencia manual y reversible

### Gate A - Decision humana

Estado 2026-08-28: bloqueado. El operador confirmo que el decision owner y el
asesor/reviewer de T011 no estan designados. El paquete de seleccion y consulta
esta listo en `docs/operations/t011-reviewer-engagement-brief.md`, sin envio,
contratacion ni gasto.

- Designar decision owner de BPT Jersey y asesor/reviewer aplicable para T011.
- Confirmar cuenta Firebase/Google Cloud y Cloudflare que administraran staging.
- Elegir region despues de revisar T011 y documentar la razon.
- Aprobar por separado cualquier alta de billing o gasto.

### Gate B - Proyecto vacio

- Crear un proyecto Firebase separado y etiquetarlo como non-production/staging.
- No crear Firestore, RTDB, Functions o buckets hasta completar Gate A.
- Agregar el alias staging a .firebaserc solo con el ID confirmado; default conserva demo-bpt-jersey.
- Verificar con una lectura metadata-only que staging y produccion tienen IDs distintos.

### Gate C - Controles de costo y acceso

- Presupuesto y alertas Google Cloud antes de desplegar Functions.
- Acceso minimo por rol; al menos dos responsables para continuidad, sin claves de servicio descargadas si Workload Identity/OIDC es viable.
- Cloudflare preview protegido con Access y X-Robots-Tag noindex verificado.
- GitHub Environment staging con ramas restringidas; required reviewer solo si el plan del repositorio lo soporta.

### Gate D - Configuracion y prueba sintetica

- Registrar una Web App propia de staging y cargar sus identificadores publicos mediante variables de entorno.
- Habilitar solo proveedores Auth necesarios para la prueba y usar cuentas example.test sin identidad real.
- Desplegar Rules y Functions desde un commit identificado, nunca desde un worktree sucio.
- Sembrar exclusivamente fixtures demo-academy.
- Ejecutar Auth, Rules, E2E desktop/mobile y contratos contra BASE_URL staging; confirmar que no existe trafico a bptjersey-f5a25.
- Conservar hashes de commit, run IDs y resultados; no conservar tokens, cookies o datos de sesion.

### Gate E - Rollback y limpieza

- Frontend: volver a la preview/deployment anterior.
- Functions/Rules: restaurar el artefacto y reglas anteriores registrados.
- Datos sinteticos: eliminar el tenant demo-academy mediante procedimiento acotado y verificable.
- Si una migracion futura fuera necesaria, detenerse: necesita backup verificado, rollback documentado y autorizacion independiente.

## Criterio de salida

El contrato pasa de documental a staging verificado solo cuando todos los gates A-E tienen evidencia. Una preview publica, un proyecto vacio o un build local no cuentan como staging aprobado. La aprobacion de staging tampoco autoriza produccion ni T058.

## Fuentes oficiales verificadas

- Firebase recomienda un proyecto separado por entorno: https://firebase.google.com/docs/projects/dev-workflows/overview-environments
- Firebase permite aliases distintos en .firebaserc: https://firebase.google.com/docs/cli#project_aliases
- La ubicacion de Firestore se selecciona al aprovisionar y no puede cambiarse: https://firebase.google.com/docs/firestore/locations
- Cloudflare Pages permite proteger preview deployments con Access: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- GitHub Environments puede restringir ramas, secretos y aprobaciones segun el plan: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

---

## Enmienda 2026-09-07 - staging separado descartado, T099 recortada a ensayo de release

Decision del operador del 2026-09-07, tomada sobre T099. Este contrato exigia cinco gates (A-E) para
un proyecto Firebase separado. **Ese entorno no se va a crear.**

### Por que

Cuando se escribio este contrato, el 2026-08-28, produccion no tenia datos reales y staging servia
para validar antes de tocarla. El 2026-09-04 se importaron 249 registros reales a `bptjersey-f5a25` y
se desplegaron callables. El proposito original -validar antes- ya no se puede cumplir: llega en
orden invertido. Lo que si sigue teniendo valor es no ensayar la release coordinada de T058 encima de
los datos reales, y eso no necesita un segundo proyecto de pago.

El gate humano que este contrato registraba como bloqueo tambien cayo: el decision owner y el revisor
de T011 estaban sin designar el 2026-08-28, y el 2026-09-06 el operador nombro a Vladimiro Afonso y
retiro la revision independiente. Lo unico que quedaba, por tanto, era gasto y una superficie mas que
mantener sincronizada.

### Que lo sustituye

| Gate original | Sustituto aprobado |
| --- | --- |
| B, proyecto vacio | Ninguno. No se crea proyecto |
| C, costo y acceso | Ninguno. No hay recursos que presupuestar |
| D, prueba sintetica | Emulator Suite sobre `demo-bpt-jersey` con el artefacto de despliegue real: Rules y golden path autenticado con secretos sinteticos |
| E, rollback | Runbook de release y rollback de T058, con baseline reconstruible y orden explicito de Rules, Functions y frontend |

### Riesgos que esto deja sin cubrir, aceptados por la misma decision

El Emulator no valida nada de lo siguiente, y por tanto la primera vez que ocurra sera en produccion:

1. Identidad cloud e IAM reales, incluido el `invoker` publico de los callables.
2. Region, cuotas y arranque en frio del contenedor de Cloud Run.
3. Montaje real de secretos en el arranque de la instancia. Es precisamente donde vive el problema
   abierto de los tres secretos placeholder (DPIA §4.7).
4. App Check con clave real y dominio real.
5. El despliegue mismo: descubrimiento de funciones, tiempos y fallos parciales.
6. Cloudflare Pages con Access, `noindex` y variables de entorno de produccion.

Los seis se trasladan a T058 como riesgo asumido, no como trabajo pendiente de T099. El incidente del
2026-09-07 -las funciones desplegadas devolviendo 503 sin que el codigo hubiera cambiado- es un
ejemplo concreto de exactamente esta clase de fallo: no lo habria detectado ningun Emulator.

### Lo que sigue vigente de este contrato

Las fronteras de identidad: `bptjersey-f5a25` es produccion y nunca es destino de pruebas ni fuente
de fixtures; el Emulator corre sobre `demo-bpt-jersey`; y se prohiben exportaciones, copias y
restauraciones de datos reales hacia cualquier entorno de prueba. Nada de esta enmienda relaja eso.
