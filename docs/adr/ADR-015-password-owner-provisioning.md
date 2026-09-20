# ADR-015: acceso del owner con contraseña

Fecha: 2026-09-20. Estado: perfil completado; corrección del backend probada, merge autorizado y preparado; despliegue de Firebase pendiente de aprobación separada.

La cuenta solicitada, `admin@admin.com`, ya tenía el claim `role=owner`, estaba habilitada y pertenecía a `demo-academy`. No existía su documento `academies/{academyId}/users/{uid}`. Además, el validador compartido de provisión administrativa aceptaba exclusivamente `authProvider=google`, aunque esta cuenta utiliza el proveedor `password` y la provisión del equipo ya puede persistir ese proveedor.

Se creó exclusivamente su perfil administrativo activo con `adminRole=owner`, proveedor real `password`, metadatos de creación y referencia de auditoría. El perfil y el evento `admin.role.granted` se escribieron en un commit atómico con precondición de inexistencia. No se cambió la contraseña, los claims, la academia ni otras cuentas. Los owners no requieren un registro de coach en `staff`; tampoco requieren las delegaciones temporales reservadas a coaches.

El validador admite ahora `google` y `password`. Conserva el esquema cerrado, identidad, academia, estado activo, rol administrativo, metadatos de auditoría y timestamps. Los consumidores mantienen sus comprobaciones de Auth vigente, bloqueo de rol y App Check. No existe una excepción por correo ni un permiso comodín.

Validación:

- La nueva prueba reprodujo el fallo antes de la corrección.
- 1.228 pruebas pasan en 72 archivos: miembros, niveles, autenticación y acceso del equipo.
- TypeScript de Functions, ESLint de los archivos modificados, compilación de Functions y `git diff --check` pasan.
- La relectura del perfil real creado pasa el validador corregido.
- El análisis de dependencias identifica 67 callables afectados; se excluye el scheduler de limpieza que comparte módulos.

El operador solicitó integrar el cambio en GitHub para que funcione en producción el 2026-09-20. El acceso de escritura a GitHub quedó habilitado mediante la autorización de GitHub CLI por navegador; se confirmó permiso WRITE sobre el repositorio. GitHub CI no despliega Firebase Functions: la publicación requiere actualizar también las 67 callables afectadas, conservando sus controles y configuración. La revisión automática rechazó ese despliegue y exige autorización explícita separada del merge. No se ejecutó el despliegue ni se confirmó acceso autenticado de extremo a extremo en producción.

Evidencia local: `.tmp/owner-test-before.log`, `.tmp/owner-tests.log`, `.tmp/owner-typecheck.log`, `.tmp/owner-build.log`, `.tmp/owner-profile-verification.jsonl`, `.tmp/owner-impacted.json`. La operación autorizada creó el evento `owner-profile-7f4e87c9-7338-4189-a1ec-c15201b7e41a` en la colección de auditoría de la academia.
