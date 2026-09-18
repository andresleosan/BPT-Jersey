import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";

const api = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentLevelCard: vi.fn(),
  getStudentLevelHistory: vi.fn(),
  getStudentSkillScores: vi.fn(),
  openStudentLevel: vi.fn(),
  assignLevel: vi.fn(),
  voidPromotion: vi.fn(),
  levelsSafeErrors: Object.freeze({
    card: "Levels are unavailable right now. Please try again later.",
    history: "Unable to load the level history. Please try again.",
    assignInput: "Unable to assign the level. Check the date and the note, then try again.",
    assign: "Unable to assign the level. Please try again later.",
    void: "Unable to void the promotion. Please try again.",
    ratings: "Unable to save the ratings. Please try again.",
    scores: "Unable to load the skill ratings. Please try again.",
  }),
}));
vi.mock("../../../../lib/levels-client", () => api);

import { ManageView } from "./manage-view";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("catalogue must parse");
const catalog = { ...parsed.value, sourceHash: "test" };

const jerseyDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Jersey" });
const today = jerseyDay.format(new Date());
const dayBack = (days: number) =>
  new Date(Date.parse(`${today}T00:00:00.000Z`) - days * 86_400_000).toISOString().slice(0, 10);
const uiDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));

/** The adult white belt and its first two stripes, straight from the shipped catalogue. */
const whiteBelt = "white-belt";
const firstStripe = "white-1st-stripe";
const secondStripe = "white-2nd-stripe";
/** The 4-5/5-7 kids ladder: the only levels that carry skill minimums (white-foundation-v1, 11). */
const kidsBelt = "white-belt-kids-4-5-and-5-7-yo";
const kidsFirstStripe = "white-4-5-and-5-7yo-1st-stripe";
const topLevel = [...catalog.definitions].sort((a, b) => b.sequence - a.sequence)[0]!;

const levelStart = dayBack(30);

const card = {
  state: "initialized" as const,
  studentId: "student-1",
  currentDefinition: { definitionKey: whiteBelt },
  targetDefinition: { definitionKey: firstStripe },
  currentLevelStartedAt: `${levelStart}T00:00:00.000Z`,
  progressPercent: 44,
  criteria: {
    classes: { required: 25, completed: 12, imported: 9, met: false },
    time: { requiredDays: 75, elapsedDays: 30, met: false },
  },
};

const promotion = {
  entryId: "grad_student-1_white-belt_x",
  kind: "promotion" as const,
  definitionKey: whiteBelt,
  fromDefinitionKey: "grey-belt",
  assignedOn: levelStart,
  classes: { done: 30, min: 25 },
  days: { done: 90, min: 75 },
  decidedByRole: "owner" as const,
  source: "bpt" as const,
  note: null,
  gaps: [],
  voided: null,
};
const opening = {
  ...promotion,
  entryId: "opening_student-1",
  kind: "opening" as const,
  definitionKey: "grey-belt",
  fromDefinitionKey: null,
  assignedOn: "2026-01-01",
  classes: null,
  days: null,
  source: "regyfit-import" as const,
  decidedByRole: null,
};

function renderView(role = "owner", age: number | null = 30) {
  return render(
    <ManageView
      age={age}
      fullName="Synthetic Member"
      recordHref="/admin/members/profile?id=student-1"
      role={role}
      studentId="student-1"
    />,
  );
}

async function assignForm() {
  return screen.findByRole("form", { name: "Assign next level" });
}

