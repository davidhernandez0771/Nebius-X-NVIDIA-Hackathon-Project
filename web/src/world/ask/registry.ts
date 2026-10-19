// Ask SANT's one tool registry. The model (Nemotron through our backend, POST /api/ask) only picks a
// tool from this list and writes a one-line reply; the client checks the call again here and is the
// only thing that runs it (useAsk.ts). If the backend is down, the prototype's keyword rules pick the
// tool instead (route()).
import { ITEMS, TAGS, type TagId } from "../scene/items";

export const SECTIONS = ["top", "story", "workshop", "machine", "bench"] as const;
export type Section = (typeof SECTIONS)[number];

export type ToolName = "go_to_section" | "show_cartridges_with_tag" | "open_cartridge" | "start_tutorial";

export interface ToolSpec {
  name: ToolName;
  description: string;
  /** The values the one argument may take, or null for none. */
  values: string[] | null;
}

export const TOOLS: readonly ToolSpec[] = [
  { name: "go_to_section", description: "Move the camera to a part of the journey: the top (logo), the story, the workshop's spiral, the machine, or the bench where new cartridges are made", values: [...SECTIONS] },
  { name: "show_cartridges_with_tag", description: "Filter the spiral to the cartridges for one job: " + TAGS.map((t) => `${t.id} (${t.label})`).join(", "), values: TAGS.map((t) => t.id) },
  { name: "open_cartridge", description: "Open one cartridge's detail: " + ITEMS.map((i) => `${i.id} (${i.title}, ${i.sub})`).join("; "), values: ITEMS.map((i) => i.id) },
  { name: "start_tutorial", description: "A short guided tour of the workshop: pick a cartridge, plug it in, make a new one", values: null },
];

export interface ToolCall {
  tool: ToolName;
  arg: string | null;
}

/** A call is run only if its tool is in the registry and its argument is one of that tool's values. */
export function validCall(tool: unknown, arg: unknown): ToolCall | null {
  const spec = TOOLS.find((t) => t.name === tool);
  if (!spec) return null;
  if (spec.values === null) return { tool: spec.name, arg: null };
  return typeof arg === "string" && spec.values.includes(arg) ? { tool: spec.name, arg } : null;
}

/** The line the log shows for a call, like the prototype: › tool("arg"). */
export const callLine = (c: ToolCall) => `› ${c.tool}(${c.arg === null ? "" : JSON.stringify(c.arg)})`;

const TAG_WORDS: [TagId, RegExp][] = [
  ["record", /record|demo|webcam|hand|camera|teleop/],
  ["perfect", /perfect|fix|physics|grasp|neaten|check/],
  ["multiply", /multipl|variant|copies|augment|random/],
  ["train", /train|policy|\bact\b|learn|eval/],
  ["robot", /robot|urdf|franka|arm|byor|bring/],
  ["results", /result|number|stat|success|score|nemotron|how (good|well)/],
];

/** The prototype's keyword rules, for when the backend can't answer. */
export function route(text: string): ToolCall {
  const q = text.toLowerCase();
  const hit = ITEMS.findIndex((it) => {
    const t = it.title.toLowerCase();
    return q.includes(t) || q.includes(t.replace(/ /g, ""));
  });
  if (/tour|tutorial|how does (it|this) work|guide|walk me/.test(q)) return { tool: "start_tutorial", arg: null };
  if (hit >= 0 && /open|show me|what is|plug/.test(q)) return { tool: "open_cartridge", arg: ITEMS[hit].id };
  if (/bench|make a (new )?cartridge|new cartridge/.test(q)) return { tool: "go_to_section", arg: "bench" };
  if (/machine|projector|plug in/.test(q)) return { tool: "go_to_section", arg: "machine" };
  for (const [t, re] of TAG_WORDS) if (re.test(q)) return { tool: "show_cartridges_with_tag", arg: t };
  if (hit >= 0) return { tool: "open_cartridge", arg: ITEMS[hit].id };
  if (/top|start|home|beginning|logo/.test(q)) return { tool: "go_to_section", arg: "top" };
  if (/story|why|what is sant|idea/.test(q)) return { tool: "go_to_section", arg: "story" };
  return { tool: "go_to_section", arg: "workshop" };
}

