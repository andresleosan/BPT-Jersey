/**
 * Since the Classes / Services clone (2026-09-16) a site id is any slug, so a screen can no longer
 * decide the label with `locationId === "town" ? "Town" : "West"`. Pages that hold the catalogue
 * pass it; the rest fall back to the names of the two historical sites, then to the id itself.
 */
const historicalSiteNames: ReadonlyMap<string, string> = new Map([
  ["town", "Town"],
  ["west", "West"],
]);

export function locationLabel(
  locationId: string,
  locations?: ReadonlyMap<string, Readonly<{ name: string }>>,
): string {
  return locations?.get(locationId)?.name ?? historicalSiteNames.get(locationId) ?? locationId;
}
