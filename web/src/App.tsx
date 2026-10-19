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
import { HandArtPreviewRoute } from "./record/handArt";
import { SantRoot } from "./sant/SantRoot";
import { WorkShell } from "./work/WorkShell";
import { useHandPointer } from "./hand/integration/useHandPointer";
import { HandCursorOverlay } from "./hand/overlay/HandCursorOverlay";
import { HandToggle } from "./hand/integration/HandToggle";
import { CalibrationPanel } from "./hand/overlay/CalibrationPanel";

// The site is the world (docs/design/world-core.md): one continuous 3D journey from the logo down to
// the workshop, where a cartridge plugs in and opens the work page. It loads lazily, so three.js is
// fetched only there.
const World = lazy(() => import("./world/core/WorldRoot"));
// Full-bleed 3D pages of the archive live outside the dashboard shell and load lazily.
const Landing = lazy(() => import("./legacy/pages/Landing"));
const Entry = lazy(() => import("./legacy/pages/Entry"));
// The design-system reference pages (internal, not linked from the site).
const DesignPage = lazy(() => import("./sant/design/DesignPage").then((m) => ({ default: m.DesignPage })));
const DesignAppPage = lazy(() => import("./sant/design/DesignAppPage").then((m) => ({ default: m.DesignAppPage })));
const RecordHudPreview = lazy(() => import("./site/record-hud/RecordHudPreview").then((m) => ({ default: m.RecordHudPreview })));
const ReviewPage2 = lazy(() => import("./site/review/ReviewPage2"));
const SetupPage = lazy(() => import("./site/setup/SetupPage"));
// The new Record (the hologram). The old one stays at /legacy/pm/record.
const RecordConsole = lazy(() => import("./site/record/RecordConsole"));
const SiteResultsPage = lazy(() => import("./site/results/ResultsPage").then((m) => ({ default: m.ResultsPage })));
const RobotsPage = lazy(() => import("./site/robots/RobotsPage"));

const lazyPage = (el: JSX.Element) => <Suspense fallback={null}>{el}</Suspense>;

const LEGACY = /^\/legacy(\/|$)/;

/** /pm/record → /record (the live test's URL opens the new page), keeping the query (e.g. ?trace) and the hash. */
function ToRecord() {
  const { search, hash } = useLocation();
  return <Navigate to={`/record${search}${hash}`} replace />;
}

export default function App() {
  // Opt-in hand-controlled cursor for the /legacy pages: mounted once outside <Routes>
  // so it survives navigation. See HAND_INTERACTION_PLAN.md. The work pages have their own, in WorkShell.
  const hand = useHandPointer();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  // Only the archived old site (/legacy/...) has this hand cursor: its controls show there alone, and
  // the camera turns off if it was left on, since no other page has a switch to turn it off.
  const onLegacy = LEGACY.test(useLocation().pathname);
  const { enabled: handOn, disable: handOff } = hand;
  useEffect(() => {
    if (!onLegacy && handOn) handOff();
  }, [onLegacy, handOn, handOff]);

  return (
    <>
      <Routes>
        {/* Hand v4's hand-art preview (live tooling, not archived). */}
        <Route path="/pm/hand-art" element={<HandArtPreviewRoute />} />
        <Route element={<SantRoot />}>
          <Route path="/" element={lazyPage(<World />)} />
          <Route path="/world" element={lazyPage(<World />)} />
          <Route path="/design" element={lazyPage(<DesignPage />)} />
          <Route path="/design/app" element={lazyPage(<DesignAppPage />)} />
          <Route path="/site/record-hud" element={lazyPage(<RecordHudPreview />)} />
          <Route path="/record" element={lazyPage(<RecordConsole />)} />
          <Route path="/review2" element={lazyPage(<ReviewPage2 />)} />
          <Route path="/site/results" element={lazyPage(<SiteResultsPage />)} />
          <Route path="/robots" element={lazyPage(<RobotsPage />)} />
          <Route path="/robots/setup" element={lazyPage(<SetupPage />)} />
        </Route>
        {/* The work pages a cartridge opens, in the journey's look. Record is the hologram (/record). */}
        <Route element={<WorkShell />}>
          <Route path="/pm/review" element={<ReviewPage />} />
          <Route path="/pm/dataset" element={<DatasetPage />} />
        </Route>
        {/* The archived old site (web/src/legacy): the 3D intro, then the dashboard and its pages. */}
        <Route path="/legacy">
          <Route index element={lazyPage(<Landing />)} />
          <Route path="enter" element={lazyPage(<Entry />)} />
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
        {/* The live test's and the cartridges' /pm/record open the new Record (the old one stays at
            /legacy/pm/record). */}
        <Route path="/pm/record" element={<ToRecord />} />
        {/* Results is the Field Notes page with the measured numbers; the old sample-data page stays at /legacy/pm/results. */}
        <Route path="/pm/results" element={<Navigate to="/site/results" replace />} />
        {/* Everything else (the old room pages, the old landings, /site) goes to the journey. */}
        <Route path="*" element={<Navigate to="/" replace />} />
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
