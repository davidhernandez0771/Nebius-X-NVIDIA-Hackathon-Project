// Layout route for every SANT page: motion (effects + reduced motion), toasts and the power-on.
// The room organizer's routes don't sit under it, so they keep their own look.
import { Outlet } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { MotionProvider } from "./motion/MotionProvider";
import { PowerOnProvider } from "./shells/PowerOn";
import "./sant.css";

export function SantRoot() {
  return (
    <MotionProvider>
      <ToastProvider>
        <PowerOnProvider>
          <Outlet />
        </PowerOnProvider>
      </ToastProvider>
    </MotionProvider>
  );
}
