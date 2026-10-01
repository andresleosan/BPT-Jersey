import {
  formatShopPrice,
  shopOrderReference,
  shopPaymentMethodLabels,
  type ShopOrderProjection,
} from "@bpt-jersey/domain/shop";
import { academyContent } from "../../content/academy";

const statusLabels = {
  requested: "Requested",
  confirmed: "Confirmed",
  ready: "Ready to collect",
  collected: "Collected",
  cancelled: "Cancelled",
} as const;

export const pickupNames: Readonly<Record<string, string>> = Object.fromEntries(
  academyContent.locations.map((location) => [location.key, location.name]),
);

function statusText(order: ShopOrderProjection): string {
  // Customers cannot cancel; when the office cancels a paid order it refunds outside the platform.
  if (order.status === "cancelled" && order.paymentStatus === "paid")
    return "Cancelled · refund handled by the academy";
  return statusLabels[order.status];
}

export function ShopOrders({ orders }: { orders: readonly ShopOrderProjection[] }) {
  return (
    <section className="shop-section" aria-labelledby="shop-orders-title">
      <p className="account-eyebrow">Your orders</p>
      <h2 id="shop-orders-title">Order history</h2>
      {orders.length === 0 ? (
        <div className="shop-empty">
          <strong>No orders yet.</strong>
          <p>Orders appear here with their collection status.</p>
        </div>
      ) : (
        <ol className="shop-order-list">
          {orders.map((order) => (
            <li className={`shop-order-item shop-order-${order.status}`} key={order.orderId}>
              <div className="shop-order-item-head">
                <strong>{shopOrderReference(order)}</strong>
                <span className={`shop-order-status shop-status-${order.status}`}>
                  {statusText(order)}
                </span>
              </div>
              <ul className="shop-order-lines">
                {order.lines.map((line) => (
                  <li key={`${line.productId}|${line.size ?? ""}`}>
                    {line.quantity} × {line.productName}
                    {line.size ? ` (${line.size})` : ""}
                    <span>{formatShopPrice(line.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>
              <p className="shop-order-meta">
                {new Date(order.createdAt).toLocaleDateString("en-GB")} · Collect from{" "}
                {pickupNames[order.pickupLocationId]} ·{" "}
                {shopPaymentMethodLabels[order.paymentMethod]} ·{" "}
                {order.paymentStatus === "paid" ? "Paid" : "Not paid yet"} ·{" "}
                <strong className="shop-money">
                  {formatShopPrice(order.totalMinor, order.currency)}
                </strong>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
