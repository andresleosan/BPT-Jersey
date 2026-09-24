"use client";

import { useEffect, useRef } from "react";

/**
 * The streak flame. The light SVG player is enough: `streak-flame.json` uses no expressions.
 * Reduced motion or a run shorter than two sessions shows the first frame, still.
 */
export function StreakFlame({ count }: Readonly<{ count: number }>) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    let cancelled = false;
    let dispose = () => {};
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || count < 2;
    import("lottie-web/build/player/lottie_light")
      .then(({ default: lottie }) => {
        if (cancelled) return;
        const anim = lottie.loadAnimation({
          container: node,
          renderer: "svg",
          loop: !still,
          autoplay: !still,
          path: "/animations/streak-flame.json",
        });
        if (still) anim.addEventListener("DOMLoaded", () => anim.goToAndStop(0, true));
        dispose = () => anim.destroy();
      })
      .catch(() => {
        /* no flame art: the multiplier still reads */
      });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [count]);
  return (
    <div className="streak-flame">
      <div ref={box} className="streak-flame-art" aria-hidden="true" data-testid="streak-flame" />
      {count >= 2 ? (
        <span className="streak-multiplier" aria-label={`${count} session streak`}>
          x{count}
        </span>
      ) : null}
    </div>
  );
}
