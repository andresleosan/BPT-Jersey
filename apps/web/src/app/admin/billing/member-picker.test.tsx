import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberPicker, filterMembers } from "./member-picker";

const members = [
  { studentId: "s1", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "s2", fullName: "Zé Pinto", familyId: null },
  { studentId: "s3", fullName: "Ana Maria Costa", familyId: "f3" },
] as const;

describe("member picker", () => {
  afterEach(cleanup);

  it("filters from two characters, ignoring case and accents, capped", () => {
    expect(filterMembers(members, "a")).toEqual([]);
    expect(filterMembers(members, "ANA").map((m) => m.studentId)).toEqual(["s1", "s3"]);
    expect(filterMembers(members, "ze").map((m) => m.studentId)).toEqual(["s2"]);
    expect(filterMembers(members, "an", 1)).toHaveLength(1);
  });

  it("lists matches as options and reports the pick", () => {
    const onSelect = vi.fn();
    render(<MemberPicker members={members} onSelect={onSelect} selected={null} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ana" },
    });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Ana Coelho", "Ana Maria Costa"]);
    fireEvent.click(options[1]!);
    expect(onSelect).toHaveBeenCalledWith(members[2]);
  });

  it("allows keyboard selection with Enter key on an option", () => {
    const onSelect = vi.fn();
    render(<MemberPicker members={members} onSelect={onSelect} selected={null} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), {
      target: { value: "ana" },
    });
    const option = screen.getByRole("option", { name: "Ana Coelho" });
    fireEvent.keyDown(option, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(members[0]);
  });

  it("shows the selected member with a change action, and the error honestly", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <MemberPicker members={members} onSelect={onSelect} selected={members[0]} />,
    );
    expect(screen.getByText("Ana Coelho")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change member" }));
    expect(onSelect).toHaveBeenCalledWith(null);
    rerender(
      <MemberPicker
        error="The member list is unavailable. Please try again."
        members={null}
        onSelect={onSelect}
        selected={null}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The member list is unavailable. Please try again.",
    );
  });
});
