# Regyfit — Classes / Services: inventario estructural (capturado 2026-09-16)

Evidencia saneada de la captura de solo lectura del panel `admin2` de Regyfit (BPT Jersey, `id_box=2293`).
No contiene nombres de personas, direcciones IP ni filas del historial: eso queda en el almacenamiento privado
`/root/regyfit-capture/` fuera del repositorio (runbook `private-staging-runbook.md`). Los nombres de sedes, tipos de
clase, planes y packs son configuración de la academia, no datos personales. Es la base del clon
`docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md`.

## Mapa del menú (orden real)

| # | Entrada | Ruta origen | Carga | Subpestañas |
|---|---------|-------------|-------|-------------|
| 1 | Locations | modulos/aulas/salas_campos.php | iframe `frame_main` | CRIAR/GERIR (única) |
| 2 | Class / Service Types | modulos/aulas/tipos_aulas.php | iframe `frame_main` | — |
| 3 | Aulas & Serviços 2.0 | php8/admin/modulos/aulas/gerir_aulas.php | `load_page` → `#main_frame` | CALENDAR · LIST |
| 4 | Memberships and Vouchers | php8/admin/modulos/aulas/planos_permissoes.php | `#main_frame` | PAYMENT PLANS · DISCOUNTS · CREDIT PACKS |
| 5 | Bulk Operations | php8/admin/modulos/aulas/operacoes_massa.php | `#main_frame` | Delete · Capacity · Rules · Trainers · Permissions · Membership data |
| 6 | Listings & Reports | php8/admin/modulos/aulas/listagens_relatorios.php | `#main_frame` | Attendance · Others |
| 7 | Drop-ins | php8/admin/modulos/aulas/dropins.php | `#main_frame` | — |
| 8 | Options | php8/admin/modulos/aulas/opcoes_aulas.php | `#main_frame` | Class / service booking rules · Class / service options |
| 9 | History | modulos/aulas/consultar_historico.php | iframe `frame_main` | — |

## 1. Locations (`CREATE/MANAGE ROOMS OR FIELDS`)

- Formulario de alta: `Name`, `Abbreviation`, botón `CREATE` (icono de calendario junto al botón).
- Tabla (DataTables, 10/25/50/100 por página, búsqueda): `ROOM/FIELD` (icono + nombre), `ABBREVIATION`, `STATUS` (select Inactive/Active editable en línea), `TYPE` (select Presential / ZOOM Platform / Jitsi Meet Platform), botón editar (lápiz) y candado (bloqueada si tiene clases).
- Datos reales: 2 sedes → `BPT Town` (abrev. `tow`, Active, Presential), `BPT West` (abrev. `wes`, Active, Presential).

## 2. Class / Service Types (`CREATE A NEW CLASS/SERVICE TYPE/EXERCISE ROOM`)

