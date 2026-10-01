"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  formatShopPrice,
  shopOrderMaximumQuantity,
  shopOrderReference,
  type ShopOrderProjection,
  type ShopPaymentMethod,
  type ShopPickupLocationId,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { academyContent } from "../../content/academy";
import type { ClientSession } from "../../lib/client-auth";
import {
  basketLineKey,
  basketTotalMinor,
  setBasketQuantity,
  type BasketLine,
} from "../../lib/shop-basket";
import { placeShopOrder, uploadShopOrderProof } from "../../lib/shop-client";
import { EnrolmentBankDetails, useEnrolmentBankDetails } from "../enrol/payment-instructions";

const quantityOptions = Array.from({ length: shopOrderMaximumQuantity }, (_, index) => index + 1);

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function ShopCheckout({
  products,
  lines,
  onLinesChange,
  session,
  signedIn,
  onPlaced,
}: {
  products: readonly ShopProductProjection[];
  lines: readonly BasketLine[];
  onLinesChange: (lines: readonly BasketLine[]) => void;
  session: ClientSession | undefined;
  signedIn: boolean;
  onPlaced: (order: ShopOrderProjection) => void;
}) {
  const byId = new Map(products.map((product) => [product.productId, product]));
  const [requestId, setRequestId] = useState(() => globalThis.crypto.randomUUID());
  const [contactName, setContactName] = useState(session?.displayName ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [note, setNote] = useState("");
  const [pickup, setPickup] = useState<ShopPickupLocationId>();
  const [method, setMethod] = useState<ShopPaymentMethod>();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  // A second click can land before React re-renders the disabled button; the ref closes that gap.
  const submitting = useRef(false);
  const [error, setError] = useState<string>();
  const bank = useEnrolmentBankDetails(
    signedIn && method === "bank_transfer" ? requestId : undefined,
  );
  const total = basketTotalMinor(lines, products);
  const madeToOrder = lines.some(
    (line) => byId.get(line.productId)?.stockStatus === "made-to-order",
  );

  // Prefill once from the account name; a customer who clears the field keeps it cleared.
  const prefilled = useRef(Boolean(session?.displayName));
  useEffect(() => {
    if (prefilled.current || !session?.displayName) return;
    prefilled.current = true;
    setContactName(session.displayName);
  }, [session?.displayName]);

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const ready =
    lines.length > 0 &&
    contactName.trim().length > 0 &&
    pickup !== undefined &&
    method !== undefined &&
    (method === "at_collection" || file !== undefined);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready || submitting.current || pickup === undefined || method === undefined) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const proofId =
        method === "bank_transfer" && file ? await uploadShopOrderProof(requestId, file) : null;
      const placed = await placeShopOrder({
        requestId,
        lines: [...lines],
        pickupLocationId: pickup,
        paymentMethod: method,
        proofId,
        contactName: contactName.trim(),
        contactPhone: optionalText(contactPhone),
        note: optionalText(note),
      });
      setRequestId(globalThis.crypto.randomUUID());
      setFile(undefined);
      onPlaced(placed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to place the order.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <aside className="shop-basket" aria-label="Basket and checkout">
      <section aria-labelledby="shop-basket-title">
        <p className="account-eyebrow">Basket</p>
        <h2 id="shop-basket-title">Your basket</h2>
        {lines.length === 0 ? (
          <p className="shop-basket-empty">Your basket is empty. Add an item to start an order.</p>
        ) : (
          <ul className="shop-basket-lines">
            {lines.map((line) => {
              const product = byId.get(line.productId);
              const key = basketLineKey(line);
              if (!product) return null;
              return (
                <li key={key}>
                  <span>
                    {product.name}
                    {line.size ? ` (${line.size})` : ""}
                  </span>
                  <label className="visually-hidden" htmlFor={`basket-${key}`}>
                    Quantity of {product.name}
                    {line.size ? ` ${line.size}` : ""}
                  </label>
                  <select
                    disabled={busy}
                    id={`basket-${key}`}
                    onChange={(event) =>
                      onLinesChange(setBasketQuantity(lines, key, Number(event.target.value)))
                    }
                    value={line.quantity}
                  >
                    {quantityOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <span className="shop-money">
                    {formatShopPrice(product.priceMinor * line.quantity)}
                  </span>
                  <button
                    aria-label={`Remove ${product.name}${line.size ? ` ${line.size}` : ""}`}
                    className="shop-text-button"
                    disabled={busy}
                    onClick={() => onLinesChange(setBasketQuantity(lines, key, 0))}
                    type="button"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="shop-basket-total">
          <span>Total</span>
          <strong className="shop-money">{formatShopPrice(total)}</strong>
        </p>
      </section>

      {!signedIn ? (
        <div className="shop-checkout-signin">
          <p>Sign in to check out. New here? A buyer account takes a minute.</p>
          <a className="button button-primary" href="/login?returnTo=%2Fshop">
            Sign in or create a buyer account
          </a>
        </div>
      ) : lines.length > 0 ? (
        <form className="shop-checkout" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <legend>Your details</legend>
            <label className="shop-field" htmlFor="shop-contact-name">
              Name for the order
              <input
                autoComplete="name"
                id="shop-contact-name"
                maxLength={160}
                onChange={(event) => setContactName(event.target.value)}
                value={contactName}
              />
            </label>
            <p className="shop-field-hint">We will contact you at {session?.email}.</p>
            <label className="shop-field" htmlFor="shop-contact-phone">
              Phone (optional)
              <input
                autoComplete="tel"
                id="shop-contact-phone"
                maxLength={64}
                onChange={(event) => setContactPhone(event.target.value)}
                type="tel"
                value={contactPhone}
              />
            </label>
            <label className="shop-field" htmlFor="shop-order-note">
              Note for the academy (optional)
              <input
                id="shop-order-note"
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </label>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Collect from</legend>
            {academyContent.locations.map((location) => (
              <label className="shop-choice" key={location.key}>
                <input
                  checked={pickup === location.key}
                  name="shop-pickup"
                  onChange={() => setPickup(location.key as ShopPickupLocationId)}
                  type="radio"
                  value={location.key}
                />
                <span>
                  <strong>{location.name}</strong> {location.address}, {location.locality}
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Payment</legend>
            {madeToOrder ? (
              <p className="shop-field-hint">
                Some items are made to order and take longer. You can still pay now or when you
                collect.
              </p>
            ) : null}
            <label className="shop-choice">
              <input
                checked={method === "bank_transfer"}
                name="shop-payment"
                onChange={() => setMethod("bank_transfer")}
                type="radio"
              />
              <span>Bank transfer now</span>
            </label>
            <label className="shop-choice">
              <input
                checked={method === "at_collection"}
                name="shop-payment"
                onChange={() => {
                  setMethod("at_collection");
                  setFile(undefined);
                }}
                type="radio"
              />
              <span>Pay when you collect</span>
            </label>
            {method === "bank_transfer" ? (
              <div className="shop-transfer">
                <EnrolmentBankDetails {...bank} />
                <p>
                  Use the reference <strong>{shopOrderReference(requestId)}</strong> and transfer{" "}
                  <strong className="shop-money">{formatShopPrice(total)}</strong>.
                </p>
                <label className="shop-field" htmlFor="shop-proof">
                  Transfer screenshot
                  <input
                    accept="image/png,image/jpeg"
                    id="shop-proof"
                    onChange={(event) => setFile(event.target.files?.[0])}
                    type="file"
                  />
                </label>
                <p className="shop-field-hint">PNG or JPEG, up to 2 MB.</p>
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                  <img
                    alt="Transfer screenshot preview"
                    className="shop-proof-preview"
                    src={preview}
                  />
                ) : null}
              </div>
            ) : null}
            {method === "at_collection" ? (
              <p className="shop-field-hint">Pay at the academy when you collect.</p>
            ) : null}
          </fieldset>

          {error ? (
            <p className="shop-message shop-message-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button-primary shop-place-order"
            disabled={!ready || busy}
            type="submit"
          >
            {busy ? "Placing order…" : `Place order · ${formatShopPrice(total)}`}
          </button>
        </form>
      ) : null}
    </aside>
  );
}
