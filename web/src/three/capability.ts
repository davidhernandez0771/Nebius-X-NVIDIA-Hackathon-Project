// Decides whether to run the WebGL scene at all.

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isMobile(): boolean {
  return typeof matchMedia === "function" && matchMedia("(max-width: 820px)").matches;
}

export function isLowPower(): boolean {
  const n = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return (
    (n.deviceMemory !== undefined && n.deviceMemory <= 2) ||
    (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 2) ||
    n.connection?.saveData === true
  );
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** `?static` forces the fallback, `?3d` forces the scene (for testing). */
export function shouldRun3D(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has("static")) return false;
  if (q.has("3d")) return hasWebGL();
  return !prefersReducedMotion() && !isLowPower() && hasWebGL();
}
