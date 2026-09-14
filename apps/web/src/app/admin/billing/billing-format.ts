import type { ManualPaymentMethod } from "@bpt-jersey/domain/finance";

export const methodLabel: Readonly<Record<ManualPaymentMethod, string>> = Object.freeze({
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
});

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatMoney(amountMinor: number): string {
  return moneyFormatter.format(amountMinor / 100);
}

export function formatDate(timestamp: string): string {
  return dateFormatter.format(new Date(timestamp));
}

export function parseMoney(value: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}
