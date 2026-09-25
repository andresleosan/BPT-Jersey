# Product

Contexto estratégico del producto para las revisiones de interfaz. DESIGN.md conserva la
autoridad visual; las decisiones de producto viven en los ledgers y en `docs/adr/`.

## Register

product

## Users

Propietario, oficina, coaches, estudiantes adultos, tutores y estudiantes adolescentes
habilitados usan flujos limitados por rol. Los miembros consultan próximas clases,
gestionan reservas y registran asistencia; el tutor actúa por el hijo seleccionado.
Los prospectos solicitan una clase de prueba desde el sitio público.

## Product Purpose

Reunir estudiantes, familias, horarios, asistencia, membresías, pagos manuales y
progreso de BPT Jersey en una plataforma responsive. Reducir la administración
fragmentada, conservando la privacidad familiar y la trazabilidad de asistencia.

## Brand Personality

Clara, segura y práctica. Un tablón de academia bien gestionada: interfaz en inglés
británico sencillo y decoración solo cuando comunica información (DESIGN.md §§1 y 8).

## Anti-references

Gymdesk es referencia funcional, no plantilla visual. Evitar marketing
genérico, gradientes decorativos, sombras difusas, tarjetas para todo, spinners y
personas de relleno (DESIGN.md §8). Conservar las excepciones de la aplicación de
miembros en DESIGN.md §9, sin imponer un sistema visual nuevo.

## Design Principles

- Un perfil canónico por estudiante o familia para todos los flujos.
- Cada rol ve únicamente la información necesaria para su trabajo.
- Privacidad y protección de menores integradas en la interacción.
- Decisiones sensibles bajo control humano autorizado.
- Tareas diarias fáciles de aprender, con acciones claras y respuestas honestas.

## Accessibility & Inclusion

Priorizar acceso web responsive. Conservar contraste alto, foco visible, texto legible,
objetivos táctiles de al menos 44 px, prevención de desbordamiento y soporte para
movimiento reducido (DESIGN.md §§3, 4 y 6). El control de autoasistencia conserva
operación nativa por teclado y anuncios de estado, según su especificación aprobada.

## Team roles (2026-09-20)

The operator unified administrator and head coach: `administrator` combines office, finance and
sporting decisions. `owner` has all of those capabilities plus administrative role management.
`coach` retains its limited sporting access and no financial workflows. The historical `headCoach`
value remains readable while an owner explicitly transitions each existing account to administrator;
new head-coach assignments are retired. Belt levels are independent of access roles.

Staff includes an office-only list of team names, emails and roles. Only owners change administrative
roles or authorise an email for administrator/owner access. Email authorisations activate through
verified Google sign-in at `/staff/login`, expire after seven days and do not send email automatically.

## Manual graduations (2026-09-20)

Administrators and owners may promote an active student to a higher catalogue level regardless of
unmet class, time, skill or age criteria, including skipped ranks. The review still shows unmet
criteria; a note is optional. The server records the decision, actor and criteria as they stood.
Coach permissions remain unchanged; historical headCoach accounts still need a note below criteria.
Academy scope, active authorisation, valid dates and current level references remain enforced.

## Complete administrative enrolment (2026-09-20)

Office staff save personal details, then complete initial level and manual subscription/payment
on the same registration screen. Members do not need an online account for manual subscriptions.
Minor students start through Families with their tutor and continue to the same setup screen.
Progress is explicit; a failed medical save remains pending and can be retried without duplicating
the student. Completion requires confirmed level, subscription and any supplied medical information.
Administrator has full operational member/coach management; granting or removing administrative
access remains owner-only. Medical administration uses current office authority and App Check;
other roles keep their existing restrictions. See ADR-013; production publication is separate.

## Office calendar management (2026-09-20)

Owner and administrator can create sessions without a per-user count quota and correct session
metadata in any status, including site and class type. Removing a session uses cancellation:
it leaves the active calendar while bookings and attendance remain in history. Editing a weekly
series has no application-imposed 400-occurrence ceiling. Member booking rules, authentication,
academy boundaries and coach restrictions remain in force. Calendar summaries and recent date
navigation avoid repeated work; users can refresh explicitly. See ADR-014; publication is separate.

