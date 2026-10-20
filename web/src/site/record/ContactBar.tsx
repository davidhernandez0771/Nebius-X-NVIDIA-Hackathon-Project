// The twin pane's quiet force bar (live only): how hard the arm pushes on the bin or the table right now, on a log
// scale with the success check's 5 N collision mark, the link and what it pushes, and the take's peak. The twin's
// link glows with it (twin/contact.ts). "floor": the soft floor is holding the target up.

import { COLLISION_MARK, COLLISION_N, barFraction, contactLevel, contactText, type TwinContact } from "../../twin/contact";

export function ContactBar({ contact, peakN, floor }: { contact: TwinContact | null; peakN: number | null; floor: boolean | null }) {
  const force = contact?.forceN ?? 0;
  const level = contactLevel(force);
  const text = contactText(contact);
  return (
    <div className="rg-force" data-level={level}>
      <div
        className="rg-force__track"
        role="meter"
        aria-label="Arm contact force"
        aria-valuemin={0}
        aria-valuemax={1000}
        aria-valuenow={Math.round(force * 10) / 10}
        aria-valuetext={text}
      >
        <i className="rg-force__fill" style={{ width: `${barFraction(force) * 100}%` }} />
        <b className="rg-force__mark" style={{ left: `${COLLISION_MARK * 100}%` }} title={`${COLLISION_N} N: the success check's collision limit`} />
      </div>
      <p className="rg-force__text">
        <span>{text}</span>
        {peakN !== null && <span className="rg-force__peak" data-over={peakN > COLLISION_N || undefined}>peak {peakN} N</span>}
        {floor && <span className="rg-force__floor">soft floor holding</span>}
      </p>
    </div>
  );
}
