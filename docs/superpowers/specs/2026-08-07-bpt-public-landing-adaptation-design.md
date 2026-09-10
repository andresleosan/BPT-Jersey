# BPT Public Landing Adaptation Design

## Estado

- Estado: diseño aprobado durante la conversación; especificación escrita pendiente de revisión final del operador.
- Alcance: adaptar la landing pública estática de `apps/web` para representar la academia real BPT Jersey sin redirigir al sitio anterior.
- Idioma visible: inglés, conforme a `BRIEF.md`.
- Fuentes consultadas: `https://bptjersey.com/`, `https://bptjersey.com/classes` y `https://bptjersey.com/contact-us` el 2026-08-07.

## Objetivo

La landing debe ser autosuficiente para una persona que descubre BPT Jersey. Debe comunicar qué entrena la academia, dónde está, qué clases publica, cuánto cuestan según la información pública, cómo iniciar una clase gratuita y por qué la futura plataforma ayuda a familias, coaches y administración.

El CTA actual `Visit BPT Jersey`, que envía al usuario a `https://bptjersey.com/`, se elimina. La página nueva no depende de una redirección ni de una consulta a la web antigua para renderizar.

## Enfoque aprobado

Se adopta un enfoque híbrido implementado inicialmente como contenido estático curado:

- Los datos públicos se guardan en un módulo tipado dentro de `apps/web/src/content/`.
- La UI consume el módulo local; no hace scraping ni `fetch` a `bptjersey.com` en runtime.
- Las URLs públicas se conservan como procedencia interna del contenido y como enlaces secundarios de redes oficiales cuando corresponda.
- Los horarios, precios y condiciones publicados se presentan como información orientativa que debe confirmarse al reservar; no se convierten en reglas de booking, billing, capacidad o autorización.
- El modelo deja una frontera clara para sustituir el módulo estático por un CMS o configuración aprobada más adelante.

## Contenido público incorporado

### Identidad y programas

La página usará la descripción pública corregida en inglés:

- Brazilian Jiu-Jitsu.
- MMA.
- Self-defence.
- Kids self-defence program based on Brazilian Jiu-Jitsu.
- Beginners Brazilian Jiu-Jitsu for people without previous martial-arts experience or returning to training.
- BJJ Gi and No-Gi sessions.

El contenido no copiará errores ortográficos del sitio, como `Brazillian`, ni artefactos de cuenta. El texto público `filler@godaddy.com` no se incorpora.

### Ubicación

La ubicación principal publicada se mostrará como:

```text
Office 9, 13 Library Place
St Helier, Jersey
JE2 3RR
```

La UI la presentará como la sede de New Town/St Helier para clases de kids y adultos. `Strive` se mantiene como sede publicada separada para sus sesiones de BJJ.

### Horario publicado

El componente de horario usará datos estructurados, no texto suelto:

| Location    | Days                 | Time        | Class                        |
| ----------- | -------------------- | ----------- | ---------------------------- |
| Town Office | Monday and Wednesday | 06:00-07:00 | No-Gi, all levels            |
| Town Office | Monday and Wednesday | 07:00-08:00 | Gi, beginners and all levels |
| Town Office | Monday and Wednesday | 17:30-18:30 | Gi, beginners                |
| Town Office | Monday and Wednesday | 18:30-19:30 | No-Gi, all levels            |
| Town Office | Tuesday and Thursday | 12:00-13:00 | Gi, beginners and all levels |
| Town Office | Tuesday and Thursday | 17:30-18:30 | Gi, all levels               |
| Town Office | Tuesday and Thursday | 18:30-19:30 | No-Gi, beginners             |
| Strive      | Tuesday and Thursday | 18:30-19:30 | Jiu-Jitsu                    |

The page will not invent a timezone, instructors for a particular session, capacity, booking window, or availability state. It will use `View classes` as an internal anchor and a visible confirmation note instead of claiming live availability.

### Fees published

The fees panel will show:

- Town Office: `£85` monthly, covering all classes and open mats.
- BPT West / Strive: `£10` per session or `£65` monthly, with the public `£8 class` wording kept as a note requiring confirmation.
- Kids: `£95` once weekly for the current school term.

The page will not implement payment, membership eligibility, tax, refunds, freeze, capacity or checkout rules. The public restriction mentioning Carrefour membership and the separate New Town location are treated as an unresolved operational contradiction; the UI will say `Confirm eligibility and current term availability when booking` rather than silently selecting one rule.

### Instructors and contact

The public instructor section may name the published qualified instructors:

- Professor Vladimiro "Miro" Afonso, 4th degree black belt.
- Eduardo "Eddie" Afonso, 2nd degree black belt.
- Andrew "Topo" Toporis, 2nd degree black belt and Jersey grappling pioneer.
- Charlie Tromans, black belt.

