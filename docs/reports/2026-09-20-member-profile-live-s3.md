# C1 / S3 — perfil canónico con datos vivos

Fecha: 2026-09-20. Rama: `feature/member-profile-live`. Trabajo limitado a `/root/BPT-Jersey-s3`.

Se registraron D1–D5 en el primer commit (`b90b607`), antes de implementar las tareas 1–9 en orden. Cada tarea tiene un commit con el trailer solicitado y una prueba de comportamiento observada en rojo antes de su implementación. Los datos de las pruebas y capturas son sintéticos. No hubo despliegue, push, acceso a producción, lectura de credenciales ni dependencias nuevas.

## Entregas y pruebas

| Tarea | Resultado | Pruebas de comportamiento principales | Commit |
| --- | --- | --- | --- |
| 1 | Aviso persistente en Members; enlace explícito del archivo al registro vivo mediante el resolvedor existente. `null` mantiene el archivo y ofrece migración/búsqueda; los fallos no se presentan como migración pendiente. Identidad ausente tiene estado neutral y navegación; ID mal formado conserva su error. | `live-record-link.test.tsx`: “keeps unresolved archive identity neutral and retries the read before navigating to the returned student”; cuatro casos “does not label … as pending migration or reveal backend details”. `member-record.test.tsx`: “treats a missing canonical student as unavailable without asserting migration or exposing retry errors”. | `6c2e5e0` |
| 2 | Billing verifica estudiante, familia y relaciones; excluye documentos `legacy-import` antes de parsear y seleccionar factura actual. Conserva límites y rechaza fuente desconocida, vínculo histórico incoherente o dato operacional inválido. No escribe finanzas. | `manual-subscription-service.test.ts`: “distinguishes an absent student from an existing student without a billing family”; “excludes imported memberships, invoices and receipts before parsing and current selection”; seis casos “fails safely for … without finance writes”. Suite: 16 pruebas. | `9ef229f` |
| 3 | Plan utiliza suscripciones y catálogo existentes, muestra historial cancelado, nombres inactivos o referencia con nombre no disponible. Comparte selección actual con Profile y actualiza su resumen en memoria. Excluye membresías importadas en ambos lectores. | `plan-tab.test.tsx`: “renders a successful empty history, then refreshes without claiming an error is empty”; “keeps cancelled history and selects the newest current membership even when catalogue names fail”. `subscription-live-reads.test.ts`: exclusión compartida y cuatro rechazos por fuente, estudiante, dato inválido o límite. `subscription-admin-client.test.ts`: “rejects a valid response for the wrong student”. | `ef8632a` |
| 4 | Payments carga solo facturas vinculadas a las membresías y sus recibos. Reutiliza la presentación existente, muestra GBP, fechas de Jersey, Void y acceso gratuito separado de pagos. Error, vacío y reintento son estados distintos. | `payments-tab.test.tsx`: “shows a safe failure then a successful empty membership-linked account on retry”; “distinguishes invoice states, receipt amounts and complimentary access without inventing payment”. También se ejecutó `member-subscription-editor.test.tsx` (4 pruebas). | `41ba77a` |
| 5 | Contratos públicos cerrados para consultas/páginas Classes; UTC, enums existentes, sesión nullable, máximo 25 filas y cursor validado. Proyecciones puras sin Firebase. Subpath registrado en exports, runtime y mapeo de despliegue. | `member-class-record-contracts.test.ts`: “closes page contracts, validates UTC cursors and projects only member-safe values”. `deploy-runtime.test.ts`: 5 pruebas, incluida preparación e importación del artefacto local. | `1f27b82` |
| 6 | Callable `listMemberClassRecords`, exportado en index, con App Check y actor de oficina activo. Transacción de lectura con estado canónico, estudiante, cursor, consulta 25+1 y hasta 25 sesiones. Filtra correcciones, omite importados, avanza páginas vacías y falla sin búsquedas alternativas si falta un índice. Dos índices nuevos; ninguna colección o concesión de reglas nueva. | `member-class-records-service.test.ts` (11): límites, páginas importadas, roles, cursores, estado canónico y proyección segura. `member-class-records-callables.test.ts`: “rechecks active office claims and uses only the verified academy”. `member-class-records-firestore.test.ts`: consulta limitada y ausencia de fallback. `qa/integration/member-class-records.test.ts`: empates/continuación/correcciones; cursores ajenos, modificados y borrados. | `4174922` |
| 7 | Classes separa Booking activity y Attendance, con lectura/error/reintento independientes; fechas Jersey, estados registrados y sesión ausente explícita. Load more conserva continuidad, deduplica y permite continuar páginas omitidas; Refresh reinicia. | `classes-tab.test.tsx`: “loads booking activity independently from failed attendance and retries only that section”; “continues an all-skipped page, deduplicates rows and resets history on Refresh”; “discards pending responses when the student changes”. `member-class-records-client.test.ts`: alcance, tipo, extras y error de cursor. | `737137a` |
| 8 | Notes muestra la nota de oficina ya cargada, como texto escapado con saltos de línea. Edit in Details enfoca el textarea existente; conserva guardia de cambios y flujo de guardado. Sin nuevo almacenamiento/callable. | `notes-tab.test.tsx`: “renders escaped multiline office text and delegates editing to Details”. `member-record.test.tsx`: “edits the office note in Details with focus and the unsaved guard, then shows the saved note”. También `details-tab.test.tsx` (17). | `9679311` |
| 9 | Regresión integrada de roles, cambio rápido de alumno, estado sin ID, foco y navegación. Se descarta todo el subárbol al cambiar de rol. Ajustes mínimos de presentación: listas sin viñetas, separadores existentes, sin encabezado Payments duplicado. | `member-record.test.tsx` (30): incluye “clears the office note immediately when the role changes while the replacement profile is loading”, cuatro pestañas falsificadas por coach y respuesta tardía de otro alumno. `member-profile-live.spec.ts`: cinco escenarios × dos tamaños (10): datos, vacío, carga/ausencia/error, coach y fallos independientes. Integración adicional con los lectores reales de Plan/Profile/Billing y mezcla importada. | Commit final de tarea 9 |

