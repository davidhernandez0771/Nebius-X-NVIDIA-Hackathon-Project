import type { Session } from "../useReplay";
import json from "./session.json";

// JSON imports widen tuples to arrays; recordHud.test.tsx checks every frame's shape instead.
export const SESSION = json as unknown as Session;
