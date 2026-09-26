import { describe, expect, it } from "vitest";

import { academyContent } from "./academy";

describe("public academy content", () => {
  it("contains the published identity, location, programs, instructors, and contact", () => {
    expect(academyContent.lastVerified).toBe("2026-08-07");
    expect(academyContent.identity.title).toBe("Brazilian Jiu-Jitsu, MMA & Self-Defence");
    expect(academyContent.identity.titleLines).toEqual([
      "Brazilian Jiu-",
      "Jitsu, MMA",
      "& Self-Defence",
    ]);
    expect(
      `${academyContent.identity.titleLines[0]}${academyContent.identity.titleLines[1]} ${academyContent.identity.titleLines[2]}`,
    ).toBe(academyContent.identity.title);
    expect(academyContent.identity.intro).toBe(
      "Gi and No-Gi classes in St Helier and the west of the island, from 6am sessions before work to evening classes. Your first class is free.",
    );
    expect(academyContent.locations).toEqual([
      {
        key: "town",
        name: "Town",
        address: "Office 9, 13 Library Place",
        locality: "St Helier, Jersey",
        postcode: "JE2 3RR",
      },
      {
        key: "west",
        name: "West",
        address: "L'Avenue de la Reine Elizabeth II",
        locality: "Jersey",
        postcode: "JE3 7BP",
      },
    ]);
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
        title: "Beginners",
        description:
          "Beginner classes run at Town on Monday and Wednesday at 17:30 and on Tuesday and Thursday at 18:30, and at West on Tuesday and Thursday at 18:30. No experience needed.",
      },
    ]);
    expect(academyContent.instructors).toEqual([
      {
        id: "coach-miro",
        name: 'Professor Vladimiro "Miro" Afonso',
        credential: "4th degree black belt",
      },
      { id: "coach-charlie", name: "Charlie Tromans", credential: "Black belt" },
      { id: "coach-amone", name: "Amoné Mouton", credential: "Black belt" },
      { id: "coach-connor", name: "Connor Hoopes", credential: "Black belt" },
      { id: "coach-catalina", name: "Catalina Bruma", credential: "Brown belt" },
    ]);
    expect(academyContent.notes.booking).toBe(
      "Times can change between terms. Check the week in your account before you come.",
    );
    expect(academyContent.notes.contact).toBe(
      "Book a free class and a coach will help you pick the right class to start with.",
    );
    expect(academyContent.sources).toEqual([
      "https://bptjersey.com/",
      "https://bptjersey.com/classes",
      "https://bptjersey.com/contact-us",
      "https://bptjersey.com/club-merchandise",
    ]);
  });

  it("contains the eight published schedule rows", () => {
    expect(academyContent.schedule).toEqual([
      {
        location: "Town",
        days: "Monday and Wednesday",
        time: "06:00-07:00",
        discipline: "No-Gi",
        level: "All levels",
      },
      {
        location: "Town",
        days: "Monday and Wednesday",
        time: "07:00-08:00",
        discipline: "Gi",
        level: "Beginners and all levels",
      },
      {
        location: "Town",
        days: "Monday and Wednesday",
        time: "17:30-18:30",
        discipline: "Gi",
        level: "Beginners",
      },
      {
        location: "Town",
        days: "Monday and Wednesday",
        time: "18:30-19:30",
        discipline: "No-Gi",
        level: "All levels",
      },
      {
        location: "Town",
        days: "Tuesday and Thursday",
        time: "12:00-13:00",
        discipline: "Gi",
        level: "Beginners and all levels",
      },
      {
        location: "Town",
        days: "Tuesday and Thursday",
        time: "17:30-18:30",
        discipline: "Gi",
        level: "All levels",
      },
      {
        location: "Town",
        days: "Tuesday and Thursday",
        time: "18:30-19:30",
        discipline: "No-Gi",
        level: "Beginners",
      },
      {
        location: "West",
        days: "Tuesday and Thursday",
        time: "18:30-19:30",
        discipline: "Jiu-Jitsu",
        level: "Beginners",
      },
    ]);
  });

  it("describes the merchandise without unverified claims", () => {
    const descriptions = academyContent.merchandise.map((category) => category.description);

    expect(descriptions[0]).toBe("BPT gis in blue, black and white with embroidered lettering.");
    expect(descriptions[1]).toBe("No-Gi rashguards with the BPT tiger in team colours.");
    expect(JSON.stringify(academyContent)).not.toMatch(/Competition-ready|limited runs/u);
  });

  it("keeps public program and contact content free of account artifacts", () => {
    const visibleContent = JSON.stringify(academyContent);

    expect(visibleContent).toContain("Kids self-defence");
    expect(visibleContent).toContain("Book a free class");
    expect(visibleContent).not.toContain("filler@godaddy.com");
    expect(visibleContent).not.toContain("(f)");
  });
});