- Alta: `Name`, `Abbreviation`, selector de icono (figura), `CREATE`.
- Tabla editable en línea por fila: `NAME` (icono, nombre, abreviatura), `COLOR` (hex, colorpicker), `STATUS` (toggle), `TYPE` (select 5 valores), `DROP-INS/TRIALS` (select 8 valores), `E-MAIL` (toggle), `LIST` (toggle), `MESSAGE TO BE DISPLAYED` (texto + guardar), botón editar, papelera o candado.
- Valores de `TYPE`: `Class: Registrations = weekly/monthly frequency` · `Class: Unlimited registrations` · `EXERCISE ROOM - Registrations = weekly/monthly frequency` · `EXERCISE ROOM - Unlimited registrations` · `SERVICE`.
- Valores de `DROP-INS/TRIALS`: `No` · `Unlimited` · `Automatic` · `1 drop-in/trial` · `2 drop-ins/trials` · `3 drop-ins/trials` · `4 drop-ins/trials` · `5 drop-ins/trials` · `6 drop-ins/trials` · `7 drop-ins/trials` · `8 drop-ins/trials` · `9 drop-ins/trials`.
- Datos reales: 31 tipos (23 activos). Colores en uso: #1befa2, #7121f2, #d7eaff, #d7ffe2, #d7fffd, #d9d7ff, #e6ffd7, #f4d7ff, #ffd7d7, #ffd7f3, #fff1d7.
- Lista (nombre · abrev · color · activo · tipo · drop-ins):
  - 10-12YO · `10-12` · `#d9d7ff` · activo · Class · Unlimited
  - 13-15YO · `13-` · `#ffd7d7` · activo · Class · Unlimited
  - 4-5YO · `4-5` · `#fff1d7` · activo · Class · Unlimited
  - 5-7YO · `5-7` · `#ffd7f3` · activo · Class · Unlimited
  - 7-8YO · `7-8` · `#f4d7ff` · activo · Class · Unlimited
  - 9-10YO · `9-10` · `#e6ffd7` · activo · Class · Unlimited
  - Carrefour Metro BJJ · `CAR_MET` · `#1befa2` · inactivo · Class · Unlimited
  - Carrefour Metro NoGI · `CAR_MET_NO` · `#7121f2` · inactivo · Class · Unlimited
  - GI All Levels Evenings · `LEV_EVE` · `#d9d7ff` · activo · Class · Automatic
  - GI All Levels Lunchtime · `LEV_LUN` · `#fff1d7` · activo · Class · Unlimited
  - GI All Levels Mornings · `LEV_MOR` · `#d7fffd` · activo · Class · Unlimited
  - GI Beginners Evenings · `BEG_EVE` · `#d7fffd` · activo · Class · Unlimited
  - GI Beginners Lunchtime · `BEG_LUN` · `#d9d7ff` · activo · Class · Automatic
  - GI Beginners Mornings · `BEG_MOR` · `#fff1d7` · activo · Class · Unlimited
  - Introduction Class · `INT_CLA` · `#f4d7ff` · activo · Class · Unlimited
  - Kids 10-12yo · `KID_10-` · `#d7ffe2` · inactivo · Class · Unlimited
  - Kids 4-6yo · `KID_4-6` · `#ffd7f3` · inactivo · Class · Unlimited
  - Kids 7-9yo · `KID_7-9` · `#fff1d7` · inactivo · Class · Unlimited
  - NoGI All Levels Evenings · `NOG_LEV_EV` · `#d7ffe2` · activo · Class · Unlimited
  - NoGI All Levels Lunchtime · `NOG_LEV_LU` · `#ffd7d7` · activo · Class · Unlimited
  - NoGI All Levels Morning · `NOG_LEV_MO` · `#fff1d7` · activo · Class · Unlimited
  - NoGI Beginners Evenings · `NOG_BEG_EV` · `#fff1d7` · activo · Class · Unlimited
  - NoGI Beginners Lunchtime · `NOG_BEG_LU` · `#fff1d7` · activo · Class · Unlimited
  - NoGI Beginners Mornings · `NO_BEG_MO` · `#ffd7d7` · activo · Class · Unlimited
  - NoGI Womens Only · `NOG_WOM_ON` · `#d9d7ff` · inactivo · Class · Unlimited
  - Open Mat · `OPENMAT` · `#d7eaff` · activo · Class (unlimited regs) · Unlimited
  - Open Mat Teens · `OM_TEEN` · `#d7fffd` · inactivo · Class · Unlimited
  - STRIVE BJJ · `STR` · `#d7fffd` · activo · Class · Unlimited
  - Strive Kids 10-12yo · `STR_KID_10` · `#f4d7ff` · inactivo · Class · Unlimited
  - Strive Kids Over 8yo · `STR_KID_OV` · `#d7eaff` · activo · Class · Unlimited
  - Strive Kids Under 8yo · `STR_KID_UN` · `#d7fffd` · activo · Class · Unlimited

## 3. Aulas & Serviços 2.0 (mapa de clases)

