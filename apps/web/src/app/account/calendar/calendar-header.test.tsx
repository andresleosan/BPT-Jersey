import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarParticipant } from "../../../lib/calendar";
import { CalendarHeader } from "./calendar-header";

const days = [
  { dateKey: "2026-09-16", weekday: "Wed", dayNumber: 16, isToday: true, startAt: "", endAt: "" },
  { dateKey: "2026-09-17", weekday: "Thu", dayNumber: 17, isToday: false, startAt: "", endAt: "" },
];
const maya: CalendarParticipant = {
  studentId: "maya",
  firstName: "Maya",
  membershipId: "m1",
  planId: "town-teens",
  participantType: "teens",
  planClassSites: ["Town"],
  planOpenMatSites: ["Town"],
};
const leo: CalendarParticipant = {
  studentId: "leo",
  firstName: "Leo",
  membershipId: "m2",
  planId: "west-kids-2x",
  participantType: "kids",
  planClassSites: ["West"],
  planOpenMatSites: ["Town"],
};

function renderHeader(props: Partial<Parameters<typeof CalendarHeader>[0]> = {}) {
  return render(
    <CalendarHeader
      canNext
      canPrev={false}
      days={days}
      displayName="Jordan Demo"
      onNext={vi.fn()}
      onPrev={vi.fn()}
      onSelectStudent={vi.fn()}
      onSignOut={vi.fn()}
      participants={[maya]}
      selectedStudentId="maya"
      {...props}
    />,
  );
}

describe("CalendarHeader", () => {
  afterEach(cleanup);

  it("shows the first name, day pills with today marked, and arrows", async () => {
    const onNext = vi.fn();
    renderHeader({ onNext });
    expect(screen.getByRole("heading", { name: "Jordan" })).toBeInTheDocument();
    expect(screen.getByText("16").closest(".day-pill")).toHaveClass("day-pill--today");
    expect(screen.getByRole("button", { name: "Earlier" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onNext).toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Choose member" })).not.toBeInTheDocument();
  });

  it("links to progress, competitors and settings from the header", () => {
    renderHeader();
    const nav = within(screen.getByRole("navigation", { name: "Account" }));
    expect(nav.getByRole("link", { name: "Progress" })).toHaveAttribute(
      "href",
      "/account/progress",
    );
    expect(nav.getByRole("link", { name: "Competitors" })).toHaveAttribute(
      "href",
      "/account/competitors",
    );
    expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/account/settings",
    );
  });

  it("renders chips for a guardian with several children and reports selection", async () => {
    const onSelectStudent = vi.fn();
    renderHeader({ participants: [maya, leo], onSelectStudent });
    expect(screen.getByRole("button", { name: "Maya" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Leo" }));
    expect(onSelectStudent).toHaveBeenCalledWith("leo");
  });
});
