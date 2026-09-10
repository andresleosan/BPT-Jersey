import {
  buildDeliveryEventId,
  buildDeliveryHistoryRecord,
  deliveryStatuses,
  parseDeliveryHistoryRecord,
  parseExternalDeliveryRequest,
  type DeliveryHistoryRecord,
  type DeliveryProviderResult,
  type ExternalDeliveryRequest,
} from "@bpt-jersey/domain/delivery";

export class DeliveryServiceError extends Error {
  public readonly code: "invalid" | "tenant" | "conflict" | "integration";

  public constructor(code: "invalid" | "tenant" | "conflict" | "integration", message: string) {
    super(message);
    this.name = "DeliveryServiceError";
    this.code = code;
  }
}

export type ExternalDeliveryProvider = Readonly<{
  name: string;
  send: (request: ExternalDeliveryRequest) => Promise<unknown>;
}>;

export type DeliveryHistoryStore = Readonly<{
  append: (record: DeliveryHistoryRecord) => Promise<void>;
  getLatest: (academyId: string, deliveryId: string) => Promise<DeliveryHistoryRecord | null>;
  list: (academyId: string) => Promise<readonly DeliveryHistoryRecord[]>;
}>;

export type GenericDeliveryFirestore = Readonly<{
  doc: (path: string) => Readonly<{
    get: () => Promise<{
      exists: boolean;
      data: () => Record<string, unknown> | undefined;
    }>;
    set: (data: Record<string, unknown>) => Promise<unknown>;
  }>;
  collection: (path: string) => Readonly<{
    get: () => Promise<{
      docs: readonly { data: () => Record<string, unknown> }[];
    }>;
  }>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const providerPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const failureCodePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function assertIdentifier(value: string, field: string): void {
  if (!identifierPattern.test(value)) {
    throw new DeliveryServiceError("invalid", `Invalid ${field}`);
  }
}

function assertProviderName(value: string): void {
  if (!providerPattern.test(value)) {
    throw new DeliveryServiceError("invalid", "Invalid delivery provider");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function safeProviderMessageId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !controlCharacterPattern.test(value)
    ? value
    : null;
}

function safeFailureCode(value: unknown): string | null {
  return typeof value === "string" && failureCodePattern.test(value) ? value : null;
}

function normalizeProviderResult(value: unknown): DeliveryProviderResult {
  if (
    !isPlainRecord(value) ||
    !deliveryStatuses.includes(value.status as (typeof deliveryStatuses)[number])
  ) {
    return Object.freeze({
      status: "failed",
      providerMessageId: null,
      failureCode: "provider_invalid_response",
      retryable: false,
    });
  }

  const status = value.status as DeliveryProviderResult["status"];
  if (status === "accepted" || status === "delivered") {
    return Object.freeze({
      status,
      providerMessageId: safeProviderMessageId(value.providerMessageId),
      failureCode: null,
      retryable: false,
    });
  }
  if (status === "skipped") {
    return Object.freeze({
      status,
      providerMessageId: null,
      failureCode: safeFailureCode(value.failureCode) ?? "delivery_skipped",
      retryable: false,
    });
  }
  return Object.freeze({
    status: "failed",
    providerMessageId: null,
    failureCode: safeFailureCode(value.failureCode) ?? "provider_error",
    retryable: value.retryable === true,
  });
}

function retryDelayMs(attempt: number): number {
  return Math.min(5_000, 250 * 2 ** (attempt - 1));
}

export function createUnconfiguredDeliveryProvider(): ExternalDeliveryProvider {
  return Object.freeze({
    name: "unconfigured",
    async send() {
      return Object.freeze({
        status: "skipped" as const,
        providerMessageId: null,
        failureCode: "provider_unconfigured",
        retryable: false,
      });
    },
  });
}

export function createDeliveryDispatcher(params: {
  provider: ExternalDeliveryProvider;
  history: DeliveryHistoryStore;
  now?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
  maxAttempts?: number;
}): Readonly<{
  dispatch: (request: unknown) => Promise<DeliveryHistoryRecord>;
}> {
  assertProviderName(params.provider.name);
  const maxAttempts = params.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new DeliveryServiceError("invalid", "maxAttempts must be between 1 and 3");
  }
  const now = params.now ?? (() => new Date().toISOString());
  const sleep =
    params.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  return {
    async dispatch(rawRequest) {
      const parsed = parseExternalDeliveryRequest(rawRequest);
      if (!parsed.ok) throw new DeliveryServiceError("invalid", "Invalid delivery request");

      const request = parsed.value;
      assertIdentifier(request.academyId, "academyId");
      const existing = await params.history.getLatest(request.academyId, request.deliveryId);
      if (
        existing &&
        (existing.status === "accepted" ||
          existing.status === "delivered" ||
          existing.status === "skipped")
      ) {
        return existing;
      }
      if (existing && !existing.retryable) return existing;

      const firstAttempt = existing === null ? 1 : existing.attempt + 1;
      if (firstAttempt > maxAttempts) {
        if (existing) return existing;
        throw new DeliveryServiceError("conflict", "Delivery attempts exhausted");
      }

      let lastRecord: DeliveryHistoryRecord | null = existing;
      for (let attempt = firstAttempt; attempt <= maxAttempts; attempt += 1) {
        let providerResult: unknown;
        try {
          providerResult = await params.provider.send(request);
        } catch {
          providerResult = Object.freeze({
            status: "failed" as const,
            providerMessageId: null,
            failureCode: "provider_error",
            retryable: true,
          });
        }

        const result = normalizeProviderResult(providerResult);
        const record = buildDeliveryHistoryRecord({
          request,
          provider: params.provider.name,
          result,
          attempt,
          occurredAt: now(),
        });
        await params.history.append(record);
        lastRecord = record;

        if (result.status !== "failed" || !result.retryable || attempt === maxAttempts)
          return record;
        await sleep(retryDelayMs(attempt));
      }

      if (lastRecord) return lastRecord;
      throw new DeliveryServiceError("integration", "Delivery provider did not return a result");
    },
  };
}

export function createInMemoryDeliveryHistoryStore(): DeliveryHistoryStore {
  const records = new Map<string, DeliveryHistoryRecord>();
  return {
    async append(record) {
      assertIdentifier(record.academyId, "academyId");
      records.set(buildDeliveryEventId(record.deliveryId, record.attempt), record);
    },
    async getLatest(academyId, deliveryId) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(deliveryId, "deliveryId");
      return (
        [...records.values()]
          .filter((record) => record.academyId === academyId && record.deliveryId === deliveryId)
          .sort((left, right) => right.attempt - left.attempt)[0] ?? null
      );
    },
    async list(academyId) {
      assertIdentifier(academyId, "academyId");
      return Object.freeze(
        [...records.values()]
          .filter((record) => record.academyId === academyId)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      );
    },
  };
}

export function createFirestoreDeliveryHistoryStore(params: {
  firestore: GenericDeliveryFirestore;
}): DeliveryHistoryStore {
  return {
    async append(record) {
      assertIdentifier(record.academyId, "academyId");
      await params.firestore
        .doc(
          `academies/${record.academyId}/deliveryEvents/${buildDeliveryEventId(record.deliveryId, record.attempt)}`,
        )
        .set(record);
    },
    async getLatest(academyId, deliveryId) {
      const records = await this.list(academyId);
      return (
        records
          .filter((record) => record.deliveryId === deliveryId)
          .sort((left, right) => right.attempt - left.attempt)[0] ?? null
      );
    },
    async list(academyId) {
      assertIdentifier(academyId, "academyId");
      const snapshot = await params.firestore
        .collection(`academies/${academyId}/deliveryEvents`)
        .get();
      return Object.freeze(
        snapshot.docs
          .map((document) => {
            const parsed = parseDeliveryHistoryRecord(document.data());
            if (!parsed.ok)
              throw new DeliveryServiceError("invalid", "Invalid delivery history record");
            return parsed.value;
          })
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      );
    },
  };
}
