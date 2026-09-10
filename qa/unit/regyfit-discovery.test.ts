import { describe, expect, it } from "vitest";

import {
  hasRegyfitDiscoveryEnvironment,
  sanitizeRegyfitPageMetadata,
} from "../src/regyfit/discovery";

describe("Regyfit discovery sanitization", () => {
  it("normalizes routes and removes values from metadata", () => {
    const sanitized = sanitizeRegyfitPageMetadata({
      route: "/admin/students?search=secret#rows",
      title: "Students",
      roles: ["admin"],
      actions: ["search", "view", "delete", "new"],
      fields: [
        {
          name: "email",
          label: "learner@example.invalid",
          dataType: "text",
          sensitivity: "restricted",
          required: false,
          value: "row value must not survive",
        },
      ],
      navigationLinks: [
        { label: "Students", route: "/admin/students?search=secret" },
        { label: "External", route: "https://outside.invalid/admin" },
      ],
      tableHeaders: ["Display name", "Status"],
    });

    expect(sanitized).toMatchObject({
      key: "students",
      label: "Students",
      route: "/admin/students",
      observedRoles: ["admin"],
      discoveryActions: ["search", "view"],
    });
    expect(sanitized.fields).toEqual([
      {
        name: "email",
        label: "[redacted]",
        dataType: "text",
        sensitivity: "restricted",
        required: false,
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain("row value must not survive");
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });

  it("redacts phone numbers, postcodes, and credential URLs", () => {
    const sanitized = sanitizeRegyfitPageMetadata({
      route: "/admin/students",
      title: "Contact +44 7700 900123",
      roles: ["admin"],
      actions: ["view"],
      fields: [],
      navigationLinks: [{ label: "Private", route: "https://user:secret@regyfit.invalid/admin" }],
      tableHeaders: ["Postcode JE2 3AB"],
    });

    expect(sanitized.label).toBe("Contact [redacted]");
    expect(JSON.stringify(sanitized)).not.toMatch(/\+44|JE2 3AB|user:secret/i);
  });

  it("requires all local discovery variables without revealing their values", () => {
    expect(
      hasRegyfitDiscoveryEnvironment({
        REGYFIT_BASE_URL: "https://regyfit.invalid",
        REGYFIT_EMAIL: "operator@example.invalid",
        REGYFIT_PASSWORD: "synthetic-only",
      }),
    ).toBe(true);
    expect(
      hasRegyfitDiscoveryEnvironment({
        REGYFIT_BASE_URL: "https://regyfit.invalid",
        REGYFIT_EMAIL: "operator@example.invalid",
      }),
    ).toBe(false);
    expect(
      hasRegyfitDiscoveryEnvironment({
        REGYFIT_BASE_URL: "not a url",
        REGYFIT_EMAIL: "operator@example.invalid",
        REGYFIT_PASSWORD: "synthetic-only",
      }),
    ).toBe(false);
    expect(
      hasRegyfitDiscoveryEnvironment({
        REGYFIT_BASE_URL: "https://user:secret@regyfit.invalid/admin?scope=all",
        REGYFIT_EMAIL: "operator@example.invalid",
        REGYFIT_PASSWORD: "synthetic-only",
      }),
    ).toBe(false);
  });
});
