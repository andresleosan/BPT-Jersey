import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const levelsApi = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  openStudentLevel: vi.fn(),
}));

vi.mock("../../lib/levels-client", () => levelsApi);

import { OpenLevelPanel } from "./open-level-panel";

const definition = (
  definitionKey: string,
  kind: "belt" | "stripe",
  name: string,
  sequence: number,
) => ({
  definitionKey,
  systemId: "ibjjf-v1",
  kind,
  parentDefinitionKey: null,
  name,
  sequence,
  stripeNumber: null,
  criteria: { minAge: 16, maxAge: null, minClasses: 25, minimumTime: null },
  observedCriteria: { minAge: 16, maxAge: null, minClasses: 25, minimumTime: null },
  visual: {
    colorMode: 1,
    colors: ["#ffffff"],
    stripeColor: null,
    stripeCenter: null,
    stripeWidth: null,
    stripePosition: null,
  },
  observedSkillRequirementSetKey: null,
  observedSkillRequirementsState: "none",
  anomalyFlags: [],
  schemaVersion: 1 as const,
});

describe("OpenLevelPanel", () => {
  afterEach(() => {
    cleanup();
    Object.values(levelsApi).forEach((mock) => mock.mockReset());
  });

  it("offers only belts from the catalog and opens the chosen student level", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue({
      definitions: [
        definition("blue-0", "belt", "BLUE BELT", 5),
        definition("white-1", "stripe", "WHITE BELT 1 STRIPE", 2),
        definition("white-0", "belt", "WHITE BELT", 1),
      ],
    });
    levelsApi.openStudentLevel.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: "white-0",
      currentLevelStartedAt: "2026-09-05T10:00:00.000Z",
      state: "initialized",
    });
    const onOpened = vi.fn();

    render(<OpenLevelPanel studentIds={["student-1", "student-2"]} onOpened={onOpened} />);

    const belt = await screen.findByLabelText("Belt");
    await waitFor(() => expect(belt).not.toBeDisabled());
    const beltOptions = Array.from(belt.querySelectorAll("option")).map((option) => option.text);
    expect(beltOptions).toEqual(["Select a belt", "WHITE BELT", "BLUE BELT"]);
    expect(beltOptions).not.toContain("WHITE BELT 1 STRIPE");

    fireEvent.change(screen.getByLabelText("Student"), { target: { value: "student-1" } });
    fireEvent.change(belt, { target: { value: "white-0" } });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Holds a white belt from a previous academy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open level record" }));

    await waitFor(() =>
      expect(levelsApi.openStudentLevel).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: "white-0",
        decisionNotes: "Holds a white belt from a previous academy.",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Level record opened for student student-1.",
    );
    expect(onOpened).toHaveBeenCalledWith("student-1", "white-0");
  });

  it("reports a failed opening without claiming success", async () => {
    levelsApi.getLevelCatalog.mockResolvedValue({
      definitions: [definition("white-0", "belt", "WHITE BELT", 1)],
    });
    levelsApi.openStudentLevel.mockRejectedValue(new Error("boom"));

    render(<OpenLevelPanel studentIds={["student-1"]} />);
    const belt = await screen.findByLabelText("Belt");
    await waitFor(() => expect(belt).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Student"), { target: { value: "student-1" } });
    fireEvent.change(belt, { target: { value: "white-0" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Already open" } });
    fireEvent.click(screen.getByRole("button", { name: "Open level record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to open the level record");
  });
});
