// The archived old site's hand-controlled cursor (HAND_INTERACTION_PLAN.md): the toggle, the
// calibration gear and the cursor. App mounts it only on /legacy/..., outside <Routes>, so it survives
// navigation inside the archive; leaving the archive unmounts it, which releases the camera and the
// model (useHandPointer's unmount cleanup), since no other page has a switch to turn it off. It loads
// lazily, so the journey's first load carries none of it.
import { useState } from "react";
import Icon from "./components/Icon";
import { useHandPointer } from "../hand/integration/useHandPointer";
import { HandCursorOverlay } from "../hand/overlay/HandCursorOverlay";
import { HandToggle } from "../hand/integration/HandToggle";
import { CalibrationPanel } from "../hand/overlay/CalibrationPanel";

export default function LegacyHand() {
  const hand = useHandPointer();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="hand-calibration-trigger"
        aria-label="Hand-control calibration"
        aria-expanded={calibrationOpen}
        onClick={() => setCalibrationOpen((open) => !open)}
      >
        <Icon name="settings" size={16} />
      </button>
      <CalibrationPanel api={hand} open={calibrationOpen} onClose={() => setCalibrationOpen(false)} />
      <HandToggle enabled={hand.enabled} status={hand.status} onEnable={hand.enable} onDisable={hand.disable} />
      <HandCursorOverlay api={hand} />
    </>
  );
}
