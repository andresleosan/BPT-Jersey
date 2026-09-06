import type { AdminRole } from "@bpt-jersey/domain";

import type { AdminSession } from "./admin-auth";

type AdminE2ERole = Extract<AdminRole, "owner" | "administrator">;

const adminE2EFlagBaked = process.env.NEXT_PUBLIC_ADMIN_E2E === "true";

function runtimeHostname(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

function isLoopbackHostname(hostname: string | undefined): boolean {
  const normalizedHostname = hostname?.toLowerCase();
  return (
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "localhost" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]"
  );
}

/** The synthetic admin session only exists in a build that baked the flag, served on loopback. */
export function isAdminE2EEnabled(
  hostname: string | undefined = runtimeHostname(),
  bakedFlag: boolean = adminE2EFlagBaked,
): boolean {
  return bakedFlag && isLoopbackHostname(hostname);
}

export function adminSessionForTestRole(role: AdminE2ERole): AdminSession {
  return Object.freeze({
    uid: `synthetic-admin-${role}`,
    email: `${role}@example.test`,
    displayName: `Synthetic ${role}`,
    academyId: "synthetic-academy",
    role,
  });
}
