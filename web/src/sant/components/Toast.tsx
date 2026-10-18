import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastInput = { message: string; tone?: "neutral" | "live" | "issue" | "danger"; action?: { label: string; onClick: () => void } };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} });

const LIFETIME_MS = 6000;

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => onDismiss(item.id), LIFETIME_MS);
    return () => window.clearTimeout(t);
  }, [paused, item.id, onDismiss]);

  return (
    <div
      className={`sant-toast sant-toast--${item.tone ?? "neutral"}`}
      role={item.tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="sant-toast__message">{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="sant-toast__action"
          onClick={() => {
            item.action!.onClick();
            onDismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className="sant-toast__close" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
        ×
      </button>
    </div>
  );
}

/** Toasts are always drawn in Volt colours: dark ink on paper pages, native on app pages. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="sant sant-toasts" data-mode="volt">
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
