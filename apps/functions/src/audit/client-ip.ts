import { isAuditIpAddress } from "@bpt-jersey/domain/audit";

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
