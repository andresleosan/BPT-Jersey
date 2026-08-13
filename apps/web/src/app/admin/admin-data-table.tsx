"use client";

import { isValidElement, useState, type ReactElement, type ReactNode } from "react";

type DataTableColumn<T> = Readonly<{
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}>;

function cellText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(cellText).join("");
  if (isValidElement(value)) {
    return cellText((value as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

function sortableValue(value: string): {
  kind: "empty" | "number" | "date" | "text";
  value: number | string;
} {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized === "—" || normalized === "-") {
    return { kind: "empty", value: "" };
  }
  const numeric = normalized.replace(/[£$,\s]/gu, "");
  if (/^-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?$/u.test(numeric)) {
    const firstNumber = Number(numeric.split("/")[0]);
    if (Number.isFinite(firstNumber)) return { kind: "number", value: firstNumber };
  }
  const timestamp = Date.parse(normalized);
  if (
    !Number.isNaN(timestamp) &&
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/iu.test(
      normalized,
    )
  ) {
    return { kind: "date", value: timestamp };
  }
  return { kind: "text", value: normalized.toLocaleLowerCase("en-US") };
}

export function AdminDataTable<T extends object>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
}) {
  const [sort, setSort] = useState<{ key: string; direction: "ascending" | "descending" }>();

  function compareRows(left: T, right: T, column: DataTableColumn<T>): number {
    const leftValue = sortableValue(cellText(column.render(left)));
    const rightValue = sortableValue(cellText(column.render(right)));
    if (leftValue.kind === "empty" || rightValue.kind === "empty") {
      if (leftValue.kind === rightValue.kind) return 0;
      return leftValue.kind === "empty" ? 1 : -1;
    }
    if (typeof leftValue.value === "number" && typeof rightValue.value === "number") {
      return leftValue.value - rightValue.value;
    }
    return String(leftValue.value).localeCompare(String(rightValue.value), "en-US");
  }

  const sortedRows = sort
    ? rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const column = columns.find((candidate) => candidate.key === sort.key);
          if (!column) return left.index - right.index;
          const comparison = compareRows(left.row, right.row, column);
          if (comparison !== 0) return sort.direction === "ascending" ? comparison : -comparison;
          return left.index - right.index;
        })
        .map(({ row }) => row)
    : rows;

  function toggleSort(key: string): void {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
        : { key, direction: "ascending" },
    );
  }

  return (
    <div className="admin-data-table-wrap">
      <table className="admin-data-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                aria-sort={sort?.key === column.key ? sort.direction : "none"}
                key={column.key}
                scope="col"
              >
                <button
                  aria-label={`Sort by ${column.label} ${
                    sort?.key === column.key && sort.direction === "ascending"
                      ? "descending"
                      : "ascending"
                  }`}
                  className="admin-table-sort-button"
                  onClick={() => toggleSort(column.key)}
                  type="button"
                >
                  {column.label}
                  <span aria-hidden="true" className="admin-table-sort-indicator">
                    {sort?.key === column.key ? (sort.direction === "ascending" ? "↑" : "↓") : "↕"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
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
