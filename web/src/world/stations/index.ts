// The station registry: the one file that lists every module. Each team edits only its own folder.
import type { StationModule } from "../core/types";
import descent from "./descent";
import intro from "./intro";
import machine from "./machine";
import robots from "./robots";
import workbench from "./workbench";
import workshop from "./workshop";
import zoom from "./zoom";

export const STATIONS: readonly StationModule[] = [intro, descent, workshop, machine, zoom, workbench, robots];
