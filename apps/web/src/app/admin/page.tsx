import { OverviewPage } from "./overview/page";

import "./admin.css";

export { AdminShell } from "./admin-shell";
export { OverviewPage as AdminOverview } from "./overview/page";

export default function AdminPage() {
  return <OverviewPage />;
}
