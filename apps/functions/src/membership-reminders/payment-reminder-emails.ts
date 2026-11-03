import {
  paymentReminderSteps,
  type PaymentReminderStep,
} from "@bpt-jersey/domain/memberships/payment-reminders";

/**
 * Membership payment reminder emails. The words are fixed by the approved spec
 * (docs/superpowers/specs/2026-11-03-membership-payment-reminders-design.md, "The emails"); the
 * plain-text and HTML parts carry the same words.
 */

export type PaymentReminderAudience = "self" | "guardian";

export type RenderedPaymentReminderEmail = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

const membershipUrl = "https://www.bptjersey.com/account/membership";
const footerText =
  "BPT Jersey · Office 9, 13 Library Place, St Helier, Jersey JE2 3RR · You're receiving this because you have a membership with BPT Jersey. Questions? Just reply to this email.";

const colours = Object.freeze({
  body: "#F2F1ED",
  card: "#FFFFFF",
  text: "#1A1A18",
  footer: "#65635D",
  button: "#2F2483",
});
const fontStack = "'Source Sans 3',Arial,sans-serif";

/** A run of text inside a line; `bold` runs are `<strong>` in HTML and plain in text. */
type Segment = Readonly<{ text: string; bold?: boolean }>;
/** A paragraph is a list of lines; each line is a list of segments. */
type Paragraph = readonly (readonly Segment[])[];

type EmailContent = Readonly<{
  subject: string;
  before: readonly Paragraph[];
  button: string;
  after: readonly Paragraph[];
}>;

type Words = Readonly<{
  /** "your Adults Unlimited" or "Leo's Adults Unlimited", lower-case start. */
  whose: string;
  /** The same, capitalised to start a sentence. */
  Whose: string;
  endDateLong: string;
  endDateShort: string;
  /** "Leo's" for the guardian audience, null for the member themself. */
  owner: string | null;
}>;

function line(...segments: (string | Segment)[]): readonly Segment[] {
  return segments.map((segment) => (typeof segment === "string" ? { text: segment } : segment));
}

const team = line("The BPT Jersey team");

const stepContent: Readonly<Record<PaymentReminderStep, (words: Words) => EmailContent>> = {
  "ends-in-7": (w) => ({
    subject: `${w.owner ?? "Your"} BPT Jersey membership ends on ${w.endDateShort}`,
    before: [
      [
        line(`${w.Whose} membership ends on `, { text: w.endDateLong, bold: true }, "."),
        line("To keep training without interruption, renew in your account before then:"),
      ],
    ],
    button: "Renew my membership",
    after: [
      [
        line("You can pay by bank transfer and upload the screenshot there, or pay at reception."),
        line("If you've already renewed, thank you, you can ignore this email."),
      ],
      [line("See you on the mats,"), team],
    ],
  }),
  "ends-tomorrow": (w) => ({
    subject: `Reminder: ${w.owner ?? "your"} membership ends tomorrow`,
    before: [[line(`Just a reminder that ${w.whose} membership ends tomorrow, ${w.endDateLong}.`)]],
    button: "Renew my membership",
    after: [[line("If you've already paid, thank you, there's nothing else to do."), team]],
  }),
  "payment-due": (w) => ({
    subject: `${w.owner ?? "Your"} BPT Jersey membership payment is due`,
    before: [
      [
        line(
          `${w.Whose} membership ended on ${w.endDateShort} and we haven't received your renewal yet.`,
        ),
        line("Please renew in your account as soon as you can:"),
      ],
    ],
    button: "Pay and renew",
    after: [
      [
        line("If you've already sent the transfer, thank you, we'll confirm it shortly."),
        line(
          "If you'd like to change or pause your plan, just reply to this email and we'll help.",
        ),
        team,
      ],
    ],
  }),
  "final-reminder": (w) => ({
    subject: "Second reminder: membership payment due",
    before: [
      [
        line(
          `We still haven't received the renewal for ${w.whose} membership, which ended on ${w.endDateShort}.`,
        ),
      ],
    ],
    button: "Pay and renew",
    after: [
      [
        line(
          "This is our last automatic reminder. If there's a problem with the payment, or you'd like to stop or change your membership, just reply and we'll sort it out together.",
        ),
        team,
      ],
    ],
  }),
};

export function paymentReminderTemplateId(
  step: PaymentReminderStep,
  audience: PaymentReminderAudience,
): string {
  return `payment-reminder.${step}.${audience}`;
}

