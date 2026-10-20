import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HandArtPreviewRoute } from "./record/handArt";
import { SantRoot } from "./sant/SantRoot";

// Every page loads lazily, so the first request of `/` carries only the router and the SANT shell
// (firstLoad.test.ts keeps it that way).

// The site is the world (docs/design/world-core.md): one continuous 3D journey from the logo down to
// the workshop, where a cartridge plugs in and opens the work page. It loads lazily, so three.js is
// fetched only there.
const World = lazy(() => import("./world/core/WorldRoot"));
// The work pages a cartridge opens (the old pm pages, in the journey's look) and their frame.
const WorkShell = lazy(() => import("./work/WorkShell").then((m) => ({ default: m.WorkShell })));
const ReviewPage = lazy(() => import("./legacy/pm/review/ReviewPage"));
const DatasetPage = lazy(() => import("./legacy/pm/dataset/DatasetPage"));
const ResultsPage = lazy(() => import("./legacy/pm/results/ResultsPage"));
// The archived old site (/legacy/...): the dashboard, its pages, and its hand cursor.
const DashboardShell = lazy(() => import("./legacy/components/DashboardShell"));
const Home = lazy(() => import("./legacy/pages/Home"));
const RoomView = lazy(() => import("./legacy/pages/RoomView"));
const AddScan = lazy(() => import("./legacy/pages/AddScan"));
const AddPhoto = lazy(() => import("./legacy/pages/AddPhoto"));
const Review = lazy(() => import("./legacy/pages/Review"));
const Inventory = lazy(() => import("./legacy/pages/Inventory"));
const Organize = lazy(() => import("./legacy/pages/Organize"));
const Chat = lazy(() => import("./legacy/pages/Chat"));
const Settings = lazy(() => import("./legacy/pages/Settings"));
const RecordPage = lazy(() => import("./legacy/pm/record/RecordPage"));
const LegacyHand = lazy(() => import("./legacy/LegacyHand"));
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
// The data showcase: real demos through SANT, in the twin and the sim's camera, and SANT working live.
const DataPage = lazy(() => import("./site/data/DataPage"));

const lazyPage = (el: JSX.Element) => <Suspense fallback={null}>{el}</Suspense>;

const LEGACY = /^\/legacy(\/|$)/;

/** /pm/record → /record (the live test's URL opens the new page), keeping the query (e.g. ?trace) and the hash. */
function ToRecord() {
  const { search, hash } = useLocation();
  return <Navigate to={`/record${search}${hash}`} replace />;
}

export default function App() {
  // Only the archived old site (/legacy/...) has this hand cursor (LegacyHand): mounted outside
  // <Routes> so it survives navigation there, and unmounted on leaving, which turns the camera off if it
  // was left on. The work pages have their own, in WorkShell.
  const onLegacy = LEGACY.test(useLocation().pathname);

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
          <Route path="/data" element={lazyPage(<DataPage />)} />
          <Route path="/robots/setup" element={lazyPage(<SetupPage />)} />
        </Route>
        {/* The work pages a cartridge opens, in the journey's look. Record is the hologram (/record). */}
        <Route element={lazyPage(<WorkShell />)}>
          <Route path="/pm/review" element={lazyPage(<ReviewPage />)} />
          <Route path="/pm/dataset" element={lazyPage(<DatasetPage />)} />
          <Route path="/pm/results" element={lazyPage(<ResultsPage />)} />
        </Route>
        {/* The archived old site (web/src/legacy): the 3D intro, then the dashboard and its pages. */}
        <Route path="/legacy">
          <Route index element={lazyPage(<Landing />)} />
          <Route path="enter" element={lazyPage(<Entry />)} />
          <Route element={lazyPage(<DashboardShell />)}>
            <Route path="home" element={lazyPage(<Home />)} />
            <Route path="room" element={lazyPage(<RoomView />)} />
            <Route path="add/scan" element={lazyPage(<AddScan />)} />
            <Route path="add/photo" element={lazyPage(<AddPhoto />)} />
            <Route path="review" element={lazyPage(<Review />)} />
            <Route path="inventory" element={lazyPage(<Inventory />)} />
            <Route path="organize" element={lazyPage(<Organize />)} />
            <Route path="chat" element={lazyPage(<Chat />)} />
            <Route path="settings" element={lazyPage(<Settings />)} />
            <Route path="pm/record" element={lazyPage(<RecordPage />)} />
            <Route path="pm/review" element={lazyPage(<ReviewPage />)} />
            <Route path="pm/dataset" element={lazyPage(<DatasetPage />)} />
            <Route path="pm/results" element={lazyPage(<ResultsPage />)} />
          </Route>
        </Route>
        {/* The live test's and the cartridges' /pm/record open the new Record (the old one stays at
            /legacy/pm/record). */}
        <Route path="/pm/record" element={<ToRecord />} />
        {/* Everything else (the old room pages, the old landings, /site) goes to the journey. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {onLegacy && lazyPage(<LegacyHand />)}
    </>
  );
}
