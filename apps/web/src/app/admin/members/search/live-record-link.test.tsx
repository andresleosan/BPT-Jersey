import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({ resolveImportedSubscription: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../../../../lib/subscription-admin-client", () => client);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { LiveRecordLink } from "./live-record-link";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps unresolved archive identity neutral and retries the read before navigating to the returned student", async () => {
  client.resolveImportedSubscription
    .mockResolvedValueOnce({ studentId: null })
    .mockResolvedValueOnce({ studentId: "created-unlinked" });
  render(<LiveRecordLink recordId="archive-1" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open live record" }));
  expect((await screen.findByRole("status")).textContent).toContain("Live record not linked yet");
  expect(screen.getByRole("link", { name: "Review member migration" }).getAttribute("href")).toBe(
    "/admin/members/migration",
  );
  expect(router.push).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Open live record" }));
  expect(router.push).toHaveBeenCalledWith("/admin/members/profile?id=created-unlinked");
  expect(client.resolveImportedSubscription.mock.calls).toEqual([["archive-1"], ["archive-1"]]);
});
it.each(["failed-precondition", "permission-denied", "resource-exhausted", "unavailable"])(
  "does not label %s as pending migration or reveal backend details",
  async (code) => {
    client.resolveImportedSubscription.mockRejectedValue({
      code,
      message: "private backend detail",
    });
    render(<LiveRecordLink recordId="archive-1" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open live record" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to resolve this live record",
    );
    expect(screen.queryByText(/Live record not linked yet|private backend detail/)).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  },
);
