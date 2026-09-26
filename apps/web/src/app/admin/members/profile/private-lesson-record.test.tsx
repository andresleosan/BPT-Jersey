import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../../../../lib/private-lesson-client", () => ({
  recordPrivateLessonPurchase: api.record,
}));

import { PrivateLessonRecord } from "./private-lesson-record";

describe("PrivateLessonRecord", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("records a purchase paid at the desk without asking for a price", async () => {
    api.record.mockResolvedValue({ purchaseId: "p1", optionId: "pack-10" });
    render(<PrivateLessonRecord studentId="student-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Record private lesson purchase" }));
    fireEvent.change(screen.getByLabelText("Lessons"), { target: { value: "pack-10" } });
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "cash" } });
    expect(screen.getByText("£500.00")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save purchase" }));
    await waitFor(() =>
      expect(api.record).toHaveBeenCalledWith({
        studentId: "student-1",
        optionId: "pack-10",
        method: "cash",
        reference: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Recorded Private lessons pack of 10. The credits are ready to book.",
    );
  });

  it("shows the server's refusal", async () => {
    api.record.mockRejectedValue(new Error("Private lessons are for members aged 16 or over."));
    render(<PrivateLessonRecord studentId="student-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Record private lesson purchase" }));
    fireEvent.click(screen.getByRole("button", { name: "Save purchase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Private lessons are for members aged 16 or over.",
    );
  });
});
