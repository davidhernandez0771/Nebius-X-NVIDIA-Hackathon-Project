import { isNote, noteUrl } from "./data";
import { NOTES, cite, type Source } from "./facts";

/** A source next to its number: a note as a link to its lines (the path on hover), or a store file by name. */
export function Cite({ source, prefix = "Source: " }: { source: Source; prefix?: string }) {
  if (!isNote(source))
    return (
      <cite className="sant-cite sant-cite--file">
        {prefix}
        {cite(source)}
      </cite>
    );
  return (
    <cite className="sant-cite" title={NOTES[source.note].path}>
      {prefix}
      <a href={noteUrl(source)!} target="_blank" rel="noreferrer">
        {cite(source)}
      </a>
    </cite>
  );
}
