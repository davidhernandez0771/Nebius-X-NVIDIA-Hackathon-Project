import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  to?: string;
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
};

/** The label says exactly what happens ("Record a demo", not "Submit"). */
export function Button({ children, variant = "primary", size = "md", to, href, onClick, type = "button", disabled, className = "" }: Props) {
  const cls = `sant-btn sant-btn--${variant} sant-btn--${size} ${className}`.trim();
  if (to)
    return (
      <Link className={cls} to={to} onClick={onClick}>
        {children}
      </Link>
    );
  if (href)
    return (
      <a className={cls} href={href} onClick={onClick}>
        {children}
      </a>
    );
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
