"use client";

import { useRef, useState, type KeyboardEvent } from "react";

const links = [
  { href: "#top", label: "Home" },
  { href: "#classes", label: "Classes" },
  { href: "#programmes", label: "Programmes" },
  { href: "/courses", label: "Courses" },
  { href: "#shop", label: "Shop" },
  { href: "#locations", label: "Locations" },
  { href: "#contact", label: "Contact" },
] as const;

/**
 * Landing navigation. Below 58rem the section links fold behind the "Menu" button; Sign in stays
 * visible outside the list, and every folded link is an anchor to a section of this page (or its
 * own route), so nothing is unreachable if the script has not run.
 */
export function PrimaryNavigation() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <nav className="primary-nav" aria-label="Primary navigation" onKeyDown={closeOnEscape}>
      <button
        aria-controls="primary-nav-links"
        aria-expanded={open}
        className="nav-menu-button"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        Menu
      </button>
      <ul className="primary-nav-links" data-open={open} id="primary-nav-links">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      <a className="nav-cta" href="/login">
        Sign in
      </a>
    </nav>
  );
}
