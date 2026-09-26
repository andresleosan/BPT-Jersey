"use client";

import Image from "next/image";
import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

const links = [
  { href: "#top", label: "Home" },
  { href: "#classes", label: "Classes" },
  { href: "#programmes", label: "Programmes" },
  { href: "/courses", label: "Courses" },
  { href: "#shop", label: "Shop" },
  { href: "#locations", label: "Locations" },
  { href: "#contact", label: "Contact" },
] as const;

function subscribeToNothing(): () => void {
  return () => undefined;
}

/**
 * Landing navigation. Below 58rem the section links fold behind the header logo, which becomes a
 * menu button; Sign in stays visible outside the list, and every folded link is an anchor to a
 * section of this page (or its own route). The logo button only exists once the script runs: the
 * static HTML keeps the plain home link, and CSS swaps the two on phones.
 */
export function PrimaryNavigation() {
  const [open, setOpen] = useState(false);
  const scriptReady = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);

  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <nav className="primary-nav" aria-label="Primary navigation" onKeyDown={closeOnEscape}>
      {scriptReady ? (
        <button
          aria-controls="primary-nav-links"
          aria-expanded={open}
          aria-label={`${open ? "Close" : "Open"} BPT Jersey menu`}
          className="nav-menu-button wordmark"
          onClick={() => setOpen((current) => !current)}
          ref={buttonRef}
          type="button"
        >
          <Image alt="" className="site-logo" height={96} src="/bpt-jersey-logo.png" width={144} />
          <span>BPT</span>
          <span>Jersey</span>
        </button>
      ) : null}
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
