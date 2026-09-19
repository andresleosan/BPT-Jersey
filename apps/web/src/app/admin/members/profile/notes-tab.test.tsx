import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NotesTab } from "./notes-tab";
afterEach(cleanup);
it("renders escaped multiline office text and delegates editing to Details", async () => {
  const edit = vi.fn();
  const view = render(<NotesTab note={"First line\n<img src=x onerror=alert(1)>"} onEdit={edit} />);
  const note = screen.getByText(/First line/);
  expect(note.textContent).toBe("First line\n<img src=x onerror=alert(1)>");
  expect(note.querySelector("img")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Edit in Details" }));
  expect(edit).toHaveBeenCalledTimes(1);
  view.rerender(<NotesTab onEdit={edit} />);
  expect(screen.getByRole("status").textContent).toBe("No office notes recorded.");
});
