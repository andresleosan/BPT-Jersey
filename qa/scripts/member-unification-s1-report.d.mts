// Test-only type surface for the .mjs exports, following the purge script convention.
import type {
  BuildMemberMigrationQueueInput,
  LegacyMemberInput,
} from "../../packages/domain/src/members/member-migration-contracts";

export declare function resolveTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
};

export declare function reportCounters(
  data: Omit<BuildMemberMigrationQueueInput, "today" | "members"> & {
    members: readonly (LegacyMemberInput & { trainingCenter?: string; vatNumber?: string })[];
    createdStudents?: readonly {
      guardianStatus?: "pending" | "assigned";
      reviewReason?: "date-of-birth-missing";
    }[];
    state: {
      readerVersion: string;
      rollbackEligibleStudentCount: number;
      rollbackCapacityLimit: number;
    };
  },
  today: string,
): Record<string, number | string>;

export declare class SafeScriptError extends Error {}
export declare function reportScriptError(error: unknown): void;

export declare function runReport(
  firestore: {
    collection(path: string): {
      get(): Promise<{ docs: { id: string; data(): unknown }[] }>;
    };
    doc(path: string): { get(): Promise<{ data(): unknown }> };
  },
  root: string,
  today: string,
): Promise<void>;
