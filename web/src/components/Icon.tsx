// Small outline icon set (inline SVG, currentColor) so the UI needs no icon dependency.
const paths = {
  home: "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6",
  room: "M5 11V8a2 2 0 012-2h10a2 2 0 012 2v3M3 13a2 2 0 014 0v2h10v-2a2 2 0 014 0v5H3v-5zM6 18v2M18 18v2",
  scan: "M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M12 8l4 2v4l-4 2-4-2v-4l4-2z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  review: "M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l3 3 5-6",
  shelf: "M4 4h16v16H4V4zM4 12h16M9 4v8M15 12v8",
  organize: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM17 13v7M13 16.5h7",
  chat: "M4 5h16v11H9l-5 4V5z",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  plus: "M12 5v14M5 12h14",
  send: "M12 19V5M6 11l6-6 6 6",
  question: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 3.5M12 17h.01",
  box: "M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10",
  spend: "M12 21a9 9 0 100-18 9 9 0 000 18zM14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5v1.5M12 16v1.5",
  chevron: "M9 6l6 6-6 6",
  mic: "M9 3a3 3 0 016 0v7a3 3 0 01-6 0V3zM5 11a7 7 0 0014 0M12 18v3M9 21h6",
  wand: "M5 19L19 5M15 5h4v4M5 15v4h4",
  layers: "M12 4l8 4-8 4-8-4 8-4zM4 13l8 4 8-4",
  sparkle: "M12 3l1.8 4.9L18.5 9l-4.7 1.9L12 15.8l-1.8-4.9L5.5 9l4.7-2.1L12 3zM19 15l.9 2.4L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.6L19 15z",
} as const;

export type IconName = keyof typeof paths;

export default function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
