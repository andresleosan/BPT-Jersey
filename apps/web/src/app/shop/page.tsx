"use client";

import { ClientAuthGate, ClientAuthProvider } from "../../lib/client-auth";

function ShopContent() {
  return (
    <main className="client-destination" aria-labelledby="shop-title">
      <p className="account-eyebrow">BPT Jersey / Client area</p>
      <h1 id="shop-title">Client shop access</h1>
      <p className="client-destination-intro">
        This authenticated client area is the boundary for future shop features.
      </p>
      <div className="client-future-state">
        <strong>Catalog and cart features are planned for a later task.</strong>
        <p>No products, carts, orders, payments, or inventory are available here yet.</p>
      </div>
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
