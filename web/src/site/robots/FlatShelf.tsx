// The still shelf for reduced motion, effects off, or no WebGL: the same cartridges standing in a row, and the
// picked one pulled up with its title block. Nothing moves on its own.
import { ROBOTS } from "./robots";

export function FlatShelf({ selected, onPick }: { selected: number | null; onPick: (i: number) => void }) {
  const sel = selected == null ? null : ROBOTS[selected];
  return (
    <div className="flat-shelf">
      <div className="flat-shelf__row" role="list">
        {ROBOTS.map((r, i) => (
          <button
            key={r.id}
            type="button"
            role="listitem"
            className="flat-cart"
            data-picked={selected === i}
            aria-label={`${r.name}, ${r.status}`}
            onClick={() => onPick(i)}
          >
            <span className="flat-cart__ribs" aria-hidden="true" />
            <span className="flat-cart__label">
              <span className="flat-cart__bar">SANT</span>
              <span className="flat-cart__code">{r.code}</span>
              <span className="flat-cart__sub">{r.sub}</span>
              <span className="flat-cart__status">{r.status.toUpperCase()}</span>
            </span>
            <span className="flat-cart__window" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="flat-shelf__title" aria-hidden={sel ? undefined : "true"}>
        {sel && (
          <>
            <strong>{sel.name.toUpperCase()}</strong>
            <span>
              {sel.status} · {sel.year} · {sel.note}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
