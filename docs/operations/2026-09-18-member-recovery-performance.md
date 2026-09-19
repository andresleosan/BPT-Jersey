# Member recovery performance and usability

Scope: `/login/recover`, based on main `852e1dc`. All new interface text is English.

## Changes

- Remove the admin stylesheet from recovery: coverage found all 60,770 source characters unused on this route.
- Defer the recovery callable and validation module until form focus or submission. Focus downloads code only; it does not search members or create requests. Keep session observation and Google authentication available without adding a delayed import before the popup.
- Announce pending requests, disable repeated submission, focus the next step heading and provide actionable connection/popup errors while retaining entered details and the opaque recovery ticket.
- Reserve feedback space and give navigation links at least 44px of touch height.

## Lab evidence

Chromium through Playwright/CDP, mobile viewport 390 x 844, cold contexts, cache disabled,
150ms network latency, 200,000 bytes/s download, 93,750 bytes/s upload and 4x CPU slowdown.
Three runs per sample. Both local builds use the same uncompressed static server.
Source sizes below include inline JavaScript and represent decoded source character counts,
not compressed transfer bytes. No user data or recovery requests were submitted during measurement.

| Metric                    |                  Before |   Final isolated sample |
| ------------------------- | ----------------------: | ----------------------: |
| Initial JavaScript source |               1,281,668 |      1,009,821 (-21.2%) |
| Initial CSS source        |                 120,708 |         60,191 (-50.1%) |
| Median FCP / LCP          |                 1,968ms |                 1,916ms |
| LCP runs                  | 1,976 / 1,968 / 1,944ms | 1,904 / 1,916 / 1,976ms |
| CLS                       |           0 in all runs |           0 in all runs |

A final sample taken alongside other validation had LCP 2,084 / 2,492 / 2,404ms.
Repeating without concurrent validation produced the isolated sample above. Timing overlaps
and host contention mean these results establish a smaller initial payload, not a reliable
percentage improvement in rendering speed. No field Core Web Vitals, INP, Lighthouse score
or official TBT measurement is available. Chrome DevTools MCP was unavailable; the browser
protocol fallback provided network, coverage and PerformanceObserver measurements.

Production baseline LCP was 1,276 / 1,304 / 1,384ms with CLS 0. Production already uses
Brotli and static-resource caching. Do not compare production timings directly with the
uncompressed local server. Shared authentication remains the largest initial code dependency;
changing it would affect login beyond the recovery scope.

## Validation

- 44 tests across recovery form, recovery authentication and office recovery review passed.
- New feedback tests were observed failing before implementation.
- Typecheck, lint, focused Prettier check, `git diff --check` and static production build passed.
- Actual compiled browser UI passed at widths 390 and 1280 with synthetic network responses:
  lazy chunk on focus; no premature callable; one request; pending announcement outside busy
  form; heading focus; Google and password choices; start-again cleanup; no overflow or page errors.
- Mobile authentication-step screenshot inspected visually.
- Build and browser validation used local emulator configuration and synthetic membership data.

No Firebase deployment, migration, member-record edit or recovery-response cache is needed.
The previous automated production App Check rejection remains a limitation for real-account
end-to-end acceptance. This optimization does not establish that acceptance or change App Check.
