import { Component, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import * as THREE from "three";
import "./scanviewer.css";

// Loads a GLB room scan and shows it dark-tinted with orbit controls.
// Heavy (three + fiber + drei): import it with React.lazy where it is used.
//
//   const ScanViewer = lazy(() => import("../three/ScanViewer"));
//   <ScanViewer url="/models/placeholder-room.glb" />

export interface ScanViewerProps {
  /** URL of a .glb / .gltf file */
  url: string;
  /** multiplied into every material colour; keeps the scan dark and warm */
  tint?: string;
  autoRotate?: boolean;
  className?: string;
  style?: CSSProperties;
  onLoaded?: (info: { size: [number, number, number] }) => void;
}

export const preloadScan = (url: string) => useGLTF.preload(url);

const FIT = 4.2; // the longest side of the scan is scaled to this many units

function tintScene(root: THREE.Object3D, tint: THREE.Color) {
  const owned: THREE.Material[] = [];
  root.traverse((o) => {
    const obj = o as THREE.Mesh;
    if (!obj.material) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = list.map((m) => {
      // clone so the shared useGLTF cache is never mutated
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (c.color) c.color.multiply(tint);
      if ("envMapIntensity" in c) c.envMapIntensity = 0.35;
      if ("metalness" in c) c.metalness = Math.min(c.metalness, 0.3);
      if ("roughness" in c) c.roughness = Math.max(c.roughness, 0.6);
      owned.push(c);
      return c;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
  return owned;
}

function Model({ url, tint, onLoaded }: { url: string; tint: string; onLoaded?: ScanViewerProps["onLoaded"] }) {
  const gltf = useGLTF(url);
  const { root, scale, offset, owned, size } = useMemo(() => {
    const root = gltf.scene.clone(true);
    const owned = tintScene(root, new THREE.Color(tint));
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    return {
      root,
      owned,
      size,
      scale: FIT / longest,
      offset: center.multiplyScalar(-1).toArray() as [number, number, number],
    };
  }, [gltf, tint]);

  useEffect(() => {
    onLoaded?.({ size: size.toArray() as [number, number, number] });
  }, [size, onLoaded]);
  useEffect(() => () => owned.forEach((m) => m.dispose()), [owned]);

  return (
    <group scale={scale}>
      <primitive object={root} position={offset} />
    </group>
  );
}

/** Shown inside the canvas while the file is still loading. */
function Wire() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.6;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[2, 1.2, 2]} />
      <meshBasicMaterial color="#35F0D0" wireframe transparent opacity={0.35} />
    </mesh>
  );
}

function LoadingStatus() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="scan-viewer__status" role="status">
      <span className="scan-viewer__ring" />
      Loading scan {Math.round(progress)}%
    </div>
  );
}

// Loader errors for a wrong URL are cryptic (a dev server answers a missing
// file with index.html, which then fails to parse), so say what happened.
function friendlyError(e: Error): string {
  if (/is not valid JSON|Unexpected token '<'/.test(e.message)) {
    return "The server did not return a GLB file. Check the URL.";
  }
  if (/404|Not Found/i.test(e.message)) return "File not found (404).";
  return e.message;
}

class ScanBoundary extends Component<
  { children: ReactNode; url: string; onRetry: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="scan-viewer__error" role="alert">
        <strong>This scan could not be loaded.</strong>
        <code>{this.props.url}</code>
        <code>{friendlyError(error)}</code>
        <button onClick={this.props.onRetry}>Try again</button>
      </div>
    );
  }
}

export default function ScanViewer({
  url,
  tint = "#968a80",
  autoRotate = true,
  className = "",
  style,
  onLoaded,
}: ScanViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    useGLTF.clear(url);
    setAttempt((a) => a + 1);
  };

  if (!url) {
    return (
      <div className={`scan-viewer ${className}`} style={style}>
        <div className="scan-viewer__error" role="status">
          <strong>No scan yet.</strong>
          <code>Add a room scan to see it here.</code>
        </div>
      </div>
    );
  }

  return (
    <div className={`scan-viewer ${className}`} style={style}>
      <ScanBoundary key={`${url}:${attempt}`} url={url} onRetry={retry}>
        <Canvas
          dpr={[1, 2]}
          camera={{ fov: 35, near: 0.1, far: 100, position: [7.4, 5.2, 8.8] }}
          gl={{ alpha: true, antialias: true }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <ambientLight intensity={0.6} color="#ffe6d2" />
          <directionalLight position={[5, 7, 4]} intensity={2.1} color="#ffb37a" />
          <directionalLight position={[-5, 3, -3]} intensity={1.3} color="#35F0D0" />
          <Suspense fallback={<Wire />}>
            <Model url={url} tint={tint} onLoaded={onLoaded} />
          </Suspense>
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={2.5}
            maxDistance={16}
            maxPolarAngle={Math.PI * 0.62}
            autoRotate={autoRotate}
            autoRotateSpeed={0.5}
          />
        </Canvas>
        <LoadingStatus />
      </ScanBoundary>
    </div>
  );
}