- Cabecera: pestañas `CALENDAR` / `LIST`; contadores `N CLASSES`, `N REGISTRATIONS`, `N% OCCUPANCY`, `N TOTAL` (390 clases totales en la caja el día de la captura).
- Barra de filtros: `LOCATIONS`, `TYPES`, `STAFF` (multiselección), `MINE`, conmutadores de vista (icono/ texto/ nivel de detalle), `NOVIDADES` (tour), `ACTIVE/INACTIVE`, imprimir, zoom −/+.
- Navegación: ‹ › `TODAY`, selector de fecha, título `14 – 20 SEP 2026`, `COPY WEEK`, `ELIMINAR SEMANA` (rojo), vistas `MONTH` / `WEEK` / `DAY`. Cada columna de día muestra `n classes · n registrations`. FullCalendar semanal 06:00–19:30 (ventana configurable en Options), tarjetas con el color del tipo, hora y chip `inscritos / capacidad` (`∞` sin límite).
- Vista LIST: filtros `DATE RANGE` (Today, Yesterday, Day before yesterday, Last 7 days, This week, Last week, This month, Last month, This year), `FROM`, `TO`, `LOCATION`, `CLASS`, `TRAINERS`, `SORT BY` (Date/time, Class type, Location), `RECORDS` (10…190), `SEARCH`, `EXCEL`, `TODAY'S CLASSES/SERVICES`. Tabla: candado, editar, icono+nombre+`AULA`, `LOCATION`, `TRAINERS`, `DATE`, `TIME`, `DROP-INS`, `TRIALS`, `REGISTRATIONS` (`n/cap`), `ATTENDANCE` (marcar), `RESULTS`.
- Panel de clase (clic en tarjeta) `CREATE CLASSES/SERVICES`: WHEN (`Date`, `Start time`, `End time`), CLASS AND LOCATION (`Class/service location`, `Class/service type`, `Maximum capacity` No/número), TRAINERS (tarjetas seleccionables con color por entrenador, selección múltiple), BOOKING RULES (`Booking and cancellation`: According to the defined rules / Specific rules; `Waiting list for registrations`: According to the general options / …). Botones `DELETE`, `MESSAGE`, `COPY`, `CANCEL`, `EDIT`.
- Panel REGISTRATIONS a la derecha: pestañas `MEMBER` / `GROUP` / `EXTERNAL`, buscador `Enrol a member of this gym`, cabecera con icono del tipo, nombre, fecha y hora, lista de inscritos con foto y papelera.

## 4. Memberships and Vouchers

### 4a. PAYMENT PLANS