## Verificación final

Se ejecutó el gate completo solicitado, en orden:

| Comprobación | Resultado final |
| --- | --- |
| `@bpt-jersey/domain build:runtime` | Correcto |
| `format:check` | Correcto |
| `lint` | Correcto, sin warnings de ESLint |
| `typecheck` | Correcto en todos los paquetes |
| `test` (web + node) | **4.252 pasan, 1 falla**, en 396 archivos (395 pasan, 1 falla) |
| Reglas, Docker `bpt-emu:local --network none` | **96 pasan**, 14 archivos |
| Integración Firestore, mismo Docker sin red | **107 pasan, 1 omitida**, 37 archivos (36 pasan, 1 omitido); código 0 |
| Build web | Correcto; exportación estática con configuración E2E sintética |
| Playwright desktop + mobile | **10 pasan**; cinco escenarios en ambos tamaños |

**Sí se observó el fallo dominical preexistente:** `fixture-calendar-repository.test.ts` → “generates sessions for every weekday but Sunday, with programs”, línea 27. Es el único fallo final de web/node, se dejó sin cambios según la instrucción del operador y hace que el comando combinado termine con código 1. No se excluyó del comando para presentar artificialmente un gate verde.

La integración incluye las **3 pruebas nuevas de `member-class-records.test.ts`**, todas correctas. La omisión declarada es `backup-v3-rehearsal.test.ts`: el emulador no soporta sus lecturas point-in-time. Además, el test preexistente “loads the deployed runner without any source TypeScript” compila dominio/functions pero retorna temprano cuando no existe `.firebase-functions`; Vitest lo cuenta entre los 107, aunque **la importación de ese runner desplegado no se ejercitó**. No se generó un despliegue para ocultar esta limitación. Las 5 pruebas unitarias de `deploy-runtime.test.ts` sí comprobaron la preparación/importación de su artefacto temporal local y el nuevo mapeo.

