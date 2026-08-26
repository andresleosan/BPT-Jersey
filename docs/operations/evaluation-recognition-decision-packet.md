# T009 Evaluation and Recognition Decision Packet

Status: review; temporary synthetic placeholder awaiting real head coach confirmation.

Prepared: 2026-08-25

## Boundary

This packet records criteria and weights for the controlled synthetic pilot. It does not grant a
belt, stripe, recognition, or production policy. The head coach remains the decision owner.

## Already Fixed By The Existing MVP

- An evaluation uses an integer score from 1 to 5 and evidence notes of 3 to 1000 characters.
- The sanitized catalog contains 171 definitions, 27 belts, 144 stripes, 11 skills, and 165
  requirements. The catalog remains the source for each target skill's minimumRating.
- A required skill is complete when the maximum recorded score for that skill reaches its
  requirement's minimumRating.
- Promotion eligibility is a gate, not a weighted override: required classes, minimum time in rank,
  and all required skills must be met.
- Recognition candidates are explainable and sorted eligible-first, then readiness percentage,
  current attendance streak, and student name. Belts and stripes are never granted automatically.
- Approved medical leave preserves attendance streak continuity. The current implementation does not
  automatically convert leave into attended classes or time-in-rank credit.
- There is no public child leaderboard. Adult comparison is opt-in, and minors see only their own
  progress.

## Source Facts And Safeguarding Reconciliation

The real BPTJ FUNCTIONS APP.docx gives this stripe baseline: kids 4-7, one stripe every 4 classes with
at least one month; kids 8-12, every 6 classes with at least 45 days; teens 12-15, every 10 classes
with at least two months; adult white 16+, every 25 classes with at least 90 days; adult blue, every
50 classes with at least 180 days; adult purple, every 55 classes with at least 180 days; adult brown
18+, every 60 classes with at least 180 days. These are real source facts to reconcile with the sanitized
171-definition catalog, not synthetic student outcomes. The DOCX also asks for member comparison by
photo/name/progress; the safer current MVP boundary (minors see only their own progress, adults opt in)
remains in force until the head coach/operator explicitly reconciles that request with safeguarding.

## Decisions Still Owned By The Head Coach

- Whether readiness should keep equal weights or use another weighting.
- Whether the score is a descriptive per-skill observation only, or whether a future aggregate
  score is wanted. A new aggregate would require a separate implementation task.
- Whether approved medical leave pauses time-in-rank, grants class credit, or only preserves streaks.
- Recognition categories beyond the promotion-readiness queue, including attendance, technical,
  conduct, or community recognition.
- Review cadence and the minimum evidence expected before a coach records a new evaluation.

## Proposed Reversible Defaults For The Synthetic Pilot

These are proposals, not approvals:

| ID       | Proposed default                                                                                                             | Rationale                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| T009-P01 | Keep the 1-5 score per skill and evidence note; do not calculate a global student score.                                     | Matches the current contract and keeps technical evidence reviewable.                   |
| T009-P02 | Keep promotion eligibility as AND(classes, time in rank, all required skills).                                               | Prevents a high readiness percentage from bypassing a missing safety or skill gate.     |
| T009-P03 | Keep readiness at equal thirds: 1/3 classes, 1/3 time in rank, 1/3 completed skills.                                         | Matches the current deterministic candidate calculation and is easy to explain.         |
| T009-P04 | Use the existing candidate sort: eligible first, readiness descending, streak descending, then name.                         | Gives staff a deterministic queue without automatic promotion.                          |
| T009-P05 | Use only the promotion-readiness queue during the synthetic pilot; do not create automatic awards or public recognition.     | Keeps human approval and child privacy intact while T009 remains open.                  |
| T009-P06 | For medical leave, preserve the streak and route class/time exceptions to head-coach review; do not grant automatic credits. | Avoids silently changing the current implementation until the coach chooses the policy. |

If the head coach rejects T009-P03 or T009-P06, T039/T041 may need a follow-up implementation and
test task. T009 must not be marked approved from this packet alone.

## Temporary Synthetic Placeholder

At the operator's request, use these invented values only for the controlled synthetic pilot:

- T009-P01 through T009-P06: provisionally accepted for Emulator/isolated staging.
- Medical leave: preserve the attendance streak; do not grant automatic class or time credit.
- Recognition scope: promotion-readiness candidates only; no automatic award or public recognition.
- Review cadence: every four weeks, with one evidence note per evaluated skill.
- Placeholder approver: operator-directed synthetic configuration, not a head coach sign-off.

This placeholder may be changed or removed without migration. It does not approve T009 for real
academy operation, real students, production, or legal/HR policy.

## Synthetic Formula Examples

These rows are invented fixtures only. They contain no real student identity or performance data.

| Synthetic ID      | Classes completed/required | Time elapsed/required | Skills completed/total | Readiness formula                 | Candidate result                                        |
| ----------------- | -------------------------: | --------------------: | ---------------------: | --------------------------------- | ------------------------------------------------------- |
| student-alpha (f) |                        4/4 |            30/30 days |                    3/3 | (1 + 1 + 1) / 3 = 100%            | Eligible for head-coach review                          |
| student-beta (f)  |                        3/4 |            30/30 days |                    2/3 | (0.75 + 1 + 0.667) / 3 = 81%      | Candidate, not eligible                                 |
| student-gamma (f) |                        4/4 |            30/30 days |                    3/3 | 100%, with approved medical leave | Streak preserved; leave-credit policy requires decision |

The examples do not authorize a promotion or recognition. They only exercise the deterministic
projection and its reasons.

## Minimum Head Coach Reply

T009 can move to approved for the synthetic pilot with one response:

T009-P01..T009-P06: approved / list changes

Medical leave policy: streak only / pause time / grant class credit / other

Recognition categories for this pilot: promotion-readiness only / list categories

Review cadence and evidence minimum: <value>

Approver/role: <head coach or operator role>

No names of real students, medical details, credentials, or other personal data should be included.

## Promotion Gate

After the head coach confirms the values, update this packet and T009 evidence, then review any
affected domain contracts, fixtures, callables, reports, and tests. Keep T008, T010, and T011 as
separate decisions.
