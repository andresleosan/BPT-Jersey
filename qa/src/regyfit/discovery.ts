import type { Frame, Page } from "@playwright/test";
import type {
  RegyfitFieldSnapshot,
  RegyfitModuleSnapshot,
  RegyfitSensitivity,
} from "@bpt-jersey/domain";

type RegyfitDataType = RegyfitFieldSnapshot["dataType"];

type RawRegyfitFieldMetadata = Readonly<{
  name: string;
  label: string;
  dataType: RegyfitDataType;
  sensitivity: RegyfitSensitivity;
  required: boolean;
  [key: string]: unknown;
}>;

type RawRegyfitPageMetadata = Readonly<{
  route: string;
  title: string;
  roles: readonly string[];
  actions: readonly string[];
  fields: readonly RawRegyfitFieldMetadata[];
  navigationLinks: readonly Readonly<{
    label: string;
    route: string;
  }>[];
  tableHeaders: readonly string[];
}>;

type BrowserFieldMetadata = Readonly<{
  name: string;
  label: string;
  dataType: string;
  required: boolean;
}>;

type Locatable = Pick<Page, "locator">;

const redactionPatterns = [
  /https?:\/\/[^/\s:@]+:[^@\s]+@[^\s]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /(?:\+\d[\d\s().-]{8,}\d|\b\d{3,4}[\s().-]\d{3,4}[\s.-]\d{3,4}\b)/g,
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi,
] as const;

const mutatingActionPattern =
  /^(?:create|update|delete|destroy|write|edit|save|export|pay|payment|message|send|approve|correct|charge|refund|remove|archive|invite|new)(?:[-_ ]|$)/i;
const dataTypes = new Set<RegyfitDataType>([
  "text",
  "email",
  "phone",
  "number",
  "integer",
  "currency",
  "boolean",
  "date",
  "datetime",
  "time",
  "select",
  "multiselect",
  "reference",
  "file",
]);
const sensitivities = new Set<RegyfitSensitivity>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const pattern of redactionPatterns) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }
  return sanitized.slice(0, 256);
}

function sanitizeIdentifier(value: unknown): string {
  const candidate = sanitizeText(value);
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(candidate) ? candidate : "";
}

function normalizeRoute(value: string): string {
  try {
    const parsed = new URL(value, "https://regyfit.invalid");
    return parsed.pathname.startsWith("/") ? parsed.pathname : "/";
  } catch {
    return "/";
  }
}

function routeKey(route: string): string {
  const lastSegment =
    route
      .split("/")
      .filter(Boolean)
      .filter((segment) => !/^index(?:\.php)?$/i.test(segment))
      .at(-1) ?? "root";
  const key = lastSegment.replace(/[^A-Za-z0-9_-]/g, "-").toLowerCase();
  return key || "root";
}