Los logs locales están en `.tmp/s3/full-gate.log`, `.tmp/s3/emulator-final.log` (reglas), `.tmp/s3/integration-final.log`, `.tmp/s3/web-build.log` y `.tmp/s3/playwright.log`.

Capturas locales: `qa/test-results/member-profile-live-*/`, generadas con fixtures sintéticos a 390×844 y 1440×900. Se inspeccionaron páginas reales y se comprobó ausencia de desbordamiento horizontal, teclado, Back/Forward, foco en Details, notas largas y referencias largas. La configuración sintética de sesión se limita al mecanismo E2E existente y loopback. El build generado no es un artefacto autorizado para publicar.

No se midieron mejoras de rendimiento. Las consultas acotadas y la carga al abrir cada pestaña reducen trabajo esperado; no constituyen una medición de latencia ni coste en producción.

## Desviaciones y hallazgos

- No hubo desviaciones funcionales de D1–D5 ni de las tareas. No se adelantó S2, no se modificaron escritores de reservas/asistencia y se conservaron los controles de registro del archivo.
- Los IDs de cursor admiten hasta 512 caracteres: los IDs canónicos de reserva incorporan dos identificadores y pueden superar 128. Sigue siendo una posición ordinaria, validada contra el documento del tenant y alumno en cada página.
- La comprobación integrada encontró retención de la nota de oficina durante un cambio de rol. La prueba falló antes del ajuste y pasó al remontar el registro por rol, descartando también respuestas pendientes. Fue una regresión observada con fixtures, sin exposición de datos reales.
- El primer build encontró una importación relativa `.js` incompatible con el empaquetador web. Se adoptó la convención existente del dominio (sin extensión en fuente; preparación de runtime añade las extensiones).
- La imagen Docker no contiene los jars de emulación. Se montaron las cachés de emuladores y Corepack del host en solo lectura; `--network none` se mantuvo. El cambio de ruta a `/workspace` hizo que pnpm intentara reinstalar dependencias; la última ejecución usa `pnpm_config_verify_deps_before_run=warn` únicamente dentro del contenedor y `COREPACK_ENABLE_NETWORK=0`. No se cambiaron dependencias ni configuración del repositorio, ni se montaron credenciales.
- Centinela emitió alertas al imprimir referencias a variables de configuración. La revisión acotada clasificó esas alertas como falsos positivos: ningún valor literal de token o clave privada estaba en la salida; no se inspeccionaron credenciales ni se realizó una auditoría del VPS fuera del alcance.

## Prioridades de revisión

1. **Proveniencia financiera**: exclusión antes del parser/selección, límites antes de filtrar, vínculo de administración a factura importada y recibos de hermanos. El guard de S3 es local; no convierte todos los lectores/escritores financieros en compatibles con S2.
2. **Cursores y consistencia**: transacción de lectura, documento de cursor del mismo tenant/alumno/tipo, orden por instante + ID, correcciones fuera del stream y cursor desde la última fila escaneada aunque sea importada. El emulador no sustituye la verificación futura de índices desplegados.
3. **Vida de los datos en pantalla**: desmontaje por rol/alumno, respuestas tardías descartadas, notas sin almacenamiento persistente, vuelta a Details con guardia de cambios y resumen Plan en memoria.
4. **Límites honestos**: Plan sigue limitado a 100 y Billing conserva sus topes; no hay totales vitalicios, agenda futura ni cuenta familiar completa. Una sesión ausente conserva la fila de actividad.

C1/S2, migración de estudiantes, despliegue de callable/índices y retirada del archivo siguen fuera del alcance de esta entrega.
