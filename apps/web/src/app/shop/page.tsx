"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatShopPrice,
  shopOrderReference,
  shopProductCategoryLabels,
  type ShopOrderProjection,
  type ShopProductCategory,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { academyContent } from "../../content/academy";
import { publicAcademyId } from "../../lib/academy";
import { ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import {
  addToBasket,
  basketTotalMinor,
  readBasket,
  reconcileBasket,
  writeBasket,
  type BasketLine,
} from "../../lib/shop-basket";
import { listMyShopOrders, listPublicShopCatalog, listShopCatalog } from "../../lib/shop-client";
import { ProductCard } from "./product-card";
import { ShopCheckout } from "./shop-checkout";
import { pickupNames, ShopOrders } from "./shop-orders";
import "./shop.css";

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

function removedNotice(removed: readonly string[]): string {
  const one = removed.length === 1;
  return `${removed.join(", ")} ${one ? "was" : "were"} removed from your basket because ${one ? "it is" : "they are"} no longer available.`;
}

function ShopContent() {
  const { session, status } = useClientSession();
  const signedIn = status === "signed-in";
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [notice, setNotice] = useState<Notice>();
  const [lines, setLines] = useState<readonly BasketLine[]>([]);
  const [placed, setPlaced] = useState<ShopOrderProjection>();

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const load = signedIn
      ? Promise.all([listShopCatalog(), listMyShopOrders()])
      : listPublicShopCatalog(publicAcademyId).then((products) => [products, [] as const] as const);
    void load
      .then(([products, orders]) => {
        if (!active) return;
        const reconciled = reconcileBasket(readBasket(), products);
        setLines(reconciled.lines);
        writeBasket(reconciled.lines);
        if (reconciled.removed.length > 0)
          setNotice({ tone: "success", text: removedNotice(reconciled.removed) });
        setState({ status: "ready", products, orders: [...orders] });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [reloadToken, signedIn]);

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

  function changeLines(next: readonly BasketLine[]): void {
    setLines(next);
    writeBasket(next);
    setPlaced(undefined);
  }

  function add(line: BasketLine): void {
    const result = addToBasket(lines, line);
    if (result.full)
      setNotice({ tone: "error", text: "Your basket holds up to 10 different items." });
    else changeLines(result.lines);
  }

  function handlePlaced(order: ShopOrderProjection): void {
    changeLines([]);
    setPlaced(order);
    setState((current) =>
      current.status === "ready" ? { ...current, orders: [order, ...current.orders] } : current,
    );
  }

  return (
    <main className="shop-page" id="main-content" aria-labelledby="shop-title">
      <a className="shop-back-link" href={signedIn ? "/account" : "/"}>
        <span aria-hidden="true">&larr;</span> {signedIn ? "Back to account" : "Back to home"}
      </a>
      <p className="account-eyebrow">BPT Jersey / Club shop</p>
      <h1 id="shop-title">Club shop</h1>
      <p className="client-destination-intro">
        Official Brazilian Power Team gis, rashguards, shorts, backpacks and casual wear. Pay by
        bank transfer or when you collect at Town or West.
      </p>

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
          {placed ? (
            <section aria-label="Order placed" className="shop-confirmation" role="status">
              <p className="account-eyebrow">Order placed</p>
              <h2>{shopOrderReference(placed.orderId)}</h2>
              <p>
                <span className="shop-money">{formatShopPrice(placed.totalMinor)}</span> · collect
                from {pickupNames[placed.pickupLocationId]}.{" "}
                {placed.paymentMethod === "bank_transfer"
                  ? "We will check your transfer. Check this page for its status; the academy may also contact you."
                  : "Pay when you collect. Check this page for its status; the academy may also contact you."}
              </p>
            </section>
          ) : null}
          <div className="shop-layout">
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
                      <ProductCard key={product.productId} onAdd={add} product={product} />
                    ))}
                  </ul>
                </>
              )}
            </section>
            <ShopCheckout
              lines={lines}
              onLinesChange={changeLines}
              onPlaced={handlePlaced}
              products={state.products}
              session={session}
              signedIn={signedIn}
            />
          </div>
          {lines.length > 0 ? (
            <a className="shop-basket-bar" href="#shop-basket-title">
              Basket · {lines.reduce((count, line) => count + line.quantity, 0)} items ·{" "}
              <span className="shop-money">
                {formatShopPrice(basketTotalMinor(lines, state.products))}
              </span>
            </a>
          ) : null}
          {signedIn ? <ShopOrders orders={state.orders} /> : null}
        </>
      ) : null}
    </main>
  );
}

export default function ShopPage() {
  return (
    <ClientAuthProvider acceptStaff>
      <ShopContent />
    </ClientAuthProvider>
  );
}
