import { describe, expect, it } from "vitest";

import {
  groupStudentName,
  historyEventDocument,
  historyEventId,
  importActorId,
  mapHistoryRow,
  normaliseName,
  parseHistorySentence,
  parseLogTimestamp,
  type HistoryRow,
  type MapOptions,
  type MappedEvent,
  type RejectedRow,
} from "../scripts/regyfit-history-import.mjs";

// Every name, address and class below is invented for this test: the real capture never enters the
// repository.
function row(sentence: string, loggedAt = "16-09-2026 11:59", user = "Synthetic User"): HistoryRow {
  return [loggedAt, user, "203.0.113.10", "", sentence];
}

const session = { sessionId: "session-1", programId: "program-1", locationId: "town" };

function options(overrides: Partial<MapOptions> = {}): MapOptions {
  return {
    academyId: "demo-academy",
    resolveSession: () => null,
    resolveStudent: () => null,
    ...overrides,
  };
}

function mapped(result: MappedEvent | RejectedRow): MappedEvent {
  if (!result.ok) throw new Error(`expected a mapped event, got ${result.reason}`);
  return result;
}

function rejected(result: MappedEvent | RejectedRow): RejectedRow {
  if (result.ok) throw new Error("expected the row to be rejected");
  return result;
}

describe("parseHistorySentence", () => {
  it("reads an athlete's own booking as a member booking", () => {
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
      ),
    ).toEqual({
      family: "member-booking",
      action: "booking.created",
      actorGroup: "member",
      studentName: "Synthetic Athlete",
      groupName: null,
      programName: null,
      classDate: "2026-09-23",
      classTime: "07:00",
    });
  });

  it("reads a booking the office made as a staff booking", () => {
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete foi inscrito pelo ADMIN na aula do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({
      family: "admin-booking",
      action: "booking.created",
      actorGroup: "staff",
      studentName: "Synthetic Athlete",
      classDate: "2026-03-02",
      classTime: "18:30",
    });
  });

  it("keeps the class type the office booking names", () => {
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete foi inscrito pelo ADMIN em GI Beginners no dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({
      family: "admin-booking-typed",
      actorGroup: "staff",
      studentName: "Synthetic Athlete",
      programName: "GI Beginners",
    });
  });

  it("reads a booking made through the app as the member's own", () => {
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete foi inscrito pela APP na aula do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({ family: "app-booking", action: "booking.created", actorGroup: "member" });
  });

  it("reads a marked attendance as a staff check-in of that class", () => {
    expect(
      parseHistorySentence("Foram marcadas presenças e faltas da aula: 1234 | 16-09-2026 | 18:30"),
    ).toEqual({
      family: "attendance",
      action: "attendance.checked_in",
      actorGroup: "staff",
      studentName: null,
      groupName: null,
      programName: null,
      classDate: "2026-09-16",
      classTime: "18:30",
    });
  });

  it("refuses the broken attendance rows that name no class at all", () => {
    expect(parseHistorySentence("Foram marcadas presenças e faltas da aula: | |")).toBeNull();
  });

  it("reads a member's own cancellation, with and without the class type", () => {
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete cancelou a inscrição na aula do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({
      family: "member-cancellation",
      action: "booking.cancelled",
      actorGroup: "member",
      programName: null,
    });
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete cancelou a inscrição na aula NoGI do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({
      family: "member-cancellation-typed",
      action: "booking.cancelled",
      actorGroup: "member",
      programName: "NoGI",
    });
  });

  it("reads a cancellation the office made as a staff cancellation", () => {
    expect(
      parseHistorySentence(
        "Foi eliminada pelo ADMIN a inscrição de Synthetic Athlete da aula do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({
      family: "admin-cancellation",
      action: "booking.cancelled",
      actorGroup: "staff",
      studentName: "Synthetic Athlete",
    });
  });

  it("names no student when the office cancellation names none", () => {
    expect(
      parseHistorySentence(
        "Foi eliminada pelo ADMIN a inscrição de  da aula do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({ family: "admin-cancellation", studentName: null });
  });

  it("reads a group booking as a staff booking that names a team, not a person", () => {
    expect(
      parseHistorySentence(
        "O grupo/equipa Competition Team foi inscrito na aula do dia 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({
      family: "group-booking",
      action: "booking.created",
      actorGroup: "staff",
      studentName: null,
      groupName: "Competition Team",
    });
  });

  it("reads drop-ins and trials as staff drop-in bookings, with or without an e-mail", () => {
    expect(
      parseHistorySentence(
        "Um dropin foi inscrito numa aula: Synthetic Guest » guest@example.test - 2 Mar 2026 at 18:30",
      ),
    ).toMatchObject({
      family: "dropin-booking",
      action: "dropin.created",
      actorGroup: "staff",
      studentName: "Synthetic Guest",
      classDate: "2026-03-02",
      classTime: "18:30",
    });
    expect(
      parseHistorySentence(
        "Um experiência foi inscrito numa aula: Synthetic Guest » - 2 Mar 2026 pelas 18:30",
      ),
    ).toMatchObject({ family: "dropin-booking", studentName: "Synthetic Guest" });
  });

  it("reads a deleted drop-in as a drop-in cancellation", () => {
    expect(
      parseHistorySentence(
        "Eliminou a inscrição do experiência Synthetic Guest da aula do dia: 2 Mar 2026 18:30",
      ),
    ).toMatchObject({
      family: "dropin-cancellation",
      action: "dropin.cancelled",
      actorGroup: "staff",
      studentName: "Synthetic Guest",
    });
  });

  it("reads the Portuguese month abbreviations Regyfit mixes in", () => {
    expect(
      parseHistorySentence(
        "O atleta Synthetic Athlete Inscreveu-se na aula do dia 3 Set 2026 pelas 07:00",
      ),
    ).toMatchObject({ classDate: "2026-09-03" });
  });

  it("recognises no sentence it was not taught", () => {
    expect(
      parseHistorySentence(
        "Foi eliminada a inscrição automatica nas aula do aluno 123 na aula 3*22",
      ),
    ).toBeNull();
    expect(parseHistorySentence("O atleta Synthetic Athlete fez outra coisa qualquer")).toBeNull();
  });
});

