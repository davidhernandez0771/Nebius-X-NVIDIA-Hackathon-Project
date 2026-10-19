import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DatasetPage from "./pm/dataset/DatasetPage";
import ReviewPage from "./pm/review/ReviewPage";
import ResultsPage from "./pm/results/ResultsPage";
import { SantRoot } from "./sant/SantRoot";
import { WorkShell } from "./work/WorkShell";

// The site is the world (docs/design/world-core.md): one continuous 3D journey from the logo down to
// the workshop, where a cartridge plugs in and opens the work page. It loads lazily, so three.js is
// fetched only there.
const World = lazy(() => import("./world/core/WorldRoot"));
// The design-system reference pages (internal, not linked from the site).
const DesignPage = lazy(() => import("./sant/design/DesignPage").then((m) => ({ default: m.DesignPage })));
const DesignAppPage = lazy(() => import("./sant/design/DesignAppPage").then((m) => ({ default: m.DesignAppPage })));
// Record (webcam, hand tracking, the twin) loads only when it opens: the world's first load stays light.
const RecordPage = lazy(() => import("./pm/record/RecordPage"));

const lazyPage = (el: JSX.Element) => <Suspense fallback={null}>{el}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route element={<SantRoot />}>
        <Route path="/" element={lazyPage(<World />)} />
        <Route path="/world" element={lazyPage(<World />)} />
        <Route path="/design" element={lazyPage(<DesignPage />)} />
        <Route path="/design/app" element={lazyPage(<DesignAppPage />)} />
      </Route>
      {/* The work pages a cartridge opens, in the journey's look. */}
      <Route element={<WorkShell />}>
        <Route path="/pm/record" element={lazyPage(<RecordPage />)} />
        <Route path="/pm/review" element={<ReviewPage />} />
        <Route path="/pm/dataset" element={<DatasetPage />} />
        <Route path="/pm/results" element={<ResultsPage />} />
      </Route>
      {/* Everything else (the old room pages, the old landing) goes to the journey. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
