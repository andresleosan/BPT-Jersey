import { createHash } from "node:crypto";

export function expiryNotificationId(membershipId: string, endsAt: string): string {
  return `expiry-${createHash("sha256").update(`${membershipId}|${endsAt}`).digest("hex")}`;
}

export function unpaidNotificationId(membershipId: string, endsAt: string): string {
  return `unpaid-${createHash("sha256").update(`${membershipId}|${endsAt}`).digest("hex")}`;
}
