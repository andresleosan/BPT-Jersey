import { rm } from "node:fs/promises";

await rm(new URL("../../../.firebase-functions/", import.meta.url), {
  recursive: true,
  force: true,
});
