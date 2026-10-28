import type { ReactNode } from "react";
import { CALIBRATION } from "../../record/framing";
import { CamTile, HandOverlay } from "./CamTile";
import { GripKnobTile } from "./GripKnob";
import { HeightTraceTile } from "./HeightTrace";
import { GRASP_Z, WORKSPACE, type HudState } from "./hudModel";
import { PalmPadTile } from "./PalmPad";
import { ChannelTile } from "./RackTile";
import { RecordBar, type Chip, type RecordState } from "./RecordBar";
import "./record-hud.css";

const EPISODE: Record<RecordState, string> = { idle: "idle", recording: "rec", paused: "paused" };

/**
 * The whole Record instrument rack (docs/design/prototypes/record-console.html), fed by props:
 * a HudState from stepHud, the bar's chips and record state, and the webcam as `camera`. Sets
 * Volt on itself, so it can be mounted inside or outside the AppShell. Each tile is also exported
 * on its own for a different arrangement.
 */
export function RecordRack({
  hud,
  chips,
  state,
  elapsedMs,
  onToggle,
  recordDisabled,
  path,
  phase,
  rateHz = null,
  camera,
  camSize = "640×480",
  message,
}: {
  hud: HudState;
  chips: Chip[];
  state: RecordState;
  elapsedMs: number;
  onToggle?: () => void;
  recordDisabled?: boolean;
  path?: string[];
  phase?: string;
  rateHz?: number | null;
  camera?: ReactNode;
  camSize?: string;
  message?: ReactNode;
}) {
  const t = hud.target;
  return (
    <div className="rh" data-mode="volt">
      <RecordBar path={path} chips={chips} state={state} elapsedMs={elapsedMs} onToggle={onToggle} disabled={recordDisabled} />
      <div className="rh-grid">
        <CamTile
          size={camSize}
          hint="pinch = grip · ✌ hold 1.5 s = reset_scene"
          status={hud.tracking ? phase : t ? "hand lost" : undefined}
          message={message}
          overlay={<HandOverlay landmarks={hud.landmarks} trail={hud.tracking ? hud.trail : []} pinch={hud.pinch} closed={hud.gripper === 1} region={CALIBRATION} />}
        >
          {camera}
        </CamTile>
        <PalmPadTile x={t?.pad.x ?? null} y={t?.pad.y ?? null} edge={t?.edge} />
        <GripKnobTile pinch={hud.pinch} gripper={t ? hud.gripper : null} stale={!hud.tracking && t !== null} />
        <HeightTraceTile
          z={t?.ee[2] ?? null}
          zHistory={hud.zHistory}
          zRange={WORKSPACE.z}
          xHistory={hud.xHistory}
          xRange={WORKSPACE.x}
          graspZ={GRASP_Z}
        />
      </div>
      <div className="rh-row">
        <ChannelTile label="ee_target_x" unit="m" value={t?.ee[0]} decimals={3} />
        <ChannelTile label="ee_target_y" unit="m" value={t?.ee[1]} decimals={3} />
        <ChannelTile label="pinch_ratio" unit="—" value={hud.tracking ? hud.pinch : null} />
        <ChannelTile label="wrist_yaw" unit="deg" value={t?.yawDeg} decimals={1} />
        <ChannelTile label="msg_rate" unit="hz" value={rateHz} decimals={0} />
        <ChannelTile label="episode" unit="state">
          <p className="rh-state" data-state={state}>
            <span className="rh-state__dot" aria-hidden="true" />
            {EPISODE[state]}
          </p>
        </ChannelTile>
      </div>
    </div>
  );
}
