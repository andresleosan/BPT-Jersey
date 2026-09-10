import type { ReactNode } from "react";

import { AdminGate } from "./admin-gate";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AdminGate>{children}</AdminGate>;
}
