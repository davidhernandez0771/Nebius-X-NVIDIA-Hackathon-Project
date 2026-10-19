// The workshop's one light switch. The lamps (Lamps.tsx) set a level 0–1 each frame; it scales the
// colour of every baked material (their light is in the atlas, so dimming the colour dims the room)
// and the intensity of the few live lights on the moving parts. Mutated in place, never React state.
// It also counts the files in, so the lamps know when the workshop is ready.
import { Color, type ColorRepresentation, type Light, type MeshBasicMaterial, type MeshStandardMaterial } from "three";
import { ALL_MODELS } from "./assets";
import { OFF } from "./flicker";

const baked = new Set<MeshBasicMaterial>();
const lights = new Map<Light, number>();
const lit = new Map<MeshStandardMaterial, number>();
const glows = new Map<MeshBasicMaterial, { base: Color; gain: number }>();
const loaded = new Set<string>();

export const power = {
  level: OFF,
  /** Seconds (canvas clock) when the power-on began, or null while it hasn't. */
  onAt: null as number | null,
};

function apply(m: MeshBasicMaterial, level: number) {
  m.color.setScalar(level);
}

export function setPower(level: number): void {
  if (level === power.level) return;
  power.level = level;
  baked.forEach((m) => apply(m, level));
  lights.forEach((base, l) => (l.intensity = base * level));
  lit.forEach((base, m) => (m.envMapIntensity = base * level));
  glows.forEach((g, m) => m.color.copy(g.base).multiplyScalar(level * g.gain));
}

/** A baked material follows the lamps from now on; returns the unregister. */
export function addBaked(m: MeshBasicMaterial): () => void {
  baked.add(m);
  apply(m, power.level);
  return () => baked.delete(m);
}

/** A lit material whose reflections (envMapIntensity `base` at full power) follow the lamps. */
export function addLit(m: MeshStandardMaterial, base: number): () => void {
  lit.set(m, base);
  m.envMapIntensity = base * power.level;
  return () => lit.delete(m);
}

/** A lamp-powered light strip: an unlit material of colour `base` at full power. */
export function addGlow(m: MeshBasicMaterial, base: ColorRepresentation): () => void {
  glows.set(m, { base: new Color(base), gain: 1 });
  m.color.copy(glows.get(m)!.base).multiplyScalar(power.level);
  return () => glows.delete(m);
}

/** Turn one glow up or down on top of the lamps (the slot light, the projector's lens). */
export function setGlowGain(m: MeshBasicMaterial, gain: number): void {
  const g = glows.get(m);
  if (!g || g.gain === gain) return;
  g.gain = gain;
  m.color.copy(g.base).multiplyScalar(power.level * gain);
}

/** A live light at full power `base`; returns the unregister. */
export function addLight(l: Light, base: number): () => void {
  lights.set(l, base);
  l.intensity = base * power.level;
  return () => lights.delete(l);
}

export function markLoaded(url: string): void {
  loaded.add(url);
}

/** 0–1: how much of the workshop has arrived. */
export function loadProgress(): number {
  return ALL_MODELS.filter((u) => loaded.has(u)).length / ALL_MODELS.length;
}

/** For tests and a fresh visit: lamps off, nothing counted. */
export function resetPower(): void {
  power.level = OFF;
  power.onAt = null;
  loaded.clear();
}
