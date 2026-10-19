import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import DatasetPage from "./pm/dataset/DatasetPage";
import ReviewPage from "./pm/review/ReviewPage";
import ResultsPage from "./pm/results/ResultsPage";
import { siteModeOf } from "./sant/motion/crossing";
import { SantRoot } from "./sant/SantRoot";
import { useHandPointer } from "./hand/integration/useHandPointer";
import { HandCursorOverlay } from "./hand/overlay/HandCursorOverlay";
import { HandToggle } from "./hand/integration/HandToggle";
import { CalibrationPanel } from "./hand/overlay/CalibrationPanel";

// Full-bleed 3D pages live outside the dashboard shell and load lazily, so the
// three.js bundle is only fetched when one of them is visited.
const Landing = lazy(() => import("./pages/Landing"));
const Entry = lazy(() => import("./pages/Entry"));
// SANT website (sprint 8): the design-system review pages, under SantRoot's providers.
const DesignPage = lazy(() => import("./sant/design/DesignPage").then((m) => ({ default: m.DesignPage })));
const DesignAppPage = lazy(() => import("./sant/design/DesignAppPage").then((m) => ({ default: m.DesignAppPage })));
const PinchSheetPreview = lazy(() => import("./landing/pinchSheet/PinchSheetPreview"));
const SiteLanding = lazy(() => import("./site/landing/LandingPage"));
// The world (sprint 9): one continuous 3D journey, from the story down to the work (docs/design/world-core.md).
const World = lazy(() => import("./world/core/WorldRoot"));
// Record (webcam, hand tracking, the twin) loads only when it opens: the world's first load stays light.
const RecordPage = lazy(() => import("./pm/record/RecordPage"));

// Dashboard pages share DashboardShell (top bar + icon rail).
export default function App() {
  // App-wide, opt-in hand-controlled cursor: mounted once outside <Routes>
  // so it survives navigation. See HAND_INTERACTION_PLAN.md.
  const hand = useHandPointer();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  // The new SANT site (/site, /robots, …) has no hand cursor: hide its controls there, and turn the
  // camera off if it was left on, since there is no switch on those pages to turn it off.
  const path = useLocation().pathname;
  const onSite = siteModeOf(path) !== null || /^\/world(\/|$)/.test(path);
  const { enabled: handOn, disable: handOff } = hand;
  useEffect(() => {
    if (onSite && handOn) handOff();
  }, [onSite, handOn, handOff]);

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
        <Route element={<SantRoot />}>
          <Route path="/site" element={<Suspense fallback={null}><SiteLanding /></Suspense>} />
          <Route path="/world" element={<Suspense fallback={null}><World /></Suspense>} />
          <Route
            path="/design"
            element={
              <Suspense fallback={null}>
                <DesignPage />
              </Suspense>
            }
          />
          <Route
            path="/design/app"
            element={
              <Suspense fallback={null}>
                <DesignAppPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="/landing/pinch-sheet" element={<Suspense fallback={null}><PinchSheetPreview /></Suspense>} />
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
          <Route path="/pm/record" element={<Suspense fallback={null}><RecordPage /></Suspense>} />
          <Route path="/pm/review" element={<ReviewPage />} />
          <Route path="/pm/dataset" element={<DatasetPage />} />
          <Route path="/pm/results" element={<ResultsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!onSite && (
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
      )}
    </>
  );
}
