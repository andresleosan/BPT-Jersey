import { createHash } from "node:crypto";
export const groupKey = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