beforeEach(() => {
  api.getLevelCatalog.mockReset();
  api.getStudentLevelCard.mockReset();
  api.getStudentLevelHistory.mockReset();
  api.getStudentSkillScores.mockReset();
  api.openStudentLevel.mockReset();
  api.assignLevel.mockReset();
  api.voidPromotion.mockReset();
  api.getLevelCatalog.mockResolvedValue(catalog);
  api.getStudentLevelCard.mockResolvedValue(card);
  api.getStudentLevelHistory.mockResolvedValue({
    studentId: "student-1",
    currentDefinitionKey: whiteBelt,
    entries: [promotion, opening],
  });
  api.getStudentSkillScores.mockResolvedValue({ latest: {}, best: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManageView reads", () => {
  it("costs exactly three restricted reads per open and one catalogue read", async () => {
    renderView();
    await screen.findByRole("table", { name: "Level history" });
    expect(api.getStudentLevelCard).toHaveBeenCalledTimes(1);
    expect(api.getStudentLevelHistory).toHaveBeenCalledTimes(1);
    expect(api.getStudentSkillScores).toHaveBeenCalledTimes(1);
    expect(api.getLevelCatalog).toHaveBeenCalledTimes(1);
    for (const read of [
      api.getStudentLevelCard,
      api.getStudentLevelHistory,
      api.getStudentSkillScores,
    ])
      expect(read).toHaveBeenCalledWith("student-1");
  });

  it("says the level record is unavailable when a read fails, and re-reads on Try again", async () => {
    api.getStudentLevelHistory.mockRejectedValueOnce(new Error(api.levelsSafeErrors.history));
    renderView();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Levels are unavailable right now. Please try again later.",
    );
    expect(screen.queryByRole("table", { name: "Level history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("table", { name: "Level history" });
    expect(api.getStudentLevelHistory).toHaveBeenCalledTimes(2);
  });
});

describe("ManageView history", () => {
  it("names the current row, the importer, and offers Void only on the latest promotion", async () => {
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("WHITE BELT");
    expect(rows[1]).toHaveTextContent(uiDay(levelStart));
    expect(rows[1]).toHaveTextContent("30/25");
    expect(rows[1]).toHaveTextContent("90/75");
    expect(rows[1]).toHaveTextContent("Owner");
    expect(rows[1]).toHaveTextContent("Current");
    expect(within(rows[1]!).getByRole("button", { name: "Void" })).toBeInTheDocument();
    // The Regyfit opening has no criteria of its own and was decided by nobody at BPT.
    expect(rows[2]).toHaveTextContent("Regyfit import");
    expect(rows[2]).toHaveTextContent("Previous");
    expect(within(rows[2]!).getAllByText("—").length).toBe(2);
    expect(within(rows[2]!).queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("offers the one recoverable step on an older promotion instead of explaining a refusal", async () => {
    const later = { ...promotion, entryId: "grad_later", definitionKey: firstStripe };
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: firstStripe,
      entries: [later, promotion, opening],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("button", { name: "Void" })).toBeNull();
    expect(rows[2]).toHaveTextContent("Void the latest promotion first");
  });

  it("strikes a voided row through and says which parts of the void were never recorded", async () => {
    const degraded = {
      ...promotion,
      entryId: "grad_degraded",
      voided: { reason: null, voidedByRole: null, voidedOn: null },
    };
    const recorded = {
      ...opening,
      entryId: "grad_recorded",
      kind: "promotion" as const,
      source: "bpt" as const,
      voided: {
        reason: "Assigned to the wrong member.",
        voidedByRole: "headCoach" as const,
        voidedOn: "2026-09-01",
      },
    };
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [degraded, recorded],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent(
      "Voided — author not recorded — date not recorded — reason not recorded",
    );
    expect(rows[1]!.className).toContain("ibjjf-voided");
    expect(rows[1]).not.toHaveTextContent("Current");
    expect(rows[2]).toHaveTextContent(
      `Voided — Head coach — ${uiDay("2026-09-01")} — Assigned to the wrong member.`,
    );
    // A cancelled promotion can never be voided again, whatever is missing from the void record,
    // and it is not waiting on anything either.
    expect(within(table).queryByRole("button", { name: "Void" })).toBeNull();
    expect(table).not.toHaveTextContent("Void the latest promotion first");
  });

  it("moves the Void action to the promotion that stands once a later one is voided", async () => {
    const later = {
      ...promotion,
      entryId: "grad_later",
      definitionKey: firstStripe,
      voided: { reason: "Wrong member.", voidedByRole: "owner" as const, voidedOn: "2026-09-02" },
    };
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: whiteBelt,
      entries: [later, promotion, opening],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).queryByRole("button", { name: "Void" })).toBeNull();
    expect(within(rows[2]!).getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Current");
  });

  it("keeps a row whose stored day cannot be read, instead of taking the record down", async () => {
    // The client's schema refuses a day that is not a real calendar date, so this state should
    // never arrive; the guard is the second line, and without it `Intl.format` throws on an
    // invalid date and takes the whole member record down over one bad row.
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: whiteBelt,
      entries: [{ ...promotion, assignedOn: "not-a-day" }],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    expect(table).toHaveTextContent("Date not recorded");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("WHITE BELT");
  });

  it("keeps the note and the gaps stored with a below-criteria promotion visible", async () => {
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: whiteBelt,
      entries: [
        {
          ...promotion,
          note: "Competition result justifies it.",
          gaps: ["Skips 1 stripe", "Classes 12/25 not met"],
        },
      ],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    expect(table).toHaveTextContent("Below criteria: Skips 1 stripe, Classes 12/25 not met");
    expect(table).toHaveTextContent("Competition result justifies it.");
  });

  it("says so plainly when there is no history at all", async () => {
    api.getStudentLevelCard.mockResolvedValue({ state: "uninitialized", studentId: "student-1" });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    });
    renderView();
    expect(await screen.findByText("No level history yet.")).toBeInTheDocument();
  });
});

describe("ManageView assignment", () => {
  it("lists gaps, demands a note of 10 to 500 characters and assigns once", async () => {
    api.assignLevel.mockResolvedValue({
      promotionId: "grad_new",
      toDefinitionKey: secondStripe,
      promotedOn: today,
      gaps: ["Skips 1 stripe"],
    });
    renderView();
    const form = await assignForm();
    const select = within(form).getByLabelText("Next level");
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).not.toContain("WHITE BELT");
    expect(options).toContain("White - 1st Stripe");
    expect(options).toContain("White - 2nd Stripe");

    const date = within(form).getByLabelText("Promotion date");
    expect(date).toHaveValue("");
    expect(date).toHaveAttribute("max", today);
    expect(date).toHaveAttribute("min", levelStart);

    fireEvent.change(select, { target: { value: secondStripe } });
    fireEvent.change(date, { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));

    const dialog = await screen.findByRole("dialog", {
      name: `Promote Synthetic Member from WHITE BELT to White - 2nd Stripe on ${uiDay(today)}?`,
    });
    expect(within(dialog).getByRole("list", { name: "Criteria not met" }).textContent).toBe(
      "Skips 1 stripeClasses 12/25 not metDays 30/75 not met",
    );
    expect(dialog).toHaveTextContent(
      "Not every criterion BPT records for this level is met. A note is required and is kept with the promotion.",
    );

    const confirm = within(dialog).getByRole("button", { name: "Confirm promotion" });
    expect(confirm).toBeDisabled();
    const note = within(dialog).getByLabelText("Note (required, 10 to 500 characters)");
    fireEvent.change(note, { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(note, { target: { value: "Competition result justifies it." } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.assignLevel).toHaveBeenCalledWith({
        studentId: "student-1",
        fromDefinitionKey: whiteBelt,
        toDefinitionKey: secondStripe,
        promotedOn: today,
        note: "Competition result justifies it.",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe("Level assigned.");
    expect(api.getStudentLevelHistory).toHaveBeenCalledTimes(2);
  });

  it("keeps at most one assignment in flight when the operator double-clicks", async () => {
    let release = (): void => {};
    api.assignLevel.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              promotionId: "grad_new",
              toDefinitionKey: firstStripe,
              promotedOn: today,
              gaps: [],
            });
        }),
    );
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: firstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    const note = within(dialog).getByLabelText("Note (required, 10 to 500 characters)");
    fireEvent.change(note, { target: { value: "Ready on every count but the clock." } });
    const confirm = within(dialog).getByRole("button", { name: "Confirm promotion" });
    // Both clicks land before React re-renders, so neither the `disabled` attribute nor the
    // `busy` state has moved when the second one runs: only an in-flight flag can stop it.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(api.assignLevel).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    release();
    expect((await screen.findByRole("status")).textContent).toBe("Level assigned.");
    expect(api.assignLevel).toHaveBeenCalledTimes(1);
  });

  it("counts the LATEST rating, not the best one ever given", async () => {
    // white-foundation-v1: 11 minimums on the kids' first stripe. Best says every one is met;
    // the latest says one is not, and the latest is what decides (operator DECISION 6).
    const requirements = catalog.requirements.filter(
      (requirement) => requirement.definitionKey === kidsFirstStripe,
    );
    expect(requirements.length).toBe(11);
    const best: Record<string, number> = {};
    const latest: Record<string, number> = {};
    for (const requirement of requirements) {
      best[requirement.skillKey] = 5;
      latest[requirement.skillKey] = requirement.skillKey === "tie-the-belt" ? 1 : 5;
    }
    api.getStudentSkillScores.mockResolvedValue({ latest, best });
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      currentDefinition: { definitionKey: kidsBelt },
      targetDefinition: { definitionKey: kidsFirstStripe },
      criteria: {
        classes: { required: 4, completed: 12, imported: 0, met: true },
        time: { requiredDays: 30, elapsedDays: 30, met: true },
      },
    });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: kidsBelt,
      entries: [{ ...promotion, definitionKey: kidsBelt }],
    });
    renderView("headCoach", 6);
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: kidsFirstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("list", { name: "Criteria not met" }).textContent).toBe(
      "Skills 10/11 at minimum not met",
    );
    expect(dialog).not.toHaveTextContent("All criteria");
  });

  it("tells a head coach exactly what a two-belt jump on a child breaks", async () => {
    const definitions = [...catalog.definitions].sort((a, b) => a.sequence - b.sequence);
    const kidsIndex = definitions.findIndex((d) => d.definitionKey === kidsBelt);
    const target = definitions[kidsIndex + 3]!;
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      currentDefinition: { definitionKey: kidsBelt },
      targetDefinition: { definitionKey: kidsFirstStripe },
      criteria: {
        classes: { required: 4, completed: 1, imported: 0, met: false },
        time: { requiredDays: 30, elapsedDays: 30, met: true },
      },
    });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: kidsBelt,
      entries: [{ ...promotion, definitionKey: kidsBelt }],
    });
    renderView("headCoach", 12);
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: target.definitionKey },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog", {
      name: `Promote Synthetic Member from WHITE BELT KIDS 4-5 and 5-7 YO to ${target.name} on ${uiDay(today)}?`,
    });
    // Belts before stripes, then classes, then days, then skills, then the age band (contract).
    expect(within(dialog).getByRole("list", { name: "Criteria not met" }).textContent).toBe(
      "Skips 2 stripesClasses 1/4 not metSkills 0/11 at minimum not metAge band not met",
    );
  });

  it("asks for no note when every criterion is met, and still records one if given", async () => {
    api.assignLevel.mockResolvedValue({
      promotionId: "grad_new",
      toDefinitionKey: firstStripe,
      promotedOn: today,
      gaps: [],
    });
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      criteria: {
        classes: { required: 25, completed: 40, imported: 0, met: true },
        time: { requiredDays: 75, elapsedDays: 30, met: true },
      },
      currentLevelStartedAt: `${dayBack(400)}T00:00:00.000Z`,
    });
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: firstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("All criteria for this level are met.");
    expect(within(dialog).queryByRole("list", { name: "Criteria not met" })).toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "Confirm promotion" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.assignLevel).toHaveBeenCalledWith({
        studentId: "student-1",
        fromDefinitionKey: whiteBelt,
        toDefinitionKey: firstStripe,
        promotedOn: today,
      }),
    );
  });

  it("warns that classes are counted as of today when the promotion is backdated", async () => {
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: firstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), {
      target: { value: dayBack(3) },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      `Classes are counted as of today, not as of ${uiDay(dayBack(3))}. The final check runs when the promotion is recorded.`,
    );
  });

  it("refuses to review without a level and a date", async () => {
    renderView();
    const form = await assignForm();
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "Choose a level and a promotion date.",
    );
  });

  it("shows only the client's safe wording when the backend refuses, and keeps the note in reach", async () => {
    api.assignLevel.mockRejectedValue(new Error(api.levelsSafeErrors.assign));
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: firstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Promoted after a competition." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm promotion" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Unable to assign the level. Please try again later.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never renders a rejection this view did not recognise", async () => {
    api.assignLevel.mockRejectedValue(new Error("uid=abc123 staff=secret-doc"));
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: firstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Promoted after a competition." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm promotion" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Unable to assign the level. Please try again later.");
    expect(document.body.textContent).not.toContain("uid=abc123");
    expect(document.body.textContent).not.toContain("secret-doc");
  });

  it("offers no assignment at the top of what BPT tracks", async () => {
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      currentDefinition: { definitionKey: topLevel.definitionKey },
      targetDefinition: null,
      progressPercent: null,
    });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: topLevel.definitionKey,
      entries: [{ ...promotion, definitionKey: topLevel.definitionKey }],
    });
    renderView();
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.queryByRole("form", { name: "Assign next level" })).toBeNull();
    expect(
      screen.getByText(
        "This is the highest level BPT tracks, so there is no next level to assign.",
      ),
    ).toBeInTheDocument();
  });

  it("offers no assignment when the level on record is not in the catalogue", async () => {
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      currentDefinition: { definitionKey: "retired-belt" },
    });
    renderView();
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.queryByRole("form", { name: "Assign next level" })).toBeNull();
    expect(
      screen.getByText(
        "The level on record is not in the current catalogue, so no assignment can be checked here.",
      ),
    ).toBeInTheDocument();
  });
});

