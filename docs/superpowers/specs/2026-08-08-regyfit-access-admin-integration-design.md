# Regyfit Access Admin Integration Design

Fecha: 2026-08-08
Estado: aprobado por el operador para especificación y planificación
Proyecto: BPT Jersey Academy Platform
Fuente: Regyfit, módulo `alunos-acessos`
Run: `regyfit-20260808-acessos-01`

## 1. Objetivo

Integrar en BPT una base administrativa autenticada con Firebase Auth/Google y,
después de validar esa base en Emulator/staging, mostrar una vista read-only de
los registros de acceso capturados desde Regyfit. La carga de los diez registros
reales ocurre únicamente en la fase posterior y en un entorno local o emulado
autorizado. La integración conserva la identidad de origen mediante `sourceId`,
no convierte `Member Nº` en identidad canónica y no reconcilia los registros con
`students` o `users`.

El panel usa la identidad visual BPT y la estructura funcional observada, pero
no copia código, assets ni identidad visual de Regyfit.

## 2. Alcance confirmado

### Incluido

- Autenticación administrativa con Firebase Auth y Google.
- Roles administrativos y control de acceso por academia.
- Shell administrativo responsive y navegación inicial.
- Colección aislada
  `academies/{academyId}/regyfitAccessRecords/{sourceId}`.
- Mapeo de `Member`, `Member Nº`, `Logins`, `Last Login` e `IP`.
- Importación idempotente por `sourceId` e `importRunId`.
- Escritura solo desde el proceso backend/importador.
- Registro append-only en `auditEvents` con run, conteo, hash, actor y propósito,
  sin valores de registros.
- Vista `Regyfit Access Records` con búsqueda, filtros, detalle e historial de
  accesos read-only.
- Proyección administrativa sin `IP`.
- Pruebas unitarias, Rules/integración con emulador y Playwright E2E sin datos
  reales versionados.

### Excluido

- Reconciliación o escritura en `students` o `users`.
- Edición, borrado, exportación o acciones mutantes.
- Activación de `but_excel2`, `but_excel3` o `but_pdf`.
- Producción, migración final, cambios en Regyfit y copia del JSONL al checkout.
- Datos reales en Git, Markdown, fixtures, logs, screenshots, traces o CI.

## 3. Arquitectura

### Dominio

`packages/domain` define el contrato inmutable del snapshot de acceso, el
resultado del mapeo y las invariantes de importación. El contrato requiere
`sourceSystem`, `sourceId`, `importRunId`, `academyId`, timestamps normalizados,
los campos observados y `schemaVersion`. `sourceId` es el ID de documento
determinista; `Member Nº` permanece como dato de origen y no como ID BPT.

El mapeo rechaza filas incompletas, IDs duplicados, run incorrecto y tipos
inválidos. No normaliza nombres hasta convertirlos en identidad ni inventa
relaciones.

### Secuencia de implementación

La implementación se divide en gates que deben pasar en orden:

1. **Base administrativa:** Firebase Auth con Google, sesión, owner y
   administrator/reception, bootstrap controlado del primer owner, claims y
   aislamiento por academia.
2. **Shell y permisos:** navegación administrativa, Rules default-deny,
   endpoint backend de proyección y pruebas negativas por rol.
3. **Panel sin datos reales:** vista read-only, estados vacíos, búsqueda,
   filtros, detalle e historial usando datos sintéticos no sensibles.
4. **Importación real autorizada:** solo después de los gates anteriores,
   lectura de `REGYFIT_PRIVATE_STAGING_ROOT`, validación de diez filas e
   importación a Emulator/staging, seguida de reconciliación y auditoría.

Playwright valida los flujos del panel y la autenticación con cuentas de prueba
o estados controlados del entorno autorizado. No crea usuarios reales fuera del
flujo de Firebase ni realiza acciones mutantes sobre Regyfit.

### Importador

El importador backend se mantiene deshabilitado para la primera fase y solo se
activa después de que la base administrativa y el panel pasen sus gates. Lee
exclusivamente desde `REGYFIT_PRIVATE_STAGING_ROOT`.
Valida el run `regyfit-20260808-acessos-01`, el módulo `alunos-acessos`, la ruta
esperada y el conteo de diez filas antes de escribir. Procesa el JSONL sin
imprimir valores, usa escrituras deterministas y trata una repetición del mismo
`sourceId`/`importRunId` como no duplicativa.

