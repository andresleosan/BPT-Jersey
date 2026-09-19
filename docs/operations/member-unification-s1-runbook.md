# Unificación de miembros S1: operación de identidad para adultos

Luis: esta guía prepara el informe, publica las dos funciones y la web, y verifica las decisiones de adultos de `demo-academy` en `bptjersey-f5a25`.
Son 27 pasos de operación y 8 de vuelta atrás opcional. Necesitas una terminal SSH del VPS como `root`, acceso de administrador, el gate local aprobado y tu PAT para publicar `main`.
Los comandos de producción los ejecuta únicamente el operador después de su confirmación explícita en el chat. Esta guía no acredita que ya se hayan ejecutado.

⚠️ Estado del gate local de Task 9 (19-09-2026): **no aprobado**. La suite completa detectó cinco fallos: dos por el import de `@bpt-jersey/domain/members/migration` sin mapeo en el artefacto de funciones, dos por expectativas antiguas de navegación y uno por la lista de acciones de auditoría. No ejecutes la publicación hasta corregirlos y repetir el gate completo en verde.

## Preparación e informe de solo lectura

Usa la misma terminal Bash durante toda la operación: las variables y la función de conteos duran esa sesión. Detente ante cualquier error o salida distinta de la esperada. No pegues claves, PAT ni datos de miembros en el chat; conserva solo contadores. No hay cambios de rama en esta guía.

### 1. Sitúate en el repositorio

📍 Terminal del VPS · root · `/root/BPT-Jersey` (este comando te lleva allí).

```bash
cd /root/BPT-Jersey
```

Salida esperada: ninguna; el directorio de trabajo pasa a ser `/root/BPT-Jersey`.

### 2. Elimina el destino de emulador de esta sesión

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
unset FIRESTORE_EMULATOR_HOST
```

Salida esperada: ninguna. Los scripts rechazan producción si esta variable existe, incluso vacía.

### 3. Configura el destino exacto de los informes

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
export GCLOUD_PROJECT=bptjersey-f5a25 S1_TARGET=production S1_ACADEMY_ID=demo-academy
```

Salida esperada: ninguna. Estas variables se heredan en los comandos siguientes; no cambies sus valores.

