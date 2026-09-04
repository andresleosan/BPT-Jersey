"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  formatShopPrice,
  shopOrderMaximumQuantity,
  shopPaymentMethodNote,
  shopProductCategoryLabels,
  type ShopOrderProjection,
  type ShopProductCategory,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { academyContent } from "../../content/academy";
import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import { listMyShopOrders, listShopCatalog, placeShopOrder } from "../../lib/shop-client";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      products: readonly ShopProductProjection[];
      orders: readonly ShopOrderProjection[];
    }>
  | Readonly<{ status: "error" }>;

type CategoryFilter = "all" | ShopProductCategory;
type Notice = Readonly<{ tone: "error" | "success"; text: string }>;

const stockLabels = {
  "in-stock": "In stock",
  "made-to-order": "Made to order",
  "sold-out": "Sold out",
} as const;

const statusLabels = {
  requested: "Requested",
  confirmed: "Confirmed",
  ready: "Ready to collect",
  collected: "Collected",
  cancelled: "Cancelled",
} as const;

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function ProductCard({
  product,
  busy,
  onOrder,
}: {
  product: ShopProductProjection;
  busy: boolean;
  onOrder: (product: ShopProductProjection, size: string | null, quantity: number) => Promise<void>;
}) {
  const [size, setSize] = useState(product.sizes[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const soldOut = product.stockStatus === "sold-out";
  const sizeId = `shop-size-${product.productId}`;
  const quantityId = `shop-quantity-${product.productId}`;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedQuantity = Math.min(
      shopOrderMaximumQuantity,
      Math.max(1, Math.trunc(Number(quantity)) || 1),
    );
    setQuantity(String(parsedQuantity));
    void onOrder(product, product.sizes.length > 0 ? size : null, parsedQuantity);
  }

  return (
    <li className="shop-product-card">
      <figure className="shop-product-figure">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-managed catalog images are external URLs
          <img alt={product.name} src={product.imageUrl} />
        ) : (
          <span className="shop-product-placeholder" aria-hidden="true">
            BPT
          </span>
        )}
      </figure>
      <div className="shop-product-body">
        <p className="card-label">{shopProductCategoryLabels[product.category]}</p>
        <h3>{product.name}</h3>
        <p className="shop-product-price">
          {formatShopPrice(product.priceMinor, product.currency)}
        </p>
        <span className={`shop-stock-badge shop-stock-${product.stockStatus}`}>
          {stockLabels[product.stockStatus]}
        </span>
        {product.description ? (
          <p className="shop-product-description">{product.description}</p>
        ) : null}
        <form className="shop-order-form" onSubmit={submit}>
          {product.sizes.length > 0 ? (
            <label className="shop-field" htmlFor={sizeId}>
              Size
              <select
                disabled={busy || soldOut}
                id={sizeId}
                onChange={(event) => setSize(event.target.value)}
                value={size}
              >
                {product.sizes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="shop-field" htmlFor={quantityId}>
            Quantity
            <input
              disabled={busy || soldOut}
              id={quantityId}
              max={shopOrderMaximumQuantity}
              min={1}
              onChange={(event) => setQuantity(event.target.value)}
              type="number"
              value={quantity}
            />
          </label>
          <button className="button button-primary" disabled={busy || soldOut} type="submit">
            {soldOut ? "Sold out" : `Request ${product.name}`}
          </button>
        </form>
      </div>
    </li>
  );
}

function ShopContent() {
  const { session } = useClientSession();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [contactName, setContactName] = useState(session?.displayName ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void Promise.all([listShopCatalog(), listMyShopOrders()])
      .then(([products, orders]) => {
        if (active) setState({ status: "ready", products, orders });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (session?.displayName && contactName.length === 0) setContactName(session.displayName);
  }, [session?.displayName, contactName.length]);

  const visibleProducts = useMemo(
    () =>
      state.status === "ready"
        ? state.products.filter((product) => filter === "all" || product.category === filter)
        : [],
    [state, filter],
  );
  const categories = useMemo(() => {
    if (state.status !== "ready") return [] as CategoryFilter[];
    const present = new Set(state.products.map((product) => product.category));
    return [
      "all" as const,
      ...academyContent.merchandise.map((c) => c.key),
      "other" as const,
    ].filter((key) => key === "all" || present.has(key));
  }, [state]);

  async function order(
    product: ShopProductProjection,
    size: string | null,
    quantity: number,
  ): Promise<void> {
    if (state.status !== "ready") return;
    const name = contactName.trim();
    if (name.length === 0) {
      setNotice({ tone: "error", text: "Add the name we should hold the order under." });
      document.getElementById("shop-contact-name")?.focus();
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const placed = await placeShopOrder({
        requestId: globalThis.crypto.randomUUID(),
        productId: product.productId,
        size,
        quantity,
        contactName: name,
        contactPhone: optionalText(contactPhone),
        note: optionalText(note),
      });
      setState({ ...state, orders: [placed, ...state.orders] });
      setNotice({
        tone: "success",
        text: `Order requested for ${placed.productName}. Pay ${formatShopPrice(placed.totalMinor)} at the academy when you collect it.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to place the order.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shop-page" id="main-content" aria-labelledby="shop-title">
      <a className="shop-back-link" href="/account">
        <span aria-hidden="true">&larr;</span> Back to account
      </a>
      <p className="account-eyebrow">BPT Jersey / Club shop</p>
      <h1 id="shop-title">Club shop</h1>
      <p className="client-destination-intro">
        Official Brazilian Power Team gis, rashguards, shorts, backpacks and casual wear. Request
        what you need and collect it at the academy.
      </p>
      <p className="shop-payment-note">{shopPaymentMethodNote}</p>

      {notice ? (
        <p
          className={`shop-message shop-message-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p className="shop-message" aria-busy="true" role="status">
          Loading the club shop...
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className="shop-message shop-message-error" role="alert">
          <p>Unable to load the club shop. Please try again.</p>
          <button
            className="button button-secondary"
            onClick={() => setReloadToken((value) => value + 1)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <section className="shop-section" aria-labelledby="shop-collection-title">
            <p className="account-eyebrow">Collection details</p>
            <h2 id="shop-collection-title">Who is collecting</h2>
            <div className="shop-collection-form">
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
            </div>
          </section>

          <section className="shop-section" aria-labelledby="shop-catalog-title">
            <p className="account-eyebrow">Catalog</p>
            <h2 id="shop-catalog-title">Products</h2>
            {state.products.length === 0 ? (
              <div className="shop-empty">
                <strong>No products are published yet.</strong>
                <p>
                  The academy team is preparing the catalog. Ask at reception for current
                  merchandise.
                </p>
              </div>
            ) : (
              <>
                <div className="shop-filter-bar" role="group" aria-label="Filter by category">
                  {categories.map((key) => (
                    <button
                      aria-pressed={filter === key}
                      className="shop-filter-button"
                      key={key}
                      onClick={() => setFilter(key)}
                      type="button"
                    >
                      {key === "all" ? "All" : shopProductCategoryLabels[key]}
                    </button>
                  ))}
                </div>
                <ul className="shop-product-grid" aria-label="Products">
                  {visibleProducts.map((product) => (
                    <ProductCard
                      busy={busy}
                      key={product.productId}
                      onOrder={order}
                      product={product}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="shop-section" aria-labelledby="shop-orders-title">
            <p className="account-eyebrow">Your orders</p>
            <h2 id="shop-orders-title">Order history</h2>
            {state.orders.length === 0 ? (
              <div className="shop-empty">
                <strong>No orders yet.</strong>
                <p>Requested items appear here with their collection status.</p>
              </div>
            ) : (
              <div className="shop-orders-table-wrap">
                <table className="shop-orders-table">
                  <caption className="visually-hidden">Your club shop orders</caption>
                  <thead>
                    <tr>
                      <th scope="col">Placed</th>
                      <th scope="col">Item</th>
                      <th scope="col">Size</th>
                      <th scope="col">Qty</th>
                      <th scope="col">Total</th>
                      <th scope="col">Status</th>
                      <th scope="col">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.orders.map((item) => (
                      <tr key={item.orderId}>
                        <td>{new Date(item.createdAt).toLocaleDateString("en-GB")}</td>
                        <td>{item.productName}</td>
                        <td>{item.size ?? "-"}</td>
                        <td>{item.quantity}</td>
                        <td>{formatShopPrice(item.totalMinor, item.currency)}</td>
                        <td>
                          <span className={`shop-status-badge shop-status-${item.status}`}>
                            {statusLabels[item.status]}
                          </span>
                        </td>
                        <td>
                          <span className={`shop-status-badge shop-status-${item.paymentStatus}`}>
                            {item.paymentStatus === "paid" ? "Paid" : "Pay on collection"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

export default function ShopPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/shop">
        <ShopContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
