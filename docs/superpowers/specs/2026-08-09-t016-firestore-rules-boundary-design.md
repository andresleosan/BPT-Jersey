# T016 Firestore Rules Boundary

**Fecha:** 2026-08-09
**Estado:** Ampliado por el diseño P1/T016 aprobado en `tasks.md` el 2026-08-19
**Tarea:** T016 - Implementar Firestore/RTDB Rules y pruebas de aislamiento por rol/familia

Este documento conserva la decisión Functions-only para Regyfit. El contrato reutilizable de actor,
política, relación, asignación y propósito vive en el ledger canónico `tasks.md`.

## Objetivo

Cerrar la frontera de datos para que ningún navegador lea directamente documentos sensibles de
Firestore o RTDB. Las Functions autorizadas serán la única superficie de lectura de registros
Regyfit y devolverán la proyección correspondiente al rol.

## Decisión

Se adopta **deny-by-default total** para las lecturas directas del cliente:

- Firestore no permite `get`, `list`, `read`, `create`, `update` ni `delete` desde SDK web para
  `regyfitAccessRecords`.
- RTDB mantiene `.read: false` y `.write: false`.
- El owner no obtiene una excepción directa para leer documentos con IP.
- `listRegyfitAccessRecords` continúa usando Admin SDK en Functions, con autorización por
  `academyId` y `role`, validación estricta del documento y proyección owner/administrator.
- Esta tarea no modifica datos, no crea índices y no aplica migraciones.

## Motivo

Permitir una excepción de Rules para owner duplicaría la frontera de seguridad y expone una ruta
directa a datos Restricted. La lectura por Functions concentra claims, tenant scope, validación de
forma, unicidad de `sourceId` y eliminación de `IP` para `administrator` en una sola boundary.

## Reglas

### Firestore

La colección `academies/{academyId}/regyfitAccessRecords/{recordId}` queda cerrada para todo acceso
directo del cliente. El fallback global permanece deny-by-default para colecciones futuras.

La seguridad de tenant no se implementa como una regla directa alternativa; se verifica en
Functions mediante claims y el campo `academyId` almacenado.

### Realtime Database

RTDB permanece completamente cerrado hasta que exista un dominio efímero explícito y una tarea con
contrato propio. No se agrega una regla genérica para usuarios autenticados.

## Pruebas

`qa/rules/regyfit-access-records.test.ts` debe comprobar:

- Anónimo no puede leer un documento ni listar la colección.
- `administrator` no puede leer directamente.
- `owner` no puede leer directamente, incluyendo `IP`.
- `headCoach`, `coach`, `guardian` y `adultStudent` no pueden leer.
- Claims de otra academia no pueden leer el tenant correcto.
- Un documento con `academyId` inconsistente no abre una excepción.
- Ningún rol puede crear, actualizar o borrar registros.
- La prueba de acceso permitido se mueve a la integración de Functions, donde se comprueba que
  owner recibe `IP` y administrator no.

La suite debe ejecutarse contra el emulador `demo-bpt-jersey`; nunca contra staging o producción.
Los fixtures son sintéticos y no contienen datos reales.

## Seguridad

- No se agregan endpoints públicos ni credenciales.
- Las Rules no confían en parámetros enviados por la UI.
- Las Functions no se relajan como compensación de Rules más estrictas.
- No se imprimen documentos, IP, tokens ni claims completos en logs de prueba.
- La consulta directa de Firestore desde el navegador debe permanecer ausente del cliente web.

## Rollback

El rollback es textual y no destructivo: restaurar la versión anterior de `firestore.rules`,
`database.rules.json` y la prueba correspondiente. No hay datos que restaurar ni backup adicional
porque la tarea no cambia documentos.

## Criterio de aceptación

T016 pasa a revisión cuando todas las lecturas y escrituras directas están rechazadas por Rules,
la suite Rules pasa con evidencia real, la integración Functions conserva las proyecciones
autorizadas y no existe una excepción directa para owner, administrator o cualquier otro rol.
