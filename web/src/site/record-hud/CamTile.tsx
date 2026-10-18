import type { ReactNode } from "react";
import type { Point } from "./hudModel";
import { RackTile, readout } from "./RackTile";

const VW = 640;
const VH = 480;

// MediaPipe's 21-landmark hand: wrist, then thumb, index, middle, ring and pinky, base to tip.
const BONES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const TRAIL = 70;

export type Region = { u_min: number; u_max: number; v_min: number; v_max: number };

/**
 * The tracked hand over the camera: bones, joints, the thumb and index tips in the signal colour,
 * a dashed line for the pinch gap (amber once the gripper is closed), a fading palm trail and the
 * dashed control region. Landmarks are raw camera coordinates; the user watches a mirror, so
 * `mirror` flips x to match the video under it. The frame letterboxes inside its box (like the
 * video's object-fit: contain), so overlay and video stay aligned whatever the tile's shape.
 */
export function HandOverlay({
  landmarks,
  trail = [],
  pinch,
  closed = false,
  region,
  mirror = true,
}: {
  landmarks: readonly Point[] | null;
  trail?: readonly Point[];
  pinch?: number | null;
  closed?: boolean;
  region?: Region;
  mirror?: boolean;
}) {
  const px = (p: Point): [number, number] => [(mirror ? 1 - p[0] : p[0]) * VW, p[1] * VH];
  const recent = trail.slice(-TRAIL);
  const tips = landmarks ? [px(landmarks[THUMB_TIP]), px(landmarks[INDEX_TIP])] : null;
  return (
    <svg className="rh-hand" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {region && (
        <>
          <rect
            className="rh-hand__region"
            x={(mirror ? 1 - region.u_max : region.u_min) * VW}
            y={region.v_min * VH}
            width={(region.u_max - region.u_min) * VW}
            height={(region.v_max - region.v_min) * VH}
          />
          <text className="rh-hand__text" x={(mirror ? 1 - region.u_max : region.u_min) * VW + 6} y={region.v_max * VH - 6}>
            workspace
          </text>
        </>
      )}
      {recent.map((p, i) => {
        const [x, y] = px(p);
        return <rect key={i} className="rh-hand__trail" x={x} y={y} width="1.5" height="1.5" opacity={((i + 1) / recent.length) * 0.35} />;
      })}
      {landmarks && (
        <>
          <g className="rh-hand__bones">
            {BONES.map(([a, b]) => {
              const [x1, y1] = px(landmarks[a]);
              const [x2, y2] = px(landmarks[b]);
              return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
          </g>
          {landmarks.map((p, i) => {
            const [x, y] = px(p);
            const tip = i === THUMB_TIP || i === INDEX_TIP;
            return <circle key={i} className={tip ? "rh-hand__joint rh-hand__joint--tip" : "rh-hand__joint"} cx={x} cy={y} r={i === 0 ? 3.2 : 2.2} />;
          })}
          {tips && (
            <>
              <line className="rh-hand__gap" data-closed={closed || undefined} x1={tips[0][0]} y1={tips[0][1]} x2={tips[1][0]} y2={tips[1][1]} />
              {pinch !== undefined && pinch !== null && (
                // Left of the leftmost tip: in the mirrored view that is outside the thumb, clear of the fingers.
                <text className="rh-hand__text" textAnchor="end" x={Math.min(tips[0][0], tips[1][0]) - 10} y={(tips[0][1] + tips[1][1]) / 2}>
                  pinch {readout(pinch, 2)}
                </text>
              )}
            </>
          )}
        </>
      )}
    </svg>
  );
}

/**
 * The camera tile: two rows tall, the video (or anything else) as children under the overlay,
 * a header on top and a footer with the gesture hint and the current phase. `message` sits in
 * the middle when there is something to do ("Show your hand to the camera").
 */
export function CamTile({
  label = "webcam_0 · hand_overlay",
  size,
  hint,
  status,
  message,
  overlay,
  children,
}: {
  label?: string;
  size?: string;
  hint?: ReactNode;
  status?: ReactNode;
  message?: ReactNode;
  overlay?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <RackTile label={label} unit={size} span="cam">
      <div className="rh-cam__media">{children}</div>
      {overlay && <div className="rh-cam__overlay">{overlay}</div>}
      {message && <div className="rh-cam__message">{message}</div>}
      <footer className="rh-cam__foot">
        <span>{hint}</span>
        <span aria-live="polite">{status}</span>
      </footer>
    </RackTile>
  );
}
