import { describe, expect, it } from "vitest";

import { academyContent } from "./academy";

describe("public academy content", () => {
  it("contains the published identity, location, programs, instructors, and contact", () => {
    expect(academyContent.lastVerified).toBe("2026-08-07");
    expect(academyContent.identity.title).toBe("Brazilian Jiu-Jitsu, MMA & Self-Defence");
    expect(academyContent.location.name).toBe("Town Office");
    expect(academyContent.location.address).toBe("Office 9, 13 Library Place");
    expect(academyContent.location.locality).toBe("St Helier, Jersey");
    expect(academyContent.location.postcode).toBe("JE2 3RR");
    expect(academyContent.programs).toEqual([
      {
        label: "BJJ",
        title: "Brazilian Jiu-Jitsu",
        description: "Gi and No-Gi training for beginners and experienced students.",
      },
      {
        label: "Kids",
        title: "Kids self-defence",
        description:
          "Age-group programs based on Brazilian Jiu-Jitsu, with focus, coordination, teamwork, and confidence.",
      },
      {
        label: "Beginners",
        title: "Start with confidence",
        description:
          "A clear entry point for people with no previous martial-arts experience or returning to training.",
      },
      {
        label: "MMA",
        title: "MMA at BPT",
        description:
          "A combat-sports pathway for students looking for a different challenge; event availability is confirmed separately.",
      },
    ]);
    expect(academyContent.instructors).toEqual([
      {
        name: 'Professor Vladimiro "Miro" Afonso',
        credential: "4th degree black belt",
      },
      {
        name: 'Eduardo "Eddie" Afonso',
        credential: "2nd degree black belt",
      },
      {
        name: 'Andrew "Topo" Toporis',
        credential: "2nd degree black belt and Jersey grappling pioneer",
      },
      { name: "Charlie Tromans", credential: "Black belt" },
    ]);
    expect(academyContent.notes.booking).toBe(
      "Timetables and fees are published information. Confirm eligibility and current term availability when booking.",
    );
    expect(academyContent.notes.contact).toBe(
      "Book a free class and the academy team will help you choose the right starting point.",
    );
    expect(academyContent.sources).toEqual([
      "https://bptjersey.com/",
      "https://bptjersey.com/classes",
      "https://bptjersey.com/contact-us",
    ]);
  });

  it("contains the eight published schedule rows and three published fee items", () => {
    expect(academyContent.schedule).toEqual([
      {
        location: "Town Office",
        days: "Monday and Wednesday",
        time: "06:00-07:00",
        discipline: "No-Gi",
        level: "All levels",
      },
      {
        location: "Town Office",
        days: "Monday and Wednesday",
        time: "07:00-08:00",
        discipline: "Gi",
        level: "Beginners and all levels",
      },
      {
        location: "Town Office",
        days: "Monday and Wednesday",
        time: "17:30-18:30",
        discipline: "Gi",
        level: "Beginners",
      },
      {
        location: "Town Office",
        days: "Monday and Wednesday",
        time: "18:30-19:30",
        discipline: "No-Gi",
        level: "All levels",
      },
      {
        location: "Town Office",
        days: "Tuesday and Thursday",
        time: "12:00-13:00",
        discipline: "Gi",
        level: "Beginners and all levels",
      },
      {
        location: "Town Office",
        days: "Tuesday and Thursday",
        time: "17:30-18:30",
        discipline: "Gi",
        level: "All levels",
      },
      {
        location: "Town Office",
        days: "Tuesday and Thursday",
        time: "18:30-19:30",
        discipline: "No-Gi",
        level: "Beginners",
      },
      {
        location: "Strive",
        days: "Tuesday and Thursday",
        time: "18:30-19:30",
        discipline: "Jiu-Jitsu",
        level: "Published session",
      },
    ]);
    expect(academyContent.fees.map((fee) => fee.amount)).toEqual(["£85", "£10 / £65", "£95"]);
  });

  it("keeps public program and contact content free of account artifacts", () => {
    const visibleContent = JSON.stringify(academyContent);

    expect(visibleContent).toContain("Kids self-defence");
    expect(visibleContent).toContain("MMA");
    expect(visibleContent).toContain("Book a free class");
    expect(visibleContent).not.toContain("filler@godaddy.com");
    expect(visibleContent).not.toContain("(f)");
  });
});
