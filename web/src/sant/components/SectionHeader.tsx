import { createElement, type ReactNode } from "react";

/** A section heading. On paper, the note sits in the margin column beside it. */
export function SectionHeader({
  title,
  lede,
  note,
  level = 2,
  id,
}: {
  title: string;
  lede?: ReactNode;
  note?: ReactNode;
  level?: 1 | 2 | 3;
  /** Lets a wrapping <section aria-labelledby> name itself after the heading. */
  id?: string;
}) {
  return (
    <header className="sant-section-header">
      <div className="sant-section-header__main">
        {createElement(`h${level}`, { className: `sant-h${level}`, id }, title)}
        {lede && <p className="sant-lede">{lede}</p>}
      </div>
      {note && <aside className="sant-margin-note">{note}</aside>}
    </header>
  );
}