## Progressive calendar loading and mobile agenda (2026-09-20)

Sessions appear independently of registration counts. Pending or unavailable counts are unknown,
not zero; retrying counts leaves the classes usable. The annual total is available on demand.
Mobile week/day views show a readable daily agenda; selecting another day in the loaded week
requires no new query. The mobile month opens weeks from full-width rows. Secondary controls and
section navigation collapse on small screens; desktop retains its timetable. See ADR-015.

## Public enrolment and staff access (2026-09-20)

Public enrolment collects details, suggests eligible plans by age and centre, then asks for bank
transfer evidence for prepaid plans. All per-session (Pay as you go) plans are exempt: no upfront
payment, screenshot or payment-review checkbox is required, including teen PAYG. Mixed family
registrations require payment evidence only for prepaid plans. Office reviews all
submitted details and payment evidence, chooses any published initial level, and confirms the paid
subscription period. Approval completes the member, level and subscription; retries preserve the
same decision and avoid duplicate payments. Staff creation uses one email-and-role form; only owners
can authorise administrative roles or promote existing coaches. See ADR-016; publication is separate.

## Staff role changes without email (2026-09-20)

An owner can change an existing team account to Administrator or Owner directly from Staff,
even when no email or Google account is linked. The target is its existing UID within the academy;
confirmation identifies it by name. Staff ID and password remain valid after promotion, and the
admin panel accepts the refreshed administrative claims without requiring an email. The coaching
profile and unrelated claims remain intact. New email invitations still activate through verified
Google sign-in. Publication of this correction is separate.

## Additional member group access (2026-09-20)

The member calendar hides sessions outside the member's age group and plan sites. Owners and
administrators manage additional program access from Members → profile → Classes. Each grant
adds to normal access and waives age, site and class allowance/weekly limits for that program;
additional-group bookings do not consume the normal weekly allowance while the grant is active.
Active membership and plan, payment standing, session capacity and booking deadlines still apply.
Since 2026-09-21 granting any additional group requires an office reason, and an optional end date
(Jersey calendar day, inclusive) after which the grant authorises nothing; members never see either.
Full or temporarily blocked sessions within accessible groups remain visible without a booking
action. Grant changes are recorded with actor, revision and before/after groups, and are checked
inside booking transactions, including waitlist offers. Member/guardian reads are scoped to the
canonical student. Publication requires coordinated Functions and frontend deployment.

## Finite courses and seminars (implementation, activation pending)

Office users create finite weekly courses and seminars, publish a public catalogue and review one
bank-transfer request per participant. Adults and guardians can enrol without a regular membership;
staff keep their existing roles. Approved participants receive remaining sessions in the existing
calendar and coach roster. Course attendance is separate from ordinary quotas, fees and graduation
counts. Cancellation closes future access; withdrawals and refunds have explicit office decisions.
See `docs/runbooks/finite-courses.md` for configuration and recovery. Production activation is separate.


## Administrator groups and class registrations (2026-09-22)

Owners and administrators manage reusable Groups under Classes / Services using existing
members; a member may belong to several groups. Registering a group creates individual class
bookings without duplicates and explicitly authorises following dates of that weekly series.
There are no group bookings before that office action (ADR-018 exception). Each date requires
an active subscription and the usual access, capacity and allowance checks. Partial results
are visible only to office and coaches; coaches receive names and operational reasons only.
Session removals are exceptions for that date and never remove group membership. Directory
deletion removes group membership; subscription loss keeps it with Missing Payment. Deleting
a group stops future automatic registration and preserves existing bookings. PAYG attendance,
including self check-in and attendance corrections, requires settled payment for that class.
Office records class payments using the existing payment form; coaches have no payment controls.
Production activation requires coordinated Functions, recurring jobs and frontend deployment.

## Transit Free is owner-only (2026-09-25)

Transit Free is an internal, complimentary plan for people close to the owner. It is never
advertised: the public landing price list, enrolment and member plan requests must not show or
offer it (`administrativePlanIds` in `packages/domain/src/memberships/plan-contracts.ts`). Only
the owner can assign it, from Members → profile; administrators and coaches cannot. Members see
it only on their own account once the owner has assigned it to them; no other member sees it.
