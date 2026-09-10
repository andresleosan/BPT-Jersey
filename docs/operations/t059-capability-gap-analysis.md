# T059 — Análisis de brechas de capacidad

**Fecha de la medición: 2026-09-08.** Todo lo que sigue está medido contra el proyecto real
`bptjersey-f5a25` y contra `apps/web/src`, no citado del ledger. La medición se reproduce con:

```
node scripts/release-delta.mjs --project bptjersey-f5a25
```

Este documento responde una sola pregunta: **de lo que el BRIEF prometió, ¿qué puede usar hoy una
persona en producción?** No es un inventario de código escrito. El código escrito no es una
capacidad hasta que está desplegado, y ésa resultó ser la brecha entera.

---

## 1. El número que resume todo

| | |
| --- | --- |
| Callables exportadas por `apps/functions/src/index.ts` | **165** |
| Desplegadas en producción | **70** |
| Invocadas por la web | **149** |
| **Invocadas por la web y no desplegadas** | **83** |
| Desplegadas y ya no exportadas (un `--only functions` las borraría) | 2 |
| Filas del tablero aprobadas | 118 de 121 (98 %) |

**El tablero dice 98 % y producción sirve el 44 % de lo que la web pide** —66 de las 149 invocadas—. Los dos números son
correctos y miden cosas distintas: el tablero mide trabajo terminado y verificado; esto mide
capacidad disponible. La distancia entre ambos **es** el hallazgo de este análisis, y no se cierra
escribiendo más código.

## 2. Capacidad por capacidad, en el orden RICE del BRIEF

El BRIEF ordena ocho capacidades por RICE. Cada callable se ha asignado a la suya leyendo **qué
módulo de `apps/web/src/lib` la invoca**, no por criterio de nadie.

| # | Capacidad (RICE) | Desplegadas | Estado |
| ---: | --- | ---: | --- |
| 1 | Seguridad, piloto aislado y auditoría (4.75) | n/a | **Presente.** No se mide en callables: son Rules, App Check y el escritor de auditoría, todos desplegados |
| 2 | Alta de adultos, familias, menores y staff (4.50) | **30/54 (56 %)** | Parcial: el lado administrativo vive; el de autoservicio y consentimiento, no |
| 3 | Membresías, deuda PAYG y finanzas manuales (4.50) | **1/16 (6 %)** | **Ausente en la práctica** |
| 4+5 | Clases, reservas, check-in y asistencia (4.25) | **9/37 (24 %)** | Parcial: el CRUD de clases y sesiones vive; reservar y asistir, no |
| 6 | Niveles, evaluaciones y promociones revisadas (4.00) | **0/15 (0 %)** | **Ausente por completo** |
| 7 | Portales por rol y avisos in-app (4.00) | **10/10 (100 %)** | Completa |
| 8 | Paneles, cumpleaños, informes y QA (3.50) | **2/3 (67 %)** | Casi completa; falta la exportación agregada |
| — | **Retail — explícitamente FUERA del MVP** | **9/9 (100 %)** | Completa |
| — | **CRM y retención — explícitamente FUERA del MVP** | **5/5 (100 %)** | Completa |

## 3. La brecha, dicha sin rodeos

**Producción sirve hoy, al 100 %, las dos cosas que el BRIEF puso fuera del MVP** —retail y
CRM/retención— **y sirve al 0 % la capacidad 6 y al 6 % la capacidad 3.** No es una acusación a
ninguna decisión concreta: cada lote se desplegó con autorización explícita y verificado. Es la
consecuencia acumulada de **elegir lotes por lo que estaba listo y era barato, en vez de por el orden
de valor que el propio BRIEF había fijado**. Nadie decidió esto; salió solo, que es como suelen salir
las cosas que nadie decide.

### Tres huecos que dejan capacidades desplegadas sin poder funcionar

Son el tipo de brecha que un recuento no ve, porque cada pieza por separado está bien:

1. **Penalizaciones sin asistencia.** `proposeNoShowPenalties`, `listNoShowPenalties` y
   `resolveNoShowPenalty` están desplegadas. `checkIn`, `correctAttendance` y
   `reconcileSessionNoShows` **no**. Se pueden resolver faltas que nada puede producir.
