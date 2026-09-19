import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardShell } from "./components";
import Home from "./pages/Home";
import RoomView from "./pages/RoomView";
import AddScan from "./pages/AddScan";
import AddPhoto from "./pages/AddPhoto";
import Review from "./pages/Review";
import Inventory from "./pages/Inventory";
import Organize from "./pages/Organize";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";

// Full-bleed 3D pages live outside the dashboard shell and load lazily, so the
// three.js bundle is only fetched when one of them is visited.
const Landing = lazy(() => import("./pages/Landing"));
const Entry = lazy(() => import("./pages/Entry"));

// Dashboard pages share DashboardShell (top bar + icon rail).
export default function App() {
  return (
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
  );
}
