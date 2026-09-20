import type { Firestore } from "firebase-admin/firestore";
import { parseMemberRecord } from "@bpt-jersey/domain/members";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import type { MemberMigrationStore } from "./member-migration-service.js";

export function createFirestoreMemberMigrationStore(firestore: Firestore): MemberMigrationStore {
  return {
    async load(academyId) {
      const root = `academies/${academyId}`;
      const [members, records, decisions, officeLinks, memberLinks] = await Promise.all(
        [
          "members",
          "regyfitMemberRecords",
          "memberMigrationDecisions",
          "regyfitOfficeLinks",
          "regyfitMemberLinks",
        ].map((name) => firestore.collection(`${root}/${name}`).limit(501).get()),
      );
      if ([members, records, decisions, officeLinks, memberLinks].some((page) => !page || page.size > 500)) {
        throw new Error("The migration preview exceeds its bounded window. Use paginated inventory review.");
      }
      // Fail loud: a row we cannot parse would silently vanish from the queue.
      const parsedMembers = members!.docs.map((document) => {
        const parsed = parseMemberRecord(document.data());
        if (!parsed.ok) throw new Error(`Legacy member ${document.id} does not parse`);
        return parsed.value;
      });
      const parsedRecords = records!.docs.map((document) => {
        const parsed = parseStoredRegyfitMemberRecord(document.data());
        if (!parsed.ok) throw new Error(`Archive record ${document.id} does not parse`);
        return parsed.value;
      });
      return {
        versions: {
          members: Object.fromEntries(members!.docs.map((doc) => [doc.id, `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`])),
          records: Object.fromEntries(records!.docs.map((doc) => [doc.id, `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`])),
        },
        members: parsedMembers,
        records: parsedRecords,
        decidedMemberIds: new Set(decisions!.docs.map((document) => document.id)),
        linkedRecordIds: new Set(
          [...officeLinks!.docs, ...memberLinks!.docs].map((document) => document.id),
        ),
      };
    },
  };
}
