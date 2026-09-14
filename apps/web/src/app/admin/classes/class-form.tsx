"use client";

import {
  ageRangeMaxAge,
  ageRangeMinAge,
  ageRangePresets,
  classDescriptionMaxLength,
  daysOfWeek,
  type AgeRange,
  type ClassRecord,
  type ClassRecurrenceRule,
  type CreateClassInput,
  type DayOfWeek,
  type LocationId,
  type UpdateClassInput,
} from "@bpt-jersey/domain/schedule";

import type { ScheduleCatalogResponse } from "../../../lib/schedule-client";
import type { StaffProfileProjection } from "../../../lib/staff-client";

export type BeltOption = Readonly<{ key: string; name: string; sequence: number }>;

export type ClassDraft = Readonly<{
  name: string;
  programId: string;
  locationId: "" | LocationId;
  rules: readonly ClassRecurrenceRule[];
  levelRange: Readonly<{ fromKey: string; toKey: string }> | null;
  ageRange: AgeRange | null;
  description: string;
  instructorIds: readonly string[];
  capacity: number;
  minParticipants: number;
  active: boolean;
}>;

export const dayLabels: Readonly<Record<DayOfWeek, string>> = Object.freeze({
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
});
const dayShort: Readonly<Record<DayOfWeek, string>> = Object.freeze({
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
});
const durations = Object.freeze([30, 45, 60, 75, 90, 120]);
const defaultRule = Object.freeze({ startTime: "18:00", durationMinutes: 60 });

export function emptyClassDraft(): ClassDraft {
  return Object.freeze({
    name: "",
    programId: "",
    locationId: "",
    rules: Object.freeze([]),
    levelRange: null,
    ageRange: null,
    description: "",
    instructorIds: Object.freeze([]),
    capacity: 20,
    minParticipants: 4,
    active: true,
  });
}

export function draftFromClass(record: ClassRecord): ClassDraft {
  return Object.freeze({
    name: record.name,
    programId: record.programId,
    locationId: record.locationId,
    rules: Object.freeze([...record.recurrenceRules]),
    levelRange: record.levelRange
      ? { fromKey: record.levelRange.fromKey, toKey: record.levelRange.toKey }
      : null,
    ageRange: record.ageRange,
    description: record.description,
    instructorIds: Object.freeze([...record.instructorIds]),
    capacity: record.capacity,
    minParticipants: record.minParticipants,
    active: record.active,
  });
}

function sortRules(rules: readonly ClassRecurrenceRule[]): readonly ClassRecurrenceRule[] {
  return Object.freeze(
    [...rules].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
  );
}

type LevelRangeResult = Readonly<{
  fromKey: string;
  toKey: string;
  fromName: string;
  toName: string;
}> | null;

function resolveLevelRange(
  draft: ClassDraft,
  belts: readonly BeltOption[],
): LevelRangeResult | string {
  if (!draft.levelRange) return null;
  const from = belts.find((belt) => belt.key === draft.levelRange?.fromKey);
  const to = belts.find((belt) => belt.key === draft.levelRange?.toKey);
  if (!from || !to) return "Pick both belts or choose Any level.";
  if (to.sequence < from.sequence) return "The 'to' belt cannot be below the 'from' belt.";
  return { fromKey: from.key, toKey: to.key, fromName: from.name, toName: to.name };
}

function validateCommon(draft: ClassDraft): string | undefined {
  if (draft.name.trim().length < 2) return "Give the class a name of at least two characters.";
  if (draft.rules.length === 0) return "Pick at least one day.";
  if (draft.rules.some((rule) => !/^([01]\d|2[0-3]):[0-5]\d$/u.test(rule.startTime)))
    return "Every day needs a start time.";
  if (draft.instructorIds.length === 0) return "Pick at least one coach.";
  if (draft.minParticipants > draft.capacity) return "Minimum participants cannot exceed capacity.";
  if (
    draft.ageRange &&
    draft.ageRange.maxAge !== null &&
    draft.ageRange.maxAge < draft.ageRange.minAge
  )
    return "The upper age cannot be below the lower age.";
  return undefined;
}

export function draftToCreateInput(
  draft: ClassDraft,
  belts: readonly BeltOption[],
): CreateClassInput | string {
  if (!draft.programId || !draft.locationId) return "Pick the program and the training centre.";
  const common = validateCommon(draft);
  if (common) return common;
  const levelRange = resolveLevelRange(draft, belts);
  if (typeof levelRange === "string") return levelRange;
  return {
    programId: draft.programId,
    locationId: draft.locationId,
    name: draft.name.trim(),
    recurrenceRules: sortRules(draft.rules),
    instructorIds: draft.instructorIds,
    capacity: draft.capacity,
    minParticipants: draft.minParticipants,
    description: draft.description.trim(),
    ageRange: draft.ageRange,
    levelRange,
  };
}

