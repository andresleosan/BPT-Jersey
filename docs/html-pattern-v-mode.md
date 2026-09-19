# HTML pattern compatibility and location HTTP 400 investigation

Branch: `fix/html-pattern-v-mode`, created from local `main`. No production requests,
push or deployment were made.

## Pattern inventory

All application sources under `apps/web` and `packages` were searched. There are
three HTML pattern attributes, two distinct strings, and no HTML pattern strings
imported from packages.

| Attribute | Original pattern | `u` | `v` |
| --- | --- | --- | --- |
| Location create abbreviation, `apps/web/src/app/admin/classes-services/locations/page.tsx:170` | `[A-Za-z0-9_-]{2,12}` | Pass | SyntaxError |
| Location edit abbreviation, same file, line 303 | `[A-Za-z0-9_-]{2,12}` | Pass | SyntaxError |
| Subscription reference, `apps/web/src/app/admin/members/member-subscription-editor.tsx:414` | `[A-Za-z0-9][A-Za-z0-9._:\-]*` | Pass | Pass |

Both location attributes now use `[A-Za-z0-9_\-]{2,12}`. JSX quoted attributes
preserve the single backslash. The character set and length limits are unchanged.
The domain abbreviation regex is used directly with `u`, not shared as an HTML
attribute, and does not need a change.

The [HTML specification](https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute)
requires `v` compilation. An invalid pattern leaves the input without a compiled
pattern, so pattern-mismatch validation is skipped; other constraints such as
`required` still apply. The console SyntaxError does not establish that the submit
handler threw or explain an HTTP 400 on its own.

## HTTP 400 evidence

The current callables do **not** use a Zod schema for these two inputs. They use
`parseUpdateLocationInput` in
`packages/domain/src/schedule/classes-services-contracts.ts:81` and
`parseSaveLocationGeofenceInput` in
`packages/domain/src/schedule/schedule-contracts.ts:86`.

For this payload:

```json
{"locationId":"town","geofence":{"latitude":49.183998,"longitude":-2.107137}}
```

- `saveLocationGeofence` accepts it. Both coordinates are finite, in range and
  have no more than six decimals; `town` is a valid ID. The local callable test
  saves this exact payload through the in-memory store.
- `updateLocation` rejects the **`geofence` key**, regardless of the coordinate
  values. Its allowed keys are `locationId`, `name`, `abbreviation`, `kind` and
  `active`. The handler at `apps/functions/src/schedule/schedule-callables.ts:314`
  converts that parser failure to `HttpsError("invalid-argument", ...)`, the
  callable error corresponding to HTTP 400. Separate top-level `latitude` or
  `longitude` keys would also be rejected.
- When saving location details, `abbreviation` is rejected if present but empty,
  shorter than two characters, longer than twelve, or containing forbidden
  characters (after trimming). The tests cover `""`, `"T"`, `"T!"` and thirteen
  letters. `name` must contain 2–80 characters after trimming. A payload with only
  `locationId` is rejected as `Nothing to update`.

The current client has no reproduced payload/schema mismatch:

1. `site-geofence-panel.tsx:53` parses strings into numeric coordinates and validates
   the payload, then calls `saveLocationGeofence` at line 68.
2. `apps/web/src/lib/schedule-client.ts:146` invokes the callable named
   `saveLocationGeofence` and sends the input unchanged.
3. The locations page renders sibling detail and coordinate forms. Its detail
   Save button submits `locationId`, `name`, and `abbreviation` to `updateLocation`;
   it does not send coordinates.
4. Chromium tests save the supplied coordinates while the detail abbreviation is
   deliberately invalid. Only `saveLocationGeofence` is called; no
   `updateLocation` request occurs.

Local history also contains `48bbcba`, which already moved the geofence panel
out of the detail form on `main`. Before that commit the forms were nested, so a
coordinate submit could also reach the detail submit handler. That same commit
introduced the abbreviation patterns. This is historical context, not proof of
the production revision or failed payload.

Thus neither latitude nor longitude causes a 400 on the intended endpoint in
this checkout. An invalid nonempty abbreviation could reach the detail endpoint
when the old HTML pattern is ignored. Sending a geofence to the detail endpoint
would also explain a 400, but the current client does not do that. The original
production request body/response and deployed revision were not supplied or
queried, so the exact cause of that observed production response remains
unconfirmed. No speculative client or schema change was made.

## Regression coverage

- `apps/web/src/lib/html-patterns.test.ts`: five tests. Discovers JSX pattern
  attributes throughout app/package source, compiles all three in both modes,
  and verifies equivalence for both changed attributes. Nonliteral expressions
  fail explicitly until their possible values are covered, rather than being
  silently skipped. Generated output and test fixtures are excluded.
- `preserves abbreviation acceptance before and after escaping the hyphen`:
  six accepted and ten rejected examples, plus all 128 ASCII characters at
  lengths 1, 2, 12 and 13: 528 samples, compared for both attributes in both
  modes (2,112 before/after comparisons). The new suite was run before the fix
  and failed on both bad attributes.
- `sends the reported town coordinates unchanged to saveLocationGeofence`:
  web client payload and callable selection, including existing App Check options.
- `saves the reported town geofence without submitting location details and enables Clear coordinates`:
  page submission routing and updated saved state.
- `accepts the reported town geofence through its dedicated callable, not updateLocation`:
  accepted geofence and exact rejection message from the wrong endpoint.
- `rejects invalid location abbreviation %j independently of coordinates`:
  four callable rejection cases.
- `qa/tests/html-pattern-v-mode.spec.ts`: two tests on desktop Chromium
  (1280 × 720) and mobile Chromium (Pixel 7, 412 × 839), four passes. Covers
  native pattern validation, Enter/Tab/Escape navigation, focus return, exact
  geofence routing, coordinate errors, catalog loading/error states and overflow.
  The browser blocks non-loopback network requests. Six synthetic screenshots
  were inspected; no member data was used.

## Verification

The requested runtime build, formatting, lint, TypeScript and web build passed.
The web build used explicit local demo Firebase settings and the existing
loopback-only synthetic admin fixture. It was not deployed.

The first unrestricted full test run was killed with exit 137; the environment
reported OOM kills. The suite was rerun with `--maxWorkers=2` to limit memory use.

Final full-suite result: **384 files passed, one failed; 4,212 tests passed, one
failed (4,213 total)**. The five focused files listed above contribute 112 passing
tests. All four Chromium cases passed separately.

The unrelated failing test is
`fixture calendar repository > generates sessions for every weekday but Sunday, with programs`
at `apps/web/src/lib/calendar/fixture-calendar-repository.test.ts:27`. It also fails
when run alone. All calendar source/test files match `main` (`git diff main --
apps/web/src/lib/calendar` is empty). The fixture appends special ready sessions
at `now + 30 minutes` (`fixture-calendar-repository.ts:417`), independently of
its Monday–Saturday timetable. During this run that instant falls on Sunday in
Europe/Jersey, contradicting the test's assertion that the returned sessions
contain no Sunday. This existing calendar issue was not changed, skipped or
masked by changing the clock. The full test command therefore remains red.
