// A quiet Contact entry point, top right: a small button that opens a panel under it listing the links
// in site/contact.ts (the panel says they are coming if it is ever empty). Escape, Close or a click
// outside closes it, and focus goes back to the button. Anything passed as children stands just before it, in the
// same row (the guide's "?", guide/Guide.tsx).
import { Logo } from "../../sant/components/Logo";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CONTACT_LINKS, type ContactLink } from "../../site/contact";
import "./ui.css";

/** Only links a visitor can safely follow from here. */
const SAFE = /^(https?:\/\/|mailto:)/i;

export function Contact({ links = CONTACT_LINKS, children }: { links?: readonly ContactLink[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = links.filter((l) => SAFE.test(l.href));

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <div className="world-contact world-u">
      {children}
      <button ref={button} type="button" className="world-contact__open" aria-expanded={open} aria-controls={id} onClick={() => (open ? close() : setOpen(true))}>
        Contact
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          className="world-contact__panel"
          role="dialog"
          aria-label="Contact"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // The world's own Escape (closing a branch, the shelf) doesn't hear this one.
            e.stopPropagation();
            e.preventDefault();
            close();
          }}
        >
          <p className="world-contact__h">
            <Logo size="sm" lit="all" wordmark={false} />
            <span>Contact</span>
          </p>
          {shown.length ? (
            <ul className="world-contact__links">
              {shown.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="world-contact__empty">Links coming soon.</p>
          )}
          <button type="button" className="world-contact__close" onClick={close}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