describe("ManageView void", () => {
  it("voids the latest promotion with a mandatory reason", async () => {
    api.voidPromotion.mockResolvedValue({
      voidId: "void_x",
      voidsPromotionId: promotion.entryId,
      restoredDefinitionKey: "grey-belt",
    });
    renderView("headCoach");
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Void the promotion of Synthetic Member to WHITE BELT?",
    });
    expect(dialog).toHaveTextContent(
      "The previous level is restored. The promotion stays in the history, marked as voided.",
    );
    const confirm = within(dialog).getByRole("button", { name: "Void promotion" });
    expect(confirm).toBeDisabled();
    const reason = within(dialog).getByLabelText("Reason (required, 10 to 500 characters)");
    fireEvent.change(reason, { target: { value: "wrong" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Assigned to the wrong member." } });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(api.voidPromotion).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(api.voidPromotion).toHaveBeenCalledWith({
        studentId: "student-1",
        promotionId: promotion.entryId,
        reason: "Assigned to the wrong member.",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe("Promotion voided.");
  });

  it("states the refusal without guessing which of its causes fired", async () => {
    api.voidPromotion.mockRejectedValue(new Error(api.levelsSafeErrors.void));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Assigned to the wrong member." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void promotion" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Unable to void the promotion. Please try again.");
    for (const guess of ["latest", "already", "restore", "no such", "not found"]) {
      expect(alert.textContent!.toLowerCase()).not.toContain(guess);
    }
  });

  it("never repeats a rejection this view did not recognise, cause and all", async () => {
    api.voidPromotion.mockRejectedValue(
      new Error("promotion grad_secret_doc is not the latest for uid=abc123"),
    );
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Assigned to the wrong member." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void promotion" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Unable to void the promotion. Please try again.",
    );
    expect(document.body.textContent).not.toContain("grad_secret_doc");
    expect(document.body.textContent).not.toContain("uid=abc123");
  });

  it("closes on Cancel without calling anything", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.voidPromotion).not.toHaveBeenCalled();
  });
});

