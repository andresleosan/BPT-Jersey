import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { projectIntroAttendance } from "./intro-conversion-service.js";

export const introAttendanceCreated = onDocumentCreated(
  { document: "academies/{academyId}/attendance/{attendanceId}", retry: true },
  async (event) => {
    await projectIntroAttendance(getFirestore(), {
      academyId: event.params.academyId,
      attendanceId: event.params.attendanceId,
      now: event.time,
    });
  },
);
