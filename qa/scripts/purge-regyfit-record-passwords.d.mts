// Type surface of purge-regyfit-record-passwords.mjs for the qa unit tests. Keep it in step with
// the exports of the .mjs.

export declare const productionConfirmation: "regyfit-password-purge-production-v1";
export declare function hasStoredPassword(data: unknown): boolean;
export declare function resolvePurgeTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
  apply: boolean;
};
