// Test-only type surface for the .mjs exports, following the purge script convention.
export declare const revertConfirmation: "member-unification-s1-revert-v1";
export declare function resolveTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
  apply: boolean;
};

export declare function revertPlan(docs: {
  decisions: readonly {
    id: string;
    migrationId?: string;
    kind?: string;
    studentId?: string;
  }[];
  profiles: readonly {
    id: string;
    source?: string;
    migrationId?: string;
    legacyMemberId?: string;
  }[];
  identityKeys: readonly { id: string; ownerStudentId?: string }[];
  officeLinks: readonly { id: string; studentId?: string }[];
}): string[];

export declare function runRevert(
  firestore: {
    collection(path: string): {
      get(): Promise<{
        docs: { id: string; data(): Record<string, unknown> }[];
      }>;
    };
    doc(path: string): { path: string };
    batch(): {
      delete(ref: { path: string }): void;
      commit(): Promise<unknown>;
    };
  },
  root: string,
  apply: boolean,
): Promise<void>;
