import { createHash, randomUUID } from "node:crypto";

import type { AcademyId, CorrelationId, UserId } from "@bpt-jersey/domain";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  aggregateReportExportClassification,
  aggregateReportExportContentType,
  aggregateReportExportFileName,
  aggregateReportExportScope,
  buildAggregateReportCsv,
  MAX_AGGREGATE_REPORT_EXPORT_BYTES,
  type AggregateReportExportRequest,
  type AggregateReportExportResponse,
} from "@bpt-jersey/domain/exports";

import {
  ProgressReportStoreError,
  type ProgressReportStore,
} from "../levels/progress-report-service.js";
import {
  OperationalReportStoreError,
  type OperationalReportStore,
} from "../reports/operational-report-service.js";

export type AggregateExportDocumentReference = Readonly<{ id: string; path: string }>;
export type AggregateExportTransaction = Readonly<{
  create: (
    ref: AggregateExportDocumentReference,
    data: Readonly<Record<string, unknown>>,
  ) => unknown;
}>;
export type AggregateExportFirestore = Readonly<{
  doc: (path: string) => AggregateExportDocumentReference;
  runTransaction: <T>(
    callback: (transaction: AggregateExportTransaction) => Promise<T>,
  ) => Promise<T>;
}>;
export type AggregateExportAuditWriter = (
  transaction: AggregateExportTransaction,
  ref: AggregateExportDocumentReference,
  draft: AuditEventDraft,
) => void;

export class AggregateReportExportServiceError extends Error {
  public readonly code: "invalid" | "tenant" | "limit" | "store";

  public constructor(code: "invalid" | "tenant" | "limit" | "store", message: string) {
    super(message);
    this.name = "AggregateReportExportServiceError";
    this.code = code;
  }
}

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EXPORT_LIFETIME_MS = 10 * 60 * 1000;

function requiredIdentifier(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) {
    throw new AggregateReportExportServiceError("invalid", "Invalid " + label);
  }
  return value;
}

export function createAggregateReportExportService(dependencies: {
  firestore: AggregateExportFirestore;
  operationalStore: OperationalReportStore;
  progressStore: ProgressReportStore;
  auditWriter: AggregateExportAuditWriter;
  serverTimestamp: () => unknown;
  now?: () => Date;
  generateExportId?: () => string;
  generateAuditId?: () => string;
}) {
  const now = dependencies.now ?? (() => new Date());
  const generateExportId = dependencies.generateExportId ?? (() => "report-export-" + randomUUID());
  const generateAuditId =
    dependencies.generateAuditId ?? (() => "report-export-audit-" + randomUUID());

  return Object.freeze({
    async prepare(input: {
      academyId: string;
      actorId: string;
      request: AggregateReportExportRequest;
    }): Promise<AggregateReportExportResponse> {
      const academyId = requiredIdentifier(input.academyId, "academyId");
      const actorId = requiredIdentifier(input.actorId, "actorId");
      const exportId = requiredIdentifier(generateExportId(), "exportId");
      const auditId = requiredIdentifier(generateAuditId(), "auditId");
      const current = now();
      if (Number.isNaN(current.getTime())) {
        throw new AggregateReportExportServiceError("invalid", "Invalid export clock");
      }

      let operational;
      let progress;
      try {
        [operational, progress] = await Promise.all([
          dependencies.operationalStore.getOperationalReport(academyId, {
            from: input.request.from,
            to: input.request.to,
          }),
          dependencies.progressStore.getProgressReport(academyId),
        ]);
      } catch (error) {
        if (
          (error instanceof OperationalReportStoreError ||
            error instanceof ProgressReportStoreError) &&
          error.code === "tenant"
        ) {
          throw new AggregateReportExportServiceError("tenant", "Export source tenant mismatch");
        }
        throw new AggregateReportExportServiceError("store", "Unable to prepare export sources");
      }

      if (
        operational.query.from !== input.request.from ||
        operational.query.to !== input.request.to
      ) {
        throw new AggregateReportExportServiceError("tenant", "Export source query mismatch");
      }

      const content = buildAggregateReportCsv({ operational, progress });
      const byteLength = Buffer.byteLength(content, "utf8");
      if (byteLength <= 0 || byteLength > MAX_AGGREGATE_REPORT_EXPORT_BYTES) {
        throw new AggregateReportExportServiceError(
          "limit",
          "Aggregate export size limit exceeded",
        );
      }
      const contentSha256 = createHash("sha256").update(content, "utf8").digest("hex");
      const expiresAt = new Date(current.getTime() + EXPORT_LIFETIME_MS).toISOString();
      const recipient = "actor:" + actorId;
      const exportPath = "academies/" + academyId + "/exports/" + exportId;
      const exportRef = dependencies.firestore.doc(exportPath);
      const auditRef = dependencies.firestore.doc(
        "academies/" + academyId + "/auditEvents/" + auditId,
      );
      if (
        exportRef.id !== exportId ||
        exportRef.path !== exportPath ||
        auditRef.id !== auditId ||
        auditRef.path !== "academies/" + academyId + "/auditEvents/" + auditId
      ) {
        throw new AggregateReportExportServiceError("tenant", "Export reference mismatch");
      }

      const auditDraft: AuditEventDraft = {
        academyId: academyId as AcademyId,
        actorId: actorId as UserId,
        action: "report.export.prepared",
        targetRef: exportPath,
        purpose: input.request.purpose,
        correlationId: ("report-export:" + exportId) as CorrelationId,
        scope: aggregateReportExportScope,
        classification: aggregateReportExportClassification,
        recipient,
        expiresAt,
        contentSha256,
        byteLength,
      };

      try {
        await dependencies.firestore.runTransaction(async (transaction) => {
          dependencies.auditWriter(transaction, auditRef, auditDraft);
          const timestamp = dependencies.serverTimestamp();
          transaction.create(exportRef, {
            exportId,
            academyId,
            requestedBy: actorId,
            purpose: input.request.purpose,
            scope: aggregateReportExportScope,
            classification: aggregateReportExportClassification,
            recipient,
            expiresAt,
            status: "delivered_inline",
            schemaVersion: 1,
            createdAt: timestamp,
            createdBy: actorId,
            updatedAt: timestamp,
            updatedBy: actorId,
          });
        });
      } catch (error) {
        if (error instanceof AggregateReportExportServiceError) throw error;
        throw new AggregateReportExportServiceError("store", "Unable to journal aggregate export");
      }

      return Object.freeze({
        exportId,
        fileName: aggregateReportExportFileName(input.request),
        contentType: aggregateReportExportContentType,
        content,
        byteLength,
        contentSha256,
        expiresAt,
        purpose: input.request.purpose,
        scope: aggregateReportExportScope,
        classification: aggregateReportExportClassification,
        query: Object.freeze({
          from: input.request.from,
          to: input.request.to,
        }),
      });
    },
  });
}
