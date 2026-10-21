import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";

const levelsApi = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentLevelCard: vi.fn(),
  levelsSafeErrors: Object.freeze({
    card: "Levels are unavailable right now. Please try again later.",
  }),
}));
vi.mock("../../../../lib/levels-client", () => levelsApi);

import { IbjjfCard, formatCriterion } from "./ibjjf-card";

const manageHref = "/admin/members/profile?id=student-1&view=manage";
const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("catalogue must parse");
const catalog = { ...parsed.value, sourceHash: "test" };

const initialized = {
  state: "initialized",
  studentId: "student-1",
  currentDefinition: { definitionKey: "white-belt" },
  targetDefinition: { definitionKey: "white-1st-stripe" },
  currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
  progressPercent: 44,
  criteria: {
    classes: { required: 20, completed: 12, imported: 9, met: false },
    time: { requiredDays: 60, elapsedDays: 60, met: true },
  },
} as const;

function card(overrides: Record<string, unknown> = {}) {
  return { ...initialized, ...overrides };
}

afterEach(cleanup);

beforeEach(() => {
  levelsApi.getLevelCatalog.mockReset();
  levelsApi.getLevelCatalog.mockResolvedValue(catalog);
  levelsApi.getStudentLevelCard.mockReset();
});

describe("formatCriterion", () => {
  it("omits the minimum when the level defines none", () => {
    expect(formatCriterion(12, 25)).toBe("12/25");
    expect(formatCriterion(12, null)).toBe("12");
    expect(formatCriterion(0, 0)).toBe("0/0");
  });
});

