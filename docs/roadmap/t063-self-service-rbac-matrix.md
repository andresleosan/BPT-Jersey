# T063 - matriz provisional de autoservicio y alcance RBAC

Estado: slice tecnico en revision; no autoriza produccion ni amplia permisos sin checkpoint humano.

Fecha: 2026-08-27 (America/Bogota)

## Invariantes no negociables

- La identidad y el tenant se derivan de Auth; el cliente no puede elegir el tenant.
- Un adulto con rol `adultStudent` solo puede operar sobre su propio `studentId`.
- Un tutor con rol `guardian` solo puede operar sobre un menor con relacion guardian activa, familia activa, contacto principal coincidente y perfil de menor activo dentro del mismo tenant.
- Si la relacion, familia o estudiante no se puede resolver, la autorizacion falla cerrado y el store no se invoca.
- El rol staff conserva sus controles actuales; los endpoints de roster, correcciones y operaciones en vivo no se convierten en autoservicio.
- Un guardian no puede ejecutar check-in en nombre de un estudiante; el check-in no delega la identidad del participante.
- Las respuestas de familia siguen usando la proyeccion redacted existente. No se exponen relaciones internas ni documentos de otro miembro.

## Matriz de acciones del slice

| Recurso                      | guardian                                                                                  | adultStudent                                                               | staff                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| Perfil propio                | Lectura mediante la superficie existente; sin editar perfil de menor                      | Leer y editar su propio perfil                                             | Segun callable administrativo existente          |
| Familia y menores vinculados | Leer la proyeccion canonica de su propia familia y menores relacionados                   | Sin acceso familiar implicito                                              | Leer/escribir segun T022 y rol                   |
| Booking                      | Crear, cancelar y consultar bookings solo de menores vinculados; aplica el cutoff vigente | Crear, cancelar y consultar solo el propio booking                         | Operacion staff existente                        |
| Asistencia e historial       | Consultar solo de menores vinculados                                                      | Consultar solo propia                                                      | Roster, correcciones y reconciliacion existentes |
| Check-in                     | Denegado en este slice                                                                    | QR/PIN solo propio                                                         | Metodos staff existentes                         |
| Checkout                     | Registrar y consultar checkout solo de menores vinculados                                 | Solo sobre su propio estudiante si la politica final lo confirma           | Override y consultas staff existentes            |
| Membresia, finanzas y pagos  | Solo proyecciones de lectura ya autorizadas; sin escritura ni cobro online                | Solo proyecciones de lectura ya autorizadas; sin escritura ni cobro online | Segun T032-T037                                  |
| Documentos y waivers         | Solo flujo privado autorizado para menores vinculados                                     | Solo flujo privado propio                                                  | Segun T024                                       |

## Correccion implementada

Los callables de agenda ya no aceptan un `studentId` arbitrario para un guardian. Se agrego un resolver tenant-scoped que revalida relacion, familia y estudiante antes de permitir booking, cancelacion, consultas de booking/asistencia/historial y checkout. La resolucion por defecto es fail-closed ante errores de lectura o documentos invalidos.

La implementacion mantiene un resolver inyectable en pruebas para evitar dependencia de Firestore y probar tanto guardian vinculado como no vinculado. No se agregaron colecciones, indices, migraciones, secretos, proveedores ni datos reales.

## Pendientes de checkpoint

- Confirmar si un tutor secundario puede operar o si solo el contacto principal mantiene autoservicio.
- Confirmar el alcance final de checkout para `adultStudent`.
- Definir solicitudes de correccion de perfil, membresia, documentos y pagos manuales sin permitir sobrescritura de registros emitidos por staff.
- Cubrir Rules/Emulator y E2E responsive antes de cualquier aprobacion; este slice solo cubre handlers y pruebas unitarias.
