# T090 - Official waiver as a registration requirement

## Scope

Make `Brazilian Power Team Jersey Waiver and Release of Liability.pdf` the only legal waiver template used by the client registration flow.

- preserve the source PDF without editing its legal content;
- expose it from the web app as the official document to review;
- require every required acknowledgement and authenticated typed name before acceptance;
- keep adult self-signing and active guardian signing for a linked minor;
- generate private evidence containing the original PDF pages and a server-generated signature record;
- send a newly saved adult profile to the waiver step so registration does not end at profile creation.

The source PDF is static and has no AcroForm fields. The app therefore captures the signature record in the existing consent boundary and keeps the original pages intact in the evidence PDF.

## Source and integrity

The source is copied from:

`F:\Proyectos\BPT Jersey\Varios\Brazilian Power Team Jersey Waiver and Release of Liability.pdf`

It is stored under `apps/web/public/legal/` for review and under the Functions consent assets for server-side evidence generation. Both copies must have the same SHA-256. No text is re-authored or silently replaced in the app.

## Behavior

- `/account/waiver` presents an official-document panel with the PDF in an embedded viewer and an explicit link to open it in a new tab.
- The existing four consent decisions remain the structured audit categories, but the heading and copy clearly state that acceptance applies to the attached official PDF.
- The submit control remains unavailable until all required decisions are accepted and the signer enters their full authenticated name.
- On success, the evidence PDF starts with the exact source PDF pages, then appends the existing server-authenticated record. The source pages are not regenerated from app text.
- `/account/profile` redirects to `/account/waiver` after a successful save and explains that the waiver is the final registration step.

## Security and rollback

- No public Firestore/R2 writes are introduced. Existing callable authorization, tenant scope, signer matching, audit trail and private R2 storage remain authoritative.
- Asset integrity is checked at build/test time. Runtime generation fails closed if the asset cannot be loaded or is not a PDF.
- Rollback is additive: remove the T090 asset/UI wiring and retain existing consent/evidence history; do not delete accepted records or private documents.

## Verification

- failing tests first for source asset integrity, evidence preservation, profile redirect and the official-document UI;
- focused domain/Functions/Web tests;
- Functions build/deploy-artifact validation to prove the runtime asset is packaged;
- full formatter, lint, typecheck, unit, Rules, build and relevant E2E checks;
- security review for path traversal, accidental public private evidence, unknown payload fields and source asset substitution.
