# ADR-015: acceso del owner con contraseña

Fecha: 2026-09-20. Estado: perfil completado; corrección del backend probada, backend publicado y verificado; integración GitHub en curso.

La cuenta solicitada, `admin@admin.com`, ya tenía el claim `role=owner`, estaba habilitada y pertenecía a `demo-academy`. No existía su documento `academies/{academyId}/users/{uid}`. Además, el validador compartido de provisión administrativa aceptaba exclusivamente `authProvider=google`, aunque esta cuenta utiliza el proveedor `password` y la provisión del equipo ya puede persistir ese proveedor.

Se creó exclusivamente su perfil administrativo activo con `adminRole=owner`, proveedor real `password`, metadatos de creación y referencia de auditoría. El perfil y el evento `admin.role.granted` se escribieron en un commit atómico con precondición de inexistencia. No se cambió la contraseña, los claims, la academia ni otras cuentas. Los owners no requieren un registro de coach en `staff`; tampoco requieren las delegaciones temporales reservadas a coaches.

El validador admite ahora `google` y `password`. Conserva el esquema cerrado, identidad, academia, estado activo, rol administrativo, metadatos de auditoría y timestamps. Los consumidores mantienen sus comprobaciones de Auth vigente, bloqueo de rol y App Check. No existe una excepción por correo ni un permiso comodín.

Validación:

- La nueva prueba reprodujo el fallo antes de la corrección.
- 1.228 pruebas pasan en 72 archivos: miembros, niveles, autenticación y acceso del equipo.
- TypeScript de Functions, ESLint de los archivos modificados, compilación de Functions y `git diff --check` pasan.
- La relectura del perfil real creado pasa el validador corregido.
- El análisis de dependencias identifica 67 callables afectados; se excluye el scheduler de limpieza que comparte módulos.

El operador autorizó explícitamente publicar las 67 funciones de Firebase. El despliegue concluyó correctamente: 66 actualizaciones y creación de `getMembership`, ausente en producción. Las 67 funciones quedaron ACTIVE y tienen recibo de publicación. La relectura del perfil real pasa el validador corregido. Las sondas anónimas a `listMembers`, `getMemberProfile` y `listLevelCatalog` devolvieron HTTP 401. No se utilizaron las credenciales personales del owner para realizar operaciones reales; estas comprobaciones no equivalen a probar cada flujo administrativo desde su sesión.

El PR #7 integra el cambio en GitHub. CI detectó que el fixture de navegador intentaba obtener una atestación real de reCAPTCHA para clientes que solicitan App Check de un solo uso, usando una clave sintética. Se simuló el proveedor y su intercambio únicamente en `qa/tests/admin-fixture.ts`, manteniendo las aserciones del smoke test y sin cambiar configuración ni código de App Check de producción.

Evidencia local: `.tmp/owner-test-before.log`, `.tmp/owner-tests.log`, `.tmp/owner-typecheck.log`, `.tmp/owner-build.log`, `.tmp/owner-profile-verification.jsonl`, `.tmp/owner-impacted.json`. La operación autorizada creó el evento `owner-profile-7f4e87c9-7338-4189-a1ec-c15201b7e41a` en la colección de auditoría de la academia.


Evidencia de publicación: `.tmp/owner-deploy.log`, `.tmp/owner-production-verification.json` y `.tmp/owner-unauthenticated-probes.json`.
