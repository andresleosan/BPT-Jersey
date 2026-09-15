import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AttendanceRecord, ProgramRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

import { ReadyForJiuJitsu } from "./ready-for-jiu-jitsu";

const accountCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/app/account/account.css"),
  "utf8",
);

const audit = {
  schemaVersion: "1" as const,
  createdAt: "",
  createdBy: "",
  updatedAt: "",
  updatedBy: "",
};
const session: SessionRecord = {
  sessionId: "s1",
  academyId: "bpt",
  classId: null,
  programId: "prog-teens",
  locationId: "town",
  instructorId: "c",
  title: "Teens BJJ",
  startAt: "2026-09-15T17:00:00.000Z",
  endAt: "2026-09-15T18:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  ...audit,
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
const record: AttendanceRecord = {
  attendanceId: "s1__sam",
  academyId: "bpt",
  sessionId: "s1",
  studentId: "sam",
  method: "self",
  state: "attended",
  occurredAt: "2026-09-15T16:52:00.000Z",
  notes: null,
  correctionOf: null,
  ...audit,
};
const near = { coords: { latitude: 49.184224, longitude: -2.107142, accuracy: 12 } };

function stubGeolocation(
  impl: (ok: (position: typeof near) => void, fail: (error: { code: number }) => void) => void,
) {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

function slider(): HTMLInputElement {
  return screen.getByRole("slider", { name: /Slide to clock in/u }) as HTMLInputElement;
}

function slideToEnd(): void {
  fireEvent.change(slider(), { target: { value: "100" } });
  fireEvent.keyUp(slider(), { key: "End" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReadyForJiuJitsu", () => {
  it("keeps a transform-synchronized contrasting slider label treatment in source styles", () => {
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={vi.fn()}
        onCheckedIn={vi.fn()}
      />,
    );

    expect(document.querySelector(".ready-fill")).toHaveAttribute(
      "data-label",
      "Slide to clock in",
    );
    expect(accountCss).toMatch(
      /\.ready-label\s*\{[\s\S]*?color: var\(--mat-ink\);[\s\S]*?z-index: 1;/u,
    );
    expect(accountCss).toMatch(
      /\.ready-fill\s*\{[\s\S]*?overflow: hidden;[\s\S]*?transform: translateX\(min\(0px, calc\(var\(--ready-progress\) - 100% \+ 3rem\)\)\);[\s\S]*?width: 100%;[\s\S]*?z-index: 2;/u,
    );
    expect(accountCss).toMatch(
      /\.ready-fill::after\s*\{[\s\S]*?content: attr\(data-label\);[\s\S]*?transform: translateX\(max\(0px, calc\(100% - var\(--ready-progress\) - 3rem\)\)\);/u,
    );
    expect(accountCss).toMatch(/\.ready-range\s*\{[\s\S]*?z-index: 3;/u);
    expect(accountCss).not.toContain("clip-path:");
    expect(accountCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\.ready-fill\s*\{[\s\S]*?transition: transform 220ms ease;/u,
    );
    const fillTransitions = [...accountCss.matchAll(/\.ready-fill\s*\{([^}]*)\}/gu)]
      .map((match) => match[1] ?? "")
      .filter((rule) => rule.includes("transition:"));
    expect(fillTransitions).toEqual([expect.stringContaining("transition: transform 220ms ease;")]);
  });

  it("keeps operational window, hint, and status text at the body-size minimum in source styles", () => {
    expect(accountCss).toMatch(/\.ready-window,\s*\.ready-hint\s*\{[\s\S]*?font-size: 1rem;/u);
    expect(accountCss).toMatch(/\.ready-status\s*\{[\s\S]*?font-size: 1rem;/u);
  });

  it("shows the two-line headline, the class and the window, and asks for location only after the slide", async () => {
    const getPosition = stubGeolocation((ok) => ok(near));
    const clockIn = vi.fn().mockResolvedValue(record);
    const onCheckedIn = vi.fn();
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={clockIn}
        onCheckedIn={onCheckedIn}
      />,
    );

    expect(screen.getByRole("heading", { name: "Ready for Jiu Jitsu" })).toBeInTheDocument();
    expect(screen.getByText("Teens BJJ · 18:00–19:00 · Town")).toBeInTheDocument();
    expect(screen.getByText("Opens 17:00 · closes 18:20")).toBeInTheDocument();
    expect(getPosition).not.toHaveBeenCalled();

    slideToEnd();

    await waitFor(() =>
      expect(clockIn).toHaveBeenCalledWith({
        sessionId: "s1",
        studentId: "sam",
        position: { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 },
      }),
    );
    await waitFor(() => expect(onCheckedIn).toHaveBeenCalledWith(record));
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("keeps native arrow progress until End commits, while an early release resets without locating", () => {
    const getPosition = stubGeolocation((ok) => ok(near));
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={vi.fn()}
        onCheckedIn={vi.fn()}
      />,
    );

    fireEvent.change(slider(), { target: { value: "60" } });
    fireEvent.keyUp(slider(), { key: "ArrowRight" });
    expect(slider().value).toBe("60");
    expect(getPosition).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider());
    expect(slider().value).toBe("0");
    expect(getPosition).not.toHaveBeenCalled();

    fireEvent.change(slider(), { target: { value: "60" } });
    fireEvent.keyUp(slider(), { key: "ArrowUp" });
    expect(slider().value).toBe("60");
    fireEvent.keyUp(slider(), { key: "End" });
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("retains sub-threshold arrow progress and commits each threshold arrow only once", () => {
    const neverResolves = () => new Promise<AttendanceRecord>(() => undefined);
    const rightPosition = stubGeolocation((ok) => ok(near));
    const { unmount } = render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={neverResolves}
        onCheckedIn={vi.fn()}
      />,
    );

    fireEvent.change(slider(), { target: { value: "94" } });
    fireEvent.keyUp(slider(), { key: "ArrowRight" });
    expect(slider().value).toBe("94");
    expect(rightPosition).not.toHaveBeenCalled();

    fireEvent.change(slider(), { target: { value: "95" } });
    fireEvent.keyUp(slider(), { key: "ArrowRight" });
    expect(rightPosition).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(slider(), { key: "ArrowRight" });
    fireEvent.pointerUp(slider());
    fireEvent.touchEnd(slider());
    expect(rightPosition).toHaveBeenCalledTimes(1);

    unmount();
    const upPosition = stubGeolocation((ok) => ok(near));
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={neverResolves}
        onCheckedIn={vi.fn()}
      />,
    );
    fireEvent.change(slider(), { target: { value: "95" } });
    fireEvent.keyUp(slider(), { key: "ArrowUp" });
    expect(upPosition).toHaveBeenCalledTimes(1);
  });

  it("disables while delayed location and clock-in prevent repeated gesture events, then announces local success", async () => {
    let locate!: (position: typeof near) => void;
    const getPosition = stubGeolocation((ok) => {
      locate = ok;
    });
    const attendance = deferred<AttendanceRecord>();
    const clockIn = vi.fn().mockReturnValue(attendance.promise);
    const onCheckedIn = vi.fn();
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={clockIn}
        onCheckedIn={onCheckedIn}
      />,
    );

    fireEvent.change(slider(), { target: { value: "100" } });
    fireEvent.pointerUp(slider());
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(slider()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Checking you're at the gym…");
    expect(document.querySelector(".ready-fill")).toHaveAttribute("data-label", "");
    fireEvent.pointerUp(slider());
    fireEvent.touchEnd(slider());
    fireEvent.keyUp(slider(), { key: "End" });
    expect(getPosition).toHaveBeenCalledTimes(1);

    locate(near);
    await waitFor(() => expect(clockIn).toHaveBeenCalledTimes(1));
    expect(slider()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Clocking you in…");
    fireEvent.pointerUp(slider());
    fireEvent.touchEnd(slider());
    fireEvent.keyUp(slider(), { key: "End" });
    expect(clockIn).toHaveBeenCalledTimes(1);

    attendance.resolve(record);
    await screen.findByRole("heading", { name: "You're in" });
    expect(screen.getByRole("status")).toHaveTextContent("You're checked in.");
    expect(onCheckedIn).toHaveBeenCalledWith(record);
  });

  it("explains a denied location and a safe callable refusal, then lets the member retry", async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1 }));
    const clockIn = vi.fn().mockRejectedValue(
      Object.assign(new Error("x"), {
        code: "functions/failed-precondition",
        details: { reason: "outside", distanceMeters: 120 },
      }),
    );
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="sam"
        clockIn={clockIn}
        onCheckedIn={vi.fn()}
      />,
    );

    slideToEnd();
    await screen.findByText(
      "Location is off. Allow it for this site, or ask a coach to check you in.",
    );
    expect(clockIn).not.toHaveBeenCalled();

    stubGeolocation((ok) => ok(near));
    slideToEnd();
    await screen.findByText("You're 120 m away. Get to the gym and try again.");
    expect(slider().value).toBe("0");
  });

  it("keeps the current sibling hint after a committed check-in", async () => {
    const getPosition = stubGeolocation((ok) => ok(near));
    const props = {
      candidate: { kind: "ready" as const, session },
      program,
      studentId: "sam",
      clockIn: vi.fn().mockResolvedValue(record),
      onCheckedIn: vi.fn(),
    };
    const { rerender } = render(
      <ReadyForJiuJitsu {...props} siblingHint="Leo is ready too — switch to Leo" />,
    );

    slideToEnd();
    await screen.findByRole("heading", { name: "You're in" });
    expect(screen.getByText("Leo is ready too — switch to Leo")).toBeInTheDocument();
    expect(getPosition).toHaveBeenCalledTimes(1);

    rerender(<ReadyForJiuJitsu {...props} siblingHint="Maya is ready too — switch to Maya" />);
    expect(screen.getByText("Maya is ready too — switch to Maya")).toBeInTheDocument();
    rerender(<ReadyForJiuJitsu {...props} />);
    expect(screen.queryByText(/is ready too/u)).not.toBeInTheDocument();
  });

  it("shows the current sibling hint for a coach-derived attendance confirmation", () => {
    const getPosition = stubGeolocation((ok) => ok(near));
    const props = {
      candidate: {
        kind: "checkedIn" as const,
        session,
        attendance: {
          ...record,
          method: "manual" as const,
          state: "late" as const,
          occurredAt: "2026-09-15T17:04:00.000Z",
        },
      },
      program,
      studentId: "sam",
      clockIn: vi.fn(),
      onCheckedIn: vi.fn(),
    };
    const { rerender } = render(
      <ReadyForJiuJitsu {...props} siblingHint="Leo is ready too — switch to Leo" />,
    );

    expect(screen.getByRole("heading", { name: "You're in" })).toBeInTheDocument();
    expect(screen.getByText("18:04 · Late")).toBeInTheDocument();
    expect(screen.getByText("Leo is ready too — switch to Leo")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(getPosition).not.toHaveBeenCalled();

    rerender(<ReadyForJiuJitsu {...props} />);
    expect(screen.queryByText(/is ready too/u)).not.toBeInTheDocument();
  });

  it("shows the confirmation card for an existing record, whoever wrote it", () => {
    render(
      <ReadyForJiuJitsu
        candidate={{
          kind: "checkedIn",
          session,
          attendance: {
            ...record,
            method: "manual",
            state: "late",
            occurredAt: "2026-09-15T17:04:00.000Z",
          },
        }}
        program={program}
        studentId="sam"
        clockIn={vi.fn()}
        onCheckedIn={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "You're in" })).toBeInTheDocument();
    expect(screen.getByText("18:04 · Late")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("shows the sibling hint when given", () => {
    render(
      <ReadyForJiuJitsu
        candidate={{ kind: "ready", session }}
        program={program}
        studentId="maya"
        clockIn={vi.fn()}
        onCheckedIn={vi.fn()}
        siblingHint="Leo is ready too — switch to Leo"
      />,
    );
    expect(screen.getByText("Leo is ready too — switch to Leo")).toBeInTheDocument();
  });
});
