import { createHash } from "node:crypto";
import { SendEmailCommand, SESv2Client, type SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import type { ExternalDeliveryRequest } from "@bpt-jersey/domain/delivery";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import type { ExternalDeliveryProvider } from "../delivery/delivery-service.js";
import { renderPaymentReminderEmail } from "./payment-reminder-emails.js";

export const sesSecrets = ["SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"].map((name) =>
  defineSecret(name),
);

export type SesSend = (input: SendEmailCommandInput) => Promise<{ MessageId?: string }>;

const throttleErrorNames = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "LimitExceededException",
]);

type SesErrorShape = Readonly<{ name?: unknown; $metadata?: { httpStatusCode?: unknown } }>;

function errorName(err: unknown): string {
  const name = (err as SesErrorShape | null)?.name;
  return typeof name === "string" ? name : "UnknownError";
}

function httpStatus(err: unknown): number | null {
  const status = (err as SesErrorShape | null)?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : null;
}

/**
 * Sends one rendered payment reminder through SES. It never logs the recipient or `err.message`:
 * SES messages can contain addresses.
 */
export function createSesDeliveryProvider(options: {
  send: SesSend;
  from: string;
  replyTo: string;
}): ExternalDeliveryProvider {
  return Object.freeze({
    name: "ses",
    async send(request: ExternalDeliveryRequest) {
      let email: ReturnType<typeof renderPaymentReminderEmail>;
      try {
        email = renderPaymentReminderEmail(request.templateId, request.variables);
      } catch (err) {
        // Never log the message or the variables: they can carry names.
        logger.error("Payment reminder template failed", {
          templateId: request.templateId,
          errorName: errorName(err),
        });
        return Object.freeze({
          status: "failed" as const,
          providerMessageId: null,
          failureCode: "template_invalid",
          retryable: false,
        });
      }
      try {
        const output = await options.send({
          FromEmailAddress: options.from,
          Destination: { ToAddresses: [request.recipient] },
          ReplyToAddresses: [options.replyTo],
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: email.text, Charset: "UTF-8" },
                Html: { Data: email.html, Charset: "UTF-8" },
              },
            },
          },
        });
        return Object.freeze({
          status: "accepted" as const,
          providerMessageId: output.MessageId ?? null,
          failureCode: null,
          retryable: false,
        });
      } catch (err) {
        const name = errorName(err);
        const status = httpStatus(err);
        if (throttleErrorNames.has(name)) {
          return Object.freeze({
            status: "failed" as const,
            providerMessageId: null,
            failureCode: "ses_throttled",
            retryable: true,
          });
        }
        if (status !== null && status >= 500) {
          return Object.freeze({
            status: "failed" as const,
            providerMessageId: null,
            failureCode: "ses_unavailable",
            retryable: true,
          });
        }
        const failureCode = "ses_rejected";
        logger.error("SES rejected a reminder", {
          failureCode,
          errorName: name,
          httpStatus: status,
        });
        return Object.freeze({
          status: "failed" as const,
          providerMessageId: null,
          failureCode,
          retryable: false,
        });
      }
    },
  });
}

/** One SESv2Client per configuration, reused across invocations of a warm instance. */
const environmentSesClients = new Map<string, SESv2Client>();

export function createSesSendFromEnvironment(region: string): SesSend {
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Email sending is not configured");
  }
  const key = createHash("sha256")
    .update(JSON.stringify([region, accessKeyId, secretAccessKey]))
    .digest("hex");
  let client = environmentSesClients.get(key);
  if (!client) {
    client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
    environmentSesClients.set(key, client);
  }
  const sesClient = client;
  return async (input) => {
    const { MessageId } = await sesClient.send(new SendEmailCommand(input));
    return MessageId === undefined ? {} : { MessageId };
  };
}
