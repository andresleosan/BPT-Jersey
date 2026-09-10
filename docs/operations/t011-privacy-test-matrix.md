# T011 — Matriz de pruebas de privacidad, retención y eliminación

**Estado:** preparada; requiere datos de prueba sintéticos y responsables designados.  
**Regla:** no usar datos reales de menores, salud, pagos ni producción.

| ID | Escenario | Resultado esperado | Evidencia |
|---|---|---|---|
| P-01 | Alta de usuario adulto con finalidad válida | Solo campos mínimos; base legal y aviso quedan asociados | Registro sintético |
| P-02 | Alta de menor | Flujo de edad/tutor según decisión aprobada; sin marketing/perfilado por defecto | Capturas/logs redactados |
| P-03 | Consentimiento retirado | Se registra retiro, detiene la finalidad dependiente y conserva solo evidencia mínima | Caso de prueba |
| P-04 | Campo de salud enviado a formulario general | Rechazo o bloqueo; no se persiste ni se escribe en logs | Evidencia de rechazo |
| P-05 | Acceso a salud sin rol autorizado | Denegado, auditado y sin revelar existencia innecesaria | Evento de auditoría |
| P-06 | Expiración de retención | Borrado/anonymización idempotente en primario e índices | Conteos antes/después |
| P-07 | Solicitud de eliminación de menor | Autenticación, búsqueda completa, borrado y notificación a procesadores | `deletion_case_id` |
| P-08 | Legal hold válido | Se preserva solo el alcance documentado, con expiración; el resto se elimina | Registro de hold |
| P-09 | Transferencia a país no aprobado | Fail-closed hasta TIA, salvaguarda y contrato | Prueba de bloqueo |
| P-10 | Subprocesador cambia región | Alerta y revisión; no se acepta cambio silencioso | Simulación de cambio |
| P-11 | Fallo parcial de borrado | Caso queda en excepción, reintento seguro y escalamiento; nunca “éxito” falso | Runbook + alerta |
| P-12 | Restauración de backup vencido | Restauración bloqueada o seguida de purga verificable antes de acceso | Registro de restore |
| P-13 | Exportación | Exporta solo lo autorizado, con expiración y acceso registrado | Archivo sintético |
| P-14 | Auditoría | No contiene PAN, secretos, salud ni payload personal completo | Revisión de logs |
| P-15 | Repetición/concurrencia | Borrado idempotente; sin duplicados ni resurrección de datos | Prueba concurrente |

## Evidencia mínima

Cada prueba debe conservar versión del código/política, fecha, entorno, actor, datos sintéticos, resultado, fallo y enlace al incidente si aplica. La evidencia no debe contener valores personales reales.

## Gate

Un fallo en P-04, P-05, P-06, P-07, P-09, P-11 o P-12 bloquea la aprobación de T011 hasta remediación y repetición satisfactoria.
