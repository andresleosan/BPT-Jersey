import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyWeek: vi.fn(),
  deleteWeek: vi.fn(),
  previewWeek: vi.fn(),
}));

vi.mock("../../../../lib/schedule-client", () => ({
  copyWeek: mocks.copyWeek,
  deleteWeek: mocks.deleteWeek,
  previewWeek: mocks.previewWeek,
}));

import { WeekActions } from "./week-actions";

describe("WeekActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("previews before copying a week and reports the result", async () => {
    mocks.previewWeek.mockResolvedValue({ count: 3, sample: [] });
    mocks.copyWeek.mockResolvedValue([{}, {}, {}]);
    const onChanged = vi.fn();
    render(<WeekActions weekStart="2026-09-14" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy week" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy week" });
    expect(
      within(dialog).getByText("3 classes will be copied to the week of 21 Sep 2026."),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(mocks.copyWeek).toHaveBeenCalledWith({
        fromWeekStart: "2026-09-14",
        toWeekStart: "2026-09-21",
        copyBookings: false,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("copies the bookings as well when asked", async () => {
    mocks.previewWeek.mockResolvedValue({ count: 1, sample: [] });
    mocks.copyWeek.mockResolvedValue([{}]);
    render(<WeekActions weekStart="2026-09-14" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy week" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy week" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Copy bookings as well" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(mocks.copyWeek).toHaveBeenCalledWith(expect.objectContaining({ copyBookings: true })),
    );
  });

  it("requires a reason to delete a week", async () => {
    mocks.previewWeek.mockResolvedValue({ count: 2, sample: [] });
    mocks.deleteWeek.mockResolvedValue([{}, {}]);
    render(<WeekActions weekStart="2026-09-14" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete week" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete week" });
    expect(within(dialog).getByText("2 classes will be cancelled.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Closed for the bank holiday" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mocks.deleteWeek).toHaveBeenCalledWith({
        weekStart: "2026-09-14",
        reason: "Closed for the bank holiday",
      }),
    );
  });

  it("reports a failed preview inside the dialog", async () => {
    mocks.previewWeek.mockRejectedValue(new Error("Unable to preview the week"));
    render(<WeekActions weekStart="2026-09-14" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy week" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy week" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Unable to preview the week",
    );
  });

  it("keeps the other week action out of reach while a dialog is open", async () => {
    mocks.previewWeek.mockResolvedValue({ count: 2, sample: [] });
    render(<WeekActions weekStart="2026-09-14" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy week" }));
    await screen.findByRole("dialog", { name: "Copy week" });
    expect(screen.getByRole("button", { name: "Copy week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete week" })).toBeDisabled();
  });

  it("focuses the dialog on open, closes on Escape and gives the focus back", async () => {
    mocks.previewWeek.mockResolvedValue({ count: 2, sample: [] });
    render(<WeekActions weekStart="2026-09-14" onChanged={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Delete week" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Delete week" });
    expect(within(dialog).getByLabelText("Reason")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