export function draftToUpdateInput(
  classId: string,
  draft: ClassDraft,
  belts: readonly BeltOption[],
): UpdateClassInput | string {
  const common = validateCommon(draft);
  if (common) return common;
  const levelRange = resolveLevelRange(draft, belts);
  if (typeof levelRange === "string") return levelRange;
  return {
    classId,
    name: draft.name.trim(),
    recurrenceRules: sortRules(draft.rules),
    instructorIds: draft.instructorIds,
    capacity: draft.capacity,
    minParticipants: draft.minParticipants,
    active: draft.active,
    description: draft.description.trim(),
    ageRange: draft.ageRange,
    levelRange,
  };
}

type ClassFormProps = Readonly<{
  activeStaff: readonly StaffProfileProjection[];
  belts: readonly BeltOption[] | null;
  catalog: ScheduleCatalogResponse;
  draft: ClassDraft;
  mode: "create" | "edit";
  onChange: (draft: ClassDraft) => void;
}>;

export function ClassForm({ activeStaff, belts, catalog, draft, mode, onChange }: ClassFormProps) {
  const set = (patch: Partial<ClassDraft>) => onChange(Object.freeze({ ...draft, ...patch }));
  const lastRule = draft.rules[draft.rules.length - 1] ?? defaultRule;
  const presetIndex = ageRangePresets.findIndex(
    (preset) =>
      draft.ageRange?.minAge === preset.minAge && draft.ageRange?.maxAge === preset.maxAge,
  );
  const ageChoice =
    draft.ageRange === null ? "any" : presetIndex >= 0 ? String(presetIndex) : "custom";

  function toggleDay(day: DayOfWeek) {
    const existing = draft.rules.find((rule) => rule.dayOfWeek === day);
    set({
      rules: sortRules(
        existing
          ? draft.rules.filter((rule) => rule.dayOfWeek !== day)
          : [
              ...draft.rules,
              {
                dayOfWeek: day,
                startTime: lastRule.startTime,
                durationMinutes: lastRule.durationMinutes,
              },
            ],
      ),
    });
  }

  function patchRule(day: DayOfWeek, patch: Partial<ClassRecurrenceRule>) {
    set({
      rules: draft.rules.map((rule) => (rule.dayOfWeek === day ? { ...rule, ...patch } : rule)),
    });
  }

  const staffKeys = [
    ...activeStaff.map((profile) => profile.staffKey),
    ...draft.instructorIds.filter((id) => !activeStaff.some((profile) => profile.staffKey === id)),
  ];

  return (
    <div className="class-form">
      <label className="schedule-admin-field class-form-wide">
        Class name
        <input
          autoFocus
          maxLength={100}
          minLength={2}
          onChange={(e) => set({ name: e.target.value })}
          required
          value={draft.name}
        />
      </label>

      {mode === "create" ? (
        <>
          <label className="schedule-admin-field">
            Program
            <select
              onChange={(e) => set({ programId: e.target.value })}
              required
              value={draft.programId}
            >
              <option value="">Select a program</option>
              {catalog.programs
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.programId} value={p.programId}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="schedule-admin-field" role="radiogroup" aria-label="Training centre">
            <span>Training centre</span>
            <div className="class-choice-row">
              {catalog.locations
                .filter((l) => l.active)
                .map((location) => (
                  <button
                    aria-checked={draft.locationId === location.locationId}
                    className="class-choice"
                    key={location.locationId}
                    onClick={() => set({ locationId: location.locationId })}
                    role="radio"
                    type="button"
                  >
                    {location.name}
                  </button>
                ))}
            </div>
          </div>
        </>
      ) : (
        <p className="schedule-admin-form-note class-form-wide">
          {catalog.programs.find((p) => p.programId === draft.programId)?.name ?? draft.programId} ·{" "}
          {catalog.locations.find((l) => l.locationId === draft.locationId)?.name ??
            draft.locationId}
          . Program and centre stay fixed; sessions already generated keep their times. Generate
          again for new days.
        </p>
      )}

      <fieldset className="class-form-wide class-form-schedule">
        <legend>Weekly schedule</legend>
        <div className="class-choice-row" role="group" aria-label="Days of the week">
          {daysOfWeek.map((day) => (
            <button
              aria-label={dayLabels[day]}
              aria-pressed={draft.rules.some((rule) => rule.dayOfWeek === day)}
              className="class-choice class-choice-day"
              key={day}
              onClick={() => toggleDay(day)}
              type="button"
            >
              {dayShort[day]}
            </button>
          ))}
        </div>
        {draft.rules.length === 0 ? (
          <p className="schedule-admin-form-note">Pick the days this class runs.</p>
        ) : null}
        <ul className="class-form-rules">
          {draft.rules.map((rule) => (
            <li key={rule.dayOfWeek}>
              <strong>{dayLabels[rule.dayOfWeek]}</strong>
              <input
                aria-label={`${dayLabels[rule.dayOfWeek]} start time`}
                onChange={(e) => patchRule(rule.dayOfWeek, { startTime: e.target.value })}
                required
                type="time"
                value={rule.startTime}
              />
              <select
                aria-label={`${dayLabels[rule.dayOfWeek]} duration`}
                onChange={(e) =>
                  patchRule(rule.dayOfWeek, { durationMinutes: Number(e.target.value) })
                }
                value={rule.durationMinutes}
              >
                {[...new Set([...durations, rule.durationMinutes])]
                  .sort((a, b) => a - b)
                  .map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
              </select>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="class-form-wide">
        <legend>Level range</legend>
        {belts === null ? (
          <p className="schedule-admin-form-note">
            Belt catalogue unavailable. Level range can be set later.
          </p>
        ) : null}
        <div className="class-form-pair">
          <label className="schedule-admin-field">
            From belt
            <select
              aria-label="From belt"
              disabled={belts === null}
              onChange={(e) =>
                set({
                  levelRange: e.target.value
                    ? { fromKey: e.target.value, toKey: draft.levelRange?.toKey || e.target.value }
                    : null,
                })
              }
              value={draft.levelRange?.fromKey ?? ""}
            >
              <option value="">Any level</option>
              {(belts ?? []).map((belt) => (
                <option key={belt.key} value={belt.key}>
                  {belt.name}
                </option>
              ))}
            </select>
          </label>
          <label className="schedule-admin-field">
            To belt
            <select
              aria-label="To belt"
              disabled={belts === null || draft.levelRange === null}
              onChange={(e) =>
                set({
                  levelRange: draft.levelRange
                    ? { ...draft.levelRange, toKey: e.target.value }
                    : null,
                })
              }
              value={draft.levelRange?.toKey ?? ""}
            >
              {(belts ?? []).map((belt) => (
                <option key={belt.key} value={belt.key}>
                  {belt.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="class-form-wide">
        <legend>Age range</legend>
        <div className="class-choice-row" role="radiogroup" aria-label="Age range">
          <button
            aria-checked={ageChoice === "any"}
            className="class-choice"
            onClick={() => set({ ageRange: null })}
            role="radio"
            type="button"
          >
            Any age
          </button>
          {ageRangePresets.map((preset, index) => (
            <button
              aria-checked={ageChoice === String(index)}
              className="class-choice"
              key={preset.label}
              onClick={() => set({ ageRange: { minAge: preset.minAge, maxAge: preset.maxAge } })}
              role="radio"
              type="button"
            >
              {preset.label}
            </button>
          ))}
          <button
            aria-checked={ageChoice === "custom"}
            className="class-choice"
            onClick={() => set({ ageRange: draft.ageRange ?? { minAge: 8, maxAge: 11 } })}
            role="radio"
            type="button"
          >
            Custom
          </button>
        </div>
        {ageChoice === "custom" && draft.ageRange ? (
          <div className="class-form-pair">
            <label className="schedule-admin-field">
              From age
              <input
                inputMode="numeric"
                max={ageRangeMaxAge}
                min={ageRangeMinAge}
                onChange={(e) =>
                  set({
                    ageRange: {
                      minAge: Number(e.target.value),
                      maxAge: draft.ageRange?.maxAge ?? null,
                    },
                  })
                }
                type="number"
                value={draft.ageRange.minAge}
              />
            </label>
            <label className="schedule-admin-field">
              To age (blank = no limit)
              <input
                inputMode="numeric"
                max={ageRangeMaxAge}
                min={ageRangeMinAge}
                onChange={(e) =>
                  set({
                    ageRange: {
                      minAge: draft.ageRange?.minAge ?? ageRangeMinAge,
                      maxAge: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
                type="number"
                value={draft.ageRange.maxAge ?? ""}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className="schedule-admin-field class-form-wide">
        Description
        <textarea
          maxLength={classDescriptionMaxLength}
          onChange={(e) => set({ description: e.target.value })}
          rows={3}
          value={draft.description}
        />
        <small>
          {draft.description.length}/{classDescriptionMaxLength}
        </small>
      </label>

      <fieldset className="class-form-wide">
        <legend>Coaches</legend>
        <div className="class-form-checks">
          {staffKeys.map((staffKey) => (
            <label className="schedule-admin-check" key={staffKey}>
              <input
                checked={draft.instructorIds.includes(staffKey)}
                onChange={(e) =>
                  set({
                    instructorIds: e.target.checked
                      ? [...draft.instructorIds, staffKey]
                      : draft.instructorIds.filter((id) => id !== staffKey),
                  })
                }
                type="checkbox"
              />
              {staffKey}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="schedule-admin-field">
        Capacity
        <input
          inputMode="numeric"
          max={200}
          min={1}
          onChange={(e) => set({ capacity: Number(e.target.value) })}
          required
          type="number"
          value={draft.capacity}
        />
      </label>
      <label className="schedule-admin-field">
        Minimum participants
        <input
          inputMode="numeric"
          max={draft.capacity}
          min={0}
          onChange={(e) => set({ minParticipants: Number(e.target.value) })}
          required
          type="number"
          value={draft.minParticipants}
        />
      </label>

      {mode === "edit" ? (
        <label className="schedule-admin-check class-form-wide">
          <input
            checked={draft.active}
            onChange={(e) => set({ active: e.target.checked })}
            type="checkbox"
          />
          Class is active
        </label>
      ) : null}
    </div>
  );
}