The contact section will provide an internal `Book a free class` CTA that anchors to the contact block, the published address, and optional secondary links to the official Facebook, Instagram, and X accounts. It will not link to the previous BPT website as the main action.

## Information architecture

The single page will contain these landmarks and anchor IDs:

1. Header: wordmark, `Home`, `Classes`, `Programs`, `Locations`, `Contact`.
2. Hero: public identity, location, `View classes`, and `Book a free class`.
3. Trust strip: New Town location, kids/adults, qualified instructors.
4. Classes: `#classes`, structured schedule board grouped by location/day.
5. Programs: `#programs`, BJJ, MMA, kids self-defence, beginners, Gi/No-Gi.
6. Fees: `#fees`, published prices and confirmation note.
7. Academy: teaching approach, qualified instructors, and community message.
8. Platform preview: families, coaches, academy operations; this remains secondary to the public academy content.
9. Contact: `#contact`, address, class-free CTA, social links, and confirmation note.
10. Footer: BPT identity, source/update note, and no old-site redirect.

The page keeps `lang="en"`, a single `h1`, ordered heading levels, semantic `header`, `nav`, `main`, `section`, `article`, and `footer` landmarks.

## Visual direction

The design preserves the approved BPT Design DNA from `STACK.md`:

- `#2F2483` BPT Purple: hero, active navigation, primary actions, and schedule markers.
- `#1A1A18` Mat Ink: footer, high-impact contact band, headings, and strong contrast.
- `#FFFFFF` Gi White: schedule board, cards that need separation, and primary button surfaces.
- `#F2F1ED` Canvas: page background and breathing space.
- Existing line/muted colors remain for dividers and secondary text only when they meet contrast requirements.
- Barlow Condensed remains the display face; Source Sans 3 remains the reading/interface face.

The signature element is the real timetable: an editorial board with day rails, location labels, discipline tags, and clear times. It replaces the current fictional `Tonight at BPT` panel. The layout uses straight edges, thin rules, asymmetric columns, and generous spacing rather than generic rounded cards or startup gradients.

Interactions remain restrained:

- Hover/focus states lift or invert buttons and schedule rows.
- Entrance animation is brief and CSS-based.
- `prefers-reduced-motion: reduce` disables non-essential movement and smooth scrolling.
- Focus rings remain visible and anchors use scroll margins so sticky/absolute navigation cannot obscure targets.

## Component boundaries

The implementation will keep content separate from presentation:

- `apps/web/src/content/academy.ts`: typed public content, schedule rows, fees, programs, instructors, source URLs, and update note.
- `apps/web/src/app/page.tsx`: page composition and semantic sections.
- `apps/web/src/app/globals.css`: responsive layout, visual tokens, schedule board, focus/motion rules, and mobile behavior.

The page remains a Server Component with static data. No client component, Firebase client, external API, form submission, or runtime state is introduced for this adaptation.

## Accessibility and responsive requirements

- Add a visible-on-focus skip link to `#main-content`.
- Keep keyboard navigation functional for every anchor and CTA.
- Give icon-only SVGs `aria-hidden="true"`; every link has descriptive accessible text.
- Use sufficient text/UI contrast and preserve visible `:focus-visible` styles.
- Keep touch targets at least 44px where practical.
- Use a responsive schedule layout: multi-column board on desktop, stacked location/day groups on mobile.
- Test at desktop and mobile viewports, keyboard tab order, 200% zoom, and reduced motion.
- Avoid horizontal overflow and keep long address/fee copy readable on narrow screens.

## Error and freshness policy

Because the content is bundled at build time, the page has no runtime dependency failure. The trade-off is freshness: the content module must keep source URLs and a `lastVerified` date, and the visible page must avoid promising live availability. Any future switch to a remote CMS must add loading/error/fallback behavior in a separate design.

## Verification criteria

- `corepack pnpm --filter @bpt-jersey/web build` creates the static page successfully.
- The page contains no `href="https://bptjersey.com/"` primary CTA or equivalent redirect.
- Real public location, program, schedule, fee, instructor, and contact content appears in English.
- No placeholder `(f)`, filler account, invented capacity, or unapproved operational constraint reaches the visible page.
- Vitest render test confirms the principal content and internal anchors.
- Playwright smoke passes desktop and mobile with no console errors or horizontal overflow.
- Keyboard/focus/reduced-motion checks pass.

## Out of scope

- Scraping or runtime synchronization with `bptjersey.com`.
- Payment, booking, membership, login, contact form submission, CRM, Firebase, or Firestore integration.
- Cloudflare/hosting configuration changes.
- Replacing the academy's existing website or claiming legal/operational approval of its published contradictions.
