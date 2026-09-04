export type ScheduleEntry = {
  location: "Town Office" | "Strive";
  days: string;
  time: string;
  discipline: "Gi" | "No-Gi" | "Jiu-Jitsu";
  level: string;
};

export type FeeItem = {
  label: string;
  amount: string;
  detail: string;
};

export type ProgramItem = {
  label: string;
  title: string;
  description: string;
};

export type Instructor = {
  name: string;
  credential: string;
};

export type MerchandiseCategory = {
  key: "gi" | "rashguard" | "shorts" | "backpack" | "casual";
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

export const academyContent = {
  lastVerified: "2026-08-07",
  sources: [
    "https://bptjersey.com/",
    "https://bptjersey.com/classes",
    "https://bptjersey.com/contact-us",
    "https://bptjersey.com/club-merchandise",
  ],
  identity: {
    title: "Brazilian Jiu-Jitsu, MMA & Self-Defence",
    titleLines: ["Brazilian Jiu-", "Jitsu, MMA", "& Self-Defence"] as const,
    intro:
      "Train with purpose in a welcoming Jersey academy built around skill, confidence, discipline, and community.",
  },
  location: {
    name: "Town Office",
    address: "Office 9, 13 Library Place",
    locality: "St Helier, Jersey",
    postcode: "JE2 3RR",
  },
  schedule: [
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
  ] satisfies readonly ScheduleEntry[],
  programs: [
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
  ] satisfies readonly ProgramItem[],
  fees: [
    {
      label: "Town Office",
      amount: "£85",
      detail: "Monthly fee covering all classes and open mats.",
    },
    {
      label: "BPT West / Strive",
      amount: "£10 / £65",
      detail: "Per session or monthly; the published £8 class wording should be confirmed.",
    },
    {
      label: "Kids",
      amount: "£95",
      detail: "Once weekly for the current school term.",
    },
  ] satisfies readonly FeeItem[],
  instructors: [
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
  ] satisfies readonly Instructor[],
  merchandise: [
    {
      key: "gi",
      title: "GIs (kimonos)",
      description: "Competition-ready BPT gis in blue, black and white with embroidered lettering.",
      image: "/shop/gis.jpg",
      imageAlt: "Blue BPT gi trousers hanging on a rail with Brazilian Power Team lettering.",
    },
    {
      key: "rashguard",
      title: "Rashguards",
      description: "No-Gi rashguards with the BPT tiger, in team colours and limited runs.",
      image: "/shop/rashguards.jpg",
      imageAlt: "Pink and black BPT rashguard sleeve showing the tiger emblem.",
    },
    {
      key: "shorts",
      title: "Shorts",
      description: "Lightweight grappling shorts for No-Gi classes and open mats.",
      image: "/shop/shorts.jpg",
      imageAlt: "Black BPT grappling shorts with Brazilian Power Team print.",
    },
    {
      key: "backpack",
      title: "Backpacks",
      description: "Training backpacks with a separate gi compartment and ventilated base.",
      image: "/shop/backpacks.jpg",
      imageAlt: "Grey Brazilian Power Team training backpack hanging on a rail.",
    },
    {
      key: "casual",
      title: "Casual clothing",
      description: "Joggers, hoodies and team wear for before and after training.",
      image: "/shop/casual.jpg",
      imageAlt: "Grey BPT joggers with the embroidered tiger patch.",
    },
  ] satisfies readonly MerchandiseCategory[],
  notes: {
    booking:
      "Timetables and fees are published information. Confirm eligibility and current term availability when booking.",
    contact:
      "Book a free class and the academy team will help you choose the right starting point.",
    merchandise:
      "Sign in to your client account to see current prices, sizes and place an order. Orders are paid at the academy on collection.",
  },
} as const;
