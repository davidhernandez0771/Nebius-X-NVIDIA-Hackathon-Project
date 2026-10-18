import { useId, type ReactNode } from "react";

/** A figure that always carries its caption and its source as text. */
export function ChartFrame({ title, caption, source, children }: { title: string; caption: ReactNode; source: string; children: ReactNode }) {
  const id = useId();
  return (
    <figure className="sant-chart" aria-labelledby={id}>
      <h3 id={id} className="sant-chart__title">
        {title}
      </h3>
      <div className="sant-chart__body">{children}</div>
      <figcaption className="sant-chart__caption">
        {caption} <span className="sant-chart__source">Source: {source}</span>
      </figcaption>
    </figure>
  );
}
