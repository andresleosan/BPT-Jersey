"use client";

import { manualProgressError, type manualProgressLimits } from "@bpt-jersey/domain/levels";
import "./progress-count-fields.css";

type Limits = ReturnType<typeof manualProgressLimits>;

export function readManualProgress(limits: Limits, classes: string, days: string) {
  const input = {
    ...(classes === "" ? {} : { classes: Number(classes) }),
    ...(days === "" ? {} : { days: Number(days) }),
  };
  const error = [classes, days].some((value) => value !== "" && !/^(0|[1-9]\d*)$/u.test(value))
    ? "Enter whole numbers only. Leave a field blank to keep its automatic count."
    : manualProgressError(limits, input);
  return { input, error };
}

export function ProgressCountFields({
  id,
  limits,
  classes,
  days,
  onClassesChange,
  onDaysChange,
  disabled = false,
}: Readonly<{
  id: string;
  limits: Limits;
  classes: string;
  days: string;
  onClassesChange: (value: string) => void;
  onDaysChange: (value: string) => void;
  disabled?: boolean;
}>) {
  return (
    <div className="ibjjf-count-fields">
      {(
        [
          { key: "classes", label: "Classes completed", value: classes, change: onClassesChange },
          { key: "days", label: "Days completed", value: days, change: onDaysChange },
        ] as const
      ).map(({ key, label, value, change }) => (
        <label htmlFor={`${id}-${key}`} key={key}>
          {label}
          <input
            aria-describedby={`${id}-${key}-help`}
            disabled={disabled || limits[key] === null}
            id={`${id}-${key}`}
            inputMode="numeric"
            max={limits[key] ?? undefined}
            min={0}
            onChange={(event) => change(event.target.value)}
            placeholder="Keep automatic count"
            step={1}
            type="number"
            value={value}
          />
          <span className="ibjjf-field-help" id={`${id}-${key}-help`}>
            {limits[key] === null
              ? `No ${key} requirement for the next level.`
              : `Manual range: 0 to ${limits[key]}.`}
          </span>
        </label>
      ))}
    </div>
  );
}
