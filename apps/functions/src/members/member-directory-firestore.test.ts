import { FieldPath } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";

type NativeData = Record<string, unknown>;
type NativeDocumentReference = Readonly<{
  kind: "document";
  id: string;
  path: string;
  sdkOnly: true;
  get: () => Promise<never>;
}>;
type NativeDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => NativeData | undefined;
  sdkOnly: true;
}>;
type NativeQueryState = Readonly<{
  collectionPath: string;
  orderByField?: unknown;
  afterValue?: string;
  limitValue?: number;
}>;
type NativeQuery = NativeQueryState &
  Readonly<{
    kind: "query";
    orderBy: (field: unknown) => NativeQuery;
    startAfter: (value: string) => NativeQuery;
    limit: (value: number) => NativeQuery;
    get: () => Promise<never>;
  }>;
type NativeTransactionOptions = Readonly<{
  maxAttempts?: number;
  readOnly?: boolean;
}>;

function documentSnapshot(id: string, data: NativeData | undefined): NativeDocumentSnapshot {
  return Object.freeze({
    id,
    exists: data !== undefined,
    data: () => data,
    sdkOnly: true,
  });
}

function firestoreHarness(
  options?: Readonly<{
    documents?: Readonly<Record<string, NativeDocumentSnapshot>>;
    queryDocuments?: readonly NativeDocumentSnapshot[];
  }>,
) {
  const directIo: string[] = [];
  const transactionGetTargets: Array<NativeDocumentReference | NativeQuery> = [];
  const creates: Array<Readonly<{ path: string; data: NativeData }>> = [];
  const sets: Array<Readonly<{ path: string; data: NativeData }>> = [];
  const queryOperations: string[] = [];
  const documentReferences: NativeDocumentReference[] = [];
  const transactionOptions: Array<NativeTransactionOptions | undefined> = [];
  let transactionActive = false;

  function document(path: string): NativeDocumentReference {
    const reference = Object.freeze({
      kind: "document" as const,
      id: path.split("/").at(-1) ?? "",
      path,
      sdkOnly: true as const,
      get: async (): Promise<never> => {
        directIo.push(`document:${path}`);
        throw new Error("Direct document I/O is forbidden");
      },
    });
    documentReferences.push(reference);
    return reference;
  }

  function query(state: NativeQueryState): NativeQuery {
    return Object.freeze({
      kind: "query" as const,
      ...state,
      orderBy(field: unknown) {
        queryOperations.push("orderBy");
        return query({ ...state, orderByField: field });
      },
      startAfter(value: string) {
        queryOperations.push("startAfter");
        return query({ ...state, afterValue: value });
      },
      limit(value: number) {
        queryOperations.push("limit");
        return query({ ...state, limitValue: value });
      },
      get: async (): Promise<never> => {
        directIo.push(`query:${state.collectionPath}`);
        throw new Error("Direct query I/O is forbidden");
      },
    });
  }

  const nativeTransaction = {
    async get(target: NativeDocumentReference | NativeQuery) {
      if (!transactionActive) throw new Error("Read outside transaction");
      transactionGetTargets.push(target);
      if (target.kind === "query") {
        return Object.freeze({ docs: options?.queryDocuments ?? [] });
      }
      return options?.documents?.[target.path] ?? documentSnapshot(target.id, undefined);
    },
    create(reference: NativeDocumentReference, data: NativeData) {
      if (!transactionActive) throw new Error("Create outside transaction");
      creates.push(Object.freeze({ path: reference.path, data }));
      return nativeTransaction;
    },
    set(reference: NativeDocumentReference, data: NativeData) {
      if (!transactionActive) throw new Error("Set outside transaction");
      sets.push(Object.freeze({ path: reference.path, data }));
      return nativeTransaction;
    },
  };

  const firestore = {
    doc: document,
    collection: (path: string) => query({ collectionPath: path }),
    async runTransaction<T>(
      callback: (transaction: typeof nativeTransaction) => Promise<T>,
      options?: NativeTransactionOptions,
    ): Promise<T> {
      transactionOptions.push(options);
      transactionActive = true;
      try {
        return await callback(nativeTransaction);
      } finally {
        transactionActive = false;
      }
    },
  };

  return {
    firestore,
    directIo,
    transactionGetTargets,
    creates,
    sets,
    queryOperations,
    documentReferences,
    transactionOptions,
  };
}

