import type { Metadata } from "next";
import type { ReactNode } from "react";

// The enrolment page itself is a client component and cannot export metadata, so its canonical
// lives here. Without it the same page served on bptjersey.pages.dev competes with the real one.
export const metadata: Metadata = {
  alternates: { canonical: "/enrol" },
};

export default function EnrolLayout({ children }: { children: ReactNode }) {
  return children;
}
