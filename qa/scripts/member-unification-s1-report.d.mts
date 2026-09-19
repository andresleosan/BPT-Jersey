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
    members: readonly (LegacyMemberInput & { trainingCenter?: string })[];
    state: {
      readerVersion: string;
      rollbackEligibleStudentCount: number;
      rollbackCapacityLimit: number;
    };
  },
  today: string,
): Record<string, number | string>;
