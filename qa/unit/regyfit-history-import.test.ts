import { describe, expect, it } from "vitest";

import {
  chooseSession,
  groupStudentName,
  historyEventDocument,
  historyEventId,
  importActorId,
  mapHistoryRow,
  normaliseName,
  resolveMemberFrom,
  rowMembershipNumber,
  parseHistorySentence,
  parseLogTimestamp,
  type HistoryRow,
  type MapOptions,
  type MemberIndex,
  type MappedEvent,
  type RejectedRow,
} from "../scripts/regyfit-history-import.mjs";

// Every name, address and class below is invented for this test: the real capture never enters the
// repository.
function row(
  sentence: string,
  loggedAt = "16-09-2026 11:59",
  user = "Synthetic User",
  membershipNumber = "",
): HistoryRow {
  return [loggedAt, user, "203.0.113.10", membershipNumber, sentence];
}

const session = { sessionId: "session-1", programId: "program-1", locationId: "town" };

function options(overrides: Partial<MapOptions> = {}): MapOptions {
  return {
    academyId: "demo-academy",
    resolveSession: () => null,
    resolveMember: () => null,
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

describe("resolveMemberFrom", () => {
  const index: MemberIndex = {
    byMembershipNumber: new Map([["bpt 0007", "member-by-number"]]),
    byName: new Map([["synthetic athlete", "member-by-name"]]),
  };

  it("lets the membership number decide when the row carries one", () => {
    expect(
      resolveMemberFrom(index, {
        membershipNumber: "BPT 0007",
        fullName: "Synthetic Athlete",
      }),
    ).toBe("member-by-number");
  });

  it("falls back to the name only when the row carries no membership number", () => {
    expect(
      resolveMemberFrom(index, { membershipNumber: null, fullName: "Synthetic Athlete" }),
    ).toBe("member-by-name");
  });

  it("falls back to the name when the membership number matches nobody", () => {
    expect(
      resolveMemberFrom(index, { membershipNumber: "BPT 9999", fullName: "Synthetic Athlete" }),
    ).toBe("member-by-name");
  });

  it("answers with nobody when neither key matches", () => {
    expect(resolveMemberFrom(index, { membershipNumber: null, fullName: "Ayesha" })).toBeNull();
  });
});

describe("mapHistoryRow", () => {
  it("hands the resolver the membership number the row carries, ahead of the name", () => {
    const seen: { membershipNumber: string | null; fullName: string }[] = [];
    const result = mapped(
      mapHistoryRow(
        row(
          "O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00",
          "16-09-2026 11:59",
          "Synthetic User",
          "BPT 0007",
        ),
        options({
          resolveMember: (person) => {
            seen.push(person);
            return person.membershipNumber === "BPT 0007" ? "member-by-number" : "member-by-name";
          },
        }),
      ),
    );

    expect(seen).toEqual([{ membershipNumber: "BPT 0007", fullName: "Synthetic Athlete" }]);
    expect(result.draft.class.memberId).toBe("member-by-number");
  });

  it("reads an empty reference column as no membership number at all", () => {
    expect(rowMembershipNumber(row("anything"))).toBeNull();
  });

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
        memberId: null,
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
    expect(result.notes).toEqual(["member-unmatched", "session-unmatched"]);
  });

  it("links the member and the session the target already holds", () => {
    const result = mapped(
      mapHistoryRow(
        row("O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        options({
          resolveSession: (startAt) => (startAt === "2026-09-23T06:00:00Z" ? session : null),
          resolveMember: (person) => (person.fullName === "Synthetic Athlete" ? "member-7" : null),
        }),
      ),
    );

    expect(result.draft.class).toEqual({
      // An imported row belongs to the member directory, never to a student record.
      studentId: null,
      memberId: "member-7",
      // The directory names the member from now on; the imported spelling is not kept beside it.
      studentName: null,
      sessionId: "session-1",
      sessionStartAt: "2026-09-23T06:00:00Z",
      programId: "program-1",
      locationId: "town",
    });
    expect(result.notes).toEqual([]);
  });

  it("never invents a member when two records answer to the same name", () => {
    const result = mapped(
      mapHistoryRow(
        row("O atleta Synthetic Athlete Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        options({ resolveMember: () => "ambiguous" }),
      ),
    );

    expect(result.draft.class.memberId).toBeNull();
    expect(result.draft.class.studentName).toBe("Synthetic Athlete");
    expect(result.notes).toContain("member-ambiguous");
  });

  it("keeps an unmatched person unmatched, with the captured name and a review note", () => {
    const result = mapped(
      mapHistoryRow(
        row("O atleta Ayesha Inscreveu-se na aula do dia 23 Sep 2026 pelas 07:00"),
        // "Ayesha" is a first name Regyfit prints alone: the directory holds no such full name, and
        // guessing at one of the members whose first name it is would fabricate the link.
        options({ resolveMember: (person) => (person.fullName === "Ayesha" ? null : "member-7") }),
      ),
    );

    expect(result.draft.class.memberId).toBeNull();
    expect(result.draft.class.studentId).toBeNull();
    expect(result.draft.class.studentName).toBe("Ayesha");
    expect(result.notes).toContain("member-unmatched");
  });

  it("marks a group booking as a group and leaves it without a student", () => {
    const result = mapped(
      mapHistoryRow(
        row("O grupo/equipa Competition Team foi inscrito na aula do dia 2 Mar 2026 pelas 18:30"),
        options({ resolveMember: () => "member-7" }),
      ),
    );

    expect(result.draft.class.memberId).toBeNull();
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
        options({ resolveMember: () => "member-7" }),
      ),
    );

    expect(result.draft.action).toBe("attendance.checked_in");
    expect(result.draft.actorGroup).toBe("staff");
    expect(result.draft.class.memberId).toBeNull();
    expect(result.draft.class.studentName).toBeNull();
    expect(result.draft.class.sessionStartAt).toBe("2026-09-16T17:30:00Z");
    // An unlinked attendance row is noted like any other: a null session the operator cannot see
    // in the review file is a gap nobody can audit.
    expect(result.notes).toEqual(["session-unmatched"]);
  });

  it("leaves a typed sentence unlinked when the only session at that time is another class", () => {
    const result = mapped(
      mapHistoryRow(
        row(
          "O atleta Synthetic Athlete cancelou a inscrição na aula NoGI do dia 2 Mar 2026 pelas 18:30",
        ),
        // The target holds exactly one session at that minute, and it is a different class: a lone
        // candidate is not evidence, so the row stays unlinked rather than pointing at the wrong one.
        options({ resolveSession: () => "class-mismatch" }),
      ),
    );

    expect(result.draft.class.sessionId).toBeNull();
    expect(result.draft.class.programId).toBeNull();
    expect(result.draft.class.sessionStartAt).toBe("2026-03-02T18:30:00Z");
    expect(result.notes).toContain("session-class-mismatch");
    expect(result.notes).not.toContain("session-unmatched");
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

describe("chooseSession", () => {
  const gi = { sessionId: "session-gi", programId: "program-gi", locationId: "town" };
  const nogi = { sessionId: "session-nogi", programId: "program-nogi", locationId: "town" };
  const names = new Map([
    ["program-gi", "GI All Levels"],
    ["program-nogi", "NoGI"],
  ]);

  it("takes the only session at that minute when the sentence names no class", () => {
    expect(chooseSession([gi], null, names)).toBe(gi);
  });

  it("takes none of several sessions when the sentence names no class", () => {
    expect(chooseSession([gi, nogi], null, names)).toBeNull();
  });

  it("refuses the only session at that minute when the sentence names another class", () => {
    // The bug this closes: a lone candidate used to win before the name was ever compared.
    expect(chooseSession([gi], "NoGI", names)).toBe("class-mismatch");
  });

  it("picks the named class out of several sessions at that minute", () => {
    expect(chooseSession([gi, nogi], "nogi", names)).toBe(nogi);
  });

  it("finds nothing at a minute the target has no session for", () => {
    expect(chooseSession([], "NoGI", names)).toBeNull();
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
