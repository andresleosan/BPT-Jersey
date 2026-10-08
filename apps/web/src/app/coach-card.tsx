"use client";
import { useLayoutEffect, useRef } from "react";
import type { PublicCoach } from "@bpt-jersey/domain/staff/team-access";

const bioMaxLines = 5;
/** Largest first: a short bio reads bigger, a long one steps down until it fits five lines. */
const bioSizesRem = [1.125, 1.0625, 1, 0.9375, 0.875, 0.8125];

/** Picks the largest size at which the bio fits five lines, again whenever the card width changes. */
function useFittedBio(bio: string | undefined) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !bio) return;
    let width = -1;
    const fit = () => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      for (const size of bioSizesRem) {
        element.style.fontSize = `${size}rem`;
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
        if (element.scrollHeight <= Math.ceil(lineHeight * bioMaxLines) + 1) break;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bio]);
  return ref;
}

function initials(name: string): string {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** One landing card: 3:4 photo (or initials in the same frame), name, belt, bio in at most five lines. */
export function CoachCard({ coach }: { coach: Pick<PublicCoach, "name" | "beltLabel" | "bio" | "photoUrl"> }) {
  const bioRef = useFittedBio(coach.bio);
  return (
    <article className="instructor-card">
      <div className="instructor-photo">
        {coach.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed R2 URL, static export
          <img alt={`${coach.name}, coach`} decoding="async" loading="lazy" src={coach.photoUrl} />
        ) : (
          <span aria-hidden="true">{initials(coach.name)}</span>
        )}
      </div>
      <div className="instructor-body">
        <strong>{coach.name}</strong>
        <span>{coach.beltLabel}</span>
        {coach.bio ? (
          <p className="instructor-bio" ref={bioRef}>
            {coach.bio}
          </p>
        ) : null}
      </div>
    </article>
  );
}
