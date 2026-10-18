// Lenis smooth scroll, for story pages only (app pages keep native scroll for precise input).
// Not created at all when motion is reduced; Lenis's own respectReducedMotion is a second guard.
import { useEffect } from "react";
import Lenis from "lenis";

export function useLenis(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.1, stopInertiaOnNavigate: true });
    return () => lenis.destroy();
  }, [enabled]);
}
