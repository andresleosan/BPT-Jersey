"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";

import {
  formatShopPrice,
  shopOrderTransitions,
  shopProductCategories,
  shopProductCategoryLabels,
  shopStockStatuses,
  type ShopOrderProjection,
  type ShopOrderStatus,
  type ShopProductCategory,
  type ShopProductDraft,
  type ShopProductProjection,
  type ShopStockStatus,
} from "@bpt-jersey/domain/shop";
import {
  listManagedShopProducts,
  listShopOrders,
  saveShopProduct,
  setShopProductActive,
  updateShopOrder,
} from "../../../lib/shop-client";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";

type WorkspaceState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      products: readonly ShopProductProjection[];
      orders: readonly ShopOrderProjection[];
    }>
  | Readonly<{ status: "error" }>;

type Notice = Readonly<{ tone: "error" | "success"; text: string }>;

type EditorValues = Readonly<{
  productId: string;
  name: string;
  category: ShopProductCategory;
  description: string;
  priceMajor: string;
  sizes: string;
  imageUrl: string;
  stockStatus: ShopStockStatus;
  sortOrder: string;
}>;

const emptyEditor: EditorValues = {
  productId: "",
  name: "",
  category: "gi",
  description: "",
  priceMajor: "",
  sizes: "",
  imageUrl: "",
  stockStatus: "in-stock",
  sortOrder: "100",
};

const stockLabels: Readonly<Record<ShopStockStatus, string>> = {
  "in-stock": "In stock",
  "made-to-order": "Made to order",
  "sold-out": "Sold out",
};

const orderStatusLabels: Readonly<Record<ShopOrderStatus, string>> = {
  requested: "Requested",
  confirmed: "Confirmed",
  ready: "Ready",
  collected: "Collected",
  cancelled: "Cancelled",
};

const transitionLabels: Readonly<Record<ShopOrderStatus, string>> = {
  requested: "Reopen",
  confirmed: "Confirm",
  ready: "Mark ready",
  collected: "Mark collected",
  cancelled: "Cancel",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function editorFromProduct(product: ShopProductProjection): EditorValues {
  return {
    productId: product.productId,
    name: product.name,
    category: product.category,
    description: product.description ?? "",
    priceMajor: (product.priceMinor / 100).toFixed(2),
    sizes: product.sizes.join(", "),
    imageUrl: product.imageUrl ?? "",
    stockStatus: product.stockStatus,
    sortOrder: String(product.sortOrder),
  };
}

function draftFromEditor(values: EditorValues): ShopProductDraft | string {
  const productId = values.productId.trim() || slugify(values.name);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(productId))
    return "Product ID must use lowercase letters, numbers and hyphens.";
  const name = values.name.trim();
  if (name.length === 0) return "Product name is required.";
  const price = Number(values.priceMajor);
  if (!Number.isFinite(price) || price < 0) return "Enter a valid price in pounds.";
  const priceMinor = Math.round(price * 100);
  const sortOrder = Number(values.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999)
    return "Sort order must be a whole number between 0 and 999.";
  const sizes = values.sizes
    .split(",")
    .map((size) => size.trim())
    .filter((size) => size.length > 0);
  if (new Set(sizes).size !== sizes.length) return "Sizes must not repeat.";
  const description = values.description.trim();
  const imageUrl = values.imageUrl.trim();
  return {
    productId,
    name,
    category: values.category,
    description: description.length === 0 ? null : description,
    priceMinor,
    currency: "GBP",
    sizes,
    imageUrl: imageUrl.length === 0 ? null : imageUrl,
    stockStatus: values.stockStatus,
    sortOrder,
  };
}

function replaceProduct(
  products: readonly ShopProductProjection[],
  replacement: ShopProductProjection,
): readonly ShopProductProjection[] {
  const next = products.some((product) => product.productId === replacement.productId)
    ? products.map((product) =>
        product.productId === replacement.productId ? replacement : product,
      )
    : [...products, replacement];
  return Object.freeze(
    [...next].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    ),
  );
}

function replaceOrder(
  orders: readonly ShopOrderProjection[],
  replacement: ShopOrderProjection,
): readonly ShopOrderProjection[] {
  return Object.freeze(
    orders.map((order) => (order.orderId === replacement.orderId ? replacement : order)),
  );
}

