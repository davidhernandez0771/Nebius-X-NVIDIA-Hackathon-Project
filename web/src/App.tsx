import { NavLink, Route, Routes } from "react-router-dom";
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
// (docs/ARCHITECTURE.md §10, step 2). This router starts at the main app.
const links = [
  ["/", "Home"],
  ["/room", "Room view"],
  ["/add/scan", "Add scan"],
  ["/add/photo", "Add photo"],
  ["/review", "Review"],
  ["/inventory", "Inventory"],
  ["/organize", "Organize"],
  ["/chat", "Chat"],
  ["/settings", "Settings"],
] as const;

export default function App() {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/"}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room" element={<RoomView />} />
          <Route path="/add/scan" element={<AddScan />} />
          <Route path="/add/photo" element={<AddPhoto />} />
          <Route path="/review" element={<Review />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/organize" element={<Organize />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
