import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminIconButton } from "./admin-ui";
import { previewData } from "./preview-data";

describe("admin operational UI primitives", () => {
  it("renders icon actions with accessible labels and tooltips", () => {
    render(<AdminIconButton label="Add new member" icon="member-add" onClick={() => undefined} />);

    expect(screen.getByRole("button", { name: "Add new member" })).toHaveAttribute(
      "title",
      "Add new member",
    );
  });

  it("marks preview data as synthetic and contains no production identifiers", () => {
    expect(previewData.environment).toBe("synthetic-preview");
    expect(JSON.stringify(previewData)).not.toMatch(
      /real member|production|serviceAccount|bearer/i,
    );
  });
});