export function ShopAdminPage() {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ status: "loading" });
  const [editor, setEditor] = useState<EditorValues>(emptyEditor);
  const [editingId, setEditingId] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [orderFilter, setOrderFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    let mounted = true;
    void Promise.all([listManagedShopProducts(), listShopOrders()])
      .then(([products, orders]) => {
        if (!mounted) return;
        startTransition(() => setWorkspace({ status: "ready", products, orders }));
      })
      .catch(() => {
        if (mounted) startTransition(() => setWorkspace({ status: "error" }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  function updateEditor<K extends keyof EditorValues>(field: K, value: EditorValues[K]): void {
    setEditor((current) => ({ ...current, [field]: value }));
    setNotice(undefined);
  }

  function startNewProduct(): void {
    setEditingId(undefined);
    setEditor(emptyEditor);
    setNotice(undefined);
  }

  function editProduct(product: ShopProductProjection): void {
    setEditingId(product.productId);
    setEditor(editorFromProduct(product));
    setNotice(undefined);
    document.getElementById("shop-product-name")?.focus();
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const draft = draftFromEditor(editor);
    if (typeof draft === "string") {
      setNotice({ tone: "error", text: draft });
      return;
    }
    setBusy("save");
    setNotice(undefined);
    try {
      const saved = await saveShopProduct(draft);
      setWorkspace((current) =>
        current.status === "ready"
          ? { ...current, products: replaceProduct(current.products, saved) }
          : current,
      );
      setEditingId(saved.productId);
      setEditor(editorFromProduct(saved));
      setNotice({ tone: "success", text: `Product "${saved.name}" saved.` });
    } catch {
      setNotice({ tone: "error", text: "Unable to save the product. Please try again." });
    } finally {
      setBusy(undefined);
    }
  }

  async function togglePublished(product: ShopProductProjection): Promise<void> {
    setBusy(`product-${product.productId}`);
    setNotice(undefined);
    try {
      const updated = await setShopProductActive(product.productId, !product.active);
      setWorkspace((current) =>
        current.status === "ready"
          ? { ...current, products: replaceProduct(current.products, updated) }
          : current,
      );
      setNotice({
        tone: "success",
        text: updated.active
          ? `"${updated.name}" is now visible to clients.`
          : `"${updated.name}" is hidden from clients.`,
      });
    } catch {
      setNotice({ tone: "error", text: "Unable to change product visibility." });
    } finally {
      setBusy(undefined);
    }
  }

  async function changeOrder(
    order: ShopOrderProjection,
    update: Readonly<{ status?: ShopOrderStatus; paymentStatus?: "paid" | "unpaid" }>,
  ): Promise<void> {
    setBusy(`order-${order.orderId}`);
    setNotice(undefined);
    try {
      const updated = await updateShopOrder({ orderId: order.orderId, ...update });
      setWorkspace((current) =>
        current.status === "ready"
          ? { ...current, orders: replaceOrder(current.orders, updated) }
          : current,
      );
      setNotice({ tone: "success", text: `Order for ${updated.productName} updated.` });
    } catch {
      setNotice({ tone: "error", text: "Unable to update the order. Please try again." });
    } finally {
      setBusy(undefined);
    }
  }

  const visibleOrders =
    workspace.status === "ready"
      ? workspace.orders.filter(
          (order) =>
            orderFilter === "all" || (order.status !== "collected" && order.status !== "cancelled"),
        )
      : [];

  return (
    <section className="admin-module-page shop-admin-page" aria-labelledby="shop-admin-title">
      <AdminSectionHeader
        description="Publish the club merchandise catalog shown to clients and process collection orders. Payment is taken at the academy; no online checkout exists."
        eyebrow="Commerce / Club shop"
        title="Club shop"
        actions={
          <a className="admin-text-link" href="/#shop" target="_blank" rel="noreferrer noopener">
            View public showcase
          </a>
        }
      />

      {notice ? (
        <p
          className={`admin-panel-card shop-admin-notice shop-admin-notice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {workspace.status === "loading" ? (
        <section className="admin-panel-card" aria-live="polite" role="status">
          Loading club shop workspace...
        </section>
      ) : workspace.status === "error" ? (
        <section className="admin-panel-card" aria-live="assertive" role="alert">
          Unable to load products and orders. Please try again.
        </section>
      ) : (
        <>
          <div className="shop-admin-grid">
            <section className="admin-panel-card" aria-labelledby="shop-products-title">
              <div className="admin-panel-card-heading">
                <div>
                  <p className="admin-eyebrow">Connected catalog</p>
                  <h3 id="shop-products-title">Products</h3>
                </div>
                <button
                  className="admin-quick-action"
                  onClick={startNewProduct}
                  type="button"
                  disabled={busy !== undefined}
                >
                  New product
                </button>
              </div>
              {workspace.products.length === 0 ? (
                <div className="admin-empty-state">
                  <strong>No products yet.</strong>
                  <p>Create the first product with the editor.</p>
                </div>
              ) : (
                <div className="admin-data-table-wrap">
                  <table className="admin-data-table">
                    <caption className="visually-hidden">Club shop products</caption>
                    <thead>
                      <tr>
                        <th scope="col">Product</th>
                        <th scope="col">Category</th>
                        <th scope="col">Price</th>
                        <th scope="col">Sizes</th>
                        <th scope="col">Stock</th>
                        <th scope="col">Visibility</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.products.map((product) => (
                        <tr key={product.productId}>
                          <td>
                            <strong>{product.name}</strong>
                            <small className="shop-admin-secondary">{product.productId}</small>
                          </td>
                          <td>{shopProductCategoryLabels[product.category]}</td>
                          <td>{formatShopPrice(product.priceMinor, product.currency)}</td>
                          <td>{product.sizes.length > 0 ? product.sizes.join(", ") : "-"}</td>
                          <td>{stockLabels[product.stockStatus]}</td>
                          <td>
                            <AdminStatusBadge status={product.active ? "Published" : "Hidden"} />
                          </td>
                          <td>
                            <div className="shop-admin-row-actions">
                              <button
                                className="shop-admin-table-button"
                                disabled={busy !== undefined}
                                onClick={() => editProduct(product)}
                                type="button"
                              >
                                Edit {product.name}
                              </button>
                              <button
                                className="shop-admin-table-button"
                                disabled={busy !== undefined}
                                onClick={() => void togglePublished(product)}
                                type="button"
                              >
                                {product.active
                                  ? `Hide ${product.name}`
                                  : `Publish ${product.name}`}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <form
              className="admin-panel-card shop-admin-editor"
              aria-labelledby="shop-editor-title"
              onSubmit={(event) => void handleSave(event)}
            >
              <div>
                <p className="admin-eyebrow">{editingId ? "Editing product" : "Product editor"}</p>
                <h3 id="shop-editor-title">
                  {editingId ? editor.name || editingId : "Add product"}
                </h3>
              </div>
              <div className="shop-admin-form-grid">
                <label className="shop-admin-field" htmlFor="shop-product-name">
                  Name
                  <input
                    disabled={busy !== undefined}
                    id="shop-product-name"
                    maxLength={120}
                    onChange={(event) => updateEditor("name", event.target.value)}
                    required
                    value={editor.name}
                  />
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-id">
                  Product ID
                  <input
                    disabled={busy !== undefined || editingId !== undefined}
                    id="shop-product-id"
                    maxLength={64}
                    onChange={(event) => updateEditor("productId", event.target.value)}
                    placeholder={slugify(editor.name) || "auto-from-name"}
                    value={editor.productId}
                  />
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-category">
                  Category
                  <select
                    disabled={busy !== undefined}
                    id="shop-product-category"
                    onChange={(event) =>
                      updateEditor("category", event.target.value as ShopProductCategory)
                    }
                    value={editor.category}
                  >
                    {shopProductCategories.map((category) => (
                      <option key={category} value={category}>
                        {shopProductCategoryLabels[category]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-price">
                  Price in pounds
                  <input
                    disabled={busy !== undefined}
                    id="shop-product-price"
                    inputMode="decimal"
                    min={0}
                    onChange={(event) => updateEditor("priceMajor", event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={editor.priceMajor}
                  />
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-sizes">
                  Sizes (comma separated)
                  <input
                    disabled={busy !== undefined}
                    id="shop-product-sizes"
                    onChange={(event) => updateEditor("sizes", event.target.value)}
                    placeholder="A1, A2, A3"
                    value={editor.sizes}
                  />
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-stock">
                  Stock
                  <select
                    disabled={busy !== undefined}
                    id="shop-product-stock"
                    onChange={(event) =>
                      updateEditor("stockStatus", event.target.value as ShopStockStatus)
                    }
                    value={editor.stockStatus}
                  >
                    {shopStockStatuses.map((status) => (
                      <option key={status} value={status}>
                        {stockLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-sort">
                  Sort order
                  <input
                    disabled={busy !== undefined}
                    id="shop-product-sort"
                    max={999}
                    min={0}
                    onChange={(event) => updateEditor("sortOrder", event.target.value)}
                    type="number"
                    value={editor.sortOrder}
                  />
                </label>
                <label className="shop-admin-field" htmlFor="shop-product-image">
                  Image URL (https or /shop/...)
                  <input
                    disabled={busy !== undefined}
                    id="shop-product-image"
                    maxLength={1024}
                    onChange={(event) => updateEditor("imageUrl", event.target.value)}
                    placeholder="/shop/gis.jpg"
                    value={editor.imageUrl}
                  />
                </label>
                <label
                  className="shop-admin-field shop-admin-field-wide"
                  htmlFor="shop-product-description"
                >
                  Description
                  <textarea
                    disabled={busy !== undefined}
                    id="shop-product-description"
                    maxLength={600}
                    onChange={(event) => updateEditor("description", event.target.value)}
                    rows={3}
                    value={editor.description}
                  />
                </label>
              </div>
              <div className="shop-admin-row-actions">
                <button
                  className="shop-admin-primary-button"
                  disabled={busy !== undefined}
                  type="submit"
                >
                  {busy === "save" ? "Saving..." : editingId ? "Save changes" : "Create product"}
                </button>
                {editingId ? (
                  <button
                    className="shop-admin-table-button"
                    disabled={busy !== undefined}
                    onClick={startNewProduct}
                    type="button"
                  >
                    Discard and start new
                  </button>
                ) : null}
              </div>
            </form>
          </div>

          <section className="admin-panel-card" aria-labelledby="shop-orders-title">
            <div className="admin-panel-card-heading">
              <div>
                <p className="admin-eyebrow">Collection orders</p>
                <h3 id="shop-orders-title">Orders</h3>
              </div>
              <label className="admin-filter-control" htmlFor="shop-order-filter">
                Show
                <select
                  id="shop-order-filter"
                  onChange={(event) => setOrderFilter(event.target.value as "open" | "all")}
                  value={orderFilter}
                >
                  <option value="open">Open orders</option>
                  <option value="all">All orders</option>
                </select>
              </label>
            </div>
            {visibleOrders.length === 0 ? (
              <div className="admin-empty-state">
                <strong>No orders match this filter.</strong>
                <p>Client requests appear here as soon as they are placed.</p>
              </div>
            ) : (
              <div className="admin-data-table-wrap">
                <table className="admin-data-table">
                  <caption className="visually-hidden">Club shop orders</caption>
                  <thead>
                    <tr>
                      <th scope="col">Placed</th>
                      <th scope="col">Item</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Total</th>
                      <th scope="col">Status</th>
                      <th scope="col">Payment</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order) => (
                      <tr key={order.orderId}>
                        <td>{new Date(order.createdAt).toLocaleString("en-GB")}</td>
                        <td>
                          <strong>{order.productName}</strong>
                          <small className="shop-admin-secondary">
                            {order.size ? `Size ${order.size} · ` : ""}Qty {order.quantity}
                            {order.note ? ` · ${order.note}` : ""}
                          </small>
                        </td>
                        <td>
                          {order.contactName}
                          {order.contactPhone ? (
                            <small className="shop-admin-secondary">{order.contactPhone}</small>
                          ) : null}
                        </td>
                        <td>{formatShopPrice(order.totalMinor, order.currency)}</td>
                        <td>
                          <AdminStatusBadge status={orderStatusLabels[order.status]} />
                        </td>
                        <td>
                          <AdminStatusBadge
                            status={order.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                          />
                        </td>
                        <td>
                          <div className="shop-admin-row-actions">
                            {shopOrderTransitions[order.status].map((target) => (
                              <button
                                className="shop-admin-table-button"
                                disabled={busy !== undefined}
                                key={target}
                                onClick={() => void changeOrder(order, { status: target })}
                                type="button"
                              >
                                {transitionLabels[target]}
                              </button>
                            ))}
                            {order.status !== "cancelled" ? (
                              <button
                                className="shop-admin-table-button"
                                disabled={busy !== undefined}
                                onClick={() =>
                                  void changeOrder(order, {
                                    paymentStatus:
                                      order.paymentStatus === "paid" ? "unpaid" : "paid",
                                  })
                                }
                                type="button"
                              >
                                {order.paymentStatus === "paid" ? "Mark unpaid" : "Mark paid"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

export default function ShopAdminRoute() {
  return <ShopAdminPage />;
}