function humanizeKey(key: string): string {
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferSensitivity(name: string, label: string): RegyfitSensitivity {
  const text = `${name} ${label}`.toLowerCase();
  if (
    /health|medical|safeguard|consent|document|payment|secret|password|token|card|cvv/.test(text)
  ) {
    return "restricted";
  }
  if (/name|email|phone|family|attendance|membership|assessment|lead|reference/.test(text)) {
    return "confidential";
  }
  if (/status|role|state|internal|audit/.test(text)) {
    return "internal";
  }
  return "public";
}

function normalizeDataType(value: string): RegyfitDataType {
  const normalized = value.toLowerCase();
  if (normalized === "select-one" || normalized === "select-multiple") {
    return normalized === "select-multiple" ? "multiselect" : "select";
  }
  if (normalized === "tel") {
    return "phone";
  }
  if (normalized === "url") {
    return "text";
  }
  if (normalized === "datetime-local") {
    return "datetime";
  }
  if (normalized === "checkbox" || normalized === "radio") {
    return "boolean";
  }
  if (dataTypes.has(normalized as RegyfitDataType)) {
    return normalized as RegyfitDataType;
  }
  return "text";
}

function uniqueText(values: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = sanitizeText(value);
    if (text && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function sanitizeField(field: RawRegyfitFieldMetadata): RegyfitFieldSnapshot | undefined {
  const name = sanitizeIdentifier(field.name);
  const label = sanitizeText(field.label);
  if (
    !name ||
    !label ||
    !dataTypes.has(field.dataType) ||
    !sensitivities.has(field.sensitivity) ||
    typeof field.required !== "boolean"
  ) {
    return undefined;
  }
  return Object.freeze({
    name,
    label,
    dataType: field.dataType,
    sensitivity: field.sensitivity,
    required: field.required,
  });
}

export function sanitizeRegyfitPageMetadata(raw: RawRegyfitPageMetadata): RegyfitModuleSnapshot {
  const route = normalizeRoute(raw.route);
  const key = routeKey(route);
  const label = sanitizeText(raw.title) || humanizeKey(key);
  const actions = uniqueText(raw.actions).filter((action) => !mutatingActionPattern.test(action));
  const fields = raw.fields.flatMap((field) => {
    const sanitized = sanitizeField(field);
    return sanitized ? [sanitized] : [];
  });

  return Object.freeze({
    key,
    label,
    route,
    observedRoles: Object.freeze(uniqueText(raw.roles)),
    discoveryActions: Object.freeze(actions),
    fields: Object.freeze(fields),
  });
}

function toSameOriginPath(value: string, currentUrl: URL): string | undefined {
  try {
    const baseUrl =
      currentUrl.protocol === "about:" ? new URL("https://regyfit.invalid") : currentUrl;
    const candidate = new URL(value, baseUrl);
    if (candidate.origin !== baseUrl.origin) {
      return undefined;
    }
    return candidate.pathname.startsWith("/") ? candidate.pathname : "/";
  } catch {
    return undefined;
  }
}

function browserFieldToRaw(field: BrowserFieldMetadata): RawRegyfitFieldMetadata | undefined {
  const name = sanitizeIdentifier(field.name);
  const label = sanitizeText(field.label);
  if (!name || !label) {
    return undefined;
  }
  return {
    name,
    label,
    dataType: normalizeDataType(field.dataType),
    sensitivity: inferSensitivity(name, label),
    required: field.required,
  };
}

async function captureRegyfitSurfaceMetadata(
  surface: Locatable,
  currentUrl: URL,
  title: string,
): Promise<RawRegyfitPageMetadata> {
  const navigationLinks = await surface.locator("a:visible").evaluateAll((elements) =>
    elements
      .filter((element) => element.closest("table") === null)
      .map((element) => ({
        label: element.textContent ?? "",
        route: element.getAttribute("href") ?? "",
      })),
  );
  const actionLabels = await surface
    .locator('button:visible, [role="button"]:visible')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label") ?? element.textContent ?? ""),
    );
  const roles = await surface
    .locator("[role]:visible")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("role") ?? ""));
  const browserFields = await surface
    .locator("input:visible, select:visible, textarea:visible")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const control = element as HTMLInputElement;
        const label = control.getAttribute("aria-label") ?? control.labels?.[0]?.textContent ?? "";
        return {
          name: control.getAttribute("name") ?? control.getAttribute("id") ?? "",
          label,
          dataType:
            control.tagName.toLowerCase() === "select"
              ? control.getAttribute("multiple") === null
                ? "select-one"
                : "select-multiple"
              : (control.getAttribute("type") ?? "text"),
          required: control.hasAttribute("required"),
        };
      }),
    );
  const labeledFields = await surface.locator("label:visible").evaluateAll((elements) =>
    elements.map((element) => {
      const label = element as HTMLLabelElement;
      const control = label.htmlFor ? document.getElementById(label.htmlFor) : undefined;
      return {
        name: control?.getAttribute("name") ?? control?.getAttribute("id") ?? label.htmlFor,
        label: label.textContent ?? "",
        dataType: control?.getAttribute("type") ?? control?.tagName.toLowerCase() ?? "text",
        required: control?.hasAttribute("required") ?? false,
      };
    }),
  );
  const fields = [...browserFields, ...labeledFields]
    .map(browserFieldToRaw)
    .filter((field): field is RawRegyfitFieldMetadata => field !== undefined)
    .filter(
      (field, index, all) => all.findIndex((candidate) => candidate.name === field.name) === index,
    );
  const tableHeaders = await surface
    .locator("table:visible thead th:visible")
    .evaluateAll((elements) => elements.map((element) => element.textContent ?? ""));

  return Object.freeze({
    route: currentUrl.pathname || "/",
    title,
    roles: Object.freeze(uniqueText(roles)),
    actions: Object.freeze(uniqueText(actionLabels)),
    fields: Object.freeze(fields),
    navigationLinks: Object.freeze(
      navigationLinks.flatMap((link) => {
        const route = toSameOriginPath(link.route, currentUrl);
        const label = sanitizeText(link.label);
        return route && label ? [{ label, route }] : [];
      }),
    ),
    tableHeaders: Object.freeze(uniqueText(tableHeaders)),
  });
}

export async function captureRegyfitPageMetadata(page: Page): Promise<RawRegyfitPageMetadata> {
  const currentUrl = new URL(page.url());
  return captureRegyfitSurfaceMetadata(page, currentUrl, sanitizeText(await page.title()));
}

export async function captureRegyfitFrameMetadata(frame: Frame): Promise<RawRegyfitPageMetadata> {
  const currentUrl = new URL(frame.url());
  const frameTitle = sanitizeText(
    (await frame
      .locator("title")
      .textContent()
      .catch(() => "")) ?? "",
  );
  return captureRegyfitSurfaceMetadata(frame, currentUrl, frameTitle);
}

export function hasRegyfitDiscoveryEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const baseUrl = env.REGYFIT_BASE_URL?.trim();
  const email = env.REGYFIT_EMAIL?.trim();
  const password = env.REGYFIT_PASSWORD?.trim();
  if (!baseUrl || !email || !password) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}
