import { NOTES, cite, type Source } from "./facts";

/** A source as text, with the note's path on hover. Every number on the page sits next to one. */
export function Cite({ source, prefix = "Source: " }: { source: Source; prefix?: string }) {
  return (
    <cite className="sant-cite" title={NOTES[source.note]}>
      {prefix}
      {cite(source)}
    </cite>
  );
}
