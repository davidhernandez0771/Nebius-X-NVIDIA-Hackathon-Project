import { Route, Routes } from "react-router-dom";
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

// No route for the decorative 3D entry scene yet -- that's a later milestone
// (docs/ARCHITECTURE.md §10, step 2). Dashboard pages share DashboardShell
// (top bar + icon rail); routes outside it (landing, entry) can go beside it.
export default function App() {
  return (
    <Routes>
      <Route element={<DashboardShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/room" element={<RoomView />} />
        <Route path="/add/scan" element={<AddScan />} />
        <Route path="/add/photo" element={<AddPhoto />} />
        <Route path="/review" element={<Review />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/organize" element={<Organize />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
