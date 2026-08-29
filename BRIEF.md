# BRIEF.md - BPT Jersey Academy Platform

## Producto

Plataforma web operativa para Brazilian Power Team Jersey que reúne en un solo sistema la gestión de estudiantes y familias, personal, horarios, asistencia, membresías, pagos, progreso, reconocimiento y CRM.

## Idioma

- Toda la interfaz, navegación, mensajes, correos, documentos generados y contenido público deben estar en inglés.
- La documentación técnica interna puede mantenerse en español.

## Fuentes funcionales vinculantes

- Desde el 2026-08-18, `F:\Proyectos\BPT Jersey\Varios\BPTJ FUNCTIONS APP.docx` y
  `F:\Proyectos\BPT Jersey\Varios\BPT-memberships.docx` son la fuente funcional prioritaria del
  MVP. Cualquier requisito anterior que los contradiga queda sustituido por estos documentos y por
  las decisiones confirmadas en esta sección.
- Regyfit se usa únicamente como fuente read-only para la jerarquía, orden, colores y habilidades
  observadas de `Levels: JIU-JITSU - IBJJF`. El inventario sanitizado vive en
  `docs/data/ibjjf-levels-observed.sanitized.json`.
- Ante conflicto, los DOCX gobiernan edad, clases y tiempo; Regyfit gobierna jerarquía, cantidad de
  stripes, visuales y habilidades observadas. Las anomalías quedan marcadas y no se importan por
  inferencia.
- No existe sincronización automática con Regyfit ni se copian miembros, credenciales, cookies,
  tokens o datos personales desde esa fuente.

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

El MVP piloto debe completar, con persistencia real en emuladores o staging separado, el registro de
adultos/familias/menores, personal, sedes y planes; pagos manuales y deuda PAYG; grupos, currículo,
clases, seminarios, reservas y cancelaciones; check-in/out, asistencia y puntualidad; niveles,
técnicas, progreso y promociones revisadas; portales por rol, avisos internos y reportes. CRM,
cobros online reales y mensajería externa no bloquean este piloto.

## Principios de producto

- Un perfil unificado por estudiante o familia, sin duplicación entre módulos.
- Seguridad y privacidad por diseño debido al tratamiento de datos de menores, información médica y pagos.
- Cada rol ve únicamente la información necesaria para su trabajo.
- Las decisiones sensibles permanecen bajo control humano: la plataforma propone; el personal autorizado aprueba.
- La experiencia debe ser fácil de aprender y reducir trabajo administrativo, tomando a Gymdesk como referencia funcional, no como plantilla visual para copiar.
- La primera versión debe ser una aplicación web responsive y preparada como PWA; las aplicaciones móviles nativas se aplazan.

## Decisiones operativas aprobadas para el piloto

1. Las sedes operativas son **Town** y **West**; todo plan, clase, booking y vista operativa declara
   su sede.
2. Booking y cancelación cierran una hora antes, incluidos Open Mats. Un no-show de Town genera una
   penalización manual auditable de GBP 15, con resolución por office.
3. Una sesión exige al menos cuatro bookings una hora antes; owner/head coach puede elevar el
   mínimo. Si no se alcanza, una tarea idempotente cancela la sesión y emite avisos in-app.
4. PAYG puede acumular una sesión pendiente; antes de reservar otra debe registrarse el pago manual
   de la deuda y de la nueva sesión.
5. El radio de 50 metros es una señal de elegibilidad para check-in, no prueba absoluta. No se
   guardan coordenadas; staff puede aplicar override con motivo y auditoría.
6. Los menores no tienen cuenta propia. El tutor gestiona registro, consentimiento, bookings y
   progreso. A los 12 años, head coach puede asignar Kids o Teens; Teens es la sugerencia.
7. La comparación de progreso solo incluye adultos opt-in. Los menores ven únicamente su propio
   progreso.
8. Las reglas de niveles generan propuestas. Solo head coach aprueba belts o stripes.
9. Los avisos del piloto son in-app. Email/SMS y cobros online reales quedan fuera del piloto.
10. El piloto usa datos sintéticos o sanitizados en emuladores y, cuando exista, un Firebase staging
    separado. No autoriza nuevas escrituras ni despliegues en producción.

### Catálogo inicial de memberships