describe("parseLogTimestamp", () => {
  it("reads the log's Jersey wall clock as the UTC instant, on BST and on GMT", () => {
    expect(parseLogTimestamp("16-09-2026 11:59")).toBe("2026-09-16T10:59:00Z");
    expect(parseLogTimestamp("05-12-2025 09:30")).toBe("2025-12-05T09:30:00Z");
  });

  it("reads nothing from a stamp that is not the log's format", () => {
    expect(parseLogTimestamp("2026-09-16 11:59")).toBeNull();
    expect(parseLogTimestamp("")).toBeNull();
  });
});

describe("normaliseName", () => {
  it("ignores case, accents and spacing, and nothing else", () => {
    expect(normaliseName("  Gregório  CAMACHO ")).toBe("gregorio camacho");
    expect(normaliseName("Amoné Mouton")).toBe(normaliseName("amone mouton"));
    expect(normaliseName("Ana Lewis")).not.toBe(normaliseName("Ana Lewes"));
  });
});

describe("mapHistoryRow", () => {
  it("maps a member booking onto an imported audit event with the class moment in UTC", () => {
    const result = mapped(
      mapHistoryRow(
        row("O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        options(),
      ),
    );

    expect(result.occurredAt).toBe("2026-09-16T10:59:00Z");
    expect(result.draft).toEqual({
      academyId: "demo-academy",
      actorId: importActorId,
      action: "booking.created",
      targetRef: `academies/demo-academy/auditEvents/${result.eventId}`,
      purpose: "regyfit-history-import",
      correlationId: result.eventId,
      class: {
        studentId: null,
        studentName: "Synthetic Athlete",
        sessionId: null,
        // 07:00 on a Jersey September morning is 06:00 UTC, not 07:00.
        sessionStartAt: "2026-09-23T06:00:00Z",
        programId: null,
        locationId: null,
      },
      actorIp: "203.0.113.10",
      actorRole: "regyfit",
      actorGroup: "member",
      actorName: "Synthetic User",
      source: "regyfit",
    });
    expect(result.notes).toEqual(["student-unmatched", "session-unmatched"]);
  });

  it("links the student and the session the target already holds", () => {
    const result = mapped(
      mapHistoryRow(
        row("O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        options({
          resolveSession: (startAt) => (startAt === "2026-09-23T06:00:00Z" ? session : null),
          resolveStudent: (name) => (name === "Synthetic Athlete" ? "student-7" : null),
        }),
      ),
    );

    expect(result.draft.class).toEqual({
      studentId: "student-7",
      // The record names the student from now on; the imported spelling is not kept beside it.
      studentName: null,
      sessionId: "session-1",
      sessionStartAt: "2026-09-23T06:00:00Z",
      programId: "program-1",
      locationId: "town",
    });
    expect(result.notes).toEqual([]);
  });

  it("never invents a student when two records answer to the same name", () => {
    const result = mapped(
      mapHistoryRow(
        row("O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        options({ resolveStudent: () => "ambiguous" }),
      ),
    );

    expect(result.draft.class.studentId).toBeNull();
    expect(result.draft.class.studentName).toBe("Synthetic Athlete");
    expect(result.notes).toContain("student-ambiguous");
  });

  it("marks a group booking as a group and leaves it without a student", () => {
    const result = mapped(
      mapHistoryRow(
        row("O grupo/equipa Competition Team foi inscrito na aula do dia 2 Mar 2026 pelas 18:30"),
        options({ resolveStudent: () => "student-7" }),
      ),
    );

    expect(result.draft.class.studentId).toBeNull();
    expect(result.draft.class.studentName).toBe("Group: Competition Team");
    expect(result.draft.actorGroup).toBe("staff");
  });

  it("notes a group booking that names no group", () => {
    const result = mapped(
      mapHistoryRow(
        row("O grupo/equipa foi inscrito na aula do dia 2 Mar 2026 pelas 18:30"),
        options(),
      ),
    );

    expect(result.draft.class.studentName).toBeNull();
    expect(result.notes).toContain("group-not-named");
  });

  it("writes an attendance row with no student and no session gap to report", () => {
    const result = mapped(
      mapHistoryRow(
        row("Foram marcadas presenças e faltas da aula: 1234 | 16-09-2026 | 18:30"),
        options({ resolveStudent: () => "student-7" }),
      ),
    );

    expect(result.draft.action).toBe("attendance.checked_in");
    expect(result.draft.actorGroup).toBe("staff");
    expect(result.draft.class.studentId).toBeNull();
    expect(result.draft.class.studentName).toBeNull();
    expect(result.draft.class.sessionStartAt).toBe("2026-09-16T17:30:00Z");
    expect(result.notes).toEqual([]);
  });

  it("drops the address when the log did not record one", () => {
    const result = mapped(
      mapHistoryRow(
        [
          "16-09-2026 11:59",
          "Synthetic User",
          "",
          "",
          "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
        ],
        options(),
      ),
    );

    expect(result.draft.actorIp).toBeNull();
  });

  it("sends a sentence it does not recognise to review, with its own text", () => {
    const result = rejected(
      mapHistoryRow(row("Foram marcadas presenças e faltas da aula: | |"), options()),
    );

    expect(result.reason).toBe("unrecognised-sentence");
    expect(result.sentence).toBe("Foram marcadas presenças e faltas da aula: | |");
    expect(result.loggedAt).toBe("16-09-2026 11:59");
  });

  it("sends a row whose own log stamp is unreadable to review", () => {
    const result = rejected(
      mapHistoryRow(
        row(
          "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
          "ontem",
        ),
        options(),
      ),
    );

    expect(result.reason).toBe("unreadable-log-timestamp");
  });
});

describe("historyEventId", () => {
  it("gives one Regyfit row one id, so a second import writes nothing twice", () => {
    const first = row(
      "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
    );
    const again = row(
      "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
    );

    expect(historyEventId(first)).toBe(historyEventId(again));
    expect(mapped(mapHistoryRow(first, options())).eventId).toBe(
      mapped(mapHistoryRow(again, options())).eventId,
    );
    expect(historyEventId(first)).toMatch(/^regyfit-[0-9a-f]{40}$/u);
  });

  it("gives two different rows two different ids", () => {
    const booking = row(
      "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
    );
    const cancellation = row(
      "O atleta Synthetic Athlete cancelou a inscrição na aula do dia 23 Sep 2026 pelas 07:00",
    );
    const later = row(
      "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
      "16-09-2026 12:01",
    );

    expect(
      new Set([historyEventId(booking), historyEventId(cancellation), historyEventId(later)]).size,
    ).toBe(3);
  });
});

describe("historyEventDocument", () => {
  it("stores the row's real log instant, not the moment of the import", () => {
    const event = mapped(
      mapHistoryRow(
        row("O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        options(),
      ),
    );

    const document = historyEventDocument(event, (iso) => ({ stamped: iso }));

    expect(document.occurredAt).toEqual({ stamped: "2026-09-16T10:59:00Z" });
    expect(document.auditEventId).toBe(event.eventId);
    expect(document.result).toBe("completed");
    expect(document.schemaVersion).toBe(1);
    expect(document.source).toBe("regyfit");
  });
});

describe("groupStudentName", () => {
  it("says a group is a group and keeps the name inside the audit field's bound", () => {
    expect(groupStudentName("Kids Team")).toBe("Group: Kids Team");
    expect(groupStudentName(null)).toBeNull();
    expect(groupStudentName("A".repeat(200))).toHaveLength(128);
  });
});
