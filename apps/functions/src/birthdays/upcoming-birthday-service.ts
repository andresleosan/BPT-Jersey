import {
  deriveUpcomingBirthdays,
  type UpcomingBirthday,
  type UpcomingBirthdayCandidate,
  type UpcomingBirthdayQuery,
} from "@bpt-jersey/domain/birthdays";

/**
 * T112: the upcoming birthdays of the canonical students, for the coach panel that used to
 * announce an invented sample list.
 *
 * Read-only and derived: nothing is stored, so there is no birthday record to keep in sync with the
 * member record. The date of birth is read here and never leaves: the projection carries the name,
 * how many days away the birthday is and whether the member is an adult or a minor.
 */
export type BirthdayErrorCode = "invalid" | "conflict";

export class UpcomingBirthdayError extends Error {
  public constructor(
    public readonly code: BirthdayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UpcomingBirthdayError";
  }
}

export type BirthdayDocumentData = Readonly<Record<string, unknown>>;
export type BirthdayQuerySnapshot = Readonly<{
  docs: readonly Readonly<{ id: string; data: () => BirthdayDocumentData | undefined }>[];
}>;
export type BirthdayQuery = Readonly<{
  where: (field: string, operator: "==", value: unknown) => BirthdayQuery;
  limit: (count: number) => BirthdayQuery;
  get: () => Promise<BirthdayQuerySnapshot>;
}>;
export type BirthdayFirestore = Readonly<{
  collection: (path: string) => BirthdayQuery;
}>;

export type UpcomingBirthdayService = Readonly<{
  listUpcomingBirthdays: (
    input: Readonly<{ academyId: string; query: UpcomingBirthdayQuery; today?: string }>,
  ) => Promise<readonly UpcomingBirthday[]>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
/** One page of active students. Above it the panel refuses rather than showing a partial list. */
const maxActiveStudents = 2_000;

function fail(code: BirthdayErrorCode, message: string): never {
  throw new UpcomingBirthdayError(code, message);
}

function candidate(
  id: string,
  value: BirthdayDocumentData | undefined,
  academyId: string,
): UpcomingBirthdayCandidate | undefined {
  if (value === undefined || value.academyId !== academyId) return undefined;
  if (typeof value.studentId !== "string" || value.studentId !== id) return undefined;
  if (typeof value.fullName !== "string" || typeof value.dateOfBirth !== "string") return undefined;
  if (typeof value.participantType !== "string" || typeof value.trainingCenter !== "string") {
    return undefined;
  }
  return Object.freeze({
    studentId: value.studentId,
    fullName: value.fullName,
    dateOfBirth: value.dateOfBirth,
    participantType: value.participantType,
    trainingCenter: value.trainingCenter,
    active: value.active === true,
    status: typeof value.status === "string" ? value.status : "",
  });
}

export function createUpcomingBirthdayService(options: {
  firestore: BirthdayFirestore;
  now?: () => string;
}): UpcomingBirthdayService {
  return {
    async listUpcomingBirthdays(input) {
      if (!identifierPattern.test(input.academyId)) fail("invalid", "academyId is invalid");
      const today = input.today ?? options.now?.() ?? new Date().toISOString().slice(0, 10);
      if (!dateOnlyPattern.test(today)) fail("invalid", "Today is invalid");

      const snapshot = await options.firestore
        .collection(`academies/${input.academyId}/students`)
        .where("active", "==", true)
        .limit(maxActiveStudents + 1)
        .get();
      if (snapshot.docs.length > maxActiveStudents) {
        fail("conflict", "More active students than one birthday page may review");
      }

      const candidates = snapshot.docs
        .map((document) => candidate(document.id, document.data(), input.academyId))
        .filter((value): value is UpcomingBirthdayCandidate => value !== undefined);

      return deriveUpcomingBirthdays({
        today,
        windowDays: input.query.windowDays,
        candidates,
        ...(input.query.trainingCenter === undefined
          ? {}
          : { trainingCenter: input.query.trainingCenter }),
      });
    },
  };
}
