import type { Metadata } from "next";
import type { ReactNode } from "react";

// The shop page itself is a client component and cannot export metadata, so its canonical lives
// here. Without it the same page served on bptjersey.pages.dev competes with the real shop.
export const metadata: Metadata = {
  alternates: { canonical: "/shop" },
};

export default function ShopLayout({ children }: { children: ReactNode }) {
  return children;
}
