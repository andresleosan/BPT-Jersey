import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ status: "signed-in" as "signed-in" | "signed-out" }));
const api = vi.hoisted(() => ({
  getWaiverRegistration: vi.fn(),
  acceptWaiver: vi.fn(),
  revokeWaiverConsent: vi.fn(),
  getWaiverEvidenceDownload: vi.fn(),
}));
vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) =>
    authState.status === "signed-in" ? children : <a href="/login">Sign in</a>,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../lib/waiver-client", () => api);

import WaiverPage from "./page";

const clauses = [
  {
    key: "photoVideo",
    heading: "Photo and video",
    body: "Synthetic media clause.",
    required: false,
  },
  {
    key: "medicalTreatment",
    heading: "Medical treatment",
    body: "Synthetic medical clause.",
    required: true,
  },
  { key: "hygiene", heading: "Hygiene", body: "Synthetic hygiene clause.", required: true },
  {
    key: "dataProtection",
    heading: "Data protection",
    body: "Synthetic data clause.",
    required: true,
  },
] as const;
const version = {
  waiverVersionId: "waiver-1",
  versionLabel: "pilot-2026-08",
  title: "Synthetic pilot waiver",
  introduction: "Synthetic content only.",
  clauses,
  contentHash: "a".repeat(64),
  effectiveAt: "2026-08-25T12:00:00Z",
  schemaVersion: "1",
} as const;
const registration = {
  currentVersion: version,
  subjects: [
    {
      studentId: "student-1",
      displayName: "Synthetic Minor",
      participantType: "minor",
      consent: null,
    },
  ],
};
const accepted = {
  consentId: "consent-1",
  studentId: "student-1",
  waiverVersionId: "waiver-1",
  versionLabel: "pilot-2026-08",
  clauseResponses: {
    photoVideo: "declined",
    medicalTreatment: "accepted",
    hygiene: "accepted",
    dataProtection: "accepted",
  },
  signedAt: "2026-08-25T12:10:00Z",
  revokedAt: null,
  evidenceDocumentId: "document-1",
  status: "accepted",
  schemaVersion: "1",
} as const;

describe("account waiver page", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-in";
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  it("renders the exact current version and submits four explicit decisions", async () => {
    api.getWaiverRegistration.mockResolvedValue(registration);
    api.acceptWaiver.mockResolvedValue(accepted);
    const user = userEvent.setup();
    render(<WaiverPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic pilot waiver" })).toBeVisible();
    expect(screen.getByText("Version pilot-2026-08")).toBeVisible();
    await user.click(screen.getByLabelText("Decline Photo and video"));
    for (const heading of ["Medical treatment", "Hygiene", "Data protection"])
      await user.click(screen.getByLabelText(`Accept ${heading}`));
    await user.type(screen.getByLabelText("Type your full name"), "Synthetic Guardian");
    await user.click(screen.getByRole("button", { name: "Accept and create evidence" }));
    await waitFor(() =>
      expect(api.acceptWaiver).toHaveBeenCalledWith({
        studentId: "student-1",
        waiverVersionId: "waiver-1",
        contentHash: "a".repeat(64),
        typedName: "Synthetic Guardian",
        clauseResponses: accepted.clauseResponses,
      }),
    );
    expect(await screen.findByText("Waiver accepted")).toBeVisible();
  });

  it("announces errors and focuses the first invalid decision", async () => {
    api.getWaiverRegistration.mockResolvedValue(registration);
    const user = userEvent.setup();
    render(<WaiverPage />);
    await screen.findByRole("heading", { name: "Synthetic pilot waiver" });
    await user.click(screen.getByRole("button", { name: "Accept and create evidence" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Complete all clause decisions");
    expect(screen.getByLabelText("Accept Photo and video")).toHaveFocus();
    expect(api.acceptWaiver).not.toHaveBeenCalled();
  });

  it("downloads and revokes an accepted waiver without exposing internal errors", async () => {
    api.getWaiverRegistration.mockResolvedValue({
      ...registration,
      subjects: [{ ...registration.subjects[0], consent: accepted }],
    });
    api.getWaiverEvidenceDownload.mockResolvedValue({
      consent: accepted,
      downloadUrl: "https://r2.example.test/evidence.pdf",
      expiresAt: "2999-01-01T00:00:00Z",
    });
    api.revokeWaiverConsent.mockResolvedValue({
      ...accepted,
      status: "revoked",
      revokedAt: "2026-08-25T13:00:00Z",
    });
    const user = userEvent.setup();
    render(<WaiverPage />);
    expect(await screen.findByText("Waiver accepted")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Prepare evidence download" }));
    expect(await screen.findByRole("link", { name: "Open signed evidence PDF" })).toHaveAttribute(
      "href",
      "https://r2.example.test/evidence.pdf",
    );
    await user.click(screen.getByRole("button", { name: "Revoke this acceptance" }));
    expect(await screen.findByText("Waiver revoked")).toBeVisible();
  });

  it("renders unavailable, safe-error and signed-out states", async () => {
    api.getWaiverRegistration.mockResolvedValueOnce({
      currentVersion: null,
      subjects: registration.subjects,
    });
    const first = render(<WaiverPage />);
    expect(await screen.findByText("No waiver is currently published.")).toBeVisible();
    first.unmount();
    api.getWaiverRegistration.mockRejectedValueOnce(new Error("private callable details"));
    render(<WaiverPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load waiver registration",
    );
    expect(screen.queryByText("private callable details")).not.toBeInTheDocument();
    cleanup();
    authState.status = "signed-out";
    render(<WaiverPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
