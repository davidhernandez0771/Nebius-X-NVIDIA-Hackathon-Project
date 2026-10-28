import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // Rollup's automatic split already keeps every heavy library out of the entry chunk and behind the routes that
    // use it: three, @react-three/fiber, postprocessing (only the lazy /metrics hall) and mediapipe (only hand
    // tracking) each load on demand. The one chunk over Vite's 500 kB default is three's core, a single ES module
    // (about 685 kB minified, 176 kB gzip) that can't be split further, so the limit sits just above it: anything
    // else growing past it still warns.
    chunkSizeWarningLimit: 700,
  },
});
