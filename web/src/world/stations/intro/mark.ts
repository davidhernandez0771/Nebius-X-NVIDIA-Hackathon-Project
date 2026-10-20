// The logo mark: one SVG, read by SVGLoader and extruded into the 3D glass logo (logo3d.ts, Scene.tsx).
// Replace web/public/world/mark.svg with any white-on-transparent drawing (square viewBox; strokes
// and fills both work) and the logo follows: the shapes out at the edge become the ring, the rest the core.
export const MARK_URL = `${import.meta.env.BASE_URL}world/mark.svg`;
