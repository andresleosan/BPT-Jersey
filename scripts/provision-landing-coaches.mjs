// Operator-only provisioning. Dry run by default; secrets never enter stdout or Git.
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashStaffPassword } from "../apps/functions/lib/src/staff/staff-login-service.js";

const require = createRequire(import.meta.url);
const admin = createRequire(new URL("../apps/functions/package.json", import.meta.url));
const cliAuth = require("firebase-tools/lib/auth");
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { getAccessToken } = require("firebase-tools/lib/apiv2");
const { getFunction } = require("firebase-tools/lib/gcp/cloudfunctionsv2");
const project = "bptjersey-f5a25";
const apply = process.argv.includes("--apply");
const privateDir = process.env.BPT_COACH_HANDOFF_DIR;
const trainers = [
  ["coach-miro", 'Professor Vladimiro "Miro" Afonso'],
  ["coach-charlie", "Charlie Tromans"],
  ["coach-amone", "Amoné Mouton"],
  ["coach-connor", "Connor Hoopes"],
  ["coach-catalina", "Catalina Bruma"],
];
const options = { project, nonInteractive: true };
const account = cliAuth.getGlobalDefaultAccount();
if (account) cliAuth.setActiveAccount(options, account);
await requireAuth(options);
const recovery = await getFunction(project, "us-central1", "beginMemberRecovery");
const academyId = recovery.serviceConfig.environmentVariables.ACADEMY_ID;
if (!academyId || !/^[A-Za-z0-9._:-]+$/u.test(academyId))
  throw Error("Missing academy configuration");
admin("firebase-admin/app").initializeApp({
  projectId: project,
  credential: {
    getAccessToken: async () => ({ access_token: await getAccessToken(), expires_in: 3600 }),
  },
});
const auth = admin("firebase-admin/auth").getAuth();
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404 && !body) return null;
  if (!response.ok) throw Error(`Firestore request failed (${response.status})`);
  return response.json();
}
function fields(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "boolean" ? { booleanValue: value } : { stringValue: String(value) },
    ]),
  );
}
let receipt;
let receiptPath;
if (apply) {
  if (!privateDir || resolve(privateDir).startsWith(resolve(".") + "/"))
    throw Error("Set BPT_COACH_HANDOFF_DIR outside the repository");
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  receiptPath = resolve(privateDir, "coach-access-private.json");
  receipt = existsSync(receiptPath)
    ? JSON.parse(readFileSync(receiptPath, "utf8"))
    : {
        project,
        academyId,
        provisionId: randomUUID(),
        createdUids: [],
        trainers: trainers.map(([uid, name], index) => ({
          uid,
          name,
          staffNumber: String(100001 + index),
          password: randomBytes(24).toString("base64url"),
        })),
      };
  if (receipt.project !== project || receipt.academyId !== academyId)
    throw Error("Receipt belongs to another academy");
}
if (receipt?.completedAt) {
  console.log("Provisioning already completed; no accounts or passwords changed.");
  process.exit(0);
}
const saveReceipt = () =>
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
const preflight = [];
for (const [index, [uid]] of trainers.entries()) {
  const user = await auth.getUser(uid).catch((error) => {
    if (error.code === "auth/user-not-found") return null;
    throw Error(`Auth preflight failed (${error.code})`);
  });
  const staffNumber = String(100001 + index);
  const credential = await request(`/staffLoginCredentials/${staffNumber}`);
  const staff = await request(`/academies/${academyId}/staff/${uid}`);
  const canonical = await request(`/academies/${academyId}/users/${uid}`);
  const owned = receipt?.createdUids.includes(uid);
  const matching =
    credential?.fields?.provisionId?.stringValue === receipt?.provisionId && !!receipt;
  if ((user && !owned) || ((credential || staff || canonical) && !matching))
    throw Error(`Existing account or profile requires review: ${uid}`);
  preflight.push({ uid, staffNumber, action: matching ? "resume" : "create" });
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", profiles: preflight }));
if (apply) {
  saveReceipt();
  for (const trainer of receipt.trainers) {
    const { uid, name, staffNumber, password } = trainer;
    if (!receipt.createdUids.includes(uid)) {
      await auth.createUser({ uid, displayName: name, disabled: true });
      receipt.createdUids.push(uid);
      saveReceipt();
    }
    const credential = await request(`/staffLoginCredentials/${staffNumber}`);
    if (!credential) {
      const now = new Date().toISOString();
      const common = {
        academyId,
        userId: uid,
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: now,
        updatedAt: now,
        createdBy: "operator-coach-provisioning",
        updatedBy: "operator-coach-provisioning",
      };
      const auditId = `coach-provision-${receipt.provisionId}-${uid}`;
      const documents = [
        [
          `academies/${academyId}/users/${uid}`,
          { ...common, accountType: "staff", displayName: name, authProvider: "custom" },
        ],
        [`academies/${academyId}/staff/${uid}`, { ...common, staffId: uid, role: "coach" }],
        [
          `staffLoginCredentials/${staffNumber}`,
          {
            ...(await hashStaffPassword(password)),
            academyId,
            userId: uid,
            staffId: uid,
            active: true,
            createdAt: now,
            updatedAt: now,
            provisionId: receipt.provisionId,
          },
        ],
        [
          `academies/${academyId}/auditEvents/${auditId}`,
          {
            academyId,
            actorId: "operator-coach-provisioning",
            action: "staff.created",
            targetRef: `academies/${academyId}/staff/${uid}`,
            purpose: "staff lifecycle operation",
            correlationId: `staff:${uid}:${auditId}`,
            auditEventId: auditId,
            result: "completed",
          },
        ],
      ];
      await request(":commit", {
        writes: documents.map(([path, record]) => ({
          update: {
            name: `${base.slice("https://firestore.googleapis.com/v1/".length)}/${path}`,
            fields: {
              ...fields(record),
              ...(path.includes("/auditEvents/") ? { schemaVersion: { integerValue: "1" } } : {}),
            },
          },
          currentDocument: { exists: false },
          ...(path.includes("/auditEvents/")
            ? { updateTransforms: [{ fieldPath: "occurredAt", setToServerValue: "REQUEST_TIME" }] }
            : {}),
        })),
      });
    }
    await auth.setCustomUserClaims(uid, { academyId, role: "coach" });
    await auth.updateUser(uid, { disabled: false });
  }
  const handoff = [
    "# BPT Jersey — acceso privado de coaches",
    "",
    "Acceso: https://bptjersey.com/staff/login",
    "",
    "| Coach | ID | Contraseña inicial |",
    "|---|---|---|",
    ...receipt.trainers.map((row) => `| ${row.name} | ${row.staffNumber} | ${row.password} |`),
    "",
    "Después de entrar: My sign-in → Link Google account. Cada coach debe vincular su propia cuenta de Google. Puede cambiar su contraseña desde My sign-in. Entrega a cada persona únicamente su fila.",
    "",
  ].join("\n");
  writeFileSync(resolve(privateDir, "accesos-coaches.md"), handoff, { mode: 0o600 });
  receipt.completedAt = new Date().toISOString();
  saveReceipt();
  console.log(
    "Five coach profiles provisioned. Credentials saved only in the private handoff directory.",
  );
}