2. **Panel financiero sin ciclo financiero.** `getFinancialDashboard` está desplegado. Las quince de
   membresías, planes, facturación manual y pagos **no**. Es un panel sobre datos que ningún camino
   productivo puede crear.
3. **Alta administrativa sin consentimiento.** Se puede dar de alta a una persona
   (`createMember`, `createFamily`) pero no se puede aceptar su waiver (`acceptWaiver`), ni leer su
   registro (`getWaiverRegistration`), ni firmar descargos, ni guardar el perfil de salud. Para un
   piloto que trata con menores y datos de salud, ése es el hueco que más pesa.

### Y una brecha que no es de código: **no hay datos reales**

El directorio canónico en producción **está vacío de miembros reales**. La migración de la colección
legacy `members` es T108, que sigue pendiente: van dos ejecutores de siete y nueve rebanadas. Lo que
hay desplegado se alimenta solo de escritores administrativos auditados. Así que incluso la capacidad
2, la más completa de las tres grandes, sirve hoy sobre un directorio que nadie ha llenado.

**Producción tiene la máquina y no tiene el combustible.**

## 4. Lo que sí está terminado, y no conviene perderlo de vista

El inverso también es cierto y es mucho: 118 filas aprobadas por evidencia, 275 ficheros de prueba y
2335 pruebas unitarias, Rules 92/92, una batería de integración contra Emulator de 82, un golden path
de 19, un runbook de release y rollback con su plantilla, DPIA y política de retención, y las cinco
alertas del §6.1 vivas. **El proyecto no está a medio construir: está construido y a medio
desplegar.** Es una distinción con consecuencias prácticas, porque cerrar esta brecha son lotes de
release con su autorización y sus precondiciones, no meses de desarrollo.

## 5. Qué haría falta para cerrarla, en orden

No es un plan aprobado; es lo que la medición dice que costaría, para que la decisión se tome con el
número delante.

1. **Lote de consentimiento y salud** (24 callables de la capacidad 2). Es el que desbloquea que el
   piloto pueda tratar legalmente con una familia real. Va primero por eso, no por RICE.
2. **Lote financiero** (las 15 que faltan de la capacidad 3). Cierra el panel que hoy no tiene detrás nada.
3. **T108** — la migración. Sin ella lo anterior opera sobre un directorio vacío.
4. **Lote de reservas y asistencia** (28 de la 4+5). El más grande, y el que convierte la agenda en
   operación diaria.
5. **Lote de niveles** (15 de la 6). El único que hoy está a cero.
6. **`prepareAggregateReportExport`** y las dos huérfanas —`getMemberReportSummary` y
   `searchMembers`—, que ya no se exportan y que un `--only functions` a secas borraría.

Cada lote con su autorización, su delta y sus precondiciones **medidas por función, no por lote**,
que es la lección que el runbook ya se llevó y que este análisis vuelve a encontrar desde otro lado.

## 6. Qué se comprobó y qué no

- **Comprobado:** el inventario desplegado se leyó del proyecto real; la lista de invocadas se leyó
  de `apps/web/src`; la asignación a capacidades se derivó del módulo cliente que invoca cada una.
- **No comprobado:** que cada callable desplegada haga bien su trabajo. La verificación §4.4 de la
  release del primer lote sondeó las 31 y leyó los logs, pero un `401` a un sondeo anónimo prueba que
  está viva y rechazando, no que su lógica sea correcta con una sesión real. Lo que sí se probó en
  navegador con sesión real fue el arreglo de App Check, y encontró un fallo.
- **No medido aquí:** el frontend, pantalla por pantalla. La web despliega entera en Pages, así que
  las pantallas de las capacidades ausentes **existen y se pueden abrir**. Del único caso observado
  se sabe cómo se comporta: en `/admin/billing`, la sección de la cuenta financiera aparece vacía con
  "Billing account could not be loaded" porque `listFinancialAccount` no está desplegada. Degrada
  visiblemente en vez de romper la página, que es la buena noticia; que **el resto se comporte igual
  no está comprobado**, y hace falta comprobarlo antes de enseñar el piloto a un tercero.
