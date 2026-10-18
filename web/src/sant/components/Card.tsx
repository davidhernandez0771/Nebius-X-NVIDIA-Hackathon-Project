import { useId, type ReactNode } from "react";

export function Card({
  title,
  aside,
  tone = "plain",
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  tone?: "plain" | "live" | "issue";
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`sant-card sant-card--${tone} ${className}`.trim()} aria-labelledby={title ? id : undefined}>
      {title && (
        <header className="sant-card__head">
          <h3 id={id} className="sant-card__title">
            {title}
          </h3>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
