import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { jointRange } from "./fmt";
import { CloseIcon, JointIcon } from "./icons";
import { accepts, assign, isSuggested, ROLE_LABEL, ROLES, rolesOf, treeRows, unassign, type Role, type TreeRow } from "./roles";
import type { Parts, RoleSet } from "./types";
import { cablePath, isClick, type Pt } from "./wiring";

type Drag = { role: Role; down: Pt; from: Pt; to: Pt; target: string | null };

const count = (roles: RoleSet, r: Role) =>
  r === "arm" ? roles.arm_joints.length : r === "gripper" ? roles.gripper_joints.length : roles[r] ? 1 : 0;

const SOCKET_HINT: Record<Role, string> = {
  base: "the link bolted to the table",
  arm: "the joints that move the hand, from the base out",
  hand: "the link the fingers hang from",
  gripper: "the finger joints",
};

/**
 * The part tree with its role sockets. Drag a socket onto a part (a cable follows the pointer and snaps to parts
 * that can take that role), or click a socket and then click parts: the keyboard and touch path. Hovering a socket
 * shows its cables to the parts it is wired to.
 */
export function RoleBoard({
  parts,
  roles,
  onChange,
  focus,
  onFocus,
}: {
  parts: Parts;
  roles: RoleSet;
  onChange: (r: RoleSet) => void;
  focus: string | null;
  onFocus: (name: string | null) => void;
}) {
  const rows = useMemo(() => treeRows(parts), [parts]);
  const board = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState<Role | null>(null);
  const [peek, setPeek] = useState<Role | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [cables, setCables] = useState<{ key: string; d: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const local = useCallback((clientX: number, clientY: number): Pt => {
    const r = board.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  }, []);

  const socketPt = useCallback(
    (role: Role): Pt => {
      const el = board.current?.querySelector<HTMLElement>(`[data-socket="${role}"] .byor-socket__port`);
      const r = el?.getBoundingClientRect();
      return r ? local(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
    },
    [local],
  );

  const portPt = useCallback(
    (name: string): Pt | null => {
      const el = board.current?.querySelector<HTMLElement>(`[data-part="${CSS.escape(name)}"] .byor-row__port`);
      const r = el?.getBoundingClientRect();
      return r ? local(r.left + r.width / 2, r.top + r.height / 2) : null;
    },
    [local],
  );

  // The resting cables of the socket being looked at (hovered, focused or armed).
  const shown = drag ? null : (peek ?? armed);
  useLayoutEffect(() => {
    const draw = () => {
      if (!shown) return setCables([]);
      const names = shown === "arm" ? roles.arm_joints : shown === "gripper" ? roles.gripper_joints : [roles[shown]].filter(Boolean);
      const from = socketPt(shown);
      setCables(
        (names as string[]).flatMap((n) => {
          const to = portPt(n);
          return to ? [{ key: n, d: cablePath(from, to) }] : [];
        }),
      );
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [shown, roles, socketPt, portPt]);

  useEffect(() => {
    if (!armed) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setArmed(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [armed]);

  const toggle = (role: Role, name: string) => {
    if (!accepts(parts, role, name)) return;
    onChange(rolesOf(roles, name).includes(role) ? unassign(roles, role, name) : assign(parts, roles, role, name));
  };

  const startDrag = (role: Role, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const from = socketPt(role);
    const down = { x: e.clientX, y: e.clientY };
    setDrag({ role, down, from, to: local(e.clientX, e.clientY), target: null });

    const move = (ev: PointerEvent) => {
      const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-part]");
      const name = hit?.dataset.part ?? null;
      const target = name && accepts(parts, role, name) ? name : null;
      const snap = target ? portPt(target) : null;
      const d = dragRef.current;
      if (d) setDrag({ ...d, to: snap ?? local(ev.clientX, ev.clientY), target });
      onFocus(target);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragRef.current;
      setDrag(null);
      if (d && ev.type === "pointerup") {
        if (isClick(d.down, { x: ev.clientX, y: ev.clientY })) setArmed((a) => (a === role ? null : role));
        else if (d.target) onChange(assign(parts, roles, role, d.target));
      }
      onFocus(selected);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const live = drag?.role ?? armed;

  return (
    <div className="byor-board" ref={board} data-dragging={drag ? drag.role : undefined} data-armed={armed ?? undefined}>
      <div className="byor-sockets" role="group" aria-label="Roles">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            className="byor-socket"
            data-socket={r}
            data-filled={count(roles, r) > 0}
            aria-pressed={armed === r}
            aria-describedby={`byor-socket-${r}`}
            onPointerDown={(e) => startDrag(r, e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setArmed((a) => (a === r ? null : r));
              }
            }}
            onMouseEnter={() => setPeek(r)}
            onMouseLeave={() => setPeek(null)}
            onFocus={() => setPeek(r)}
            onBlur={() => setPeek(null)}
          >
            <span className="byor-socket__label">{ROLE_LABEL[r]}</span>
            <span className="byor-socket__count sant-num">{count(roles, r)}</span>
            <span className="byor-socket__port" aria-hidden="true" />
            <span id={`byor-socket-${r}`} className="sant-sr-only">
              {SOCKET_HINT[r]}. Press to pick parts for this role.
            </span>
          </button>
        ))}
      </div>
      <p className="byor-board__hint" aria-live="polite">
        {armed
          ? `Picking parts for ${ROLE_LABEL[armed]}: ${SOCKET_HINT[armed]}. Click a part to add or remove it; Escape to finish.`
          : "Drag a role onto a part, or click a role and then the parts."}
      </p>

      <ol className="byor-tree" aria-label={`${parts.name} parts`}>
        {rows.map((row) => (
          <TreeItem
            key={row.kind + row.name}
            row={row}
            parts={parts}
            roles={roles}
            live={live}
            target={drag?.target === row.name}
            focused={focus === row.name}
            onPick={() => {
              if (armed) toggle(armed, row.name);
              else {
                const next = selected === row.name ? null : row.name;
                setSelected(next);
                onFocus(next);
              }
            }}
            onHover={(on) => !drag && onFocus(on ? row.name : selected)}
            onRemove={(r) => onChange(unassign(roles, r, row.name))}
          />
        ))}
      </ol>

      <svg className="byor-cables" aria-hidden="true">
        {cables.map((c) => (
          <path key={c.key} d={c.d} className="byor-cable" data-role={shown ?? undefined} />
        ))}
        {drag && !isClick(drag.from, drag.to, 8) && (
          <path d={cablePath(drag.from, drag.to)} className="byor-cable byor-cable--live" data-snapped={drag.target !== null} />
        )}
      </svg>
    </div>
  );
}

function TreeItem({
  row,
  parts,
  roles,
  live,
  target,
  focused,
  onPick,
  onHover,
  onRemove,
}: {
  row: TreeRow;
  parts: Parts;
  roles: RoleSet;
  live: Role | null;
  target: boolean;
  focused: boolean;
  onPick: () => void;
  onHover: (on: boolean) => void;
  onRemove: (r: Role) => void;
}) {
  const mine = rolesOf(roles, row.name);
  const takes = live ? accepts(parts, live, row.name) : false;
  const link = row.kind === "link" ? parts.links.find((l) => l.name === row.name) : undefined;
  const mimic = row.joint?.mimic;
  const label = live
    ? `${row.name}: ${takes ? (mine.includes(live) ? `remove from ${ROLE_LABEL[live]}` : `add to ${ROLE_LABEL[live]}`) : `can't be ${ROLE_LABEL[live]}`}`
    : `${row.name}${mine.length ? `, ${mine.map((r) => ROLE_LABEL[r]).join(" and ")}` : ""}`;

  return (
    <li
      className="byor-row"
      data-part={row.name}
      data-kind={row.kind}
      data-takes={live ? takes : undefined}
      data-target={target || undefined}
      data-focused={focused || undefined}
      style={{ "--depth": row.depth } as CSSProperties}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className="byor-row__lanes" aria-hidden="true">
        {row.guides.map((g, i) =>
          i === row.depth - 1 && row.branchStart ? (
            <span key={i} className="byor-lane" data-elbow={row.branchLast ? "last" : "mid"} />
          ) : (
            <span key={i} className="byor-lane" data-through={g} />
          ),
        )}
        <span className="byor-lane byor-lane--own" data-node={row.kind} data-start={row.depth === 0 && row.name === parts.root} data-end={row.end}>
          {row.kind === "joint" ? <JointIcon type={row.joint!.type} className="byor-lane__glyph" /> : <span className="byor-lane__dot" />}
        </span>
      </span>
      <button type="button" className="byor-row__main" onClick={onPick} aria-label={label} aria-disabled={live ? !takes : undefined} aria-pressed={!live ? focused : undefined}>
        <span className="byor-row__name">{row.name}</span>
        <span className="byor-row__meta">
          {row.joint ? jointRange(row.joint) : link && !link.has_geometry ? "frame" : null}
          {mimic && <>, follows {mimic.joint}</>}
        </span>
      </button>
      <span className="byor-row__chips">
        {mine.map((r) => (
          <span key={r} className="byor-chip" data-role={r} data-suggested={isSuggested(parts, r, row.name)} title={isSuggested(parts, r, row.name) ? `Suggested: ${parts.why[r === "arm" ? "arm_joints" : r === "gripper" ? "gripper_joints" : r] ?? ""}` : undefined}>
            {ROLE_LABEL[r]}
            <button type="button" className="byor-chip__x" aria-label={`Remove ${row.name} from ${ROLE_LABEL[r]}`} onClick={() => onRemove(r)}>
              <CloseIcon width={12} height={12} />
            </button>
          </span>
        ))}
      </span>
      <span className="byor-row__port" aria-hidden="true" />
    </li>
  );
}
