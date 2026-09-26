# Design System: BPT Jersey — Brazilian Jiu-Jitsu Academy Platform

Source of truth for generating new screens (Stitch or hand-built) that belong to the BPT Jersey
platform: public site, member `/account` area, coach and admin surfaces. Extracted from the live
codebase (`apps/web/src/app/globals.css`, `admin/admin.css`, `layout.tsx`) — every value below
is what the product ships today, not an aspiration.

## 1. Visual Theme & Atmosphere

A mat-floor academy interface: flat, square-cornered, high-contrast and unapologetically bold.
Think a gi — heavy white cotton, a single purple belt, a lime patch. Density is **Daily App
Balanced (5)**: generous section spacing on the public site, tighter working grids in admin.
Variance is **Offset Asymmetric (6)**: the hero is a 1.15fr / 0.85fr split, never centered;
content blocks sit left with wide right-hand air. Motion is **Static Restrained (3)**: 160–220 ms
eases, a 2 px lift on hover, nothing perpetual. Elevation is communicated by **thick borders and
hard offset shadows**, never by blur. The atmosphere is a well-run club noticeboard — clear,
confident, no decoration that does not carry information.

## 2. Color Palette & Roles

Absolute rule: one brand purple, one brand lime, warm-grey neutrals. No blue, no gradients.

**Brand**
- **BPT Purple** (`#2F2483`) — Hero background, primary CTAs in the client area, eyebrow labels, focus outlines, `theme-color`. The only accent.
- **BPT Purple Dark** (`#211965`) — Hover state of purple fills; text on white primary buttons over the hero; inset "belt" underlines (`inset 0 -0.2rem 0`).
- **BPT Lime** (`#D9F36A`) — Sparse highlight: badges, the single lime accent on dark purple. Never as a fill for large surfaces, never as text on white.
- **Purple Wash** (`#F0EFFF`) — Tinted surface behind selected rows / info panels in admin. Pair with `#D9D6FF` for its border.

**Neutrals (warm, never cool)**
- **Canvas** (`#F2F1ED`) — Page background everywhere. Off-white with a paper warmth.
- **Gi White** (`#FFFFFF`) — Panels, cards, inputs, primary button over purple.
- **Mat Ink** (`#1A1A18`) — Primary text and 2 px structural borders. Never pure black.
- **Muted** (`#65635D`) — Secondary copy, descriptions, `dt` labels.
- **Line** (`#8A8880`) — 1 px dividers, table rules, disabled outlines.
- **Paper Edge** (`#E8E7E3`, `#D9D8D2`) — Hairline separators on canvas.

**Status (semantic, each with its own tint + left-rule)**
- **Confirmed Green** (`#176B49`) text / `#E7F6EE` tint / `border-left: 0.35rem solid #176B49`.
- **Attention Amber** (`#C98B00`) rule, `#765400` text on `#FFF8E6`-style tint.
- **Refused Red** (`#8D1C2F`) rule, `#721626` / `#5F1020` text on `#FFF0F2` tint.
- Status is always **text + colored left-rule**, never a colored pill alone.

## 3. Typography Rules

- **Display:** `Barlow Condensed` 500 / 600 / 700 (`--font-display`, fallback `Impact, sans-serif`). Uppercase, `letter-spacing: 0.035em`, `line-height: 1`. Page titles scale `clamp(3.4rem, 9vw, 7rem)`; the wordmark is `1.75rem` 700. Hierarchy comes from condensed weight and size contrast against the body, not from color.
- **Body:** `Source Sans 3` (`--font-body`, fallback `Arial, sans-serif`). `1rem` / `line-height: 1.5`. Paragraph blocks are capped around `36–58rem` so lines stay under 65 characters.
- **Eyebrow / label:** Body face, `0.72rem`, 700, uppercase, `letter-spacing: 0.15em`, color BPT Purple. Every screen opens with one (`BPT JERSEY / CLIENT`, `BPT JERSEY / ACCOUNT ACCESS`).
- **Buttons:** `0.9rem`, 700, `letter-spacing: 0.025em`.
- **Numbers / money / times:** Body face with `font-variant-numeric: tabular-nums` in tables and invoices.
- **Banned:** Inter, generic serifs (Times, Georgia, Garamond), any script or rounded display face. No gradient text. No mixed weights inside one headline.

