# T011 Retention, Residency And Deletion Decision

## Objetivo

Preparar un paquete de decisión para que el operador y la asesoría aplicable a
Jersey definan retención, residencia, acceso, borrado y restauración sin
convertir supuestos legales en reglas del producto.

## Alcance

- Inventariar categorías de datos y propietarios de decisión.
- Exigir una decisión documentada para plazo o criterio de retención, legal hold,
  residencia/transferencias, borrado, copias de seguridad y restauración.
- Fijar controles provisionales del piloto: datos sintéticos o sanitizados,
  ausencia de producción y ausencia de borrado destructivo.
- Mantener `T011` bloqueada hasta aprobación del operador y revisión legal
  aplicable.

## Fuera de alcance

- No afirmar cumplimiento de GDPR, UK GDPR, Jersey Data Protection Law, PCI DSS
  ni safeguarding.
- No inventar plazos, regiones de proveedor, bases legales ni obligaciones de
  conservación.
- No cambiar Rules, esquema, migraciones, código de borrado o configuración de
  producción.

## Criterio de salida

El paquete se considera listo para decisión cuando cada categoría tiene un
responsable, una pregunta de aprobación concreta, un método de borrado o
conservación y un tratamiento de backup/restore. La tarea solo puede pasar de
`bloqueada` después de registrar la aprobación, fecha, fuente y restricciones.
