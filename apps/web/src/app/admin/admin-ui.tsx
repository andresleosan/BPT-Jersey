import type { ReactNode } from "react";

import { AdminIcon, type AdminIconName } from "./admin-icons";

export function AdminIconButton({
  icon,
  label,
  onClick,
}: {
  icon: AdminIconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="admin-icon-button"
      onClick={onClick}
      title={label}
      type="button"
    >
      <AdminIcon name={icon} height="1.35rem" width="1.35rem" />
    </button>
  );
}

export function AdminSectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-section-header">
      <div>
        <p className="admin-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="admin-section-actions">{actions}</div> : null}
    </header>
  );
}

export function AdminStatusBadge({ status }: { status: string }) {
  const tone = status.toLowerCase().replaceAll(" ", "-");
  return <span className={`admin-status-badge admin-status-${tone}`}>{status}</span>;
}

export function AdminMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <article aria-label={`${value} ${label}`} className="admin-metric">
      <p className="admin-card-label">{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

export function AdminFilterBar({ children }: { children: ReactNode }) {
  return <div className="admin-filter-bar">{children}</div>;
}