| Plan             |            Precio | Acceso vinculante                                          |
| ---------------- | ----------------: | ---------------------------------------------------------- |
| Pay as you go    | GBP 10 por sesión | Town y West; aplica la regla de deuda PAYG.                |
| BPT Jersey Adult |       GBP 125/mes | Todas las clases y Open Mats de Town y West.               |
| West Kids 1x     |        GBP 95/mes | Una clase semanal y West Open Mats; sin Town Open Mats.    |
| West Kids 2x     |       GBP 115/mes | Dos clases semanales y acceso a Town Open Mats.            |
| West Adult       |        GBP 65/mes | Clases/Open Mats West sin límite y Town Open Mats.         |
| West Teens       |        GBP 45/mes | Dos clases semanales; Open Mat cuesta GBP 7.50 por sesión. |
| Town Adult       |        GBP 85/mes | Clases y Open Mats Town sin límite.                        |
| Town Kids 1x     |        GBP 95/mes | Una clase semanal.                                         |
| Town Kids 2x     |       GBP 135/mes | Dos clases semanales y Open Mats Town sin límite.          |
| Town Teens       |        GBP 45/mes | Dos clases semanales; Open Mat cuesta GBP 7.50 por sesión. |

## MVP piloto priorizado

Todos los bloques siguientes pertenecen al piloto completo. El puntaje RICE simplificado ordena
la construcción; no elimina requisitos obligatorios de los DOCX.

| Orden | Capacidad                                    | Alcance | Impacto | Confianza | Esfuerzo inverso | Puntaje | Motivo                                                              |
| ----: | -------------------------------------------- | ------: | ------: | --------: | ---------------: | ------: | ------------------------------------------------------------------- |
|     1 | Security, isolated pilot and audit trail     |       5 |       5 |         5 |                4 |    4.75 | Bloquea escrituras ambiguas y protege menores, salud y finanzas.    |
|     2 | Adult, family, minor and staff registration  |       5 |       5 |         5 |                3 |    4.50 | Fuente unificada de identidad, tutela, consentimiento y asignación. |
|     3 | Memberships, PAYG debt and manual finance    |       5 |       5 |         5 |                3 |    4.50 | Define acceso comercial sin depender de un proveedor externo.       |
|     4 | Groups, curriculum, classes and bookings     |       5 |       5 |         5 |                2 |    4.25 | Habilita el calendario operativo y el autoservicio.                 |
|     5 | Check-in/out, attendance and punctuality     |       5 |       5 |         5 |                2 |    4.25 | Flujo diario crítico, incluida la seguridad de menores.             |
|     6 | IBJJF levels, skills and reviewed promotions |       4 |       5 |         5 |                2 |    4.00 | Implementa el progreso solicitado sin promociones automáticas.      |
|     7 | Role portals and in-app notifications        |       4 |       4 |         5 |                3 |    4.00 | Conecta la operación de owner, staff, coach y familias.             |
|     8 | Dashboards, birthdays, reports and pilot QA  |       4 |       4 |         4 |                2 |    3.50 | Cierra trazabilidad, visibilidad y evidencia de entrega.            |

## Reglas no negociables del MVP

- Los menores no necesitan cuentas individuales; sus tutores los gestionan desde la cuenta familiar.
- El piloto no captura datos de tarjeta. Una integración productiva futura delegará esos datos al
  proveedor y nunca los almacenará en BPT.
- Historial financiero y de membresía no se elimina accidentalmente.
- Las correcciones de asistencia, pagos y evaluaciones conservan auditoría de autor y momento.
- Para menores, la salida registra adulto autorizado, salida independiente aprobada, confirmación del personal o permanencia en las instalaciones.
- No existe un leaderboard público infantil ni se etiqueta públicamente al peor estudiante.
- Ausencias médicas aprobadas no penalizan reconocimientos.
- Coaches no pueden mantener conversaciones privadas y ocultas con menores.
- Belts y stripes nunca se otorgan automáticamente.
- Child transportation está completamente fuera de alcance.

## Fuera del MVP

- Cobros online reales, proveedor de pago, webhooks financieros y automatización de refunds.
- Email/SMS transaccional y automatizaciones externas de comunicación.
- CRM completo, journeys de retención y automatización comercial.
- Asistencia offline, apps nativas, comunidad, referrals, competencias, privadas y retail.
- Analítica predictiva, IA, multi-academia, white label y SaaS.
- Autorizaciones de salida de menores, promociones, pagos, diagnósticos o decisiones de safeguarding mediante IA.
- Comparación pública de menores y promociones automáticas.

## Roadmap

### MVP (v1) - lanzamiento

- Piloto aislado, guardas de entorno, roles, permisos, consentimientos y auditoría.
- Registro unificado de adultos, familias, menores, tutores, coaches y staff.
- Town/West, catálogo de planes, memberships, deuda PAYG y pagos manuales.
- Grupos, currículo, clases, seminarios, bookings, cancelaciones y avisos internos.
- QR/manual/GPS asistido, check-in/out, asistencia, puntualidad y operación preclase.
- 27 belts, 144 stripes, técnicas, progreso y promociones aprobadas por head coach.
- El alcance de Levels es completo dentro del MVP: las 171 definiciones observadas, los 27 belts,
  los 144 stripes y las 11 habilidades deben recrearse; no se difiere ninguna parte a v2.
- Portales por rol, cumpleaños, comparación adulta opt-in, dashboards y reportes.
- QA por rol, accesibilidad, carga, Rules, restauración y rollback del piloto.

