// The simulator's own camera for one episode, played from its sprite sheet (GET /showcase/.../footage): one image
// download, then each frame is a background position, so it costs no video decoder and follows the shared clock.
import { footageAt, type Footage } from "./model";

export function FootageView({ footage, t, label }: { footage: Footage | null; t: number; label: string }) {
  if (!footage) return <div className="data-footage data-footage--empty" role="img" aria-label={`${label}: no camera frames`} />;
  const rows = Math.ceil(footage.frames / footage.cols);
  const { index } = footageAt(footage, t);
  const col = index % footage.cols;
  const row = Math.floor(index / footage.cols);
  const pct = (k: number, n: number) => (n <= 1 ? 0 : (k / (n - 1)) * 100);
  return (
    <div
      className="data-footage"
      role="img"
      aria-label={label}
      data-frame={index}
      style={{
        backgroundImage: `url("${footage.url}")`,
        backgroundSize: `${footage.cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${pct(col, footage.cols)}% ${pct(row, rows)}%`,
      }}
    />
  );
}
