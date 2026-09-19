import { useEffect, useRef } from "react";
import { animate, onScroll, stagger } from "animejs";
import { prefersReducedMotion } from "./capability";

/** Big serif headline: each word rises out of a mask the first time it is seen. */
export function Headline({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = ref.current!;
    if (prefersReducedMotion()) return;
    const words = el.querySelectorAll<HTMLElement>(".hw");
    let anim: ReturnType<typeof animate> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        anim = animate(words, {
          translateY: ["112%", "0%"],
          duration: 1100,
          ease: "outExpo",
          delay: stagger(70),
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      anim?.revert();
    };
  }, []);
  return (
    <h2 ref={ref} className={`display ${className}`}>
      {text.split(" ").map((w, i) => (
        <span key={i}>
          <span className="hmask">
            <span className="hw">{w}</span>
          </span>{" "}
        </span>
      ))}
    </h2>
  );
}

/**
 * Body statement: unread words are dim, read words bright, scrubbed by scroll
 * with anime.js's scroll observer against the chapter's pinned range.
 */
export function Reveal({
  text,
  section,
  className = "",
}: {
  text: string;
  section: React.RefObject<HTMLElement>;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (prefersReducedMotion() || !section.current) return;
    const words = ref.current!.querySelectorAll<HTMLElement>(".rw");
    const anim = animate(words, {
      opacity: [0.16, 1],
      ease: "linear",
      duration: 400,
      delay: stagger(90),
      autoplay: onScroll({
        target: section.current,
        // anime reads these as "<viewport edge> <section edge>": start when the
        // section top is half way up the screen, finish when its bottom is
        // level with the bottom of the screen (the end of the pinned range).
        enter: "50% start",
        leave: "end end",
        sync: true,
      }),
    });
    return () => {
      anim.revert();
    };
  }, [section]);
  return (
    <p ref={ref} className={`statement ${className}`}>
      {text.split(" ").map((w, i) => (
        <span className="rw" key={i}>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}
