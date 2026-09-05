import { describe, expect, it } from "vitest";

import {
  buildNoShowPenaltyId,
  decideNoShowPenalty,
  isCoveredByMedicalLeave,
  noShowPenaltyAmountMinor,
  parseResolveNoShowPenaltyInput,
  resolvedPenaltyStatus,
} from "./no-show-penalty-contracts";

const sessionStartAt = "2026-09-10T18:00:00.000Z";

describe("no-show penalty (T111)", () => {
  it("is fifteen pounds, as the pilot decision fixes it", () => {
    expect(noShowPenaltyAmountMinor).toBe(1_500);
  });

  it("builds one deterministic identifier per absence", () => {
    expect(buildNoShowPenaltyId(" session-1 ", " student-1 ")).toBe("session-1__student-1");
  });

  describe("decideNoShowPenalty", () => {
    it("proposes for a Town no-show and nothing else", () => {
      expect(
        decideNoShowPenalty({ locationId: "town", attendanceState: "no_show", sessionStartAt }),
      ).toEqual({ propose: true, amountMinor: 1_500 });

      expect(
        decideNoShowPenalty({ locationId: "west", attendanceState: "no_show", sessionStartAt }),
      ).toEqual({ propose: false, skipReason: "otherSite" });

      for (const state of ["attended", "late", "absent", "excused"]) {
        expect(
          decideNoShowPenalty({ locationId: "town", attendanceState: state, sessionStartAt }),
        ).toEqual({ propose: false, skipReason: "notNoShow" });
      }
    });

    it("never proposes for an absence covered by an approved medical leave", () => {
      expect(
        decideNoShowPenalty({
          locationId: "town",
          attendanceState: "no_show",
          sessionStartAt,
          medicalLeaves: [{ startDate: "2026-09-01", endDate: "2026-09-30", status: "active" }],
        }),
      ).toEqual({ propose: false, skipReason: "medicalLeave" });

      // A leave that does not cover the day, or is not active, does not shield the absence.
      expect(
        decideNoShowPenalty({
          locationId: "town",
          attendanceState: "no_show",
          sessionStartAt,
          medicalLeaves: [{ startDate: "2026-08-01", endDate: "2026-08-31", status: "active" }],
        }).propose,
      ).toBe(true);
      expect(
        decideNoShowPenalty({
          locationId: "town",
          attendanceState: "no_show",
          sessionStartAt,
          medicalLeaves: [{ startDate: "2026-09-01", endDate: "2026-09-30", status: "closed" }],
        }).propose,
      ).toBe(true);
    });
  });

  describe("isCoveredByMedicalLeave", () => {
    it("covers the first and last day of the leave and nothing outside it", () => {
      const leave = [{ startDate: "2026-09-10", endDate: "2026-09-12", status: "active" }];
      expect(isCoveredByMedicalLeave("2026-09-10T06:00:00.000Z", leave)).toBe(true);
      expect(isCoveredByMedicalLeave("2026-09-12T23:00:00.000Z", leave)).toBe(true);
      expect(isCoveredByMedicalLeave("2026-09-09T23:00:00.000Z", leave)).toBe(false);
      expect(isCoveredByMedicalLeave("2026-09-13T00:30:00.000Z", leave)).toBe(false);
    });

    it("ignores a malformed date on either side", () => {
      expect(
        isCoveredByMedicalLeave("not-a-time", [
          { startDate: "2026-09-01", endDate: "2026-09-30", status: "active" },
        ]),
      ).toBe(false);
      expect(
        isCoveredByMedicalLeave(sessionStartAt, [
          { startDate: "September", endDate: "2026-09-30", status: "active" },
        ]),
      ).toBe(false);
    });
  });

  describe("parseResolveNoShowPenaltyInput", () => {
    const reason = "Student called ahead and the coach agreed to waive it.";

    it("accepts a waiver and a charge with the invoice office issued", () => {
      expect(
        parseResolveNoShowPenaltyInput({ penaltyId: "s__st", decision: "waive", reason }),
      ).toMatchObject({ ok: true });
      const charged = parseResolveNoShowPenaltyInput({
        penaltyId: "s__st",
        decision: "charge",
        reason,
        invoiceId: "invoice-1",
      });
      expect(charged.ok && charged.value.invoiceId).toBe("invoice-1");
    });

    it("refuses an invoice on a waiver, an unknown decision, a short reason and extra keys", () => {
      for (const payload of [
        { penaltyId: "s__st", decision: "waive", reason, invoiceId: "invoice-1" },
        { penaltyId: "s__st", decision: "cancel", reason },
        { penaltyId: "s__st", decision: "charge", reason: "no" },
        { penaltyId: "s__st", decision: "charge", reason, extra: true },
        { decision: "charge", reason },
        null,
      ]) {
        expect(parseResolveNoShowPenaltyInput(payload).ok, JSON.stringify(payload)).toBe(false);
      }
    });
  });

  it("maps each decision to its terminal status", () => {
    expect(resolvedPenaltyStatus("charge")).toBe("charged");
    expect(resolvedPenaltyStatus("waive")).toBe("waived");
  });
});
