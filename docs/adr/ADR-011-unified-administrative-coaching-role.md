# ADR-011: administrador y coach principal unificados

Fecha: 2026-09-20. Estado: aceptada por el operador en chat; Functions publicadas con aprobación explícita, web pendiente.

## Decisión

El equipo usa owner, administrator y coach. Administrator reúne gestión de oficina, finanzas y
decisiones deportivas del antiguo headCoach. Owner tiene esas mismas capacidades y es el único que
concede o cambia acceso administrativo. Coach mantiene sus restricciones actuales. No se acumulan
roles en una cuenta: el rol principal determina sus permisos.

Esta decisión sustituye la separación deportiva G12 de T051V2 y la distinción entre administrator y
headCoach en ADR-010 para nuevas asignaciones. El valor headCoach se conserva para registros
históricos y cuentas pendientes de transición. No se reinterpretan tokens antiguos como
administrativos: el owner cambia cada cuenta explícitamente desde Staff y el servidor mantiene
claims, documento canónico y auditoría con el mecanismo de bloqueo y compensación existente.

## Interfaz y acceso

Staff lista nombre, correo y rol para owner/administrator. Una acción revisable identifica la
persona y el nuevo rol antes de confirmar. Un owner no modifica su propio rol desde este flujo.
Las nuevas altas y cambios de perfil docente no crean headCoach; los registros antiguos se leen.
Los perfiles docentes, disponibilidad y asignaciones se conservan al cambiar a administrator.
Un administrador u owner puede tener un perfil docente operativo sin perder sus claims administrativos.

Se puede autorizar un correo para administrator/owner. La autorización dura siete días, se puede
cancelar antes de su activación y no envía mensajes. Al entrar con Google se comprueban el correo
verificado, cuenta activa, academia y autoridad actual del owner emisor. Una cuenta teenStudent
no se eleva por este flujo. Las autorizaciones de adultos existentes requieren la misma academia.

## Concurrencia y fallos

Cada correo tiene un índice privado de academia y una autorización canónica bajo esa academia.
Una transacción reserva pending → processing. Reemplazar o cancelar processing está prohibido.
La asignación usa el bloqueo compartido de roles y su compensación Auth/Firestore. La autorización
termina accepted o failed y no se consume de nuevo. Si el proceso se interrumpe después de reservar,
queda processing para revisión; no se reintenta una concesión incierta automáticamente.
Si falla solo la confirmación final tras asignar claims, la cuenta conserva el acceso asignado y
la autorización processing requiere reconciliación operativa. El registro de roles prueba la concesión.

Las reglas de Firestore deniegan acceso directo al índice y a las autorizaciones. Solo los callables
proyectan identidad y los cambios registran eventos sin copiar el correo al evento de auditoría.

## Publicación

No se cambiaron cuentas ni invitaciones de producción durante el desarrollo. Publicar funciones
y web requiere autorización específica. El owner debe pasar las cuentas headCoach existentes
a administrator; hasta entonces mantienen el alcance anterior.
