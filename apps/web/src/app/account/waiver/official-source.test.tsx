import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getWaiverRegistration: vi.fn() }));
vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../lib/waiver-client", () => ({
  getWaiverRegistration: api.getWaiverRegistration,
  acceptWaiver: vi.fn(),
  revokeWaiverConsent: vi.fn(),
  getWaiverEvidenceDownload: vi.fn(),
}));

import WaiverPage from "./page";

const registration = {
  currentVersion: {
    waiverVersionId: "waiver-1",
    versionLabel: "official-2026-09",
    title: "Brazilian Power Team Jersey Waiver and Release of Liability",
    introduction: "Official document source.",
    clauses: [
      {
        key: "photoVideo",
        heading: "Photo and video",
        body: "Review the official document.",
        required: true,
      },
      {
        key: "medicalTreatment",
        heading: "Medical treatment",
        body: "Review the official document.",
        required: true,
      },
      { key: "hygiene", heading: "Hygiene", body: "Review the official document.", required: true },
      {
        key: "dataProtection",
        heading: "Data protection",
        body: "Review the official document.",
        required: true,
      },
    ],
    contentHash: "a".repeat(64),
    effectiveAt: "2026-09-01T12:00:00Z",
    schemaVersion: "1",
  },
  subjects: [
    {
      studentId: "student-1",
      displayName: "Synthetic Adult",
      participantType: "adult",
      consent: null,
    },
  ],
};

describe("official waiver source panel", () => {
  afterEach(() => {
    api.getWaiverRegistration.mockReset();
  });

  it("embeds the official PDF and links to the same source", async () => {
    api.getWaiverRegistration.mockResolvedValue(registration);
    render(<WaiverPage />);
    const source =
      "/legal/Brazilian%20Power%20Team%20Jersey%20Waiver%20and%20Release%20of%20Liability.pdf";
    expect(await screen.findByTitle("Official waiver document")).toHaveAttribute("src", source);
    expect(screen.getByRole("link", { name: "Open the official waiver document" })).toHaveAttribute(
      "href",
      source,
    );
  });
});
