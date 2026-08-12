# BRIEF.md - BPT Jersey Academy Platform

## Producto

Plataforma web operativa para Brazilian Power Team Jersey que reúne en un solo sistema la gestión de estudiantes y familias, personal, horarios, asistencia, membresías, pagos, progreso, reconocimiento y CRM.

## Idioma

- Toda la interfaz, navegación, mensajes, correos, documentos generados y contenido público deben estar en inglés.
- La documentación técnica interna puede mantenerse en español.

## Usuarios objetivo

- Propietario de la academia.
- Administración y recepción.
- Head coach y coaches.
- Padres, madres y tutores de menores.
- Estudiantes adultos.
- Prospectos interesados en una clase de prueba.

El usuario que más sufre sin el producto es el equipo operativo de la academia: hoy debe coordinar datos, asistencia, cobros, progreso y seguimiento entre herramientas separadas. Las familias también necesitan visibilidad segura y confiable sobre asistencia, salida y progreso de sus hijos.

## Problema y resultado esperado

Sin esta plataforma durante los próximos tres meses, la academia seguirá expuesta a registros fragmentados, seguimiento manual de pagos y prospectos, menor trazabilidad sobre menores presentes en las instalaciones y dificultad para evaluar el progreso de forma consistente.

El MVP debe permitir operar la academia sin hojas de cálculo paralelas. Su criterio de salida es poder registrar una familia, administrar un coach, vender una membresía, cobrar, programar una clase, registrar entrada y salida, tomar asistencia, evaluar desempeño, proponer reconocimientos, administrar un lead, recuperar a un estudiante inactivo y exportar la información.

## Principios de producto

- Un perfil unificado por estudiante o familia, sin duplicación entre módulos.
- Seguridad y privacidad por diseño debido al tratamiento de datos de menores, información médica y pagos.
- Cada rol ve únicamente la información necesaria para su trabajo.
- Las decisiones sensibles permanecen bajo control humano: la plataforma propone; el personal autorizado aprueba.
- La experiencia debe ser fácil de aprender y reducir trabajo administrativo, tomando a Gymdesk como referencia funcional, no como plantilla visual para copiar.
- La primera versión debe ser una aplicación web responsive y preparada como PWA; las aplicaciones móviles nativas se aplazan.

## Alcance previo a construcción - Phase 0

Antes de cerrar reglas de negocio deben confirmarse:

1. Programas, grupos de edad y habilidad, clases Gi/No-Gi/beginner/advanced/competition, capacidad, ubicaciones, horarios y precios.
2. Reglas de cinturones y stripes, pagos, cancelaciones y congelación de membresías.
3. Roles iniciales: administrator/reception, head coach, coach, parent/guardian y adult student. `owner` no es un rol de negocio visible, pero el claim técnico `owner` es el único autorizado para conceder o revocar accesos administrativos.
4. Criterios uniformes de desempeño: attendance, punctuality, focus, discipline, technical progress, training performance, effort, resilience, respect y teamwork.
5. Proveedor de pagos disponible para una academia en Jersey, conservando una capa independiente del proveedor.

## MVP - Phase 1 priorizado

Todos los bloques siguientes pertenecen al primer release. El puntaje RICE simplificado ordena la construcción; no elimina requisitos obligatorios.

| Orden | Capacidad | Alcance | Impacto | Confianza | Esfuerzo inverso | Puntaje | Motivo |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | Security, consent and audit trail | 5 | 5 | 5 | 3 | 4.50 | Condición transversal y de lanzamiento por menores, salud y pagos. |
| 2 | User, family and student management | 5 | 5 | 5 | 3 | 4.50 | Fuente unificada de identidad para todos los módulos. |
| 3 | Roles, coach and staff management | 5 | 5 | 5 | 3 | 4.50 | Habilita separación de funciones y acceso mínimo. |
| 4 | Scheduling, classes and bookings | 5 | 5 | 5 | 3 | 4.50 | Base de la operación diaria y de la asistencia. |
| 5 | Check-in, check-out and attendance | 5 | 5 | 5 | 3 | 4.50 | Operación principal y control de menores en las instalaciones. |
| 6 | Memberships and subscriptions | 5 | 5 | 5 | 3 | 4.50 | Define acceso, vigencia y relación comercial. |
| 7 | Payments, invoices and receipts | 4 | 5 | 4 | 2 | 3.75 | Mueve recaudo y reduce seguimiento manual; depende del proveedor. |
| 8 | Owner dashboard and reports | 4 | 4 | 4 | 2 | 3.50 | Convierte los datos operativos en acciones diarias. |
| 9 | Academy CRM | 4 | 4 | 4 | 2 | 3.50 | Mejora conversión, seguimiento y retención. |
| 10 | Student progress and coach assessments | 4 | 4 | 4 | 2 | 3.50 | Diferencia el producto de un CRUD genérico de gimnasio. |
| 11 | Communication | 4 | 4 | 4 | 2 | 3.50 | Centraliza avisos y mantiene comunicación con menores visible al tutor. |
| 12 | Recognition and internal rankings | 3 | 3 | 4 | 3 | 3.25 | Aporta motivación, pero siempre requiere revisión del head coach. |

## Reglas no negociables del MVP

