import { httpsCallable } from "firebase/functions";
import {
  studentGroupAccessSchema,
  studentGroupAccessQuerySchema,
  saveStudentGroupAccessSchema,
  type SaveStudentGroupAccess,
} from "@bpt-jersey/domain/schedule/member-calendar";
import { getFirebaseFunctions } from "./firebase-client";

export async function getStudentGroupAccess(studentId: string) {
  const response = await httpsCallable(getFirebaseFunctions(), "getStudentGroupAccess")(
    studentGroupAccessQuerySchema.parse({ studentId }),
  );
  const access = studentGroupAccessSchema.parse(response.data);
  if (access.studentId !== studentId) throw new Error("Group access is unavailable.");
  return access;
}

export async function saveStudentGroupAccess(input: SaveStudentGroupAccess) {
  const response = await httpsCallable(getFirebaseFunctions(), "saveStudentGroupAccess")(
    saveStudentGroupAccessSchema.parse(input),
  );
  const access = studentGroupAccessSchema.parse(response.data);
  if (access.studentId !== input.studentId) throw new Error("Group access is unavailable.");
  return access;
}
