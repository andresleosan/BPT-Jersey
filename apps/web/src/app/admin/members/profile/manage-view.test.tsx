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
  recordSkillRatings: vi.fn(),
  levelsSafeErrors: Object.freeze({
    card: "Levels are unavailable right now. Please try again later.",
    history: "Unable to load the level history. Please try again.",
    assignInput: "Unable to assign the level. Check the date and the note, then try again.",
    assign: "Unable to assign the level. Please try again later.",
    void: "Unable to void the promotion. Please try again.",
    open: "Unable to open the student level. Please try again.",
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

const ratingsDirty = vi.fn();

function renderView(role = "owner", age: number | null = 30) {
  return render(
    <ManageView
      age={age}
      fullName="Synthetic Member"
      onRatingsDirtyChange={ratingsDirty}
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
  api.recordSkillRatings.mockReset();
  ratingsDirty.mockReset();
  api.getLevelCatalog.mockResolvedValue(catalog);
  api.getStudentLevelCard.mockResolvedValue(card);
  api.getStudentLevelHistory.mockResolvedValue({
    studentId: "student-1",
    currentDefinitionKey: whiteBelt,
    lastApprovedPromotionId: promotion.entryId,
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
    // An opening is not a promotion: it is offered neither the action nor the instruction, which
    // would be a step towards something the server refuses under every one of its four causes.
    expect(rows[2]).not.toHaveTextContent("Void the most recently recorded promotion first");
  });

  it("offers the one recoverable step on an older promotion instead of explaining a refusal", async () => {
    const later = { ...promotion, entryId: "grad_later", definitionKey: firstStripe };
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: firstStripe,
      lastApprovedPromotionId: later.entryId,
      entries: [later, promotion, opening],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("button", { name: "Void" })).toBeNull();
    expect(rows[2]).toHaveTextContent("Void the most recently recorded promotion first");
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
      lastApprovedPromotionId: null,
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
    expect(table).not.toHaveTextContent("Void the most recently recorded promotion first");
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
      lastApprovedPromotionId: promotion.entryId,
      entries: [later, promotion, opening],
    });
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).queryByRole("button", { name: "Void" })).toBeNull();
    expect(within(rows[2]!).getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Current");
  });

  /**
   * T051V2 review of Task 16 (Critical-1). The promotion RECORDED last — the only one
   * `voidPromotion` accepts — is not always the newest row by `assignedOn`: two promotions can
   * share a day, where the history's sort comparator is inconsistent and orders them arbitrarily,
   * and Plan D's Regyfit import writes promotions straight in with whatever dates the source
   * carries. The view used to pick the newest by date, which put the Void button on a row the
   * server refuses and told the row labelled "Current" to void something else first.
   */
  it("offers Void on the promotion the head recorded last, not the newest one by date", async () => {
    const backdated = {
      ...promotion,
      entryId: "grad_recorded_last",
      definitionKey: firstStripe,
      assignedOn: dayBack(40),
    };
    const newerByDate = { ...promotion, entryId: "grad_newer_by_date", assignedOn: dayBack(5) };
    api.voidPromotion.mockResolvedValue({
      voidId: "void_x",
      voidsPromotionId: backdated.entryId,
      restoredDefinitionKey: whiteBelt,
    });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: firstStripe,
      lastApprovedPromotionId: backdated.entryId,
      entries: [newerByDate, backdated, opening],
    });
    renderView("headCoach");
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    // Newest by date, and NOT the one the server would accept.
    expect(rows[1]).toHaveTextContent(uiDay(dayBack(5)));
    expect(within(rows[1]!).queryByRole("button", { name: "Void" })).toBeNull();
    expect(rows[1]).toHaveTextContent("Void the most recently recorded promotion first");
    // The row the head names is both "Current" and the one that carries the action.
    expect(rows[2]).toHaveTextContent("Current");
    expect(rows[2]).not.toHaveTextContent("Void the most recently recorded promotion first");
    fireEvent.click(within(rows[2]!).getByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Assigned to the wrong member." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void promotion" }));
    await waitFor(() =>
      expect(api.voidPromotion).toHaveBeenCalledWith({
        studentId: "student-1",
        promotionId: backdated.entryId,
        reason: "Assigned to the wrong member.",
      }),
    );
  });

  it("never offers Void on an opening, whatever the head names", async () => {
    // The server refuses a void of an opening under every one of its four causes, so an affordance
    // on that row could only ever end in the opaque refusal.
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: "grey-belt",
      lastApprovedPromotionId: opening.entryId,
      entries: [opening],
    });
    renderView("headCoach");
    const table = await screen.findByRole("table", { name: "Level history" });
    expect(within(table).queryByRole("button", { name: "Void" })).toBeNull();
    expect(table).not.toHaveTextContent("Void the most recently recorded promotion first");
  });

  it("says nothing about voiding when the head names no promotion at all", async () => {
    // An unactionable instruction on every row is the self-contradiction Critical-1 describes.
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: whiteBelt,
      lastApprovedPromotionId: null,
      entries: [promotion, opening],
    });
    renderView("headCoach");
    const table = await screen.findByRole("table", { name: "Level history" });
    expect(within(table).queryByRole("button", { name: "Void" })).toBeNull();
    expect(table).not.toHaveTextContent("Void the most recently recorded promotion first");
  });

  /**
   * T051V2 review of Task 16 (Critical-2). `currentDefinitionKey` is nullable. When it is null the
   * view used to call every standing promotion "Previous" — telling the operator that the belt the
   * member holds is a former belt — and still offered Void on it.
   */
  it("claims neither Current nor Previous when no level is on record", async () => {
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: null,
      lastApprovedPromotionId: promotion.entryId,
      entries: [promotion, opening],
    });
    renderView("headCoach");
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    for (const row of [rows[1]!, rows[2]!]) {
      expect(row).not.toHaveTextContent("Previous");
      expect(row).not.toHaveTextContent("Current");
      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    }
  });

  it("keeps a row whose stored day cannot be read, instead of taking the record down", async () => {
    // The client's schema refuses a day that is not a real calendar date, so this state should
    // never arrive; the guard is the second line, and without it `Intl.format` throws on an
    // invalid date and takes the whole member record down over one bad row.
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: whiteBelt,
      lastApprovedPromotionId: promotion.entryId,
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
      lastApprovedPromotionId: promotion.entryId,
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
      lastApprovedPromotionId: null,
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

  /**
   * T051V2 re-review of Task 16 (m2). The refusal was rendered and read by a sighted operator, but
   * nothing tied it to the control it is about: with `aria-describedby` deleted the whole suite
   * stayed green and a screen-reader user heard the label and no reason. The tie is asserted
   * through the accessible description, which is what assistive technology actually resolves.
   */
  it("names the note's refusal as the textarea's own description", async () => {
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: firstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    const note = within(dialog).getByLabelText("Note (required, 10 to 500 characters)");
    expect(note).toHaveAccessibleDescription("");
    // Nine characters: typed, and shorter than the contract's minimum of ten.
    fireEvent.change(note, { target: { value: "too short" } });
    expect(within(dialog).getByText(api.levelsSafeErrors.assignInput)).toHaveAttribute(
      "id",
      "ibjjf-assign-note-problem",
    );
    expect(note).toHaveAccessibleDescription(api.levelsSafeErrors.assignInput);
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

  /**
   * T051V2 review of Task 16 (Critical-3). `reload` used to bump the attempt only, so the view
   * kept the pre-write snapshot for the whole refetch while the in-flight flag was cleared the
   * moment the write resolved — two operator clicks, two identical `assignLevel` calls, and
   * "Level assigned." announced beside a history table without the promotion in it.
   */
  it("sends one assignment even when the operator clicks again before the reload lands", async () => {
    api.assignLevel.mockResolvedValue({
      promotionId: "grad_new",
      toDefinitionKey: firstStripe,
      promotedOn: today,
      gaps: [],
    });
    const loaded = {
      studentId: "student-1",
      currentDefinitionKey: whiteBelt,
      lastApprovedPromotionId: promotion.entryId,
      entries: [promotion, opening],
    };
    let releaseHistory = (): void => {};
    api.getStudentLevelHistory.mockResolvedValueOnce(loaded).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseHistory = () => resolve(loaded);
        }),
    );
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), { target: { value: firstStripe } });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Ready on every count but the clock." },
    });
    const confirm = within(dialog).getByRole("button", { name: "Confirm promotion" });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.assignLevel).toHaveBeenCalledTimes(1));
    // The refetch is in flight and held open below.
    await waitFor(() => expect(api.getStudentLevelHistory).toHaveBeenCalledTimes(2));

    // The write has resolved and the reload has NOT: nothing stale is left to act on.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("form", { name: "Assign next level" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Level history" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Level assigned.");
    fireEvent.click(confirm);
    expect(api.assignLevel).toHaveBeenCalledTimes(1);

    releaseHistory();
    await screen.findByRole("table", { name: "Level history" });
    expect(api.assignLevel).toHaveBeenCalledTimes(1);
  });

  /**
   * T051V2 review of Task 16 (Major-1). `promotionNoteSchema` normalises CRLF before measuring and
   * refuses every C0 control character and DEL. A 12-character note carrying BEL and NUL used to
   * leave Confirm enabled and was refused by the server with a string that points at nothing.
   */
  it("refuses a note the contract refuses, and says which refusal it is", async () => {
    const invisible = `ok${String.fromCharCode(7)}note${String.fromCharCode(0)}here`;
    expect(invisible.trim().length).toBe(12);
    renderView();
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), { target: { value: firstStripe } });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    const note = within(dialog).getByLabelText("Note (required, 10 to 500 characters)");
    fireEvent.change(note, { target: { value: invisible } });
    expect(within(dialog).getByRole("button", { name: "Confirm promotion" })).toBeDisabled();
    expect(dialog).toHaveTextContent(
      "Unable to assign the level. Check the date and the note, then try again.",
    );
    expect(api.assignLevel).not.toHaveBeenCalled();
    // A carriage return is normalised, not refused: the same note with CRLF line breaks passes.
    fireEvent.change(note, { target: { value: `Competition${String.fromCharCode(13)}result.` } });
    expect(within(dialog).getByRole("button", { name: "Confirm promotion" })).toBeEnabled();
  });

  it("pins the optional note to the same 10-character floor", async () => {
    // An optional note of 1-9 characters is not "no note": the schema refuses it, and sending it
    // for the server to refuse generically is the round trip this check exists to avoid.
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
    fireEvent.change(within(form).getByLabelText("Next level"), { target: { value: firstStripe } });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm promotion" });
    expect(confirm).toBeEnabled();
    const note = within(dialog).getByLabelText("Note (optional, 10 to 500 characters)");
    fireEvent.change(note, { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    expect(dialog).toHaveTextContent(
      "Unable to assign the level. Check the date and the note, then try again.",
    );
    fireEvent.change(note, { target: { value: "" } });
    expect(confirm).toBeEnabled();
    expect(dialog).not.toHaveTextContent("Check the date and the note");
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
      lastApprovedPromotionId: promotion.entryId,
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
      lastApprovedPromotionId: promotion.entryId,
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
    expect(dialog).toHaveTextContent(
      "All criteria BPT records for this level are met as of today.",
    );
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
      `Classes and the age band are counted as of today, not as of ${uiDay(dayBack(3))}. The final check runs when the promotion is recorded.`,
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
      lastApprovedPromotionId: promotion.entryId,
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

  /**
   * T051V2 review of Task 16 (Major-4, mutants M21-M23). No keyboard or focus behaviour of this
   * dialog had a test. It is now opened with `showModal()`, which is what gives it the focus trap,
   * the inert background, the backdrop and native Escape in a browser. jsdom 30 implements neither
   * `showModal` nor `close`, so THESE tests exercise the fallback path — the trap and the native
   * Escape still owe a manual check in front of a real browser, which an axe pass cannot give.
   */
  it("moves focus into the dialog, restores it on close and closes on Escape", async () => {
    renderView("headCoach");
    const open = await screen.findByRole("button", { name: "Void" });
    open.focus();
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("textarea"));

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.voidPromotion).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Void" }));
  });

  it("restores focus to the button that opened it when it is cancelled", async () => {
    renderView("headCoach");
    const open = await screen.findByRole("button", { name: "Void" });
    open.focus();
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Void" }));
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
      lastApprovedPromotionId: null,
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
      lastApprovedPromotionId: null,
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
      "Unable to open the student level. Please try again.",
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

describe("ManageView skills assessment", () => {
  /** The 4-5/5-7 kids ladder is the only one that carries skill minimums (11 per level). */
  function kidsRecord(latest: Record<string, number> = {}, targetKey = kidsFirstStripe) {
    api.getStudentSkillScores.mockResolvedValue({ latest, best: {} });
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      currentDefinition: { definitionKey: kidsBelt },
      targetDefinition: { definitionKey: targetKey },
    });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: kidsBelt,
      lastApprovedPromotionId: promotion.entryId,
      entries: [{ ...promotion, definitionKey: kidsBelt }],
    });
  }

  const skillGroup = (name: RegExp) => screen.getByRole("group", { name });

  it("marks the minimums of the level being moved INTO, not the one held", async () => {
    kidsRecord();
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    expect(within(skillGroup(/^Tie The Belt/u)).getByText("Minimum 2")).toBeInTheDocument();
    expect(within(skillGroup(/^Warm Up 2 - Bridges/u)).getByText("Minimum 3")).toBeInTheDocument();
    cleanup();
    // The same held level, whose own 11 requirements are still in the catalogue, moving into an
    // adult stripe that carries none: nothing may be claimed as a minimum, and since OPERATOR
    // DECISION 9 nothing is listed either - a skill the next level does not require does not
    // count towards it.
    kidsRecord({}, firstStripe);
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    expect(screen.queryByText(/Minimum \d/u)).toBeNull();
    expect(screen.getByText("This level requires no rated skills.")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  /**
   * OPERATOR DECISION 9, through the view that owns the requirement set. The shipped catalogue has
   * exactly one requirement set (11 skills on 15 of 171 levels), so the only way to tell "the
   * target's requirements" from "the whole catalogue" is a target that requires a subset: this
   * trims the next level's requirements to two of the eleven.
   */
  it("rates only what the next level requires, and says the other ratings are untouched", async () => {
    const kept = ["tie-the-belt", "warm-up-2-bridges"];
    api.getLevelCatalog.mockResolvedValue({
      ...catalog,
      requirements: catalog.requirements.filter(
        (requirement) =>
          requirement.definitionKey !== kidsFirstStripe || kept.includes(requirement.skillKey),
      ),
    });
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    kidsRecord({ "warm-up-1-technical-stand-up": 3 });
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    // Two skills, five radios each: the other nine of the eleven are not on screen.
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    expect(skillGroup(/^Tie The Belt/u)).toBeInTheDocument();
    expect(skillGroup(/^Warm Up 2 - Bridges/u)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Technical Stand Up/u })).toBeNull();
    // The rating that is no longer on screen is neither lost nor hidden without a word.
    expect(
      screen.getByText("A rating for 1 other skill is on record. Nothing here changes it."),
    ).toBeInTheDocument();
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Save ratings" }));
    await waitFor(() =>
      expect(api.recordSkillRatings).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: kidsBelt,
        ratings: [{ skillKey: "tie-the-belt", score: 5 }],
      }),
    );
  });

  /** Case 3: the top of what BPT tracks. There is no target, so no requirement set exists to rate. */
  it("says why there is nothing to rate at the highest level BPT tracks", async () => {
    api.getStudentLevelCard.mockResolvedValue({
      ...card,
      currentDefinition: { definitionKey: topLevel.definitionKey },
      targetDefinition: null,
      progressPercent: null,
    });
    renderView("headCoach");
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    expect(
      screen.getByText("This is the highest level BPT tracks, so there are no skills to rate."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("shows the rating already on record and records against the level held", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    kidsRecord({ "tie-the-belt": 4 });
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    const tie = skillGroup(/^Tie The Belt/u);
    expect(within(tie).getByRole("radio", { name: "4" })).toBeChecked();
    fireEvent.click(within(tie).getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Save ratings" }));
    await waitFor(() =>
      expect(api.recordSkillRatings).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: kidsBelt,
        ratings: [{ skillKey: "tie-the-belt", score: 5 }],
      }),
    );
    expect(await screen.findByText("Ratings saved.")).toBeInTheDocument();
    // Task 17 review, Major-1: this used to expect a SECOND read of the ratings. The save no
    // longer reloads the view, so the one read this view made on open is still the only one, and
    // the panel that the operator is looking at is the one they were typing into.
    expect(api.getStudentSkillScores).toHaveBeenCalledTimes(1);
    expect(within(tie).getByRole("radio", { name: "5" })).toBeChecked();
    expect(screen.queryByText("You have unsaved ratings.")).toBeNull();
  });

  it("lets a coach rate a member they may not decide on", async () => {
    kidsRecord();
    renderView("coach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    expect(screen.queryByRole("form", { name: "Assign next level" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("offers no assessment for a member with no level open", async () => {
    api.getStudentLevelCard.mockResolvedValue({ state: "uninitialized", studentId: "student-1" });
    renderView("headCoach");
    await screen.findByRole("form", { name: "Open level" });
    expect(screen.queryByRole("heading", { level: 3, name: "Skills assessment" })).toBeNull();
  });

  it("asks before a full navigation discards unsaved ratings", async () => {
    kidsRecord();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    const back = screen.getByRole("link", { name: "Back to record" });
    expect(fireEvent.click(back)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    await screen.findByText("You have unsaved ratings.");
    expect(fireEvent.click(back)).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?");
    confirm.mockReturnValue(true);
    expect(fireEvent.click(back)).toBe(true);
  });
  /**
   * Task 17 review, Major-1. Before the fix this exact scenario PASSED with the opposite
   * assertions: the save called `reload`, the panel was remounted on a refetch that predated the
   * second click, and "Ratings saved." was shown over a rating that no longer existed.
   */
  it("keeps a rating made while the save was in flight, and announces the save", async () => {
    kidsRecord({ "tie-the-belt": 1 });
    let release: (value: unknown) => void = () => {};
    api.recordSkillRatings.mockReturnValue(new Promise((done) => (release = done)));
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Save ratings" }));
    await waitFor(() => expect(api.recordSkillRatings).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Saving ratings" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    // A SECOND skill rated while the first write is still in flight.
    fireEvent.click(within(skillGroup(/^Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" }));
    await act(async () => {
      release({ studentId: "student-1", recorded: 1 });
      await Promise.resolve();
    });
    expect(await screen.findByText("Ratings saved.")).toBeInTheDocument();
    // The in-flight edit survives, is still reported as unsaved, and only the SENT one settled.
    expect(
      within(skillGroup(/^Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" }),
    ).toBeChecked();
    expect(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" })).toBeChecked();
    expect(screen.getByText("You have unsaved ratings.")).toBeInTheDocument();
    expect(ratingsDirty).toHaveBeenLastCalledWith(true);
    // No refetch: the panel was never thrown away, so there was nothing to rebuild it from.
    expect(api.getStudentSkillScores).toHaveBeenCalledTimes(1);

    // And the view's own copy of the ratings moved by what was SENT, not by what is on screen:
    // the promotion dialog counts ONE skill at its minimum, not the in-flight second one.
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: kidsFirstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Skills 1/11 at minimum not met")).toBeInTheDocument();
  });

  /**
   * The saved rating must reach the promotion dialog too, which is the one consumer of
   * `scores.latest` outside the panel. Without the in-place update it would still read the
   * pre-save map, because there is no longer a refetch to correct it.
   */
  it("carries a saved rating into the promotion dialog without a refetch", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    kidsRecord();
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    const counters = () => screen.getAllByText(/saved at minimum/u).map((node) => node.textContent);
    // "Tie The Belt" is the only skill in its category, so its counter is the first of the two.
    expect(counters()).toEqual([
      "0/1 rated \u00b7 0/1 saved at minimum",
      "0/10 rated \u00b7 0/10 saved at minimum",
    ]);
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    // Minor-3: the counter speaks for the STORE, so an unsaved click does not move it.
    expect(counters()[0]).toBe("1/1 rated \u00b7 0/1 saved at minimum");
    fireEvent.click(screen.getByRole("button", { name: "Save ratings" }));
    await screen.findByText("Ratings saved.");
    expect(counters()[0]).toBe("1/1 rated \u00b7 1/1 saved at minimum");

    // The same saved rating, read by the promotion dialog: 1 of 11, not 0 and not 2.
    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: kidsFirstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Skills 1/11 at minimum not met")).toBeInTheDocument();
    expect(api.getStudentSkillScores).toHaveBeenCalledTimes(1);
  });

  it("names the level the ratings are filed against", async () => {
    kidsRecord();
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    expect(
      screen.getByText(
        "Ratings are recorded against WHITE BELT KIDS 4-5 and 5-7 YO, the level currently held.",
      ),
    ).toBeInTheDocument();
  });

  it("offers no assessment to an administrator", async () => {
    kidsRecord();
    renderView("administrator", 6);
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.queryByRole("heading", { level: 3, name: "Skills assessment" })).toBeNull();
  });

  /**
   * Task 17 review, Major-2, exit 4. This replaces "stops asking about ratings a reload has
   * already thrown away", whose contract was that a void silently threw the ratings away and the
   * record anchor then had nothing to ask about. The ratings are still thrown away - a void
   * really does replace what is on record - but the operator is now asked BEFORE the write, not
   * left to find out afterwards.
   */
  it("asks before a void throws unsaved ratings away, and stops asking once they are gone", async () => {
    kidsRecord();
    api.voidPromotion.mockResolvedValue({ voidsPromotionId: promotion.entryId });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    await screen.findByText("You have unsaved ratings.");

    fireEvent.click(screen.getAllByRole("button", { name: "Void" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Reason/u), {
      target: { value: "Recorded against the wrong member." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void promotion" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?");
    // Refused: nothing was written and the ratings are still there.
    expect(api.voidPromotion).not.toHaveBeenCalled();
    expect(screen.getByText("You have unsaved ratings.")).toBeInTheDocument();

    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Void promotion" }));
    await screen.findByText("Promotion voided.");
    // The reload really did throw them away, so nothing is left to ask about.
    expect(ratingsDirty).toHaveBeenLastCalledWith(false);
    confirm.mockClear();
    expect(fireEvent.click(screen.getByRole("link", { name: "Back to record" }))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  /** Task 17 review, Major-2, exit 4: the same reload, reached through an assignment. */
  it("asks before an assignment throws unsaved ratings away", async () => {
    kidsRecord();
    api.assignLevel.mockResolvedValue({ promotionId: "p1" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    await screen.findByText("You have unsaved ratings.");

    const form = await assignForm();
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: kidsFirstStripe },
    });
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Note/u), {
      target: { value: "Promoted at the grading, minimums checked in person." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm promotion" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved ratings?");
    expect(api.assignLevel).not.toHaveBeenCalled();
    expect(screen.getByText("You have unsaved ratings.")).toBeInTheDocument();
  });

  it("stops guarding ratings once the view itself is gone", async () => {
    kidsRecord();
    const view = renderView("headCoach", 6);
    await screen.findByRole("heading", { level: 3, name: "Skills assessment" });
    fireEvent.click(within(skillGroup(/^Tie The Belt/u)).getByRole("radio", { name: "5" }));
    await screen.findByText("You have unsaved ratings.");
    expect(ratingsDirty).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(ratingsDirty).toHaveBeenLastCalledWith(false);
  });
});