describe("ManageView roles", () => {
  it("gives an administrator the record and the history but no decision", async () => {
    renderView("administrator");
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.queryByRole("form", { name: "Assign next level" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Open level" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    expect(
      screen.getByText("Only a head coach or the owner can open, assign or void a level."),
    ).toBeInTheDocument();
  });

  it("gives a coach the same read-only view", async () => {
    renderView("coach");
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.queryByRole("form", { name: "Assign next level" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    expect(
      screen.getByText("Only a head coach or the owner can open, assign or void a level."),
    ).toBeInTheDocument();
  });

  it("tells an administrator who must open a level that has never been opened", async () => {
    api.getStudentLevelCard.mockResolvedValue({ state: "uninitialized", studentId: "student-1" });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    });
    renderView("administrator");
    expect(
      await screen.findByText("No level yet. A head coach or the owner opens it."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Open level" })).toBeNull();
  });
});

describe("ManageView open level", () => {
  beforeEach(() => {
    api.getStudentLevelCard.mockResolvedValue({ state: "uninitialized", studentId: "student-1" });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    });
  });

  it("opens a level at a start date with notes, once", async () => {
    api.openStudentLevel.mockResolvedValue({});
    renderView();
    const form = await screen.findByRole("form", { name: "Open level" });
    fireEvent.change(within(form).getByLabelText("Level"), { target: { value: firstStripe } });
    fireEvent.change(within(form).getByLabelText("Start date"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(within(form).getByLabelText("Notes"), {
      target: { value: "Holds this stripe from Regyfit." },
    });
    expect(within(form).getByLabelText("Start date")).toHaveAttribute("max", today);
    const submit = within(form).getByRole("button", { name: "Open level" });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    await waitFor(() =>
      expect(api.openStudentLevel).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: firstStripe,
        startedOn: "2026-07-01",
        decisionNotes: "Holds this stripe from Regyfit.",
      }),
    );
    expect(api.openStudentLevel).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toBe("Level opened.");
  });

  it("asks for all three fields before calling anything", async () => {
    renderView();
    const form = await screen.findByRole("form", { name: "Open level" });
    fireEvent.click(within(form).getByRole("button", { name: "Open level" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "Choose a level, a start date and write a short note.",
    );
    expect(api.openStudentLevel).not.toHaveBeenCalled();

    // A refused form is not "in flight": the operator corrects it and sends it.
    api.openStudentLevel.mockResolvedValue({});
    fireEvent.change(within(form).getByLabelText("Level"), { target: { value: firstStripe } });
    fireEvent.change(within(form).getByLabelText("Start date"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(within(form).getByLabelText("Notes"), {
      target: { value: "Holds this stripe from Regyfit." },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Open level" }));
    await waitFor(() => expect(api.openStudentLevel).toHaveBeenCalledTimes(1));
  });

  it("states a refusal in this view's own words", async () => {
    api.openStudentLevel.mockRejectedValue(new Error("uid=abc123 leaked"));
    renderView();
    const form = await screen.findByRole("form", { name: "Open level" });
    fireEvent.change(within(form).getByLabelText("Level"), { target: { value: firstStripe } });
    fireEvent.change(within(form).getByLabelText("Start date"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(within(form).getByLabelText("Notes"), {
      target: { value: "Holds this stripe from Regyfit." },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Open level" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "Unable to open the level. Please try again.",
    );
    expect(document.body.textContent).not.toContain("uid=abc123");
  });
});

describe("ManageView frame", () => {
  it("names the member once, links back to the record and never shows the id", async () => {
    renderView();
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.getByRole("heading", { level: 2, name: "Synthetic Member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to record" })).toHaveAttribute(
      "href",
      "/admin/members/profile?id=student-1",
    );
    expect(screen.getByText(/^30 years old/u)).toBeInTheDocument();
    expect(screen.queryByText(/student-1/u)).toBeNull();
  });

  it("says the age is unknown rather than inventing one", async () => {
    renderView("owner", null);
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.getByText(/^Age unknown/u)).toBeInTheDocument();
  });
});