describe("member-directory Firestore Admin adapters", () => {
  it("converts writer snapshots and keeps writer reads and mutations in one transaction", async () => {
    const sourceData = { stateId: "current", stateRevision: 7 };
    const sourceSnapshot = documentSnapshot("current", sourceData);
    const harness = firestoreHarness({
      documents: {
        "academies/academy-1/memberDirectoryStates/current": sourceSnapshot,
      },
    });
    const { writer } = createMemberDirectoryFirestoreAdapters(harness.firestore as never);

    const result = await writer.runTransaction(async (transaction) => {
      const stateReference = writer.doc("academies/academy-1/memberDirectoryStates/current");
      const snapshot = await transaction.get(stateReference);
      const chained = transaction
        .create(writer.doc("academies/academy-1/students/student-1"), {
          studentId: "student-1",
        })
        .set(writer.doc("academies/academy-1/memberDirectoryStates/current"), {
          stateRevision: 8,
        });
      expect(chained).toBe(transaction);
      return snapshot;
    });

    expect(result).not.toBe(sourceSnapshot);
    expect(result).toEqual({ id: "current", exists: true, data: expect.any(Function) });
    expect(result.data()).toEqual(sourceData);
    expect(result.data()).not.toBe(sourceData);
    expect(harness.creates).toEqual([
      {
        path: "academies/academy-1/students/student-1",
        data: { studentId: "student-1" },
      },
    ]);
    expect(harness.sets).toEqual([
      {
        path: "academies/academy-1/memberDirectoryStates/current",
        data: { stateRevision: 8 },
      },
    ]);
    expect(harness.transactionOptions).toEqual([undefined]);
    expect(harness.directIo).toEqual([]);
  });

  it("lists students through the transaction using document ID, cursor and exact limit", async () => {
    const profileData = { studentId: "student-7", membershipNumber: "BPT-7" };
    const profileSnapshot = documentSnapshot("student-7", profileData);
    const studentData = { studentId: "student-8", fullName: "Student Eight" };
    const studentSnapshot = documentSnapshot("student-8", studentData);
    const harness = firestoreHarness({
      documents: {
        "academies/academy-1/studentAdminProfiles/student-7": profileSnapshot,
      },
      queryDocuments: [studentSnapshot],
    });
    const { reader } = createMemberDirectoryFirestoreAdapters(harness.firestore as never);

    const result = await reader.runTransaction(async (transaction) => {
      const profile = await transaction.get("academies/academy-1/studentAdminProfiles/student-7");
      const students = await transaction.listStudents({
        academyId: "academy-1",
        afterDocumentId: "student-7",
        limit: 3,
      });
      transaction.create("academies/academy-1/auditEvents/audit-1", {
        action: "member.listed",
      });
      transaction.set("academies/academy-1/studentRestrictedReadLimits/owner-1", {
        count: 1,
      });
      return { profile, students };
    });

    expect(result.profile).toEqual({
      id: "student-7",
      exists: true,
      data: profileData,
    });
    expect(result.profile).not.toBe(profileSnapshot);
    expect(result.profile.data).not.toBe(profileData);
    expect(result.students).toEqual([{ id: "student-8", exists: true, data: studentData }]);
    expect(result.students[0]).not.toBe(studentSnapshot);
    expect(result.students[0]?.data).not.toBe(studentData);
    expect(harness.queryOperations).toEqual(["orderBy", "startAfter", "limit"]);
    const queryTarget = harness.transactionGetTargets.find(
      (target): target is NativeQuery => target.kind === "query",
    );
    expect(queryTarget).toBeDefined();
    expect((queryTarget?.orderByField as FieldPath).isEqual(FieldPath.documentId())).toBe(true);
    expect(queryTarget).toMatchObject({
      collectionPath: "academies/academy-1/students",
      afterValue: "student-7",
      limitValue: 3,
    });
    expect(harness.creates).toEqual([
      {
        path: "academies/academy-1/auditEvents/audit-1",
        data: { action: "member.listed" },
      },
    ]);
    expect(harness.sets).toEqual([
      {
        path: "academies/academy-1/studentRestrictedReadLimits/owner-1",
        data: { count: 1 },
      },
    ]);
    expect(harness.transactionOptions).toEqual([{ maxAttempts: 10 }]);
    expect(harness.directIo).toEqual([]);
  });

  it("omits startAfter when no cursor is present and preserves a limit of one", async () => {
    const harness = firestoreHarness();
    const { reader } = createMemberDirectoryFirestoreAdapters(harness.firestore as never);

    await reader.runTransaction((transaction) =>
      transaction.listStudents({ academyId: "academy-1", limit: 1 }),
    );

    expect(harness.queryOperations).toEqual(["orderBy", "limit"]);
    const queryTarget = harness.transactionGetTargets.find(
      (target): target is NativeQuery => target.kind === "query",
    );
    expect(queryTarget).toMatchObject({
      collectionPath: "academies/academy-1/students",
      limitValue: 1,
    });
    expect(queryTarget).not.toHaveProperty("afterValue");
    expect(harness.directIo).toEqual([]);
  });
});