La escritura se dirige al Emulator Suite o a un proyecto de staging autorizado.
La configuración debe impedir explícitamente un proyecto de producción. El
proceso produce solo recibos y métricas sanitizadas: conteo, hash, run, módulo y
resultado.

### Acceso y proyecciones

Firestore Rules no permite ocultar campos individuales dentro de un documento.
Por ello, el documento completo con `IP` solo es legible directamente por
`owner`. `administrator/reception` consume un endpoint/proyección backend que
omite `IP`; no se concede lectura directa del documento restringido. `head
coach`, `coach`, `parent/guardian` y `adult student` reciben rechazo. Las
escrituras desde clientes están prohibidas.

El backend valida autenticación, `academyId` y rol antes de devolver una
proyección. Los tests deben comprobar tanto la negativa de Rules como la
ausencia del campo restringido en la respuesta administrativa.

### Panel

La ruta administrativa será una superficie autenticada/read-only con shell
responsive: navegación lateral en desktop, navegación compacta en móvil,
encabezado de módulo, búsqueda por miembro/source ID, filtros por actividad y
último acceso, tabla adaptable a tarjetas, detalle lateral o sección de detalle
y bloque de historial. La columna `IP` solo aparece en la vista owner y tiene
señalización de dato restringido. No se muestran valores en estados vacíos,
errores, fixtures ni snapshots.

Antes de la importación real, la vista se prueba con datos sintéticos o estado
vacío. Los módulos no capturados se representan como estructura documentada o estado
`Not yet imported`, sin datos inventados.

## 4. Flujo de datos

```text
private staging JSONL
  -> validación de run/módulo/conteo
  -> mapeo de dominio sin PII en logs
  -> backend/importador privilegiado
  -> Firestore Emulator o staging autorizado
  -> auditEvents metadata-only
  -> backend projection by role
  -> Regyfit Access Records UI read-only
```

La auditoría identifica la corrida y el resultado, pero nunca copia nombres,
números de miembro, IP, timestamps de login ni el payload original.

## 5. Errores, idempotencia y rollback

- Un JSONL ausente, run incorrecto, módulo incorrecto o conteo distinto a diez
  bloquea la carga antes de cualquier escritura.
- Una fila inválida o un `sourceId` duplicado bloquea la corrida y no se
  continúa silenciosamente.
- Una repetición con bytes/mapeo equivalente conserva un único documento por
  `sourceId`; el `importRunId` identifica la corrida observada.
- Un documento de staging/emulador puede revertirse eliminando únicamente los
  documentos con el `importRunId` de la corrida, nunca datos fuera de ella.
- No se ejecuta rollback contra producción ni se borra el staging privado desde
  la aplicación.

## 6. Pruebas

- Fase administrativa: Google Auth, sesión, bootstrap de owner, claims,
  aislamiento de academia y acceso administrativo.
- Unitarias: parser, mapeo de los cinco campos, source ID, conteo, duplicados,
  idempotencia, hash de auditoría y ausencia de valores en logs/eventos.
- Permisos: owner con `IP`, administrator/reception sin `IP`, roles operativos
  sin acceso, cliente sin escritura y aislamiento por academia.
- Integración: Firebase Emulator con importación sintética y una validación de
  conteo real que no persiste datos privados en el repositorio.
- E2E: navegación administrativa, búsqueda, filtros, detalle, historial,
  proyección administrativa sin `IP`, estado no autorizado y responsive
  desktop/móvil.
- Gates: lint, typecheck, formato, suite completa, audit de dependencias y
  `git diff --check`.

## 7. Seguridad y retención

El staging queda fuera del checkout y debe eliminarse antes del 2026-08-22. El
staging real no se toca durante la construcción de la base administrativa. El
importador no escribe la ruta, contenido ni valores reales en logs versionables,
artefactos de Playwright o CI. La importación real no se ejecuta contra
producción y esta especificación no contiene filas capturadas.

## 8. Decisiones y límites

- El operador aprobó la colección aislada, el uso de `sourceId`/`importRunId`,
  el alcance read-only y la matriz de roles el 2026-08-08.
- `Member Nº` se conserva como campo de origen, no como ID canónico BPT.
- La proyección backend es un requisito técnico para cumplir la separación de
  `IP`; no se implementará una supuesta regla por campo en Firestore.
- No hay autorización para producción, exportaciones Regyfit ni reconciliación
  de identidad.