- Formulario `CREATE PAYMENT PLAN`: `Plan name` (multi-idioma, 8 banderas), `Payment cycle` (Weekly / Fortnightly / 4 Weeks / Monthly / Bimonthly / Quarterly / Semi-annual / Annual), `Price (£)`, `Frequency` (, 1–14 x per week, 1–N x per month), `ALLOWS ENROLMENT IN CLASSES` (marcar todo/nada + un checkbox por tipo activo con select `No maximum limit`/límite), `ALLOWED SCHEDULE SLOTS` (rejilla 7 días × 48 medias horas, verde permitido / rojo bloqueado, dos tablas 00:00–11:30 y 12:00–23:30), `Available for purchase` (No/Yes), `CREATE`. En edición aparece aviso «Changes … automatically applied to the N associated members» y botones `X` / `SAVE CHANGES`.
- Tabla `PAYMENT PLANS`: `PLAN NAME`, `APP`, `INTEGRATIONS`, `MEMBERS`, `STATUS` (toggle), PDF de socios, editar, candado/papelera.
- Panel `ASSOCIATE TO MEMBERS`: `Member no.`, `Name`, `Status` (Active members…), `Sort by`, `Members/Page`, `MANAGE`.
- Datos reales: 10 planes:
  - **BPT Jersey - Town & West** · Monthly · £125.00 · Unlimited · 6 socios · activo · app No · clases permitidas: GI All Levels Evenings, GI All Levels Lunchtime, GI All Levels Mornings, GI Beginners Evenings, GI Beginners Lunchtime, GI Beginners Mornings, Introduction Class, NoGI All Levels Evenings, NoGI All Levels Lunchtime, NoGI All Levels Morning, NoGI Beginners Evenings, NoGI Beginners Lunchtime, NoGI Beginners Mornings, Open Mat, STRIVE BJJ · compra online: ?
  - **Kids Town** · Quarterly · £135.00 · Unlimited · 1 socios · activo · app No · clases permitidas: Introduction Class · compra online: ?
  - **Parents** · Quarterly · £0.00 · Unlimited · 2 socios · activo · app No · clases permitidas: Introduction Class · compra online: ?
  - **Strive** · Monthly · £65.00 · Unlimited · 13 socios · activo · app No · clases permitidas: Introduction Class, Open Mat, STRIVE BJJ · compra online: ?
  - **Strive Kids** ·  · £ ·  · 1 socios · activo · app No · clases permitidas: (ninguna marcada) · compra online: ?
  - **Strive Teens x1** · Weekly · £7.50 · 1 x per week · 23 socios · activo · app No · clases permitidas: Introduction Class, STRIVE BJJ · compra online: ?
  - **Strive x1** · Weekly · £10.00 · 1 x per week · 26 socios · activo · app No · clases permitidas: Introduction Class, STRIVE BJJ · compra online: ?
  - **Town All Levels** · Monthly · £85.00 · Unlimited · 18 socios · activo · app No · clases permitidas: GI All Levels Evenings, GI All Levels Lunchtime, GI All Levels Mornings, GI Beginners Evenings, GI Beginners Lunchtime, GI Beginners Mornings, Introduction Class, NoGI All Levels Evenings, NoGI All Levels Lunchtime, NoGI All Levels Morning, NoGI Beginners Evenings, NoGI Beginners Lunchtime, NoGI Beginners Mornings, Open Mat · compra online: ?
  - **Town Beginners** · Monthly · £85.00 · Unlimited · 3 socios · activo · app No · clases permitidas: GI Beginners Evenings, GI Beginners Lunchtime, GI Beginners Mornings, Introduction Class, NoGI Beginners Evenings, NoGI Beginners Lunchtime, NoGI Beginners Mornings, Open Mat · compra online: ?
  - **Town Kids x1** · Quarterly · £95.00 · 1 x per week · 2 socios · activo · app No · clases permitidas: (ninguna marcada) · compra online: ?

### 4b. DISCOUNTS

- `CREATE DISCOUNT`: `Discount name`, `Type` (Weekly / Fortnightly / 4 Weeks / Monthly / Bimonthly / Quarterly / Semi-annual / Annual), `CREATE`. Tabla: nombre + `Discount: importe`, `Members`, editar, papelera. Panel `ASSOCIATE TO MEMBERS` igual que en planes.
- Datos reales: 1 descuento(s): Sem Noção Discount: 5.00 0.

### 4c. CREDIT PACKS

- `CREATE A CREDIT PACK`: `Pack name` (multi-idioma), `No. of credits`, `Price (£)`, `Expiry` (No expiry / meses), `ALLOWS ENROLMENT IN CLASSES` (checkbox por tipo, sin límite por tipo), `ALLOWED SCHEDULE SLOTS`, `Available for purchase`, `CREATE`. Tabla: `PACK NAME`, `PASSES`, `PRICE`, `EXPIRY`, `APP`, `INTEGRATIONS`, editar, papelera.
- Datos reales: 2 packs: **10 Classes Beginners** (10 pases, £150.00, caduca 3 months, app No, integraciones No); **Strive - 10 Classes** (10 pases, £100.00, caduca 3 months, app Yes, integraciones Yes).

## 5. Bulk Operations (`TOTAL CLASSES/SERVICES: N` arriba a la derecha)

