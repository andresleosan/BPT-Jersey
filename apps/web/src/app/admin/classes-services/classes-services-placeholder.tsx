import { classesServicesTabs } from "./classes-services-tabs";

/**
 * A tab that is routed but not built yet. The heading comes from the tabs constant so the card and
 * the tab strip can never drift apart.
 */
export function ClassesServicesPlaceholder({ href }: { href: string }) {
  const tab = classesServicesTabs.find((candidate) => candidate.href === href);
  if (!tab) throw new Error(`No Classes / Services tab is routed at ${href}.`);

  return (
    <section className="cs-card">
      <h2>{tab.label}</h2>
      <p className="cs-placeholder">Coming in the next release.</p>
    </section>
  );
}