## 4. Component Stylings

- **Buttons (`.button`):** `border-radius: 0`, `min-height: 3.15rem`, padding `0.8rem 1.15rem`, `inline-flex` with `0.8rem` gap. Hover: `translateY(-2px)`; active: back to `0` (tactile push). Transition `160ms ease` on background/border/transform. Over purple: primary = Gi White fill with Purple Dark text, secondary = 1 px Gi White outline. Over canvas (client area): primary = BPT Purple fill → Purple Dark on hover, secondary = Mat Ink outline. Focus ring: `outline: 3px solid` BPT Purple, `offset 4px`; on purple ground the ring inverts to white with a `0 0 0 6px` Mat Ink halo. No glows, no gradients, no icons-only buttons.
- **Panels / identity blocks (`.client-identity`):** Gi White fill, **`border-top: 0.35rem solid` BPT Purple** as the elevation cue, `1.25rem` padding, `max-width: 36rem`, square corners. Cards are reserved for things that must read as a distinct object (a membership plan, an invoice); lists of links are plain stacked buttons, not cards.
- **Hard shadows:** the only shadows are offset blocks tinted with purple — `0 1.5rem 0 rgba(47,36,131,0.12)` under feature imagery, `-1rem 0 0 rgba(47,36,131,0.08)` beside the hero location block. Zero blur radius, always.
- **Inputs:** Label above (body 600), input `min-height 3rem`, Gi White fill, `1px solid` Line border, `border-radius: 0`, focus = 3 px purple outline. Helper text Muted below; error text Refused Red below with the red left-rule tint on the whole field group. No floating labels, no icons inside inputs.
- **Notices / reminders:** Full-width band, tint + `0.3–0.35rem` colored left-rule, eyebrow (`FOLLOW-UP`, `SAFEGUARDING`) + heading + one sentence. Failure copy is honest and short ("Reminders are temporarily unavailable. Please try again later.").
- **Tables (admin):** `1px` Line rules, header row uppercase eyebrow style, selected row on Purple Wash with `#D9D6FF` border. Action buttons inline at the row end, never a kebab menu.
- **Loading:** Skeleton blocks in Paper Edge matching the panel's real dimensions (`.client-auth-loading` reserves the layout). No spinners.
- **Empty states:** Eyebrow + condensed headline + one plain sentence + a single primary button (e.g. "Ask for a place"). No illustrations.

## 5. Layout Principles

- **Container:** `--content-width: 90rem` (1440 px) centered; horizontal padding `clamp(1.25rem, 4vw, 4.5rem)`; section rhythm `--section-space: clamp(4.5rem, 9vw, 8rem)`.
- **Hero:** BPT Purple ground, CSS Grid `minmax(0, 1.15fr) minmax(18rem, 0.85fr)`, `min-height: 48rem`, top padding `clamp(9rem, 14vw, 12rem)` to clear the absolute-positioned white header. Left-aligned copy; the right column holds the location / schedule block. One primary CTA and one outline secondary, never a third.
- **Client destination (`/account` family):** single column, `max-width: 58rem`, left-aligned, `min-height: 100dvh`. Order is fixed: eyebrow → condensed H1 → intro paragraph → notice bands → stacked action buttons → identity panel → sign-out.
- **Grid over flex math:** every multi-column area is CSS Grid with `minmax(0, …)`; `min-width: 0` is applied globally to prevent overflow. No `calc()` percentage hacks, no absolute-positioned content stacking (only the site header is absolute).
- **Radius:** `0` everywhere. The two exceptions (`0.75rem`, `1rem`) are image masks only.

## 6. Responsive Rules

