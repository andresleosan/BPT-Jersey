"use client";

import type { AgeAvailability } from "@bpt-jersey/domain/schedule/age-capacity";
import { useId } from "react";
import "./age-capacity-fields.css";

export type AgeCapacityDraft = { age: string; capacity: string };

export function AgeCapacityFields({ rows, onChange, disabled, maximum, canManage, availability }: {
  rows: readonly AgeCapacityDraft[]; onChange: (rows: readonly AgeCapacityDraft[]) => void;
  disabled: boolean; maximum: number; canManage: boolean; availability?: readonly AgeAvailability[] | null | undefined;
}) {
  const prefix = useId();
  if (!canManage && rows.length === 0) return null;
  const patch = (index: number, change: Partial<AgeCapacityDraft>) => onChange(rows.map((row, i) => i === index ? { ...row, ...change } : row));
  return <section className="cs-age-limits" aria-labelledby={`${prefix}-title`}>
    <h3 id={`${prefix}-title`}>Age-specific limits</h3>
    <p className="cs-session-help">Optional. Ages without a limit share the remaining class capacity.</p>
    {rows.map((row, index) => <div className="cs-age-limit-row" key={index}>
      <label htmlFor={`${prefix}-age-${index}`}>Age (years)
        <input id={`${prefix}-age-${index}`} type="number" inputMode="numeric" min={0} max={120} step={1} required value={row.age} disabled={disabled || !canManage} onChange={(event) => patch(index, { age: event.target.value })} />
      </label>
      <label htmlFor={`${prefix}-places-${index}`}>Maximum places
        <input id={`${prefix}-places-${index}`} type="number" inputMode="numeric" min={1} max={maximum || 300} step={1} required value={row.capacity} disabled={disabled || !canManage} onChange={(event) => patch(index, { capacity: event.target.value })} />
      </label>
      {availability !== undefined && <p className="cs-age-occupancy">{row.age !== "" && availability?.some((item) => item.age === Number(row.age)) ? `${availability.find((item) => item.age === Number(row.age))!.occupied} booked or held` : "Occupancy checked when saving"}</p>}
      {canManage && <button type="button" className="cs-button" disabled={disabled} aria-label={`Remove age limit ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove limit</button>}
    </div>)}
    {canManage && <button type="button" className="cs-button" disabled={disabled || rows.length >= 121} onClick={() => onChange([...rows, { age: "", capacity: "" }])}>Add age limit</button>}
    {!canManage && <p className="cs-session-help">Only the owner can change age limits.</p>}
  </section>;
}
