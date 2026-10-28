// Static fallback for reduced motion / low-power / no WebGL: the same room as
// a flat isometric line drawing. No canvas, no animation.

const K = Math.cos(Math.PI / 6);
const iso = (x: number, y: number, z: number) => `${((x - z) * K).toFixed(3)},${((x + z) * 0.5 - y).toFixed(3)}`;

function Box({ x, y, z, w, h, d, tone = 0.06, stroke = "var(--l-accent)" }: {
  x: number; y: number; z: number; w: number; h: number; d: number; tone?: number; stroke?: string;
}) {
  // x,y,z = min corner. Visible faces from the +x/+z side: top, +z front, +x right.
  const top = [[x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + d], [x, y + h, z + d]];
  const front = [[x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d]];
  const right = [[x + w, y, z], [x + w, y, z + d], [x + w, y + h, z + d], [x + w, y + h, z]];
  const pts = (f: number[][]) => f.map((p) => iso(p[0], p[1], p[2])).join(" ");
  return (
    <g stroke={stroke} strokeOpacity={0.55} strokeWidth={0.02} strokeLinejoin="round">
      <polygon points={pts(front)} fill={`rgba(244,240,236,${tone * 0.7})`} />
      <polygon points={pts(right)} fill={`rgba(244,240,236,${tone * 0.4})`} />
      <polygon points={pts(top)} fill={`rgba(244,240,236,${tone})`} />
    </g>
  );
}

export default function StaticRoom() {
  return (
    <div className="static-room" aria-hidden="true">
      <svg viewBox="-4.8 -5.2 9.6 8.4" role="img">
        <Box x={-2.3} y={-0.16} z={-2.3} w={4.6} h={0.16} d={4.6} tone={0.05} />
        <Box x={-2.3} y={0} z={-2.3} w={4.6} h={2.5} d={0.12} tone={0.03} />
        <Box x={-2.3} y={0} z={-2.3} w={0.12} h={2.5} d={4.6} tone={0.03} />
        <Box x={-0.98} y={0} z={-1.02} w={2.4} h={0.02} d={1.7} tone={0.08} stroke="var(--l-warm)" />
        <Box x={-1.75} y={0} z={-2.18} w={1.3} h={1.78} d={0.4} tone={0.07} />
        <Box x={0.35} y={0.72} z={-2.15} w={1.5} h={0.06} d={0.7} tone={0.09} />
        <Box x={0.8} y={0} z={-0.25} w={0.9} h={0.48} d={1.9} tone={0.09} />
        <Box x={-2.0} y={0} z={1.4} w={0.4} h={0.9} d={0.4} tone={0.09} />
        <Box x={-0.6} y={0} z={0.65} w={0.28} h={0.06} d={0.2} tone={0.14} stroke="var(--l-warm)" />
        <Box x={-0.65} y={0.78} z={-1.75} w={0.14} h={0.1} d={0.14} tone={0.14} stroke="var(--l-warm)" />
        <Box x={1.5} y={0.78} z={-1.85} w={0.2} h={0.5} d={0.2} tone={0.1} stroke="var(--l-warm)" />
      </svg>
    </div>
  );
}
