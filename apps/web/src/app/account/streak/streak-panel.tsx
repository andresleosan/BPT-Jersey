"use client";

/**
 * Streak panel slot (T042V2). Phase 0 mounts it in `/account` between the check-in slider and the
 * purple header (`topSlot` of `MemberCalendar`); the streak team fills it in from
 * `docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md`. The flame animation is
 * served from `/animations/streak-flame.json` and `lottie-web` is already a dependency.
 */
export function StreakPanel(props: Readonly<{ studentId: string }>) {
  void props; // The panel itself lands with the streak UI unit; the selected participant is already wired.
  return null;
}
