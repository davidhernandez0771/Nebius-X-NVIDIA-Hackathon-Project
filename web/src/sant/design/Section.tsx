import { useId, type ReactNode } from "react";
import { SectionHeader } from "../components";

/** One /design section: a region named by its heading. */
export function Section({ title, lede, note, children }: { title: string; lede?: ReactNode; note?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="sant-design-section" aria-labelledby={id}>
      <SectionHeader id={id} title={title} lede={lede} note={note} />
      {children}
    </section>
  );
}
