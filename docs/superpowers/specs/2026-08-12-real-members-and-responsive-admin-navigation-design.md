# Members reales y navegación administrativa responsive

Fecha: 2026-08-12  
Estado: aprobado para especificación; pendiente de revisión escrita antes de implementación

## Objetivo

Reemplazar progresivamente los fixtures sintéticos de Members por registros reales importados desde
los reportes PDF de Regyfit y convertir el shell administrativo en una experiencia SPA responsive,
sin recarga completa del documento al cambiar de sección.

La primera entrega cubre únicamente:

- Navegación administrativa persistente con App Router.
- Drawer responsive con identidad visual BPT Jersey y logo.
- Importación controlada de los PDFs reales de `F:\Proyectos\BPT Jersey\Varios`.
- Lectura de Members desde Firestore a través de Functions después de confirmar la importación.

No se versionan PDFs, PII real, secretos ni artefactos derivados.

## Fuente Real

Los archivos de entrada locales son:

- `Active.pdf`
- `Activos Regularizados.pdf`
- `COM NÚMERO DE SÓCIO.pdf`
- `Inactive.pdf`
- `No number.pdf`
- `Regularizados.pdf`
- `Suspensos.pdf`
- `Total.pdf`

El importador existente conserva el flujo seguro:

1. Selección local de uno a cinco PDFs por operación, respetando los límites actuales.
2. Creación de sesión temporal y URLs firmadas.
3. Upload privado a R2.
4. Parseo y validación del reporte.
5. Preview con adiciones, actualizaciones, duplicados y conflictos.
6. Confirmación explícita del administrador.
7. Escrituras Firestore server-side, con tenant scope y auditoría existente.

La operación se ejecuta por lotes si el conjunto real supera el límite de archivos de una sesión.
No se combinan automáticamente reportes incompatibles ni se sobreescriben conflictos.

## Navegación SPA

Se agregará `apps/web/src/app/admin/layout.tsx` para mantener `AdminGate` y `AdminShell` alrededor
de las páginas administrativas. La navegación del shell usará `next/link` y el App Router para
actualizar el segmento sin recargar el documento completo.

Desktop:

- Sidebar persistente con ancho estable.
- Logo BPT Jersey y navegación completa visibles.
- Contenido cambia dentro del workspace sin reconstruir la página completa.

Mobile:

- Sidebar reemplazada por un botón de menú accesible.
- El botón muestra el logo reducido, la sección activa y un indicador de apertura.
- El drawer aparece sobre el workspace con fondo de contraste y panel de navegación.
- Cierre mediante selección de ruta, botón explícito, `Escape` y click fuera.
- El foco se mantiene dentro del drawer mientras está abierto y vuelve al botón al cerrarse.
- Respeta `prefers-reduced-motion`, foco visible y targets táctiles mínimos.

El componente no dependerá de mediciones del navegador para decidir el layout; CSS media queries
controlará el cambio desktop/mobile.

## Members Reales

La página `/admin/members` dejará de renderizar `previewData.members` como fuente principal. Usará
un cliente callable para solicitar la primera página de la proyección autorizada y mostrará:

- Estado de carga.
- Estado vacío si todavía no existe importación confirmada.
- Error genérico sin detalles de infraestructura.
- Tabla responsive con los campos aprobados.
- Paginación o enlace a la búsqueda completa ya existente.
- Indicador explícito de fuente conectada y fecha de última lectura, sin llamar a los datos
  "synthetic preview" cuando sean reales.

El backend seguirá siendo la autoridad para `academyId`, role, límites, proyección y rate limit.
Firestore Rules conservará el acceso directo cerrado al cliente.

## Estados y Errores

- PDF inválido: rechazo genérico y detalle seguro en el preview, sin persistir filas.
- Reporte duplicado: mostrar duplicados y exigir decisión/confirmación según el contrato existente.
- Conflicto de identidad: bloquear confirmación hasta corregir o excluir el conflicto.
- Sesión expirada: invalidar preview y exigir seleccionar los PDFs nuevamente.
- Fallo parcial de almacenamiento: compensar mediante el journal existente.
- Firestore no disponible: mantener la pantalla en estado de error sin datos parciales.
- Navegación sin autorización: no renderizar shell ni datos administrativos.

## Seguridad y Privacidad

- Los PDFs reales permanecen fuera del repositorio y fuera del build frontend.
- No se imprimen PII, contenido PDF, tokens ni URLs firmadas en logs o errores de UI.
- Solo el backend lee/escribe Members.
- Todas las operaciones verifican Auth, claims administrativos y academy scope.
- Se mantiene rate limiting por academia, administrador y operación.
- La importación queda limitada a una acción explícita del administrador; no se ejecuta durante
  `next build` ni al cargar la página.

## Verificación

Antes de marcar la tarea como lista se ejecutará:

- Pruebas unitarias del drawer, navegación y estados de Members.
- Pruebas Functions del parseo, preview, conflictos, idempotencia y escrituras reales sintéticas.
- Integración contra Firebase Emulator Suite con documentos de prueba aislados.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` y `pnpm build`.
- E2E desktop/mobile: navegación entre módulos sin recarga de documento, drawer responsive y
  Members después de una importación confirmada en emulador.
- `git diff --check` y auditoría de ausencia de PDFs/PII versionados.

## Evolución Posterior

Después de esta entrega, el mismo patrón reemplazará fixtures en este orden:

1. Clases, grupos, agenda y asistencia.
2. Membresías y pagos.
3. Roles, consentimiento y auditoría.
4. CRM y comunicaciones.

Cada bloque tendrá su propio contrato, pruebas y commit/push sobre `main`.
