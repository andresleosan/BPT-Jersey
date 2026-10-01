"use client";

import { useState, type FormEvent } from "react";

import {
  formatShopPrice,
  isShopProductPurchasable,
  shopMadeToOrderLabel,
  shopOrderMaximumQuantity,
  shopProductCategoryLabels,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import type { BasketLine } from "../../lib/shop-basket";

const stockLabels = {
  "in-stock": "In stock",
  "made-to-order": "Made to order",
  "sold-out": "Sold out",
} as const;

export function ProductCard({
  product,
  onAdd,
}: {
  product: ShopProductProjection;
  onAdd: (line: BasketLine) => void;
}) {
  const [size, setSize] = useState(product.sizes[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const purchasable = isShopProductPurchasable(product);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = Math.min(
      shopOrderMaximumQuantity,
      Math.max(1, Math.trunc(Number(quantity)) || 1),
    );
    setQuantity("1");
    onAdd({
      productId: product.productId,
      size: product.sizes.length > 0 ? size : null,
      quantity: parsed,
    });
  }

  // The body always renders seven rows (lead and description may be empty) so the subgrid lines up.
  return (
    <li className="shop-product-card">
      <figure className="shop-product-figure">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-managed catalog images are external URLs
          <img
            alt={product.name}
            decoding="async"
            height={600}
            loading="lazy"
            src={product.imageUrl}
            width={800}
          />
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
          {product.stockStatus === "made-to-order"
            ? shopMadeToOrderLabel(product.leadTimeWeeks)
            : stockLabels[product.stockStatus]}
        </span>
        <p className="shop-product-lead">
          {product.stockStatus === "made-to-order"
            ? "Made for you after you order. The academy confirms when it will be ready."
            : ""}
        </p>
        <p className="shop-product-description">{product.description ?? ""}</p>
        <form className="shop-order-form" onSubmit={submit}>
          {/* A sold-out product keeps only its disabled button: no controls that cannot be used. */}
          {purchasable && product.sizes.length > 0 ? (
            <label className="shop-field">
              Size
              <select
                aria-label={`Size for ${product.name}`}
                name="size"
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
          {purchasable ? (
            <label className="shop-field">
              Quantity
              <input
                aria-label={`Quantity of ${product.name}`}
                inputMode="numeric"
                max={shopOrderMaximumQuantity}
                min={1}
                name="quantity"
                onChange={(event) => setQuantity(event.target.value)}
                type="number"
                value={quantity}
              />
            </label>
          ) : null}
          <button
            aria-label={
              purchasable ? `Add ${product.name} to basket` : `${product.name} is sold out`
            }
            className="button button-primary"
            disabled={!purchasable}
            type="submit"
          >
            {purchasable ? "Add to basket" : "Sold out"}
          </button>
        </form>
      </div>
    </li>
  );
}
