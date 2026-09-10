import type { SVGProps } from "react";

export type AdminIconName =
  | "activity"
  | "attendance"
  | "close"
  | "finance"
  | "member-add"
  | "members"
  | "menu"
  | "reports"
  | "search"
  | "teams";

export function AdminIcon({ name, ...props }: { name: AdminIconName } & SVGProps<SVGSVGElement>) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...common} {...props}>
      {name === "member-add" ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.7-3 2.5-4.5 5.5-4.5s4.8 1.5 5.5 4.5M19 11v6m-3-3h6" />
        </>
      ) : null}
      {name === "members" ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.7-3 2.5-4.5 5.5-4.5s4.8 1.5 5.5 4.5M16 6.5a2.7 2.7 0 0 1 0 5.2M16 15c2.3.2 3.8 1.5 4.5 4" />
        </>
      ) : null}
      {name === "search" ? (
        <>
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="m15 15 5 5M7.5 10.5h6M10.5 7.5v6" />
        </>
      ) : null}
      {name === "teams" ? (
        <>
          <circle cx="8" cy="8" r="2.5" />
          <circle cx="16" cy="8" r="2.5" />
          <path d="M3 19c.5-2.7 2.1-4 5-4s4.5 1.3 5 4M11 19c.5-2.7 2.1-4 5-4s4.5 1.3 5 4" />
        </>
      ) : null}
      {name === "activity" ? (
        <>
          <rect x="4" y="5" width="16" height="15" rx="1" />
          <path d="M8 3v4M16 3v4M4 9h16M8 13h3M8 16h6" />
        </>
      ) : null}
      {name === "attendance" ? (
        <>
          <path d="m5 12 4 4L19 6" />
          <circle cx="12" cy="12" r="9" />
        </>
      ) : null}
      {name === "finance" ? (
        <>
          <rect x="4" y="5" width="16" height="14" rx="1" />
          <path d="M8 9h8M8 13h3M15 13h1" />
        </>
      ) : null}
      {name === "reports" ? (
        <>
          <path d="M5 19V9M12 19V5M19 19v-7" />
          <path d="M3 19h18" />
        </>
      ) : null}
      {name === "menu" ? <path d="M4 7h16M4 12h16M4 17h16" /> : null}
      {name === "close" ? <path d="m6 6 12 12M18 6 6 18" /> : null}
    </svg>
  );
}
