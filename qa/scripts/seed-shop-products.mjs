// Seeds the initial club shop catalog (one product per public merchandise category).
//
// usage:
//   SHOP_ACADEMY_ID=<academyId> \
//   SHOP_SEED_TARGET=emulator|production \
//   [SHOP_SEED_PUBLISH=true] \
//   node qa/scripts/seed-shop-products.mjs
//
// Production writes additionally require:
//   GCLOUD_PROJECT=bptjersey-f5a25
//   SHOP_OPERATOR_CONFIRMATION=shop-products-production-v1
//
// Products are created hidden (active: false) unless SHOP_SEED_PUBLISH=true, because the public
// site publishes no prices: the academy reviews price and sizes in /admin/shop and publishes.
// Existing products are never overwritten.

import { createRequire } from "node:module";

// Runs against the compiled domain runtime: build it first with
//   corepack pnpm --filter @bpt-jersey/domain build:runtime
import { parseShopProductRecord } from "../../packages/domain/lib/shop/shop-contracts.js";

const requireFromFunctions = createRequire(
  new URL("../../apps/functions/package.json", import.meta.url),
);
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

const productionProjectId = "bptjersey-f5a25";
const productionConfirmation = "shop-products-production-v1";
const seedActorId = "system:shop-seed";

const catalog = [
  {
    productId: "bpt-gi",
    name: "BPT competition gi",
    category: "gi",
    description:
      "Official Brazilian Power Team gi with embroidered BPT lettering. Available in blue, black and white; state the colour in the order note.",
    priceMinor: 9500,
    sizes: ["A0", "A1", "A2", "A3", "A4", "M1", "M2", "M3", "M4"],
    imageUrl: "/shop/gis.jpg",
    stockStatus: "made-to-order",
    sortOrder: 10,
  },
  {
    productId: "bpt-rashguard",
    name: "BPT rashguard",
    category: "rashguard",
    description:
      "No-Gi rashguard with the BPT tiger emblem. Team colours and limited runs; state the colour in the order note.",
    priceMinor: 4000,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    imageUrl: "/shop/rashguards.jpg",
    stockStatus: "made-to-order",
    sortOrder: 20,
  },
  {
    productId: "bpt-shorts",
    name: "BPT grappling shorts",
    category: "shorts",
    description: "Lightweight grappling shorts for No-Gi classes and open mats.",
    priceMinor: 3500,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    imageUrl: "/shop/shorts.jpg",
    stockStatus: "made-to-order",
    sortOrder: 30,
  },
  {
    productId: "bpt-backpack",
    name: "BPT training backpack",
    category: "backpack",
    description: "Training backpack with a separate gi compartment and ventilated base.",
    priceMinor: 5500,
    sizes: [],
    imageUrl: "/shop/backpacks.jpg",
    stockStatus: "made-to-order",
    sortOrder: 40,
  },
  {
    productId: "bpt-joggers",
    name: "BPT joggers",
    category: "casual",
    description: "Grey joggers with the embroidered BPT tiger patch for before and after training.",
    priceMinor: 4500,
    sizes: ["S", "M", "L", "XL"],
    imageUrl: "/shop/casual.jpg",
    stockStatus: "made-to-order",
    sortOrder: 50,
  },
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function isLoopbackHost(value) {
  if (!value) return false;
  const host = value.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function resolveTarget() {
  const target = required("SHOP_SEED_TARGET");
  if (target === "emulator") {
    if (!isLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Emulator seeds require FIRESTORE_EMULATOR_HOST on a loopback host");
    }
    return { target, projectId: process.env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey" };
  }
  if (target === "production") {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Production seeds must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (required("GCLOUD_PROJECT") !== productionProjectId) {
      throw new Error(`Production seeds require GCLOUD_PROJECT=${productionProjectId}`);
    }
    if (process.env.SHOP_OPERATOR_CONFIRMATION !== productionConfirmation) {
      throw new Error("Production seeds require the operator confirmation value");
    }
    return { target, projectId: productionProjectId };
  }
  throw new Error("SHOP_SEED_TARGET must be emulator or production");
}

async function main() {
  const { target, projectId } = resolveTarget();
  const academyId = required("SHOP_ACADEMY_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(academyId)) {
    throw new Error("SHOP_ACADEMY_ID is not a valid academy id");
  }
  const publish = process.env.SHOP_SEED_PUBLISH === "true";
  const now = new Date().toISOString();

  const records = catalog.map((product) => {
    const parsed = parseShopProductRecord({
      ...product,
      currency: "GBP",
      academyId,
      active: publish,
      schemaVersion: "1",
      createdAt: now,
      createdBy: seedActorId,
      updatedAt: now,
      updatedBy: seedActorId,
    });
    if (!parsed.ok) {
      throw new Error(
        `Seed product ${product.productId} rejected: ${parsed.error
          .map((issue) => `${issue.path.join(".")}:${issue.code}`)
          .join(", ")}`,
      );
    }
    return parsed.value;
  });

  if (getApps().length === 0) initializeApp({ projectId });
  const firestore = getFirestore();
  const collection = firestore.collection(`academies/${academyId}/shopProducts`);

  let created = 0;
  let skipped = 0;
  for (const record of records) {
    const reference = collection.doc(record.productId);
    const outcome = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) return "skipped";
      transaction.create(reference, record);
      return "created";
    });
    if (outcome === "created") created += 1;
    else skipped += 1;
    console.log(`${outcome}: ${reference.path}`);
  }

  console.log(JSON.stringify({ target, projectId, academyId, publish, created, skipped }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
