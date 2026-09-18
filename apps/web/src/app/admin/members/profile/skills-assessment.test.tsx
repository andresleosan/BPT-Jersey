import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `levelsSafeErrors` is mocked with the WHOLE frozen allowlist because `safe-message.ts` checks a
 * rejection against `Object.values(levelsSafeErrors)`: a partial mock would make every safe string
 * but the listed ones unrecognisable and the checks below would pass for the wrong reason.
 */
const api = vi.hoisted(() => ({
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

import { SkillsAssessment } from "./skills-assessment";

const skills = [
  {
    key: "tie-the-belt",
    displayLabel: "Tie The Belt",
    observedLabel: "1. Tie The Belt",
    minimumRating: 2,
    sequence: 1,
  },
  {
    key: "warm-up-1-technical-stand-up",
    displayLabel: "Warm Up 1 - Technical Stand Up",
    observedLabel: null,
    minimumRating: 3,
    sequence: 2,
  },
  {
    key: "warm-up-2-bridges",
    displayLabel: "Warm Up 2 - Bridges",
    observedLabel: null,
    minimumRating: 3,
    sequence: 3,
  },
];

type Props = Parameters<typeof SkillsAssessment>[0];

function propsFor(overrides: Partial<Props> = {}) {
  return {
    studentId: "student-1",
    definitionKey: "white-belt",
    definitionName: "WHITE BELT",
    skills,
    hasTarget: true,
    minimums: {
      "tie-the-belt": 2,
      "warm-up-1-technical-stand-up": 3,
      "warm-up-2-bridges": 3,
    },
    initialScores: { "warm-up-1-technical-stand-up": 4 },
    onDirtyChange: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  } satisfies Props;
}

function renderAssessment(overrides: Partial<Props> = {}) {
  const props = propsFor(overrides);
  render(<SkillsAssessment {...props} />);
  return props;
}

const group = (name: RegExp) => screen.getByRole("group", { name });
const saveButton = () => screen.getByRole("button", { name: "Save ratings" });

/**
 * A block body, not an expression body. `mockReset()` RETURNS the mock, and an arrow that returns
 * a function hands vitest a teardown callback: it then CALLS the mock after every test, with no
 * arguments and nobody awaiting it, so a test whose mock rejects fails on an unhandled rejection
 * that has nothing to do with what it asserts. (The plan's snippet had the expression form.)
 */
beforeEach(() => {
  api.recordSkillRatings.mockReset();
});
afterEach(() => cleanup());

describe("SkillsAssessment", () => {
  it("groups skills by category with rated and minimum counts, collapsed by default", () => {
    renderAssessment();
    const warmUp = screen.getByText("Warm Up").closest("details")!;
    expect(warmUp).not.toHaveAttribute("open");
    expect(within(warmUp).getByText("1/2 rated · 1/2 saved at minimum")).toBeInTheDocument();
    const fundamentals = screen.getByText("Fundamentals").closest("details")!;
    expect(within(fundamentals).getByText("0/1 rated · 0/1 saved at minimum")).toBeInTheDocument();
  });

  it("marks the minimum with text and an outlined option", () => {
    renderAssessment();
    const bridges = group(/Warm Up 2 - Bridges/u);
    expect(within(bridges).getByText("Minimum 3")).toBeInTheDocument();
    expect(within(bridges).getByRole("radio", { name: "3" }).closest("label")).toHaveClass(
      "ibjjf-score-minimum",
    );
    expect(within(bridges).getAllByRole("radio")).toHaveLength(5);
  });

  /**
   * OPERATOR DECISION 9, case 1. Replaces "says nothing about minimums when this level carries
   * none", whose contract was that a skill the next level does not require was still listed and
   * counted. Only the target's requirement set is rateable now, so a skill with no minimum is not
   * on screen at all and no counter includes it.
   */
  it("lists only the skills the next level requires", () => {
    renderAssessment({ minimums: { "warm-up-2-bridges": 3 } });
    expect(screen.getByRole("group", { name: /Warm Up 2 - Bridges/u })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Tie The Belt/u })).toBeNull();
    expect(screen.queryByRole("group", { name: /Technical Stand Up/u })).toBeNull();
    expect(screen.queryByText("Fundamentals")).toBeNull();
    expect(screen.getByText("Warm Up").closest("details")!.textContent).toContain(
      "0/1 rated · 0/1 saved at minimum",
    );
  });

  /** Case 2: the common one today - 156 of 171 levels carry no requirement at all. */
  it("states plainly that a next level with no requirements has nothing to rate", () => {
    renderAssessment({ minimums: {} });
    expect(screen.getByText("This level requires no rated skills.")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save ratings" })).toBeNull();
    expect(screen.queryByText(/Rate each skill from 1 to 5/u)).toBeNull();
    expect(screen.queryByText(/the level currently held/u)).toBeNull();
  });

  /**
   * Case 3: no target at all. The minimums map is empty for the same reason as case 2, but the
   * cause is different and the card on the same member's screen already says which: it is the top
   * of what BPT tracks. The vocabulary is OPERATOR DECISION 7's, deliberately not "the catalogue".
   */
  it("says why there is nothing to rate when there is no next level", () => {
    renderAssessment({ hasTarget: false, minimums: {} });
    expect(
      screen.getByText("This is the highest level BPT tracks, so there are no skills to rate."),
    ).toBeInTheDocument();
    expect(screen.queryByText("This level requires no rated skills.")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  /**
   * Case 4: a rating on record for a skill the next level does not require. It is neither sent nor
   * overwritten - `changed` is built from the listed skills - but "not shown" must not read as
   * "lost", so the panel says the ratings are there and untouched.
   */
  it("says that ratings outside the requirement set are on record and untouched", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    renderAssessment({
      initialScores: { "tie-the-belt": 5, "warm-up-1-technical-stand-up": 4 },
      minimums: { "warm-up-2-bridges": 3 },
    });
    expect(
      screen.getByText("Ratings for 2 other skills are on record. Nothing here changes them."),
    ).toBeInTheDocument();
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "5" }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.recordSkillRatings).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: "white-belt",
        ratings: [{ skillKey: "warm-up-2-bridges", score: 5 }],
      }),
    );
  });

  it("counts one such rating in the singular, and says nothing when there are none", () => {
    renderAssessment({
      initialScores: { "tie-the-belt": 5 },
      minimums: { "warm-up-2-bridges": 3 },
    });
    expect(
      screen.getByText("A rating for 1 other skill is on record. Nothing here changes it."),
    ).toBeInTheDocument();
    cleanup();
    renderAssessment();
    expect(screen.queryByText(/other skill/u)).toBeNull();
  });

  /**
   * Case 5: the requirement set changes identity and contents while the panel is mounted.
   * `initialScores` is read in a lazy `useState` initialiser and must stay put; the minimums are
   * read during render and must move. Neither may re-render the parent in a loop.
   */
  it("follows a changed requirement set without looping or losing the ratings on screen", () => {
    const reported: boolean[] = [];
    const props = propsFor({ onDirtyChange: (dirty: boolean) => reported.push(dirty) });
    const { rerender } = render(<SkillsAssessment {...props} />);
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "5" }));
    expect(reported).toEqual([false, true]);
    rerender(
      <SkillsAssessment
        {...props}
        initialScores={{ "tie-the-belt": 1 }}
        minimums={{ "warm-up-2-bridges": 4 }}
      />,
    );
    expect(screen.queryByRole("group", { name: /Tie The Belt/u })).toBeNull();
    expect(within(group(/Warm Up 2 - Bridges/u)).getByText("Minimum 4")).toBeInTheDocument();
    expect(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "5" })).toBeChecked();
    expect(reported).toEqual([false, true]);
  });

  it("saves only changed ratings explicitly and reports dirty state", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    const props = renderAssessment();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" }));
    expect(screen.getByRole("status")).toHaveTextContent("You have unsaved ratings.");
    await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.recordSkillRatings).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: "white-belt",
        ratings: [{ skillKey: "warm-up-2-bridges", score: 4 }],
      }),
    );
    // Task 17 review, Major-1: the parent moves its own copy of the ratings by what was SENT, so
    // the save hands that list back instead of announcing a bare "something was saved".
    expect(props.onSaved).toHaveBeenCalledWith([{ skillKey: "warm-up-2-bridges", score: 4 }]);
  });

  /**
   * Minor-3 of the Task 17 review. The promotion dialog's "Skills n/m at minimum" counts what the
   * STORE holds, so a counter here that moved on an unsaved click put two numbers about the same
   * member, disagreeing, on the same screen. Both count the saved ratings now.
   */
  it("counts only saved ratings towards the minimums, and says so", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    renderAssessment();
    const warmUp = () => screen.getByText("Warm Up").closest("details")!;
    expect(within(warmUp()).getByText("1/2 rated · 1/2 saved at minimum")).toBeInTheDocument();
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "3" }));
    expect(within(warmUp()).getByText("2/2 rated · 1/2 saved at minimum")).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(within(warmUp()).getByText("2/2 rated · 2/2 saved at minimum")).toBeInTheDocument(),
    );
  });

  /** Minor-4: every "Minimum n" on screen belongs to the TARGET level; this names the held one. */
  it("names the level the ratings are filed against, and says nothing when it is unknown", () => {
    renderAssessment();
    expect(
      screen.getByText("Ratings are recorded against WHITE BELT, the level currently held."),
    ).toBeInTheDocument();
    cleanup();
    renderAssessment({ definitionName: null });
    expect(screen.queryByText(/the level currently held/u)).toBeNull();
  });

  /** Minor-5: a save that says nothing while it runs. */
  it("announces the save while it is running", async () => {
    let settle: (value: { studentId: string; recorded: number }) => void = () => {};
    api.recordSkillRatings.mockReturnValue(
      new Promise<{ studentId: string; recorded: number }>((resolve) => {
        settle = resolve;
      }),
    );
    renderAssessment();
    fireEvent.click(within(group(/Tie The Belt/u)).getByRole("radio", { name: "2" }));
    expect(saveButton()).toHaveAttribute("aria-busy", "false");
    fireEvent.click(saveButton());
    const saving = await screen.findByRole("button", { name: "Saving ratings" });
    expect(saving).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      settle({ studentId: "student-1", recorded: 1 });
    });
    expect(screen.getByRole("button", { name: "Save ratings" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  /**
   * P1. The rejection carries a server-shaped message with an identifier in it. Nothing but the
   * client's own allowlisted string may reach the screen, so `failure.message` in place of
   * `safeMessage` fails here rather than passing on a mock that was already safe.
   */
  it("states a save refusal in this view's own words and keeps the ratings", async () => {
    api.recordSkillRatings.mockRejectedValue(
      new Error("PERMISSION_DENIED: student student-42 has no level open on academy bpt-jersey"),
    );
    renderAssessment();
    fireEvent.click(within(group(/Tie The Belt/u)).getByRole("radio", { name: "2" }));
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Unable to save the ratings. Please try again.",
    );
    expect(document.body.textContent).not.toContain("student-42");
    expect(document.body.textContent).not.toContain("PERMISSION_DENIED");
    expect(within(group(/Tie The Belt/u)).getByRole("radio", { name: "2" })).toBeChecked();
  });

  /**
   * P2. The panel is remounted by the parent's reload in the shipped view, which used to hide a
   * dirty flag that re-armed itself the moment it was cleared. Nothing is remounted here.
   */
  it("stops reporting unsaved ratings after a save without being remounted", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    const props = renderAssessment();
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" }));
    await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(saveButton());
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText("You have unsaved ratings.")).toBeNull();
    expect(saveButton()).toBeDisabled();
    expect(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" })).toBeChecked();
  });

  /** P2, second half: what was NOT sent stays unsaved. */
  it("keeps a rating changed while the save was in flight unsaved", async () => {
    let settle: (value: { studentId: string; recorded: number }) => void = () => {};
    api.recordSkillRatings.mockReturnValue(
      new Promise<{ studentId: string; recorded: number }>((resolve) => {
        settle = resolve;
      }),
    );
    const props = renderAssessment();
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" }));
    fireEvent.click(saveButton());
    fireEvent.click(within(group(/Tie The Belt/u)).getByRole("radio", { name: "2" }));
    await act(async () => {
      settle({ studentId: "student-1", recorded: 1 });
    });
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("You have unsaved ratings.")).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(api.recordSkillRatings).toHaveBeenLastCalledWith({
        studentId: "student-1",
        definitionKey: "white-belt",
        ratings: [{ skillKey: "tie-the-belt", score: 2 }],
      }),
    );
  });

  /** P3. A cast would render a 7 as nothing checked and count the skill as not rated. */
  it("refuses a score outside 1 to 5 instead of treating it as a rating", () => {
    renderAssessment({
      initialScores: { "warm-up-1-technical-stand-up": 7, "warm-up-2-bridges": 0 },
    });
    const standUp = group(/Warm Up 1 - Technical Stand Up/u);
    expect(
      within(standUp)
        .getAllByRole("radio")
        .filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(0);
    expect(screen.getByText("Warm Up").closest("details")!.textContent).toContain(
      "0/2 rated · 0/2 saved at minimum",
    );
    expect(document.body.textContent).not.toContain("7");
  });

  /**
   * P4. The parent hands down a NEW arrow on every render. An effect keyed on the callback's
   * identity re-runs on each of those renders; in the shipped view it would also loop, because the
   * report is what re-renders the parent, so the mutant is asserted here on the report count.
   */
  it("reports the dirty state once although the parent passes a new callback each render", () => {
    const reported: boolean[] = [];
    function Parent() {
      const [seen, setSeen] = useState(0);
      return (
        <>
          <button onClick={() => setSeen(seen + 1)} type="button">
            {`Re-render ${seen}`}
          </button>
          <SkillsAssessment
            {...propsFor({ onDirtyChange: (dirty: boolean) => reported.push(dirty) })}
          />
        </>
      );
    }
    render(<Parent />);
    fireEvent.click(screen.getByRole("button", { name: "Re-render 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Re-render 1" }));
    expect(reported).toEqual([false]);
  });

  /** P5. `disabled` alone did not hold for the other three writes (Task 16); it does not here. */
  it("sends one batch when the save button is clicked twice before the first settles", async () => {
    api.recordSkillRatings.mockResolvedValue({ studentId: "student-1", recorded: 1 });
    renderAssessment();
    fireEvent.click(within(group(/Warm Up 2 - Bridges/u)).getByRole("radio", { name: "4" }));
    const save = saveButton();
    act(() => {
      save.click();
      save.click();
    });
    await waitFor(() => expect(api.recordSkillRatings).toHaveBeenCalledTimes(1));
    expect(api.recordSkillRatings).toHaveBeenCalledTimes(1);
  });
});
