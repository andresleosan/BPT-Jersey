"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import { ClientAuthProvider, useClientSession, type ClientSession } from "../../lib/client-auth";
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
type Notice = Readonly<{ tone: "error" | "success" | "warning"; text: string }>;

function productName(
  products: readonly ShopProductProjection[],
  productId: string,
): string | undefined {
  return products.find((product) => product.productId === productId)?.name;
}

/** Hidden products are no longer in the catalogue, so their names are unknown ("An item"). */
function removedNotice(removed: readonly string[]): string {
  const named = removed.filter((name) => name !== "An item");
  const unknown = removed.length - named.length;
  const parts = [...named];
  if (unknown > 0) {
    const other = named.length > 0 ? " other" : "";
    parts.push(
      unknown === 1 && !other ? "An item" : `${unknown}${other} item${unknown === 1 ? "" : "s"}`,
    );
  }
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const one = removed.length === 1;
  return `${list} ${one ? "was" : "were"} removed from your basket because ${one ? "it is" : "they are"} no longer available.`;
}

/** Staff open the shop from their own area, so the back link returns them there. */
function backLink(session: ClientSession | undefined): Readonly<{ href: string; label: string }> {
  if (!session) return { href: "/", label: "Back to home" };
  if (session.staffRole === "owner" || session.staffRole === "administrator")
    return { href: "/admin", label: "Back to admin" };
  if (session.staffRole === "headCoach" || session.staffRole === "coach")
    return { href: "/coach", label: "Back to coach" };
  return { href: "/account", label: "Back to account" };
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
  const confirmationRef = useRef<HTMLElement>(null);
  const [basketInView, setBasketInView] = useState(false);

  // On a phone the confirmation sits above the catalogue, far from the checkout that was just used.
  useEffect(() => {
    if (!placed) return;
    confirmationRef.current?.focus();
    confirmationRef.current?.scrollIntoView?.({ block: "start" });
  }, [placed]);

  useEffect(() => {
    // Wait for Auth: loading the public catalogue first would cost a second call for every member.
    if (status === "loading") return;
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
          setNotice({ tone: "warning", text: removedNotice(reconciled.removed) });
        setState({ status: "ready", products, orders: [...orders] });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [reloadToken, signedIn, status]);

  // The phone basket bar is fixed to the bottom of the screen; once the basket itself is on screen
  // it would only sit on top of Place order, and a tap there jumped back to the basket heading.
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const basket = document.querySelector(".shop-basket");
    if (!basket) return;
    const observer = new IntersectionObserver(([entry]) =>
      setBasketInView(entry?.isIntersecting ?? false),
    );
    observer.observe(basket);
    return () => observer.disconnect();
  }, [ready]);

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

  const back = backLink(signedIn ? session : undefined);
  const itemCount = lines.reduce((count, line) => count + line.quantity, 0);

  function changeLines(next: readonly BasketLine[]): void {
    setLines(next);
    writeBasket(next);
    setPlaced(undefined);
    setNotice(undefined);
  }

  function add(line: BasketLine): void {
    const result = addToBasket(lines, line);
    if (result.full) {
      setNotice({ tone: "error", text: "Your basket holds up to 10 different items." });
      return;
    }
    changeLines(result.lines);
    const name = state.status === "ready" ? productName(state.products, line.productId) : undefined;
    if (name) setNotice({ tone: "success", text: `Added ${name} to your basket.` });
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
      <a className="shop-back-link" href={back.href}>
        <span aria-hidden="true">&larr;</span> {back.label}
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
            <section
              aria-label="Order placed"
              className="shop-confirmation"
              ref={confirmationRef}
              role="status"
              tabIndex={-1}
            >
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
          {lines.length > 0 && !basketInView ? (
            <a className="shop-basket-bar" href="#shop-basket-title">
              Basket · {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
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
