import { lazy, Suspense, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardShell } from "./components";
import Icon from "./components/Icon";
import Home from "./pages/Home";
import RoomView from "./pages/RoomView";
import AddScan from "./pages/AddScan";
import AddPhoto from "./pages/AddPhoto";
import Review from "./pages/Review";
import Inventory from "./pages/Inventory";
import Organize from "./pages/Organize";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";
import { useHandPointer } from "./hand/integration/useHandPointer";
import { HandCursorOverlay } from "./hand/overlay/HandCursorOverlay";
import { HandToggle } from "./hand/integration/HandToggle";
import { CalibrationPanel } from "./hand/overlay/CalibrationPanel";

// Full-bleed 3D pages live outside the dashboard shell and load lazily, so the
// three.js bundle is only fetched when one of them is visited.
const Landing = lazy(() => import("./pages/Landing"));
const Entry = lazy(() => import("./pages/Entry"));

// Dashboard pages share DashboardShell (top bar + icon rail).
export default function App() {
  // App-wide, opt-in hand-controlled cursor: mounted once outside <Routes>
  // so it survives navigation. See HAND_INTERACTION_PLAN.md.
  const hand = useHandPointer();
  const [calibrationOpen, setCalibrationOpen] = useState(false);

  return (
    <>
      <Routes>
        {/* The landing page is the front door. /welcome is kept as an alias. */}
        <Route
          path="/"
          element={
            <Suspense fallback={null}>
              <Landing />
            </Suspense>
          }
        />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route
          path="/enter"
          element={
            <Suspense fallback={null}>
              <Entry />
            </Suspense>
          }
        />
        <Route element={<DashboardShell />}>
          <Route path="/home" element={<Home />} />
          <Route path="/room" element={<RoomView />} />
          <Route path="/add/scan" element={<AddScan />} />
          <Route path="/add/photo" element={<AddPhoto />} />
          <Route path="/review" element={<Review />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/organize" element={<Organize />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
