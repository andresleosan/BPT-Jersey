import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProgramRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

import { SessionCard, type CalendarEntry } from "./session-card";

const audit = {
  schemaVersion: "1" as const,
  createdAt: "",
  createdBy: "",
  updatedAt: "",
  updatedBy: "",
};
const program: ProgramRecord = {
  programId: "prog-teens",
  academyId: "bpt",
  name: "Teens BJJ",
  ageBand: "teens",
  discipline: "bjj",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
};
const session: SessionRecord = {
  sessionId: "s1",
  academyId: "bpt",
  classId: null,
  programId: "prog-teens",
  locationId: "town",
  instructorId: "c",
  title: "Teens BJJ",
  startAt: "2026-09-16T17:00:00.000Z",
  endAt: "2026-09-16T18:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  ...audit,
};
const now = new Date("2026-09-16T15:00:00Z");

function entry(
  status: CalendarEntry["derived"]["status"],
  extra: Partial<CalendarEntry> = {},
): CalendarEntry {
  return { session, program, derived: { status }, ...extra };
}

function renderCard(props: Partial<Parameters<typeof SessionCard>[0]> = {}) {
  return render(
    <ul>
      <SessionCard
        busy={false}
        entry={entry("open")}
        now={now}
        onBook={vi.fn()}
        onCancelRequest={vi.fn()}
        {...props}
      />
    </ul>,
  );
}

describe("SessionCard", () => {
  afterEach(cleanup);

  it("shows time, title, site and a Book action when open", async () => {
    const onBook = vi.fn();
    renderCard({ onBook });
    expect(screen.getByText("18:00–19:00")).toBeInTheDocument();
    expect(screen.getByText("Teens BJJ")).toBeInTheDocument();
    expect(screen.getByText("Town")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book" }));
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it("labels a free Intro Class and exposes its dedicated action", async () => {
    const onBook = vi.fn();
    renderCard({ entry: entry("open", { session: { ...session, accessMode: "intro" } }), onBook });
    expect(screen.getByText(/Free Intro Class/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book free intro" }));
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it("offers Cancel while cancellable and says closed after the cut-off", () => {
    const { unmount } = renderCard({ entry: entry("booked") });
    expect(screen.getByRole("button", { name: "Booked · Cancel" })).toBeInTheDocument();
    unmount();
    renderCard({ entry: entry("booked"), now: new Date("2026-09-16T16:30:00Z") });
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.getByText("Cancellations closed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders static labels for missed, attended, closed and full", () => {
    for (const [status, label] of [
      ["missed", "Missed"],
      ["attended", "Attended"],
      ["closed", "Closed"],
      ["full", "Full"],
    ] as const) {
      const { unmount } = renderCard({ entry: entry(status) });
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("toggles the locked reason on tap", async () => {
    renderCard({ entry: entry("locked", { derived: { status: "locked", lockedReason: "site" } }) });
    expect(screen.queryByText("Your plan doesn't cover Town")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not available" }));
    expect(screen.getByText("Your plan doesn't cover Town")).toBeInTheDocument();
  });

  it("shows the note passed in", () => {
    renderCard({ entry: entry("booked"), note: "Booked. Missing it costs £15." });
    expect(screen.getByText("Booked. Missing it costs £15.")).toBeInTheDocument();
  });

  it("shows the level and age ranges and the description when the session carries them", () => {
    const detailed = {
      ...session,
      description: "Gi only. Bring a mouthguard.",
      ageRange: { minAge: 12, maxAge: 15 },
      levelRange: { fromKey: "w", toKey: "b", fromName: "White", toName: "Blue" },
    };
    render(
      <ul>
        <SessionCard
          busy={false}
          entry={{ session: detailed, program, derived: { status: "open" } }}
          now={new Date("2026-09-16T10:00:00Z")}
          onBook={vi.fn()}
          onCancelRequest={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByText("White → Blue · Ages 12–15")).toBeInTheDocument();
    expect(screen.getByText("Gi only. Bring a mouthguard.")).toBeInTheDocument();
    cleanup();
    render(
      <ul>
        <SessionCard
          busy={false}
          entry={{ session, program, derived: { status: "open" } }}
          now={new Date("2026-09-16T10:00:00Z")}
          onBook={vi.fn()}
          onCancelRequest={vi.fn()}
        />
      </ul>,
    );
    expect(screen.queryByText(/All levels/u)).toBeNull();
  });
  it("shows the curriculum attached to the session", () => {
    renderCard({
      entry: entry("booked", {
        session: {
          ...session,
          curriculum: {
            title: "Guard retention",
            techniques: ["Frames", "Hip escape"],
            details: "Finish with positional rounds.",
          },
        },
      }),
    });
    const curriculum = screen.getByRole("region", { name: "Session curriculum" });
    expect(curriculum).toHaveTextContent("Guard retention");
    expect(curriculum).toHaveTextContent("Frames");
    expect(curriculum).toHaveTextContent("Hip escape");
    expect(curriculum).toHaveTextContent("Finish with positional rounds.");
  });

  it("reads time first, then class, then site and coach, then the state", () => {
    const { container } = renderCard({
      entry: entry("open", { session: { ...session, instructorName: "Coach Silva" } }),
    });
    const card = container.querySelector(".session-card")!;
    const order = [...card.children].map((child) => child.className.split(" ")[0]);
    expect(order.slice(0, 3)).toEqual(["session-time", "session-title", "session-site"]);
    expect(order.indexOf("session-action")).toBeGreaterThan(2);
    expect(card.querySelector(".session-site")).toHaveTextContent("Town · Coach Silva");
    expect(accountRule(".session-title")).not.toMatch(/ellipsis|nowrap/u);
  });

  it("keeps the whole-card status backgrounds of DESIGN §9", () => {
    for (const [status, background] of [
      ["open", "var(--status-open)"],
      ["booked", "var(--status-booked)"],
      ["attended", "var(--status-attended)"],
      ["missed", "var(--status-missed)"],
    ] as const) {
      expect(accountRule(`.session-card--${status}`)).toContain(`background: ${background};`);
    }
    expect(accountRule(".session-card--booked")).toContain(
      "box-shadow: inset 0.35rem 0 0 #176b49;",
    );
    expect(accountRule(".session-card--missed")).toContain(
      "box-shadow: inset 0.35rem 0 0 #8d1c2f;",
    );
    expect(accountCss).toMatch(/--status-open: #ffe66d;/iu);
    expect(accountCss).toMatch(/--status-booked: #d7f0e2;/iu);
  });

  it("keeps the course label and the absence toggle on a booked course session", () => {
    const onCancelRequest = vi.fn();
    renderCard({
      onCancelRequest,
      entry: entry("booked", {
        session: { ...session, courseId: "course-1", courseOrdinal: 2, courseSessionCount: 8 },
      }),
    });
    expect(screen.getByText("Course included · session 2/8")).toBeInTheDocument();
    screen.getByRole("button", { name: "Included · Mark absent" }).click();
    expect(onCancelRequest).toHaveBeenCalled();
  });
});

const accountCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/account/account.css"),
  "utf8",
);

function accountRule(selector: string): string {
  const start = accountCss.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return accountCss.slice(start, accountCss.indexOf("}", start));
}
