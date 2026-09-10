# ADR-001: Monolito modular en monorepo pnpm

Fecha: 2026-08-06  
Estado: aceptada

## Contexto

El producto contiene módulos de academia, familias, personal, agenda, asistencia, pagos, progreso, CRM y comunicaciones, pero será operado inicialmente por una sola academia y mantenido como un solo producto.

## Decisión

Construir un monolito modular TypeScript en un monorepo pnpm, con límites de dominio explícitos y despliegues separados únicamente para frontend y Cloud Functions.

## Alternativas consideradas

- Microservicios: descartados porque no existen equipos, necesidades de escalado ni ritmos de despliegue independientes que compensen su coordinación.
- Un solo paquete sin módulos: descartado porque favorece acoplamiento entre permisos, pagos, asistencia y progreso.
- Múltiples repositorios: descartados porque aumentan mantenimiento, contratos y CI sin aportar autonomía real.

## Consecuencias

Se reduce la complejidad inicial y se facilita compartir tipos y pruebas. A cambio, los límites de módulo deben revisarse activamente para que una futura extracción sea posible y para evitar un monolito desordenado.