### 4. Indica la ruta de la credencial del Admin SDK

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$(ls /root/secrets/*adminsdk*.json)"
```

Salida esperada: ninguna. Debe existir una sola clave coincidente. Ante un error o varias coincidencias, detente. El comando solo pasa la ruta por la variable requerida; no abras ni imprimas el archivo.

### 5. Construye el runtime del dominio

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
```

Salida esperada: compilación terminada con código 0. Los scripts importan este artefacto local.

### 6. Ejecuta el informe inicial de solo lectura

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
corepack pnpm exec node qa/scripts/member-unification-s1-report.mjs
```

Salida esperada: contadores `members`, `archiveRecords`, `decided`, `strong`, `suggested`, `ambiguous`, `none`, `minorOrUndated`, `archiveOnly`, validaciones de IDs y estado del directorio. Guarda los números como informe inicial. `errors: 1` obliga a detenerse; no publiques ni decidas.

### 7. Valida las condiciones para continuar

📍 Revisión del informe del paso 6, sin comandos.

Deben cumplirse todas:

- `unparsableMembers: 0`.
- `unparsableRecords: 0`.
- `invalidLegacyIds: 0`.
- `legacyIdCaseCollisions: 0`.
- `readerVersion: canonical-v1`.
- `rollbackEligibleStudentCount + strong + suggested + none` < `rollbackCapacityLimit`.
- `rollbackCapacityLimit: 400`.

Salida esperada: todas las condiciones satisfechas. Si no, detente. No cambies `readerVersion`: exige otro diseño y autorización explícita. El presupuesto también debe reservar capacidad para cualquier ambiguo que se decida crear y para otras altas concurrentes; repite el informe antes de continuar si hay cambios. No cuentes dos veces `minorOrUndated`: esas filas ya están incluidas en las categorías.

`invalidIdentifiers` > 0 indica miembros que serán rechazados con `invalid-member-data`: corrige sus identificadores en el registro legacy o decide omitirlos (`skip`). Por sí solo no es un motivo para detener la operación. `undated` cuenta filas sin fecha de nacimiento propia ni recuperada de una coincidencia fuerte; siguen pendientes de S1b. Si hay documentos no parseables, el informe imprime todos los contadores y termina con `errors: 1 — Queue would fail: unparsable documents` y código de salida 1.

### 8. Define el comando de conteos de solo lectura

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

Este bloque define una función local que consulta únicamente la academia fijada y muestra totales. No escribe documentos ni muestra IDs o datos personales.

```bash
s1_counts() {
  corepack pnpm exec node --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import { resolveTarget } from './qa/scripts/member-unification-s1-report.mjs';
try {
  const { projectId } = resolveTarget(process.env);
  if (process.env.S1_ACADEMY_ID !== 'demo-academy') throw new Error();
  const require = createRequire(`${process.cwd()}/apps/functions/package.json`);
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId }));
  const root = db.collection('academies').doc('demo-academy');
  for (const name of [
    'members', 'regyfitMemberRecords', 'students',
    'regyfitOfficeLinks', 'regyfitMemberLinks', 'memberMigrationDecisions',
  ]) {
    const result = await root.collection(name).count().get();
    console.log(`${name}: ${result.data().count}`);
  }
  const decisions = await root.collection('memberMigrationDecisions').get();
  const s1 = decisions.docs.map(doc => doc.data()).filter(
    row => row.migrationId === 'member-unification-s1-2026-09',
  );
  for (const kind of ['link', 'create-unlinked', 'skip']) {
    console.log(`${kind}: ${s1.filter(row => row.kind === kind).length}`);
  }
  const profiles = await root.collection('studentAdminProfiles')
    .select('legacyMemberId').get();
  const ids = profiles.docs.map(doc => doc.data().legacyMemberId)
    .filter(id => typeof id === 'string')
    .map(id => id.normalize('NFKC').trim().toUpperCase());
  console.log(`duplicateLegacyMemberIds: ${ids.length - new Set(ids).size}`);
} catch {
  console.error('errors: 1');
  process.exitCode = 1;
}
NODE
}
```

Salida esperada: ninguna; queda definida `s1_counts`. Los comandos siguientes la invocan en esta misma terminal. Si vuelves otro día, repite los pasos 1–5 y 8 antes de consultar.

### 9. Registra los conteos iniciales

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
s1_counts
```

Salida esperada: totales de las seis colecciones, decisiones S1 por tipo y `duplicateLegacyMemberIds: 0`. Guarda estos números como base. La referencia del 19-09-2026 era 243 `members`, 249 registros de archivo y 2 `students`; usa los valores actuales, no supongas que siguen iguales. Si hay duplicados o `errors: 1`, detente.

## Publicación selectiva de funciones y web

### 10. Confirma la publicación en el chat

📍 Chat con el agente, sin comandos.

⚠️ Los siguientes pasos publican código en producción. Confirma explícitamente el despliegue de `listMemberMigrationQueue`, `decideMemberMigration` y la web después de revisar los informes y el gate completo. Sin confirmación, detente aquí.

Salida esperada: confirmación de Luis registrada. La alternativa es conservar los informes y posponer la publicación. Nunca hagas un deploy total: `selfCheckIn` sigue sin desplegar a propósito. No ejecutes bootstrap ni forward.

### 11. Comprueba que el entorno de funciones no es un enlace simbólico

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
test ! -L apps/functions/.env && echo 'OK: no es symlink'
```

Salida esperada: `OK: no es symlink`. Si no aparece, detente; no despliegues ni reemplaces automáticamente el enlace.

### 12. Prepara el archivo de entorno solo si falta

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

El bloque conserva cualquier archivo existente y copia el entorno preparado únicamente si no existe el destino.

```bash
if test ! -e apps/functions/.env && test ! -L apps/functions/.env; then
  cp /root/BPT-Jersey/.tmp/functions-env/.env apps/functions/.env
fi
```

Salida esperada: ninguna y código 0. Si la fuente no existe, detente. No muestres su contenido ni lo añadas a Git.

### 13. Verifica que el entorno es un archivo real

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
test -f apps/functions/.env && test ! -L apps/functions/.env && echo 'OK: archivo real'
```

Salida esperada: `OK: archivo real`. Si no aparece, detente.

Hacer merge/push a `main` publica la web, incluida la nueva entrada de navegación «Member migration»; despliega los dos callables inmediatamente antes/después para evitar que la página muestre «queue unavailable». Este procedimiento los despliega antes del push.

### 14. Despliega únicamente las dos funciones S1

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

⚠️ Cambia funciones de producción. Ejecuta solo tras el paso 10. El `predeploy` de `firebase.json` construye el artefacto desplegable; no lo sustituyas por una compilación manual. Las barras finales permiten pegar el comando completo en varias líneas cortas.

```bash
corepack pnpm exec firebase deploy --project bptjersey-f5a25 \
  --only functions:listMemberMigrationQueue,functions:decideMemberMigration
```

Salida esperada: ambas funciones creadas o actualizadas correctamente y `Deploy complete!`. Si falla alguna, detente antes del push de la web. No aceptes propuestas de borrar otras funciones.

### 15. Actualiza la referencia remota de main

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
git fetch origin main
```

Salida esperada: descarga correcta de la referencia remota. Si Git pide autenticación HTTPS, escribe el PAT como contraseña únicamente en esta terminal SSH; nunca dentro del comando, en el chat o en un archivo.

### 16. Revisa qué rama vas a publicar

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
git status --short --branch
```

Salida esperada: rama `feature/member-unification-s1`, con el commit de Task 9 y sin cambios pendientes en archivos versionados. Los directorios locales `.impeccable/`, `Assets/`, `docs/audits/` y `.superpowers/` no forman parte de la publicación. No uses `git add .`. Ante otra rama o cambios versionados, detente.

### 17. Comprueba que main puede avanzar sin sobrescribir historia

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
git merge-base --is-ancestor origin/main HEAD && echo 'OK: fast-forward'
```

Salida esperada: `OK: fast-forward`. Si no aparece, detente y resuelve la divergencia en una tarea separada; no fuerces el push.

### 18. Publica la web enviando el commit aprobado a main

📍 Terminal del VPS · root · `/root/BPT-Jersey`, en la terminal SSH interactiva.

⚠️ El push a `main` activa Cloudflare Pages. Hazlo solo después del éxito de ambas funciones y de la confirmación del paso 10. El remoto HTTPS debe pedir tu usuario y PAT; escribe el PAT en el campo contraseña, que no lo muestra. Este comando no cambia la rama local.

```bash
git -c credential.helper= -c core.askPass= push origin HEAD:main
```

Salida esperada: avance de `main` en el remoto y compilación iniciada en Cloudflare Pages. Ante rechazo, detente; no fuerces ni publiques la web por otro camino. La web se publica junto con/después de las funciones, nunca antes.

### 19. Verifica la publicación de Cloudflare Pages

📍 Navegador · panel de Cloudflare Pages del proyecto BPT Jersey.

Comprueba que el despliegue de `main` corresponde al commit aprobado y termina correctamente.

Salida esperada: despliegue de producción exitoso con ese commit. Si falla, no empieces las decisiones; conserva el error de compilación sin secretos para diagnóstico.

## Uso de la cola y verificación

### 20. Abre la cola como administrador

📍 Navegador · web de producción BPT Jersey · `/admin/members/migration`.

Inicia sesión como `owner` o `administrator` de `demo-academy` y abre la ruta.

Salida esperada: cola con pestañas Strong, Suggested, Ambiguous, No match y Under 18 / no date, un contador Only in the archive e identificadores enmascarados. Los coaches no operan esta cola. Si aparece un error de carga, detente y reintenta la lectura sin tomar decisiones.

### 21. Elige los datos de entrenamiento para las altas

📍 Navegador · cola de migración.

Selecciona el centro `Town` o `West` y de una a tres preferencias `morning`, `afternoon`, `evening` según lo confirmado para los adultos que vas a aprobar.

Salida esperada: centro y preferencias seleccionados. La selección se aplica a cada alta del lote; no deduzcas estos datos del legado ni apruebes un lote con necesidades distintas.

### 22. Decide las coincidencias fuertes revisadas

📍 Navegador · cola de migración · Strong.

⚠️ Aprobar crea altas canónicas y decisiones auditadas. Usa la aprobación de los visibles solo para adultos revisados con identificador fuerte idéntico y los datos de entrenamiento correctos. Cada petición contiene como máximo 50 decisiones; un lote sigue siendo una decisión explícita por miembro.

Salida esperada: resumen de aplicadas/rechazadas y cola recalculada. Revisa cada rechazo: un fallo parcial no revierte las decisiones aplicadas. Reintentar una ya aplicada devuelve `already-decided`; no intentes borrar su registro create-only.

### 23. Decide individualmente los demás adultos

📍 Navegador · cola de migración · Suggested, Ambiguous o No match.

⚠️ Cada decisión escribe datos. Revisa cada adulto antes de elegir `link` con un candidato válido, `create-unlinked` para alta sin enlace, o `skip` con motivo de 3–200 caracteres. Una coincidencia por nombre/fecha solo es una sugerencia y nunca se aprueba automáticamente.

Salida esperada: cada decisión tiene resultado aplicado o rechazo seguro. Un enlace ya ocupado se rechaza como `record-already-linked`; un candidato ajeno no es válido. No inventes identificadores, tutores ni datos de entrenamiento para desbloquear un rechazo.

### 24. Revisa los pendientes que quedan fuera de S1

📍 Navegador · cola de migración · Under 18 / no date y contador Only in the archive.

Conserva menores y filas sin fecha suficiente como pendientes de tutor para S1b. Los registros solo presentes en el archivo se reflejan en un contador de lectura, sin decisiones en esta pantalla. El servicio permite `skip` de un menor con motivo, pero no permite su alta en S1; esta operación no exige descartarlos.

Salida esperada: pendientes visibles y ninguna alta de menor. No exijas que toda la cola quede vacía para verificar adultos; registra las categorías pendientes y los motivos de los descartes.

### 25. Repite el informe de solo lectura

📍 Terminal del VPS · root · `/root/BPT-Jersey`, misma sesión configurada en los pasos 1–5.

```bash
corepack pnpm exec node qa/scripts/member-unification-s1-report.mjs
```

Salida esperada: `readerVersion: canonical-v1`, ambas validaciones de IDs a cero, `rollbackEligibleStudentCount` < 400 y progreso coherente con las decisiones. Los totales `members` y `archiveRecords` deben coincidir con el informe inicial.

### 26. Obtén los conteos finales

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
s1_counts
```

Salida esperada: contadores finales sin datos personales y `duplicateLegacyMemberIds: 0`. Ante `errors: 1`, detente sin dar por completada la migración.

### 27. Concilia los resultados y registra el cierre operativo

📍 Revisión de los conteos iniciales/finales y de la cola, sin comandos.

Compara los incrementos desde el paso 9, contando solo decisiones aplicadas:

- `students` final = inicial + incremento de `link` + incremento de `create-unlinked` (si el inicial sigue siendo 2, es 2 + altas nuevas).
- `regyfitOfficeLinks` final = inicial + incremento de `link`.
- `memberMigrationDecisions` final = inicial + incrementos de `link`, `create-unlinked` y `skip`; `decided` del informe coincide con el total de decisiones.
- `members`, `regyfitMemberRecords` y `regyfitMemberLinks` no cambian por S1; `duplicateLegacyMemberIds` sigue en cero.
- El lector continúa en `canonical-v1` y el contador de capacidad queda por debajo de 400.

Salida esperada: todas las igualdades satisfechas y los pendientes S1b/archivo identificados. Coordina una ventana sin otras altas/decisiones para comparar; si hubo actividad concurrente, concíliala antes de cerrar. Solo después de verificar el conteo final registra T108 como **«sustituida por S1»**. C1 sigue `en-progreso`: S1b menores, S2 histórico, S3 ficha viva y S4 retirar visor están pendientes.

## Vuelta atrás de emergencia (opcional)

⚠️ No es un reinicio de migración. El revert sigue las decisiones con `migrationId: member-unification-s1-2026-09` y borra sus `students`, `studentAdminProfiles`, claves de identidad, enlaces `regyfitOfficeLinks`, familias de oficina `office-{studentId}` y decisiones. No toca `members`, `regyfitMemberRecords`, `auditEvents` ni `memberDirectoryStates`; los dos estudiantes previos sin esta migración no son objetivos.

El `rollbackEligibleStudentCount` **no baja**: su cadena firmada solo avanza mediante el alta canónica. El límite es 400; tras unas 245 altas revertidas quedan unas 155 plazas, no otra migración completa. Una segunda pasada requiere una transición del plano de control fuera de S1. No edites ese contador ni cambies `readerVersion` como parte del revert.

El script borra en lotes de hasta 400 documentos y conserva las decisiones hasta eliminar sus documentos asociados para permitir reintentos. No garantiza una transacción única global ni comprueba todas las referencias creadas después de las altas. Antes del apply, revisa si ya hay actividad dependiente y exige un plan específico si la hay.

### 28. Pausa las decisiones y las altas relacionadas

📍 Coordinación con los operadores de BPT Jersey, sin comandos.

⚠️ Acuerda que nadie cree o modifique datos relacionados durante el diagnóstico/revert. No existe un bloqueo global automático en este script.

Salida esperada: ventana de operación acordada sin escritores concurrentes. Si no puedes garantizarla, detente y conserva la alternativa de solo lectura.

### 29. Ejecuta el dry-run de la vuelta atrás

📍 Terminal del VPS · root · `/root/BPT-Jersey`, con los pasos 1–5 preparados.

```bash
S1_REVERT_APPLY=no \
  corepack pnpm exec node qa/scripts/member-unification-s1-revert.mjs
```

Salida esperada: conteos de `students`, `studentAdminProfiles`, `families`, `studentIdentityKeys`, `regyfitOfficeLinks` y `memberMigrationDecisions` que se borrarían. No borra nada. El `no` explícito impide heredar un apply anterior. Compara con los conteos finales; ante discrepancias o `errors: 1`, detente.

### 30. Confirma por separado el borrado de emergencia

📍 Chat con el agente, sin comandos.

⚠️ Pide a Luis confirmación explícita del apply después de revisar el dry-run, el backup verificado, las referencias posteriores y el límite de capacidad. La confirmación del despliegue no autoriza este borrado. La alternativa reversible es quedarse en el dry-run.

Salida esperada: autorización de Luis registrada para este revert concreto. Sin ella no continúes.

### 31. Aplica la vuelta atrás autorizada

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

⚠️ Borra los documentos indicados por el dry-run. La confirmación literal es exactamente la siguiente y se limita a este comando; no uses `--apply`, porque el script lee `S1_REVERT_APPLY`.

```bash
S1_REVERT_APPLY=yes \
  MEMBER_UNIFICATION_CONFIRMATION=member-unification-s1-revert-v1 \
  corepack pnpm exec node qa/scripts/member-unification-s1-revert.mjs
```

Salida esperada: conteos iniciales y seis contadores `remainingStudents`, `remainingStudentAdminProfiles`, `remainingFamilies`, `remainingStudentIdentityKeys`, `remainingRegyfitOfficeLinks`, `remainingMemberMigrationDecisions` a cero. Si falla, no supongas atomicidad: vuelve al dry-run, revisa qué queda y confirma el reintento antes de otro apply.

### 32. Verifica el plan restante sin escribir

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
S1_REVERT_APPLY=no \
  corepack pnpm exec node qa/scripts/member-unification-s1-revert.mjs
```

Salida esperada: los seis conteos del plan a cero. Son los objetivos reconocidos por el plan; completa también la comparación global siguiente.

### 33. Verifica el lector y el límite después del revert

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
corepack pnpm exec node qa/scripts/member-unification-s1-report.mjs
```

Salida esperada: lector `canonical-v1`, fuentes legacy intactas, IDs válidos y contador de capacidad sin reducirse. Las filas cuyas decisiones se borraron vuelven a la cola; no las migres otra vez automáticamente.

### 34. Verifica los totales globales después del revert

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
s1_counts
```

Salida esperada: decisiones de esta migración a cero, estudiantes y enlaces ajenos a S1 conservados, fuentes legacy iguales al informe inicial y cero duplicados. El revert afecta a toda la migración S1, incluidas decisiones anteriores al informe de esta sesión: descuenta también esas altas si ya existían al empezar. No declares éxito por los ceros del plan si los totales globales no cuadran.

### 35. Retira la ruta de la credencial de esta sesión

📍 Terminal del VPS · root · `/root/BPT-Jersey`.

```bash
unset GOOGLE_APPLICATION_CREDENTIALS
```

Salida esperada: ninguna. No modifica ni borra la clave del VPS. Al terminar la operación normal también puedes ejecutar este paso, omitiendo 28–34.

## Verificación final

La operación normal termina únicamente con los informes de los pasos 25–27 conciliados, el commit correcto publicado y los pendientes fuera de S1 registrados. La vuelta atrás termina únicamente con los pasos 32–34 conciliados y su límite documentado. Conserva solo los contadores y el resultado del gate; nunca secretos ni datos personales como evidencia.

Referencias: [ADR-009](../adr/ADR-009-students-canonical-member-directory.md) y [spec S1](../superpowers/specs/2026-09-19-member-unification-s1-identity-design.md). Para los comandos mandan los contratos de entorno actuales de los scripts: `S1_TARGET`, `S1_ACADEMY_ID`, `GCLOUD_PROJECT`, `S1_REVERT_APPLY` y `MEMBER_UNIFICATION_CONFIRMATION`.
