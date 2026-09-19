// Landing-only display faces. The dashboard keeps the system font.
// (Instrument Serif + JetBrains Mono are both open-licensed.)
const HREF =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap";

export function ensureFonts() {
  if (document.querySelector('link[data-sant-fonts]')) return;
  const pre = document.createElement("link");
  pre.rel = "preconnect";
  pre.href = "https://fonts.gstatic.com";
  pre.crossOrigin = "";
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = HREF;
  link.dataset.santFonts = "1";
  document.head.append(pre, link);
}