- **Delete**: tres tarjetas `DELETE CLASSES/SERVICES BY LOCATION` (select Location), `BY TYPE` (select Class/service type), `BY DATE/TIME` (date). Al elegir aparecen los pasos siguientes y la confirmación.
- **Capacity**: `MAXIMUM CAPACITY BY ROOM/FIELD` (select), `MAXIMUM CAPACITY BY CLASS/SERVICE TYPE` (select).
- **Rules**: `CLASS/SERVICE BOOKING RULES` con select `Location / Class-service type`.
- **Trainers**: `REPLACE THE TRAINER OF THE CLASSES/SERVICES IN A PERIOD`: `Trainer to be replaced`, `New trainer`, `Date range`, `From`, `To`, `Location` (All…), `Class/service type` (All…), `APPLY`; nota «leaving the end date empty applies the change from the start date onwards».
- **Permissions**: filtro de socios `Member number`, `Member name`, `Sort by`, `Weekly frequency`, `Gender`, `State` (Active members…), `Box/gym`, botón `BY CLASS TYPE` → lista de socios para editar permisos por tipo.
- **Membership data**: mismo filtro con botón `FILTER` → lista de socios para editar datos de membresía en masa.

## 6. Listings & Reports

- Aviso: «depending on the amount of data, exporting some reports can take a while».
- **Attendance**: `REPORT OF BOOKINGS, ATTENDANCE AND ABSENCES` (`Date range`, `From`, `To`, `Group/Team`, `Member`, `Type` Attendance/…; `EXCEL`, `PDF`); `TOTALS OF BOOKINGS, ATTENDANCE AND ABSENCES` (mismos filtros sin Type; `EXCEL`, `PDF`); `MONTHLY MAP OF BOOKINGS, ATTENDANCE AND ABSENCES` (`Month`, `Year`, `Group/Team`, `Class/service type`, `Type`, `Status` Active only/…, `Records` Members with records/…, `Include members with unlimited access` Yes/No; `EXCEL`, `PDF`).
- **Others**: `MEMBERS BY CLASS TYPE` (`Class type`, `Status`, `Sort by`; PDF), `MEMBERS BY PAYMENT PLAN` (`Payment plan`, `Status`, `Sort by`; PDF), `MEMBERS WITH ADDITIONAL PLANS` (`Status`, `Sort by`; PDF), `TOTAL CLASSES/SERVICES` (`Date range`, `From`, `To`; PDF), `CLASS OCCUPANCY` (`COLOUR SCALE` leyenda; `Date range`, `From`, `To`, `Days of the week` 7 checkboxes, `Report type` List/…, `Class type`, `Location`, `Teacher`, `Analyse by` Registrations/…; `EXCEL`, `PDF`).

## 7. Drop-ins (oferta de clase suelta de la caja)

- Tarjeta `DROP-INS` (`SAVE`): `Price per class (drop-in)` (£), botón de estado `DROP-IN IS INACTIVE` / activo, `Address`, `Postal code`, `City / town`, `GPS Coordinates` (lat, lng) y mapa de Google con marcador.
- Tarjeta `OPTIONS`: select con 3 políticas: `1. Allow drop-ins to view and sign up for classes`, `2. …view only…`, `3. Do not allow drop-ins to view or sign up for classes`.
- Tarjeta `PHOTOS` (`DRAG TO SORT`): «Select or drag up to 10 photos (.jpg)».
- Tarjeta `DETAILS` (`SAVE ALL`): textareas multi-idioma `ABOUT`, `MATERIAL`, `PARKING`, `CHANGING ROOMS`, `BAR / CAFETERIA`, `PAYMENT METHODS`, `OTHER DETAILS`.
- Datos reales: DROP-IN IS INACTIVE, sin precio configurado, dirección de la sede Town, política 3, sin fotos ni textos.

## 8. Options

