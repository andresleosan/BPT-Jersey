import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnrolmentLevelDeclaration } from "@bpt-jersey/domain/members/enrolment-requests";
import { getLevelCatalog } from "../../lib/levels-client";
import {
  LevelDeclaration,
  beltsForAge,
  defaultWhiteBelt,
  stripesForBelt,
} from "./level-declaration";

// The bundled catalogue: `getLevelCatalog` reads it from the repository's own sanitized JSON when
// `NEXT_PUBLIC_LEVELS_BACKEND` is unset, so these are the belts and stripes a real applicant sees.
const defs = (await getLevelCatalog()).definitions;

const beginner: EnrolmentLevelDeclaration = { experience: "beginner", declaredLevelKey: null };

function Harness({
  age,
  definitions = defs,
  initial = beginner,
  onChange,
}: Readonly<{
  age: number;
  definitions?: typeof defs;
  initial?: EnrolmentLevelDeclaration;
  onChange: (next: EnrolmentLevelDeclaration) => void;
}>) {
  const [value, setValue] = useState(initial);
  return (
    <LevelDeclaration
      id="applicant"
      age={age}
      definitions={definitions}
      value={value}
      disabled={false}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("belt and stripe options", () => {
  it("offers only belts for the student's age", () => {
    expect(beltsForAge(defs, 30).map((belt) => belt.definitionKey)).toEqual([
      "white-belt",
      "blue-belt",
      "purple-belt",
      "brown-belt",
      "black-belt",
    ]);
    expect(beltsForAge(defs, 9).every((belt) => belt.criteria.maxAge !== null)).toBe(true);
    expect(beltsForAge(defs, 9).length).toBeGreaterThan(0);
  });

  it("lists stripes of the chosen belt in order", () => {
    expect(stripesForBelt(defs, "blue-belt").map((stripe) => stripe.stripes)).toEqual([1, 2, 3, 4]);
    expect(stripesForBelt(defs, "blue-belt")[1]?.definitionKey).toBe("blue-2nd-stripe");
  });

  // Task 14 starts an undeclared trial student on this belt, so the age band decides it, not the
  // adult default: a nine-year-old beginner may not be opened on the adult white belt.
  it("names the white belt of the student's own age band", () => {
    expect(defaultWhiteBelt(defs, 30)).toBe("white-belt");
    expect(defaultWhiteBelt(defs, 9)).toBe("white-belt-kids-7-8-and-8-10-yo");
  });
});

describe("level declaration", () => {
  it("declares the stripe key when stripes are chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness age={30} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "I'm not a Beginner" }));
    await user.selectOptions(screen.getByLabelText("Belt"), "blue-belt");
    await user.selectOptions(screen.getByLabelText("Stripes"), "2");

    expect(onChange).toHaveBeenLastCalledWith({
      experience: "experienced",
      declaredLevelKey: "blue-2nd-stripe",
    });
  });

  it("returns to beginner", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        age={30}
        initial={{ experience: "experienced", declaredLevelKey: "blue-2nd-stripe" }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "I am a beginner" }));

    expect(onChange).toHaveBeenLastCalledWith({
      experience: "beginner",
      declaredLevelKey: null,
    });
    expect(screen.queryByLabelText("Belt")).not.toBeInTheDocument();
  });

  it("shows the belt the student already declared, stripes and all", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        age={30}
        initial={{ experience: "experienced", declaredLevelKey: "blue-2nd-stripe" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Belt")).toHaveValue("blue-belt");
    expect(screen.getByLabelText("Stripes")).toHaveValue("2");

    // Changing the belt cannot keep a stripe that belongs to the belt left behind.
    await user.selectOptions(screen.getByLabelText("Belt"), "purple-belt");

    expect(onChange).toHaveBeenLastCalledWith({
      experience: "experienced",
      declaredLevelKey: "purple-belt",
    });
    expect(screen.getByLabelText("Stripes")).toHaveValue("0");
  });

  // Without a catalogue the form cannot offer a belt, and it must not pretend it can: the applicant
  // is told the office will confirm the level, and can still send the request as a beginner.
  it("says so when the catalogue could not be loaded", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness age={30} definitions={[]} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "I'm not a Beginner" }));

    expect(onChange).toHaveBeenLastCalledWith({
      experience: "experienced",
      declaredLevelKey: null,
    });
    expect(
      screen.getByText(
        "Belt selection is unavailable right now — the office will confirm your level.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "I am a beginner" })).toBeVisible();
  });
});
