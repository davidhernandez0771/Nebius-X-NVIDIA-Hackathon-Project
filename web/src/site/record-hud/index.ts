// Record HUD: the instrument-rack tiles from docs/design/prototypes/record-console.html as
// presentational components fed by props, for T4 to mount on Record. Preview: /site/record-hud.
export { CamTile, HandOverlay, type Region } from "./CamTile";
export { GripKnob, GripKnobTile } from "./GripKnob";
export { HeightTraceTile, Trace } from "./HeightTrace";
export {
  GRASP_Z,
  HISTORY,
  WORKSPACE,
  formatClock,
  frameAt,
  initialHud,
  knobAngle,
  meanRateHz,
  stepHud,
  toTarget,
  type HudState,
  type Point,
  type Target,
} from "./hudModel";
export { PalmPad, PalmPadTile } from "./PalmPad";
export { ChannelTile, RackTile, readout } from "./RackTile";
export { RecordBar, RecordControl, StatusChip, type Chip, type ChipState, type RecordState } from "./RecordBar";
export { RecordRack } from "./RecordRack";
export { SimStartLoader } from "./SimStartLoader";