- **Class / service booking rules**: DEADLINES — `Allow bookings until` D/H/M `before the class/service` (valor 0d 0h 30m), `Allow cancellations until` (At the start of the class/service / Custom / At the end of the class/service), `Allow bookings with an advance of` D/H/M (7d 0h 20m). LIMITS — `Limit of class bookings per day` (Unlimited), `How many classes/services can each member be booked into at the same time` (Unlimited), `Limit of bookings in each class/service type per day` (Inactive), `Waiting list for registrations` (No), `The way the maximum capacity works for the type set as EXERCISE ROOM is the same as Classes/Services` (No), `The count of the x per month a member can book classes starts from` (the start of the month). PENALTIES — toggles `Absences` (INACTIVE), `Cancelling a class/service booking` (INACTIVE). AUTOMATIONS — `Automatically book classes for members whose membership payment has expired` (No), `…members with no passes or with expired passes` (No), `Automatically send an e-mail to members when the class/service booking is made by a staff member` (No). Cada fila se guarda al cambiar (indicador `done`).
- **Class / service options**: VIEW — show names of people in charge (Yes), details to show in the booking calendar (No), only show classes the member is allowed to book (No), message when a member misses a booked class (No), show each member's number of passes in the list (No), initially show the classes/services (of all spaces), `Title for the category that is neither a class nor a service` (`Exercise room`, multi-idioma, `SAVE`). WEEKLY CLASS/SERVICE MAP — `Duplicate automatically` (for the next 4 weeks) `based on` (the current week), `Class/service map of these spaces` (checkbox por sede, ambas), `SAVE CHANGES`, copy the bookings as well (No), show the name of the member booked (No), `Time window available from` 06:00 `at` 19:30, remember zoom (No). OTHERS — count the number of times per week as (Classes), overlapping bookings (No), limit bookings according to weekly/monthly frequency (Yes), allow changing the coach (Until the end of the class/service), allow marking attendance until (Always), booking without COVID certificate (Yes), validate bookings by time of day (Yes), waiting list gets online link (Yes), time slots for booking EXERCISE ROOM (5 minutes), allow workouts ending after closing time (No).

## 9. History (`CLASS REGISTRATIONS LOG`)

- Filtros: `Since` (date + time), `Logged by` (select de usuarios), `Registration type` (All / Registrations in classes/services by members / Cancellations in classes/services by members / Drop-ins registrations by athletes / Cancellation of drop-ins by athletes / Registrations in classes/services by coachs / Cancellations in classes/services by coachs / Drop-ins/trials registrations by coaches / Drop-ins/trials cancellations by coaches / Registo de presenças e faltas), `No. of records` (100…1000), `LIST`. Tarjeta `RECORDS (N)` con `PDF`.
- Tabla: `DATE/TIME`, `USER`, `IP`, `TASK` (frase en portugués: «O atleta X inscreveu-se na aula do dia … pelas …», «cancelou a inscrição…», «foi inscrito pelo ADMIN…», «Foram marcadas presenças e faltas da aula: id | fecha | hora», «Um experiência foi inscrito numa aula…»).
- Captura privada: 1000 filas (máximo por consulta) con nombres e IP; no entran en el repo.

## Clases programadas capturadas (LIST, 1 sep – 31 dic 2026)

- 177 clases entre el 1 de septiembre y el 19 de octubre de 2026 (después no hay nada programado). Columnas: EXCEL, LOCATION, TRAINERS, DATE, TIME, DROP-INS, TRIALS, REGISTRATIONS, ATTENDANCE, RESULTS.
- Por sede: NoGI All Levels Morning AULA 11, GI All Levels Mornings AULA 12, GI Beginners Mornings AULA 10, GI Beginners Evenings AULA 10, NoGI All Levels Evenings AULA 10, GI All Levels Lunchtime AULA 12, GI Beginners Lunchtime AULA 12, Strive Kids Under 8yo AULA 1, GI All Levels Evenings AULA 12, NoGI Beginners Evenings AULA 12, STRIVE BJJ AULA 12, 7-8YO AULA 4, 9-10YO AULA 4, 10-12YO AULA 5, 13-15YO AULA 5, Strive Kids Over 8yo AULA 1, Open Mat AULA 35, Introduction Class AULA 3, 4-5YO AULA 3, 5-7YO AULA 3. Los entrenadores se capturan en privado (son personas).