- Breakpoints: phone below `48rem`; tablet `48rem–64rem` uses the desktop layout at two columns; desktop from `64rem`. Every grid collapses to one column below `48rem` (`max-width: 47.99rem`); grids with three or more desktop columns step down to two between `48rem` and `64rem`. Smaller content-driven steps (`42rem`, `38rem`, `32rem`) still tune individual components.
- The hero collapses to one column below `48rem`; between `48rem` and `64rem` it keeps two compact columns.
- Full-screen layouts use `100dvh`, never `100vh`, so iOS Safari toolbars do not hide content. Fixed and mobile headers and the admin navigation drawer pad with `env(safe-area-inset-*)`. Supported floor: iOS 16.
- No horizontal scroll: `overflow-wrap: anywhere` on headings and paragraphs, `max-width: 100%` on media and buttons.
- Headlines scale with `clamp()`; body never drops below `1rem`. Form controls (`input`, `select`, `textarea`) never drop below `16px`, so iOS Safari does not zoom into a field.
- Touch targets: buttons are `3.15rem` tall; nav links and table actions keep ≥ `44px`.
- Header wordmark stays single-line (`white-space: nowrap`); under `58rem` the landing nav folds its section links behind the header logo, which becomes the menu button (`aria-expanded`, `aria-controls`, Escape closes and returns focus) over a stacked list with `44px` rows, while "Sign in" stays visible beside it. The logo button only exists once the script runs, so without JavaScript (and on desktop) the logo stays the plain link home.
- Admin, staff and coach shell: the round logo is the navigation toggle, never a home link (the header's Home link covers that). On desktop it hides the purple sidebar down to a slim strip holding only the logo (sticky) and shows it again; open by default, the choice remembered per browser in `localStorage` (`bpt-admin-sidebar`). Below `48rem` the header logo opens and closes the navigation drawer. No slide animation: the change is instant.
- `prefers-reduced-motion: reduce` disables all transforms and transitions (`transition: none`).

## 7. Motion & Interaction

- **Easing:** `ease`, `160ms` for color/border, `220ms` for transform. No springs, no linear, no bounce.
- **Hover:** `-2px` lift on buttons; background swap on links. **Active:** return to `0` — the press is felt, not animated further.
- **Reveal:** content mounts instantly. No staggered cascades, no scroll-triggered entrances, no perpetual loops. Skip-link slides in on focus (`translateY(-180%) → 0`, `160ms`).
- **Performance:** only `transform` and `opacity` are animated; `scroll-behavior: smooth` with `scroll-margin-top: 7rem` for anchored targets.
- **Exception:** The course promotion band is the only permitted perpetual motion: linear marquee, visible Pause control, pauses on hover/focus, static wrapped list under reduced motion.

## 8. Anti-Patterns (Banned)

- No emojis, no icon fonts as decoration.
- No `Inter`, no generic serifs, no rounded/friendly display faces.
- No pure black (`#000000`); ink is `#1A1A18`.
- No blur shadows, no glows, no gradients (solid purple only).
- No rounded corners on UI (radius `0`), no pills — status is text + left-rule.
- No blue, teal or neon accents; no second brand color beyond purple + lime.
- No centered hero; no three-equal-card feature rows; no card-for-everything.
- No spinners; no "Scroll to explore" filler; no bouncing chevrons.
- No AI copy clichés ("Elevate", "Seamless", "Unleash"); UK-English, plain academy voice ("Ask for a place", "Review and sign waiver").
- No placeholder people ("John Doe"); use role labels ("Client account", "Guardian").
- No overlapping text/images; no absolute-positioned content besides the site header.

## 9. Member app (`/account`)

The signed-in member area is an app, not a web page: immersive **BPT Purple** header holding
identity, child chips and the day strip (pills: weekday letter + number, today filled **BPT
Lime**); the calendar body sits on **Canvas** so the traffic light stays legible. Radius here is
**1rem** (999px on pills/actions) — the only place the system rounds. Status is the **whole card
background**: open `#FFE66D`, booked `#D7F0E2` + `#176B49` left rule, attended `#E7F6EE`
muted, missed `#FFE1E6` + `#8D1C2F` left rule, closed/full/locked `#E8E7E3` muted. One action per
card. Phone (< 48rem) shows one day chosen from the day strip; tablet (`48rem–64rem`) and desktop
(from `64rem`) show the week (seven columns Mon–Sun, today at `1.6fr`, including course sessions on
Sundays) with a Week / Day switch. Full-height member screens use `100dvh`.
Skeleton shimmer while loading; native `<dialog>` for the only confirmation (cancel).

## 10. Belt colours are data (Levels)

The level catalogue carries each belt's real colours (`visual.colors`, `stripeColor`). Those hex
values are **data, not decoration**, so blue, yellow, orange, green, brown and black are allowed in
exactly two places: the belt bar of a belt card (`.belt-bar`/`.belt-tip`) and the colour-filter
swatches (`.levels-colour`) that stand for a belt. Nowhere else — they never become an accent, a
tag, the background of any other element, or text colour; the card around the bar stays Gi White
with Mat Ink and the single purple eyebrow. A belt card is one `<article>` per belt; stripes are
marks on the bar's ink tip plus an ordered list, never separate cards.
In the catalogue editor (`/admin/levels` → Versions) the preview is that same `.belt-bar`, and the
native `<input type="color">` beside each hex field is the only other place a belt colour shows. A
hex reaches CSS only once it matches `#RRGGBB`; until then the field says "Enter a colour like
#1A2B3C" and the preview keeps the last valid colour.

## 11. Ready for Jiu Jitsu (/account self check-in)

El único elemento permitido sobre el encabezado morado del miembro es una tarjeta **Gi White** con
la regla superior morada de 0.35rem, radio 1rem, y el titular de dos líneas **READY / FOR JIU
JITSU** en Barlow Condensed 700, Mat Ink, clamp(3rem, 14vw, 6rem). El rango nativo de
confirmación deslizante usa una pista Paper Edge, relleno **BPT Purple** que acompaña el pulgar, y
pulgar **BPT Lime** con aro Mat Ink. Incluye una línea de metadatos (clase · hora · sede), una
línea para la ventana y una línea de estado. Una negativa es una banda con regla izquierda roja y
una frase sencilla. Tras el registro, la tarjeta sustituye el control por "YOU'RE IN" y la hora.
No hay indicadores giratorios ni animación fuera del relleno de 220 ms.

## 12. Timetable colours are data

- A class type's timetable colour (Types → "Timetable colour") is catalogue data, validated
  as `#RRGGBB` before it reaches CSS.
- In the admin/coach **week** timetable it fills the whole session card (operator decision,
  2026-09-26: the cards keep the pastel type colours of the original timetable), with Mat Ink
  text and a boxed occupancy chip at the bottom right. A colour too dark for Mat Ink to reach
  WCAG AA (4.5:1) is mixed towards white until it does; a cancelled card drops the fill (Paper
  Edge, struck through). The single-day agenda keeps the `0.35rem` left rule, and Types shows
  the swatch. Never a text colour, never elsewhere, never in the member app.
- The type is always named in text; colour is never the only carrier of information. A week
  card whose title already is the type's name does not repeat it on a second line.

## Course catalogue and enrolment surfaces

The course catalogue uses the existing BPT display type, purple actions, warm canvas and ruled rows.
Office tools reuse AdminGate, AdminShell and the established controls. Personal course requests use
clear status bands, labelled bank details and progressively loaded payment panels. The normal member
calendar and coach roster retain their visual language, adding course-session and absence labels.

The requested landing promotion is one exception to the restrained-motion rule: a CSS-only scrolling
course band, with a visible pause button, pause on focus/hover, an inert duplicate and a static wrapped
list for reduced-motion users. It loads public JSON without importing Firebase authentication. Course
forms, images and review panels load only when opened; motion never blocks the page content.
