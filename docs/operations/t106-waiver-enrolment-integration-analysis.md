# T106 - Integración del "Waiver and Emergency Contact Form" en el alta administrativa

Fecha: 2026-09-04. Alcance: análisis y propuesta; no cambia código de consentimiento.

## 1. Qué contiene el formulario oficial

Fuente: `F:\Proyectos\BPT Jersey\Varios\Brazilian Power Team Jersey Waiver and Release of Liability.pdf`
(copia inmutable en `apps/web/public/legal/` y `apps/functions/src/consents/assets/`, SHA-256
`5FF6ADD6...C10AD1`, integrada en T090).

| Bloque del PDF                                   | Campos                                                                          | Dónde vive hoy en la plataforma                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Participant information                          | Full name, DOB, phone, email (opt), address (opt), post code (opt)              | `students` (nombre, DOB, teléfono, email). **Address y post code no existen** en ningún contrato.                 |
| Emergency contact                                | Full name, relationship, phone, alternate phone (opt)                           | **No existe** para alumnos canónicos. Solo aparece como texto libre en `regyfitMemberRecords.emergencyContact`. |
| Medical conditions, injuries, allergies, medication | Texto libre                                                                    | `healthProfiles.conditionSummary` (máx. 1.000 caracteres, Restricted) via `saveHealthProfile`.                    |
| Cláusulas 1-10 (riesgos, médico, liberación, indemnización, tratamiento, foto/vídeo, menores, ley de Jersey, datos, higiene) | Aceptación única al firmar | `waiverVersions` (4 cláusulas fijas: `photoVideo`, `medicalTreatment`, `hygiene`, `dataProtection`) + `consents`. |
| Firma                                            | Participant signature, parent/guardian signature (<18), date, instructor name   | `consents.signedBy` (UID autenticado), `signatureMethod: authenticated_typed_name`, PDF evidencia en R2.          |

## 2. Cómo funciona hoy el waiver y por qué no cubre el alta administrativa

- El único camino para registrar aceptación es `/account/waiver`, con el cliente autenticado
  (`guardian` o `adultStudent`). El backend exige que `students.userId === uid` (adulto) o una
  relación activa `relationships.adultUserId === uid` (menor).
- Un alumno creado desde `/admin/members/add` no tiene `userId` hasta que crea su cuenta y
  completa `/account/profile`; por tanto **no puede firmar nada** hasta ese momento.
- Los callables de consentimiento (`getWaiverRegistration`, `acceptWaiver`, `publishWaiverVersion`,
  etc.) están **cerrados fuera del piloto** (`BPT_SYNTHETIC_PILOT=true`), igual que
  `saveHealthProfile`. En producción hoy fallan con `failed-precondition`; el alta administrativa
  ya ignora silenciosamente ese fallo al guardar condiciones médicas.
- La evidencia PDF necesita R2 real; los secretos `R2_*` en producción son placeholders (T104).
- No hay versión de waiver publicada en producción (T091: "no hay texto legal aprobado").

## 3. Opciones de integración

| Opción                                                      | Descripción                                                                                                                                                                                                                | Ventajas                                                                          | Riesgos / coste                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A. Captura en recepción + firma presencial registrada por admin | El alta captura contacto de emergencia y datos médicos; el admin marca "waiver firmado en papel", fecha, instructor y sube el escaneo al flujo privado R2 (T024). La app conserva el PDF oficial como texto vinculante. | Encaja con la operación real (tablet/papel en recepción), no exige cuenta de cliente. | Requiere nuevo `signatureMethod: "in_person_witnessed"` en `consents`, callable admin `recordWitnessedWaiver`, y R2 productivo.          |
| B. Invitación al cliente                                    | El alta guarda email; el sistema envía enlace para crear cuenta -> `/account/profile` -> `/account/waiver` (flujo T090 ya existente). Estado "waiver pendiente" visible en el directorio.                                   | Reutiliza todo lo construido; firma autenticada con máxima trazabilidad.          | Mensajería externa está fuera del MVP (STACK); depende de que el alumno complete el proceso; menores necesitan tutor vinculado.       |
| C. Solo datos, sin firma digital                            | El alta captura emergencia + médico y muestra checklist de lectura; la firma sigue en papel archivado fuera del sistema.                                                                                                  | Mínimo cambio; no toca el modelo legal.                                           | No hay evidencia verificable en la plataforma; duplicidad de fuentes.                                                                  |

## 4. Recomendación

Implementar **A + B** en dos pasos, manteniendo C como fallback mientras T011 (política legal) siga
bloqueada:

1. **Datos (sin dependencia legal):**
   - Añadir a `students`/`studentAdminProfiles` un bloque `emergencyContact { fullName, relationship,
     phoneNumber, alternatePhoneNumber }` y `postalAddress { line, postCode }` opcionales, clasificados
     `Confidential`, con proyección restringida en el directorio (nunca en listados generales).
   - Extender `adminCreateStudentInputSchema`, el writer canónico y `/admin/members/add` con la sección
     "Emergency contact" replicando el PDF; el bloque médico ya existe.
   - Mostrar el estado de waiver (`none | paper-witnessed | digital-accepted | revoked`) en la ficha.
2. **Firma (cuando T011 y el texto legal estén aprobados y `BPT_SYNTHETIC_PILOT` deje de ser el gate):**
   - Publicar la versión oficial en `/admin/waivers` con las cuatro cláusulas mapeadas al PDF.
   - Nuevo callable admin `recordWitnessedWaiver({ studentId, signedOn, instructorName, guardianName? })`
     que reutiliza `createConsentStore.acceptWaiver` con `signatureMethod: "in_person_witnessed"`,
     genera la misma evidencia PDF y audita `consent.accepted`.
   - Para menores, exigir tutor vinculado (flujo de familias) antes de aceptar la firma presencial.
   - Cuando el alumno cree su cuenta, `/account/waiver` mostrará la aceptación existente y permitirá
     renovarla digitalmente.

## 5. Dependencias y bloqueos

- T011 (retención/residencia/borrado) y texto legal aprobado: sin ellos no se debe activar firma
  productiva ni almacenar escaneos.
- R2 productivo con credenciales reales (T104 dejó placeholders).
- T093/T094 (alta canónica y onboarding) para que `students` sea la única fuente del participante.
