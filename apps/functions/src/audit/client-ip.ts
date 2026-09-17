import { isAuditIpAddress } from "@bpt-jersey/domain/audit";

/**
 * The address a class audit event records. The first X-Forwarded-For entry is read, which is what
 * Google's front end puts there for a real browser call - but a caller can send that header itself,
 * and nothing here distinguishes a forged entry from a genuine one. The recorded address is
 * therefore provenance, not proof: useful to see where a booking appeared to come from, never
 * evidence that a particular person made it. Before anyone relies on it forensically, the value
 * must be verified against a real production booking (the header chain in production is not the
 * emulator's, and this has not been observed there yet).
 */
export function clientIpFromRequest(request: {
  rawRequest?: { headers?: Record<string, unknown>; ip?: unknown };
}): string | null {
  const header = request.rawRequest?.headers?.["x-forwarded-for"];
  const forwarded = Array.isArray(header) ? header[0] : header;
  const first = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  if (isAuditIpAddress(first)) return first;
  const socket = request.rawRequest?.ip;
  return isAuditIpAddress(socket) ? socket : null;
}