- Los menores no necesitan cuentas individuales; sus tutores los gestionan desde la cuenta familiar.
- No se almacena información cruda de tarjetas; la conserva el proveedor de pagos.
- Historial financiero y de membresía no se elimina accidentalmente.
- Las correcciones de asistencia, pagos y evaluaciones conservan auditoría de autor y momento.
- Para menores, la salida registra adulto autorizado, salida independiente aprobada, confirmación del personal o permanencia en las instalaciones.
- No existe un leaderboard público infantil ni se etiqueta públicamente al peor estudiante.
- Ausencias médicas aprobadas no penalizan reconocimientos.
- Coaches no pueden mantener conversaciones privadas y ocultas con menores.
- Belts y stripes nunca se otorgan automáticamente.
- Child transportation está completamente fuera de alcance.

## Fuera del MVP

- Phase 2: booking avanzado, automatización de cobros/CRM/notificaciones, autoservicio completo y asistencia offline.
- Phase 3: biblioteca técnica, currículo, evaluación por técnica, promociones y portal completo de progreso.
- Phase 4: goals/streaks, resúmenes familiares automatizados, apps nativas y comunidad.
- Phase 5: referrals, eventos, competencias, clases privadas y retail avanzado fuera de la tienda inicial aprobada.
- Phase 6: analítica predictiva, IA, multi-academia, white label y SaaS.
- Autorizaciones de salida de menores, promociones, pagos, diagnósticos o decisiones de safeguarding mediante IA.

## Roadmap

### MVP (v1) - lanzamiento

- Configuración de academia, roles, permisos y reglas de evaluación.
- Perfiles unificados de familias, estudiantes, coaches y personal.
- Agenda, clases, reservas básicas, check-in/out y asistencia.
- Membresías, pagos, facturas, recibos y alertas básicas.
- Evaluaciones, skill checklist y reconocimiento interno revisado por coaches.
- CRM, comunicaciones, dashboard operativo, reportes y exportación.
- Consentimientos versionados, auditoría, acceso restringido, backups probados y QA E2E por rol.

Estimación no comprometida: **20-28 semanas hasta piloto de producción**, con objetivo orientativo entre diciembre de 2026 y febrero de 2027. Se recalibrará al terminar Phase 0, elegir proveedor de pagos y conocer el volumen/migración de datos reales.

### v2 - automatización y profundidad operativa

- Booking avanzado, waitlists, créditos y reservas recurrentes.
- Automatización de cobros, CRM, retención y notificaciones.
- Autoservicio ampliado para tutores y adultos.
- Asistencia offline con sincronización segura.
- Biblioteca técnica, currículo, evaluación detallada y workflow de promociones.

### v3 - engagement, crecimiento y escala

- Goals, streaks, resúmenes familiares y comunidad controlada.
- Aplicaciones móviles nativas.
- Referrals, eventos, privadas, competencias y retail.
- Analítica predictiva explicable, IA asistida, multi-academia y eventual SaaS.

## Métricas de éxito

- Porcentaje de operación diaria realizada sin hojas de cálculo externas.
- Tiempo administrativo semanal ahorrado.
- Cero menores marcados como presentes sin estado de salida al cierre.
- Tasa de cobros exitosos y reducción de saldos vencidos.
- Conversión de enquiry a trial y de trial a membership.
- Retención y alertas de caída de asistencia atendidas.
- Cobertura y puntualidad de evaluaciones de progreso.
- Trazabilidad completa de cambios sensibles.

## Marca y referencias

- Sitio actual: https://bptjersey.com/
- Instagram: https://www.instagram.com/brazilianpowerteamjersey?igsh=MXFkZG13ZDZsMW4weg==
- Facebook: https://www.facebook.com/share/18B9xSnHx6/?mibextid=wwXIfr
- Competidor/referencia funcional: https://gymdesk.com/
- Logo oficial: `F:\Proyectos\BPT Jersey\Img\Logo.PDF`
- El sitio actual presenta Brazilian Jiu-Jitsu, MMA y self-defence, con clases infantiles y adultas en distintas franjas y ubicaciones.

## Restricciones técnicas y económicas

- Gestor de paquetes obligatorio: pnpm.
- Plataforma preferida: Firebase Auth, Cloud Firestore, Realtime Database, Cloud Functions y Firebase Hosting.
- Archivos y objetos: Cloudflare R2.
- Debe priorizarse el uso eficiente de las cuotas gratuitas indicadas por el operador, sin depender de que permanezcan invariables.
- Cloud Functions y phone authentication requieren Blaze/pay-as-you-go; antes de producción deben existir presupuestos y alertas de facturación.
- Las tarifas y cuotas se verifican nuevamente antes de cada despliegue porque son condiciones externas variables.

## Decisiones abiertas

- Proveedor de pagos con disponibilidad y condiciones adecuadas para Jersey.
- Necesidad real de phone authentication en el MVP; por defecto se priorizan email/password y Google para evitar costo y abuso por SMS.
- Proveedor de email transaccional y eventual SMS.
- Datos definitivos de programas, horarios, capacidades, tarifas y ubicaciones.
- Reglas finales de cancelación, freeze, descuentos y reconocimiento.
- Política de retención, residencia y eliminación de datos, validada para Jersey y para información de menores.
- Fecha objetivo de lanzamiento y presupuesto mensual máximo.
