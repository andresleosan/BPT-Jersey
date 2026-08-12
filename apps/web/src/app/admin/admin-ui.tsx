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

export function AdminDataTable<T extends object>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: readonly { key: string; label: string; render: (row: T) => ReactNode }[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
}) {
  return (
    <div className="admin-data-table-wrap">
      <table className="admin-data-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td data-label={column.label} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminFilterBar({ children }: { children: ReactNode }) {
  return <div className="admin-filter-bar">{children}</div>;
}
