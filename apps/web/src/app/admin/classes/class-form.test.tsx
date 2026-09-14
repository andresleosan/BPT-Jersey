import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduleCatalogResponse } from "../../../lib/schedule-client";
import type { StaffProfileProjection } from "../../../lib/staff-client";
import { ClassForm, draftToCreateInput, emptyClassDraft, type BeltOption } from "./class-form";

const catalog: ScheduleCatalogResponse = {
  locations: [
    {
      locationId: "town",
      academyId: "a",
      name: "BPT Town",
      address: "",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
    {
      locationId: "west",
      academyId: "a",
      name: "BPT West",
      address: "",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
  ],
  programs: [
    {
      programId: "p-kids",
      academyId: "a",
      name: "Kids BJJ",
      ageBand: "kids",
      discipline: "bjj",
      level: "all-levels",
      active: true,
      schemaVersion: "1",
    },
  ],
};
const belts: BeltOption[] = [
  { key: "k-white", name: "White", sequence: 1 },
  { key: "k-grey", name: "Grey", sequence: 2 },
  { key: "k-yellow", name: "Yellow", sequence: 3 },
];
const staff: readonly StaffProfileProjection[] = [
  { staffKey: "coach-a", role: "coach", active: true, status: "active", schemaVersion: "1" },
];

describe("class form", () => {
  afterEach(cleanup);

  it("toggles weekdays and copies the last time into a newly opened day", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClassForm
        activeStaff={staff}
        belts={belts}
        catalog={catalog}
        draft={emptyClassDraft()}
        mode="create"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Monday", pressed: false }));
    let draft = onChange.mock.lastCall![0];
    expect(draft.rules).toEqual([{ dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 }]);
    rerender(
      <ClassForm
        activeStaff={staff}
        belts={belts}
        catalog={catalog}
        draft={draft}
        mode="create"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Monday start time"), { target: { value: "17:30" } });
    draft = onChange.mock.lastCall![0];
    rerender(
      <ClassForm
        activeStaff={staff}
        belts={belts}
        catalog={catalog}
        draft={draft}
        mode="create"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Wednesday", pressed: false }));
    draft = onChange.mock.lastCall![0];
    expect(draft.rules).toEqual([
      { dayOfWeek: 1, startTime: "17:30", durationMinutes: 60 },
      { dayOfWeek: 3, startTime: "17:30", durationMinutes: 60 },
    ]);
  });

  it("applies an age preset and a custom range", () => {
    const onChange = vi.fn();
    render(
      <ClassForm
        activeStaff={staff}
        belts={belts}
        catalog={catalog}
        draft={emptyClassDraft()}
        mode="create"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "8–11" }));
    expect(onChange.mock.lastCall![0].ageRange).toEqual({ minAge: 8, maxAge: 11 });
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(onChange.mock.lastCall![0].ageRange).toEqual({ minAge: 8, maxAge: 11 });
  });

  it("builds a create input with belt names and refuses an inverted belt range", () => {
    const draft = {
      ...emptyClassDraft(),
      name: "Kids BJJ",
      programId: "p-kids",
      locationId: "town" as const,
      rules: [{ dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 }],
      levelRange: { fromKey: "k-white", toKey: "k-yellow" },
      ageRange: { minAge: 8, maxAge: 11 },
      description: " Bring a gi. ",
      instructorIds: ["coach-a"],
      capacity: 20,
      minParticipants: 4,
    };
    expect(draftToCreateInput(draft, belts)).toEqual({
      programId: "p-kids",
      locationId: "town",
      name: "Kids BJJ",
      recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }],
      instructorIds: ["coach-a"],
      capacity: 20,
      minParticipants: 4,
      description: "Bring a gi.",
      ageRange: { minAge: 8, maxAge: 11 },
      levelRange: { fromKey: "k-white", toKey: "k-yellow", fromName: "White", toName: "Yellow" },
    });
    expect(
      draftToCreateInput(
        { ...draft, levelRange: { fromKey: "k-yellow", toKey: "k-white" } },
        belts,
      ),
    ).toBe("The 'to' belt cannot be below the 'from' belt.");
    expect(draftToCreateInput({ ...draft, rules: [] }, belts)).toBe("Pick at least one day.");
  });

  it("disables the belt selectors when the catalogue is unavailable", () => {
    render(
      <ClassForm
        activeStaff={staff}
        belts={null}
        catalog={catalog}
        draft={emptyClassDraft()}
        mode="create"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("From belt")).toBeDisabled();
    expect(
      screen.getByText("Belt catalogue unavailable. Level range can be set later."),
    ).toBeInTheDocument();
  });
});
