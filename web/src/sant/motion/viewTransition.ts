// Route changes inside a same-document view transition, with a plain fallback.
// React Router 6.30's `viewTransition` prop only works with data routers; this app uses
// <BrowserRouter>, so we wrap navigate() ourselves (docs/design/ui-motion-research.md §3).
import { flushSync } from "react-dom";

type TransitionDoc = { startViewTransition?: (update: () => void) => unknown };

export function navigateWithTransition<T>(
  navigate: (to: T) => void,
  to: T,
  {
    reduced,
    doc = document as unknown as TransitionDoc,
    flush = flushSync,
  }: { reduced: boolean; doc?: TransitionDoc; flush?: (fn: () => void) => void },
): void {
  if (reduced || typeof doc.startViewTransition !== "function") {
    navigate(to);
    return;
  }
  // flushSync makes React commit the new route inside the callback, so the browser's "new"
  // snapshot is the new page.
  doc.startViewTransition(() => flush(() => navigate(to)));
}