Estimación no comprometida: **8-12 semanas hasta el piloto controlado**, con objetivo orientativo
entre octubre y noviembre de 2026. No incluye despliegue productivo ni integración de pagos/email.

### v2 - automatización y profundidad operativa

- Booking avanzado, waitlists, créditos y reservas recurrentes.
- Automatización de cobros, CRM, retención y notificaciones.
- Autoservicio ampliado para tutores y adultos.
- Asistencia offline con sincronización segura.
- Biblioteca técnica ampliada, planificación avanzada de lecciones, evaluación detallada y
  automatizaciones del workflow de promociones. El currículo básico y la aprobación humana ya
  pertenecen al MVP.

### v3 - engagement, crecimiento y escala

- Goals, achievements, resúmenes familiares ampliados y comunidad controlada.
- Aplicaciones móviles nativas.
- Referrals, privadas, competencias y retail. Los seminarios operativos ya pertenecen al MVP.
- Analítica predictiva explicable, IA asistida, multi-academia y eventual SaaS.

#### Corte implementado T060 - waitlist persistida

El primer usuario es el tutor o adulto que encuentra una sesión completa. Sin una waitlist, la intención se pierde o exige seguimiento manual del staff. El corte medible conserva solicitudes recuperables para una futura promoción, pero todavía no promete ni asigna cupos automáticamente.

Entra ahora: join/list/cancel tenant-scoped, posición atómica, elegibilidad fail-closed por sesión completa y membresía `active`/`trial` vigente, RBAC y pruebas Emulator. Se difieren promoción, oferta/aceptación, reordenamiento, créditos, recurrencia, cobros, mensajes y UI final hasta contar con políticas aprobadas.

## Plan provisional de avance v2/v3

El contador visual incluye doce capacidades futuras T060-T071. El plan de discovery prioriza T060
(booking avanzado), T063 (autoservicio), T062 (retencion/CRM) y T067 (logros familiares). La
puntuacion y las decisiones abiertas estan en
docs/roadmap/v2-v3-advance-plan.md. Este plan no cambia el alcance del MVP ni aprueba implementacion,
produccion, pagos, mensajeria externa o datos reales.

## Métricas de éxito del piloto

- Porcentaje de operación diaria realizada sin hojas de cálculo externas.
- Tiempo administrativo semanal ahorrado.
- Cero menores marcados como presentes sin estado de salida al cierre.
- Porcentaje de pagos manuales y saldos conciliados sin inconsistencias.
- Cobertura y puntualidad de evaluaciones de progreso.
- Rachas de asistencia calculadas sin penalizar ausencias médicas aprobadas.
- Trazabilidad completa de cambios sensibles.

Conversión, retención, cobros online y entregas externas se medirán cuando sus módulos post-piloto
existan; no son criterios de aceptación de este MVP.

## Marca y referencias

- Sitio actual: https://bptjersey.com/
- Instagram: https://www.instagram.com/brazilianpowerteamjersey?igsh=MXFkZG13ZDZsMW4weg==
- Facebook: https://www.facebook.com/share/18B9xSnHx6/?mibextid=wwXIfr
- Competidor/referencia funcional: https://gymdesk.com/
- Logo oficial: `F:\Proyectos\BPT Jersey\Img\Logo.PDF`
- El sitio actual presenta Brazilian Jiu-Jitsu, MMA y self-defence, con clases infantiles y adultas en distintas franjas y ubicaciones.

## Restricciones técnicas y económicas

- Gestor de paquetes obligatorio: pnpm.
- Plataforma operativa: Firebase Auth, Cloud Firestore, Realtime Database y Cloud Functions;
  frontend estático/PWA en Cloudflare Pages.
- Archivos y objetos: Cloudflare R2.
- Debe priorizarse el uso eficiente de las cuotas gratuitas indicadas por el operador, sin depender de que permanezcan invariables.
- Cloud Functions y phone authentication requieren Blaze/pay-as-you-go; antes de producción deben existir presupuestos y alertas de facturación.
- Las tarifas y cuotas se verifican nuevamente antes de cada despliegue porque son condiciones externas variables.

## Decisiones abiertas

- Proveedor de pagos con disponibilidad y condiciones adecuadas para Jersey, solo para una fase
  productiva posterior; no bloquea el piloto manual.
- Necesidad real de phone authentication en el MVP; por defecto se priorizan email/password y Google para evitar costo y abuso por SMS.
- Proveedor de email transaccional y eventual SMS, fuera del piloto.
- Horarios concretos y capacidades de cada clase, configurables por staff.
- Reglas de freeze, descuentos y refunds posteriores al catálogo inicial.
- Política de retención, residencia y eliminación de datos, validada para Jersey y para información de menores.
- Fecha objetivo de producción y presupuesto mensual máximo.
