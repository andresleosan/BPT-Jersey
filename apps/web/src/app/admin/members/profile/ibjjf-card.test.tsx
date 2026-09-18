import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    classes: { required: 25, completed: 12, imported: 9, met: false },
    time: { requiredDays: 75, elapsedDays: 80, met: true },
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
    expect(within(region).getByRole("progressbar", { name: "Next graduation" })).toHaveAttribute(
      "value",
      "44",
    );
    expect(within(region).getByText("44%")).toBeInTheDocument();
    const classes = within(region).getByText("Classes since last promotion").closest("div")!;
    expect(classes).toHaveClass("ibjjf-unmet");
    expect(within(classes).getByText("12/25")).toBeInTheDocument();
    expect(within(classes).getByText("Not met")).toBeInTheDocument();
    expect(within(classes).getByText("9 from Regyfit + 3 in BPT")).toBeInTheDocument();
    const days = within(region).getByText("Days at this level").closest("div")!;
    expect(days).toHaveClass("ibjjf-met");
    expect(within(days).getByText("80/75")).toBeInTheDocument();
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

  it("states the top of the catalogue instead of a progress bar when there is no next level", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(
      card({ targetDefinition: null, progressPercent: null }),
    );
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(
      within(region).getByText(
        "Highest level in the catalogue. There is no next graduation to work towards.",
      ),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(region).queryByText("0%")).not.toBeInTheDocument();
    expect(within(region).queryByText("Next graduation")).not.toBeInTheDocument();
  });

  it("never draws a bar for a null percentage even when a target level is present", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(card({ progressPercent: null }));
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const region = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(region).queryByRole("progressbar")).not.toBeInTheDocument();
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
    expect(within(region).getByText("12/25")).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/Regyfit/u);
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
});
