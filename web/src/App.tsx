import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { DashboardShell } from "./legacy/components";
import Icon from "./legacy/components/Icon";
import Home from "./legacy/pages/Home";
import RoomView from "./legacy/pages/RoomView";
import AddScan from "./legacy/pages/AddScan";
import AddPhoto from "./legacy/pages/AddPhoto";
import Review from "./legacy/pages/Review";
import Inventory from "./legacy/pages/Inventory";
import Organize from "./legacy/pages/Organize";
import Chat from "./legacy/pages/Chat";
import Settings from "./legacy/pages/Settings";
import DatasetPage from "./legacy/pm/dataset/DatasetPage";
import RecordPage from "./legacy/pm/record/RecordPage";
import ReviewPage from "./legacy/pm/review/ReviewPage";
import ResultsPage from "./legacy/pm/results/ResultsPage";
import { SantRoot } from "./sant/SantRoot";
import { useHandPointer } from "./hand/integration/useHandPointer";
import { HandCursorOverlay } from "./hand/overlay/HandCursorOverlay";
import { HandToggle } from "./hand/integration/HandToggle";
import { CalibrationPanel } from "./hand/overlay/CalibrationPanel";

// Full-bleed 3D pages live outside the dashboard shell and load lazily, so the
// three.js bundle is only fetched when one of them is visited.
const Landing = lazy(() => import("./legacy/pages/Landing"));
const Entry = lazy(() => import("./legacy/pages/Entry"));
// SANT website (sprint 8): the design-system review pages, under SantRoot's providers.
const DesignPage = lazy(() => import("./sant/design/DesignPage").then((m) => ({ default: m.DesignPage })));
const DesignAppPage = lazy(() => import("./sant/design/DesignAppPage").then((m) => ({ default: m.DesignAppPage })));
const PinchSheetPreview = lazy(() => import("./landing/pinchSheet/PinchSheetPreview"));
const SiteLanding = lazy(() => import("./site/landing/LandingPage"));

const LEGACY = /^\/legacy(\/|$)/;

/** /pm/... → /legacy/pm/..., keeping the query (e.g. /pm/review?id=…) and the hash. */
function ToLegacy() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/legacy${pathname}${search}${hash}`} replace />;
}

// The old dashboard pages share DashboardShell (top bar + icon rail).
export default function App() {
  // Opt-in hand-controlled cursor for the /legacy pages: mounted once outside <Routes>
  // so it survives navigation. See HAND_INTERACTION_PLAN.md.
  const hand = useHandPointer();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  // Only the archived old site (/legacy/...) has the hand cursor: its controls show there alone, and
  // the camera turns off if it was left on, since no other page has a switch to turn it off.
  const onLegacy = LEGACY.test(useLocation().pathname);
  const { enabled: handOn, disable: handOff } = hand;
  useEffect(() => {
    if (!onLegacy && handOn) handOff();
  }, [onLegacy, handOn, handOff]);

  return (
    <>
      <Routes>
        {/* The SANT landing (/site) is the front door. /welcome is kept as an alias. */}
        <Route path="/" element={<Navigate to="/site" replace />} />
        <Route path="/welcome" element={<Navigate to="/site" replace />} />
        <Route element={<SantRoot />}>
          <Route path="/site" element={<Suspense fallback={null}><SiteLanding /></Suspense>} />
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
        {/* The archived old site (web/src/legacy): the 3D intro, then the dashboard and its pages. */}
        <Route path="/legacy">
          <Route
            index
            element={
              <Suspense fallback={null}>
                <Landing />
              </Suspense>
            }
          />
          <Route
            path="enter"
            element={
              <Suspense fallback={null}>
                <Entry />
              </Suspense>
            }
          />
          <Route element={<DashboardShell />}>
            <Route path="home" element={<Home />} />
            <Route path="room" element={<RoomView />} />
            <Route path="add/scan" element={<AddScan />} />
            <Route path="add/photo" element={<AddPhoto />} />
            <Route path="review" element={<Review />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="organize" element={<Organize />} />
            <Route path="chat" element={<Chat />} />
            <Route path="settings" element={<Settings />} />
            <Route path="pm/record" element={<RecordPage />} />
            <Route path="pm/review" element={<ReviewPage />} />
            <Route path="pm/dataset" element={<DatasetPage />} />
            <Route path="pm/results" element={<ResultsPage />} />
          </Route>
        </Route>
        {/* Old bookmarks and the live test's /pm/record keep working. */}
        <Route path="/pm/*" element={<ToLegacy />} />
        <Route path="*" element={<Navigate to="/site" replace />} />
      </Routes>
      {onLegacy && (
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
