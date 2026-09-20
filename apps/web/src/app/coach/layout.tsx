"use client";

import type { ReactNode } from "react";
import { AdminGate } from "../admin/admin-gate";
import "./coach.css";

/** The teaching workspace is shared by coaches and the unified office/coaching roles. */
export default function CoachLayout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