describe("IbjjfCard", () => {
  it("renders the belt, one progress value and both criteria with met state as text", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(initialized);
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).getByRole("img", { name: "WHITE BELT belt" })).toBeInTheDocument();
    expect(within(region).getByRole("heading", { name: "WHITE BELT" })).toBeInTheDocument();
    expect(within(region).getByText("Promoted on 1 Jul 2026")).toBeInTheDocument();
    expect(within(region).getByRole("progressbar", { name: "Overall progress" })).toHaveAttribute(
      "value",
      "44",
    );
    expect(within(region).getByText("44%")).toBeInTheDocument();
    const classes = within(region).getByText("Classes since last promotion").closest("div")!;
    expect(classes).toHaveClass("ibjjf-unmet");
    expect(within(classes).getByText("12/20")).toBeInTheDocument();
    expect(within(classes).getByText("Not met")).toBeInTheDocument();
    expect(within(classes).getByText("9 imported + 3 in BPT")).toBeInTheDocument();
    const days = within(region).getByText("Days at this level").closest("div")!;
    expect(days).toHaveClass("ibjjf-met");
    expect(within(days).getByText("60/60")).toBeInTheDocument();
    expect(within(days).getByText("Met")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Manage" })).toHaveAttribute(
      "href",
      manageHref,
    );
    expect(levelsApi.getStudentLevelCard).toHaveBeenCalledTimes(1);
    expect(levelsApi.getStudentLevelCard).toHaveBeenCalledWith("student-1");
  });

  it("names the stripe but draws its parent belt's bar with the stripe marks", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({ currentDefinition: { definitionKey: "white-1st-stripe" } }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).getByRole("heading", { name: "White - 1st Stripe" })).toBeInTheDocument();
    const bar = within(region).getByRole("img", { name: "WHITE BELT belt" });
    expect(bar.querySelectorAll(".belt-tip i")).toHaveLength(1);
  });

  it("says the level is the highest BPT tracks, and only when there is no target level", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({ targetDefinition: null, progressPercent: null }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(
      within(region).getByText(
        "This is the highest level BPT tracks, so there is no next graduation to measure.",
      ),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(region).queryByText("0%")).not.toBeInTheDocument();
    expect(within(region).queryByText("Overall progress")).not.toBeInTheDocument();
    expect(region.textContent).not.toMatch(/Graduation review/u);
  });

  // The schema makes `targetDefinition` and `progressPercent` independently nullable. A payload
  // that names the next stripe must never be described as the top of what BPT tracks.
  it("makes no claim at all when a target level is present but the percentage is null", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(card({ progressPercent: null }));
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      within(region).getByText("Progress is not available for this level."),
    ).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/highest level/iu);
    expect(within(region).queryByText("Overall progress")).not.toBeInTheDocument();
  });

  // 2026-10-20 diagnosis: 4/4 classes (3 imported + 1 at BPT) and 42/30 days read as "ready" next
  // to 66%, which the skills nobody had rated were holding down, and review needs a later class.
  it("tells overall progress apart from the graduation review and names unmet skills", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({
        progressPercent: 66,
        criteria: {
          classes: { required: 4, completed: 4, imported: 3, met: true },
          time: { requiredDays: 30, elapsedDays: 42, met: true },
          skills: { total: 11, completed: 0, met: false },
        },
      }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    const bar = within(region).getByRole("progressbar", { name: "Overall progress" });
    expect(bar).toHaveAttribute("value", "66");
    expect(bar).toHaveAccessibleDescription(
      "Average of classes, days and skills. It is not the graduation review.",
    );
    const classes = within(region).getByText("Classes since last promotion").closest("div")!;
    expect(classes).toHaveClass("ibjjf-met");
    expect(within(classes).getByText("3 imported + 1 in BPT")).toBeInTheDocument();
    const skills = within(region).getByText("Skills at minimum rating").closest("div")!;
    expect(skills).toHaveClass("ibjjf-unmet");
    expect(within(skills).getByText("0/11")).toBeInTheDocument();
    expect(within(skills).getByText("Not met")).toBeInTheDocument();
    expect(region.textContent).toMatch(
      /Graduation review counts classes and days only\..*Imported and office-added classes count towards the minimum but cannot open it\./su,
    );
  });

  it("adds no skills row when the next level asks for no skill", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({
        criteria: { ...initialized.criteria, skills: { total: 0, completed: 0, met: true } },
      }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).getByText("12/20")).toBeInTheDocument();
    expect(within(region).queryByText("Skills at minimum rating")).not.toBeInTheDocument();
  });

  it("renders the heading fallback when the stored level is not in the current catalogue", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({ currentDefinition: { definitionKey: "retired-level-key" } }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(
      within(region).getByRole("heading", { name: "Level not in the current catalogue" }),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("img")).not.toBeInTheDocument();
  });

  it("says nothing about Regyfit when no classes were imported", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({
        criteria: {
          ...initialized.criteria,
          classes: { ...initialized.criteria.classes, imported: 0 },
        },
      }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).getByText("12/20")).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/Regyfit/u);
  });

  it("says nothing about Regyfit rather than a negative BPT count when the counts disagree", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({
        criteria: {
          ...initialized.criteria,
          classes: { required: 25, completed: 3, imported: 9, met: false },
        },
      }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).getByText("3/25")).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/Regyfit/u);
    expect(region.textContent).not.toMatch(/-6/u);
  });

  it("shows a bare count when the level defines no minimum", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({
        criteria: {
          classes: { required: null, completed: 12, imported: 0, met: true },
          time: { requiredDays: null, elapsedDays: 80, met: true },
        },
      }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    const classes = within(region).getByText("Classes since last promotion").closest("div")!;
    expect(within(classes).getByText("12")).toBeInTheDocument();
    expect(classes.textContent).not.toMatch(/\//u);
  });

  it("omits the promotion line when the stored start instant is missing or unusable", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(card({ currentLevelStartedAt: null }));
    const { rerender } = render(
      <IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />,
    );
    let region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(region.textContent).not.toMatch(/Promoted on/u);

    levelsApi.getStudentLevelCard.mockResolvedValue(card({ currentLevelStartedAt: "not-a-date" }));
    rerender(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-2" />);
    region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    await waitFor(() =>
      expect(within(region).getByRole("heading", { name: "WHITE BELT" })).toBeInTheDocument(),
    );
    expect(region.textContent).not.toMatch(/Promoted on/u);
  });

  it("shows the empty state with Open level only for deciders", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue({
      state: "uninitialized",
      studentId: "student-1",
    });
    const { rerender } = render(<IbjjfCard canOpenLevel manageHref="/m" studentId="student-1" />);
    expect(await screen.findByRole("heading", { name: "No level yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open level" })).toHaveAttribute("href", "/m");
    rerender(<IbjjfCard canOpenLevel={false} manageHref="/m" studentId="student-1" />);
    expect(screen.queryByRole("link", { name: "Open level" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toBeInTheDocument();
  });

  it("shows a skeleton while loading and a safe retry on failure", async () => {
    levelsApi.getStudentLevelCard.mockRejectedValueOnce(
      new Error("Levels are unavailable right now. Please try again later."),
    );
    render(<IbjjfCard canOpenLevel manageHref="/m" studentId="student-1" />);
    expect(screen.getByRole("region", { name: "JIU-JITSU IBJJF" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Levels are unavailable right now. Please try again later.",
    );
    levelsApi.getStudentLevelCard.mockResolvedValue(initialized);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "WHITE BELT" })).toBeInTheDocument(),
    );
  });

  it("renders one fixed string, never the thrown message, when a rejection carries detail", async () => {
    levelsApi.getStudentLevelCard.mockRejectedValue(
      new Error("PERMISSION_DENIED: /academies/bpt-jersey/students/student-1/levelHeads/current"),
    );
    render(<IbjjfCard canOpenLevel manageHref="/m" studentId="student-1" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Levels are unavailable right now. Please try again later.");
    const region = screen.getByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(region.textContent).not.toMatch(/academies|PERMISSION_DENIED|student-1/u);
  });

  it("does not render a stale card when the member changes while a read is in flight", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    levelsApi.getStudentLevelCard.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({ currentDefinition: { definitionKey: "white-1st-stripe" } }),
    );
    const { rerender } = render(
      <IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />,
    );
    rerender(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-2" />);
    resolveFirst(initialized);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "White - 1st Stripe" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "WHITE BELT" })).not.toBeInTheDocument();
  });

  // The effect blanks the card on every member change. Without that, a ready card for member A
  // stays on screen under member B's name until B's read lands.
  it("blanks a ready card the moment the member changes", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValueOnce(initialized);
    levelsApi.getStudentLevelCard.mockImplementation(() => new Promise(() => {}));
    const { rerender } = render(
      <IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />,
    );
    await screen.findByRole("heading", { name: "WHITE BELT" });
    rerender(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-2" />);
    const region = screen.getByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByRole("status")).toHaveTextContent("Loading the IBJJF level.");
    expect(screen.queryByRole("heading", { name: "WHITE BELT" })).not.toBeInTheDocument();
    expect(region.textContent).not.toMatch(/Promoted on|12\/25|44%/u);
  });

  // A read that fails for the member we already left must not turn the current member's card
  // into "Levels unavailable".
  it("keeps the current member's card when the previous member's read fails late", async () => {
    let rejectFirst: (reason: unknown) => void = () => {};
    levelsApi.getStudentLevelCard.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({ currentDefinition: { definitionKey: "white-1st-stripe" } }),
    );
    const { rerender } = render(
      <IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />,
    );
    rerender(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-2" />);
    await screen.findByRole("heading", { name: "White - 1st Stripe" });

    await act(async () => {
      rejectFirst(new Error("PERMISSION_DENIED for student-1"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "White - 1st Stripe" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
