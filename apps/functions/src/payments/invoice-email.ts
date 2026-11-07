import type { InvoiceRecord, ManualPaymentRecord } from "@bpt-jersey/domain/finance";
import { paymentMethodLabels, type BillingDetails } from "@bpt-jersey/domain/payments";

const money = (minor: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Rendering only. Sending stays disabled until the office configures invoice email delivery. */
export function renderPaidInvoiceEmail(
  invoice: InvoiceRecord,
  payment: ManualPaymentRecord,
  billing: BillingDetails,
  balanceMinor: number,
) {
  const date = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeZone: "Europe/Jersey",
  }).format(new Date(payment.occurredAt));
  const rows = [
    ["Invoice", invoice.invoiceReference],
    ["Description", invoice.description],
    ["Invoice total", money(invoice.totalMinor)],
    ["Payment received", money(payment.amountMinor)],
    ["Remaining balance", money(balanceMinor)],
    ["Payment method", paymentMethodLabels[payment.method]],
    ["Date", date],
    ["Payment reference", payment.manualReference],
  ];
  const address = [
    billing.name,
    billing.line1,
    billing.line2,
    billing.city,
    billing.postalCode,
    billing.countryCode,
  ].filter(Boolean);
  const subject = `BPT Jersey invoice ${invoice.invoiceReference}`;
  const text = `BPT JERSEY\n${balanceMinor === 0 ? "PAID INVOICE" : "PAYMENT RECEIPT"}\n\nThank you, ${billing.name}. Your payment has been received.\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nBill to\n${address.join("\n")}\n\nView your invoices: https://www.bptjersey.com/account/billing\nBPT Jersey, Office 9, 13 Library Place, St Helier, Jersey JE2 3RR`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#F2F1ED;color:#1A1A18;font-family:'Source Sans 3',Arial,sans-serif;font-size:16px;line-height:1.5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#FFFFFF;border:1px solid #D6D4CC"><tr><td style="padding:28px;background:#2F2483;color:#FFFFFF"><p style="margin:0;font-weight:700;letter-spacing:2px">BPT JERSEY</p><h1 style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:32px;line-height:1.1;margin:16px 0 0">${balanceMinor === 0 ? "PAID INVOICE" : "PAYMENT RECEIPT"}</h1></td></tr><tr><td style="padding:28px"><p>Thank you, ${escape(billing.name)}. Your payment has been received.</p><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-variant-numeric:tabular-nums">${rows.map(([label, value]) => `<tr><th scope="row" align="left" style="padding:12px 8px 12px 0;border-bottom:1px solid #E8E7E3;font-weight:600">${escape(label!)}</th><td align="right" style="padding:12px 0;border-bottom:1px solid #E8E7E3;overflow-wrap:anywhere">${escape(value!)}</td></tr>`).join("")}</table><h2 style="font-size:18px;margin-top:24px">Bill to</h2><p>${address.map(escape).join("<br>")}</p><p style="margin-top:28px"><a href="https://www.bptjersey.com/account/billing" style="display:inline-block;padding:14px 20px;background:#2F2483;color:#FFFFFF;font-weight:700;text-decoration:none">View your invoices</a></p></td></tr><tr><td style="padding:20px 28px;background:#F2F1ED;color:#65635D">BPT Jersey<br>Office 9, 13 Library Place, St Helier, Jersey JE2 3RR</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