function parseTemplateId(
  templateId: string,
): Readonly<{ step: PaymentReminderStep; audience: PaymentReminderAudience }> {
  const match = /^payment-reminder\.([a-z0-9-]+)\.(self|guardian)$/u.exec(templateId);
  const step = paymentReminderSteps.find((candidate) => candidate === match?.[1]);
  if (!match || !step) throw new Error("Unknown payment reminder template");
  return { step, audience: match[2] as PaymentReminderAudience };
}

function requireVariable(variables: Readonly<Record<string, string>>, name: string): string {
  const value = variables[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Payment reminder variable ${name} is missing`);
  }
  return value.trim();
}

/** Jersey-local end dates, e.g. "Wednesday 12 November" and "12 November". */
export function formatReminderDates(
  endsAt: string,
): Readonly<{ endDateLong: string; endDateShort: string }> {
  const date = new Date(endsAt);
  if (Number.isNaN(date.getTime())) throw new Error("Membership end date is not a valid instant");
  const long = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Jersey",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const short = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Jersey",
    day: "numeric",
    month: "long",
  });
  return { endDateLong: long.format(date), endDateShort: short.format(date) };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function lineText(segments: readonly Segment[]): string {
  return segments.map((segment) => segment.text).join("");
}

function lineHtml(segments: readonly Segment[]): string {
  return segments
    .map((segment) =>
      segment.bold ? `<strong>${escapeHtml(segment.text)}</strong>` : escapeHtml(segment.text),
    )
    .join("");
}

function renderText(greeting: string, content: EmailContent): string {
  const paragraphs = [
    greeting,
    ...content.before.map((paragraph) => paragraph.map(lineText).join("\n")),
    `${content.button}: ${membershipUrl}`,
    ...content.after.map((paragraph) => paragraph.map(lineText).join("\n")),
    footerText,
  ];
  return `${paragraphs.join("\n\n")}\n`;
}

function renderHtml(greeting: string, content: EmailContent): string {
  const paragraphStyle = `margin:0 0 16px 0;font-family:${fontStack};font-size:16px;line-height:24px;color:${colours.text};`;
  const paragraph = (html: string) => `<p style="${paragraphStyle}">${html}</p>`;
  const paragraphs = (list: readonly Paragraph[]) =>
    list.map((item) => paragraph(item.map(lineHtml).join("<br>"))).join("\n");
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;border-collapse:collapse;">
<tr><td bgcolor="${colours.button}" style="background-color:${colours.button};border-radius:0;">
<a href="${membershipUrl}" style="display:inline-block;padding:14px 28px;font-family:${fontStack};font-size:16px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:0;">${escapeHtml(content.button)}</a>
</td></tr>
</table>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${colours.body};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colours.body}" style="background-color:${colours.body};border-collapse:collapse;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;border-collapse:collapse;">
<tr><td bgcolor="${colours.card}" style="background-color:${colours.card};padding:32px 28px 16px 28px;">
${paragraph(escapeHtml(greeting))}
${paragraphs(content.before)}
${button}
${paragraphs(content.after)}
</td></tr>
<tr><td style="padding:16px 0 0 0;font-family:${fontStack};font-size:13px;line-height:20px;color:${colours.footer};">${escapeHtml(footerText)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Throws on an unknown template or a missing variable, so nothing half-filled is ever sent. */
export function renderPaymentReminderEmail(
  templateId: string,
  variables: Readonly<Record<string, string>>,
): RenderedPaymentReminderEmail {
  const { step, audience } = parseTemplateId(templateId);
  const recipientFirstName = requireVariable(variables, "recipientFirstName");
  const planName = requireVariable(variables, "planName");
  const endDateLong = requireVariable(variables, "endDateLong");
  const endDateShort = requireVariable(variables, "endDateShort");
  const owner =
    audience === "guardian" ? `${requireVariable(variables, "memberFirstName")}'s` : null;
  const words: Words = {
    whose: `${owner ?? "your"} ${planName}`,
    Whose: `${owner ?? "Your"} ${planName}`,
    endDateLong,
    endDateShort,
    owner,
  };
  const content = stepContent[step](words);
  // `recipientFirstName` is "there" when no first name is known, which gives "Hi there,".
  const greeting = `Hi ${recipientFirstName},`;
  return Object.freeze({
    subject: content.subject,
    text: renderText(greeting, content),
    html: renderHtml(greeting, content),
  });
}
