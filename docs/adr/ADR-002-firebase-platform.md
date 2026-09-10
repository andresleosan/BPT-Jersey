# ADR-002: Firebase como plataforma operativa

Fecha: 2026-08-06  
Estado: aceptada

## Contexto

El producto necesita autenticación, permisos, datos operativos, eventos en tiempo real, backend administrado, hosting y un camino de despliegue de baja carga operativa.

## Decisión

Usar Firebase Blaze con Auth, Firestore Standard como fuente canónica, Realtime Database solo para estado efímero justificado, Cloud Functions de segunda generación y Firebase Hosting.

## Alternativas consideradas

- Backend Node.js y PostgreSQL administrado: ofrece integridad relacional superior, pero aumenta operación y se aparta de la plataforma solicitada.
- Realtime Database como fuente principal: descartada por el modelo multi-módulo, consultas e historial auditable.
- Firebase App Hosting para todo el frontend: descartado inicialmente porque introduce Cloud Run y facturación adicional cuando una salida estática/PWA cubre el camino principal.

## Consecuencias

Se obtiene integración rápida y emuladores locales. A cambio, existen dependencia del proveedor, costos por operación y mayor disciplina para modelar consultas, índices, reglas, idempotencia y límites de documentos. La salida futura exige adaptadores de dominio y exportaciones verificadas.
