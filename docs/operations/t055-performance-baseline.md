# T055 — Baseline de rendimiento sintético

Fecha: 2026-08-24

## Alcance

Se midió la proyección pura `buildSessionOperationalView` del dominio de agenda con datos sintéticos. El ejercicio cubre el cálculo del roster operativo que combina reservas, asistencia y child check-out; no accede a Firestore, R2, Firebase Auth, staging ni producción.

## Medición

- Dataset: 1.000 reservas, 500 registros de asistencia y 250 check-outs.
- Iteraciones: 25 ejecuciones en Node.js 24.18.0.
- Resultado: mediana 0,579 ms; p95 1,533 ms; máximo 2,088 ms.
- Invariantes: 999 reservas confirmadas en el roster y 0 walk-ins con este fixture.

## Interpretación y límites

La proyección pura no muestra un cuello de botella en este volumen sintético; por tanto no se aplicó una optimización especulativa. Esta medición no sustituye una prueba de carga de Firebase, red, índices, navegador ni staging. Es evidencia local del algoritmo de agregación y deja pendiente la carga live/staging de T055.
