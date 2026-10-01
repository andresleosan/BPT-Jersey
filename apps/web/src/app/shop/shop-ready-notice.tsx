"use client";

import { useEffect, useState } from "react";

import { shopOrderReference, type ShopOrderProjection } from "@bpt-jersey/domain/shop";
import { listMyShopOrders } from "../../lib/shop-client";
import { pickupNames } from "./shop-orders";

import "./shop-ready-notice.css";

/** One line per order the office marked ready; nothing at all when none are waiting. */
export function ShopReadyNotice({ orders }: { orders: readonly ShopOrderProjection[] }) {
  const ready = orders.filter((order) => order.status === "ready");
  if (ready.length === 0) return null;
  return (
    <div className="shop-ready-notice" role="status">
      {ready.map((order) => (
        <p key={order.orderId}>
          Your order <strong>{shopOrderReference(order)}</strong> is ready to collect at{" "}
          {pickupNames[order.pickupLocationId]}.
        </p>
      ))}
    </div>
  );
}

/** For /account: one read on mount; any failure stays silent so the account page never breaks. */
export function MyShopReadyNotice() {
  const [orders, setOrders] = useState<readonly ShopOrderProjection[]>([]);
  useEffect(() => {
    let live = true;
    listMyShopOrders()
      .then((value) => {
        if (live) setOrders(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return <ShopReadyNotice orders={orders} />;
}
