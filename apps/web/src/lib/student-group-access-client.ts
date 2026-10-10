import { z } from "zod";
import { httpsCallable } from "./callable";
import {
  memberAgeRangeSchema,
  studentGroupAccessSchema,
  studentGroupAccessQuerySchema,
  saveStudentAgeRangeSchema,
  saveStudentGroupAccessSchema,
  type SaveStudentAgeRange,
  type SaveStudentGroupAccess,
} from "@bpt-jersey/domain/schedule/member-calendar";
import { getFirebaseFunctions } from "./firebase-client";

// The server consumes these App Check tokens once (SEC-02).
const limitedUse = Object.freeze({ limitedUseAppCheckTokens: true });

export async function getStudentGroupAccess(studentId: string) {
  const response = await httpsCallable(getFirebaseFunctions(), "getStudentGroupAccess")(
    studentGroupAccessQuerySchema.parse({ studentId }),
  );
  const access = studentGroupAccessSchema.parse(response.data);
  if (access.studentId !== studentId) throw new Error("Group access is unavailable.");
  return access;
}

export async function saveStudentGroupAccess(input: SaveStudentGroupAccess) {
  const response = await httpsCallable(getFirebaseFunctions(), "saveStudentGroupAccess", limitedUse)(
    saveStudentGroupAccessSchema.parse(input),
  );
  const access = studentGroupAccessSchema.parse(response.data);
  if (access.studentId !== input.studentId) throw new Error("Group access is unavailable.");
  return access;
}

export async function saveStudentAgeRange(input: SaveStudentAgeRange) {
  const response = await httpsCallable(getFirebaseFunctions(), "saveStudentAgeRange", limitedUse)(
    saveStudentAgeRangeSchema.parse(input),
  );
  const access = studentGroupAccessSchema.parse(response.data);
  if (access.studentId !== input.studentId) throw new Error("Access is unavailable.");
  return access;
}

const exceptionRowSchema = z.strictObject({
  studentId: z.string(),
  fullName: z.string(),
  dateOfBirth: z.string().nullable(),
  programIds: z.array(z.string()),
  ageRange: memberAgeRangeSchema.nullable(),
  expiresOn: z.string().nullable(),
});
export type AccessExceptionRow = z.infer<typeof exceptionRowSchema>;

export async function listStudentAccessExceptions(): Promise<readonly AccessExceptionRow[]> {
  const response = await httpsCallable(getFirebaseFunctions(), "listStudentAccessExceptions")({});
  const parsed = z.strictObject({ rows: z.array(exceptionRowSchema) }).safeParse(response.data);
  if (!parsed.success) throw new Error("Unable to load access exceptions.");
  return parsed.data.rows;
}
