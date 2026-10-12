"use client";

import { useState, type KeyboardEvent } from "react";

const maximumSizes = 12;

/** Common BJJ and clothing runs; a preset only adds the sizes the product does not have yet. */
const presets = [
  { label: "Adult gi", sizes: ["A0", "A1", "A1L", "A2", "A2L", "A3", "A3L", "A4"] },
  { label: "Kids gi", sizes: ["M000", "M00", "M0", "M1", "M2", "M3", "M4"] },
  { label: "Clothing", sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  { label: "One size", sizes: ["One size"] },
] as const;

export type SizeStock = Readonly<Record<string, string>>;

/** One row per size: units left (blank = not counted) and an Available switch that sets 0. */
export function SizeStockEditor({
  sizes,
  stock,
  disabled,
  onChange,
}: {
  sizes: readonly string[];
  stock: SizeStock;
  disabled: boolean;
  onChange: (sizes: readonly string[], stock: SizeStock) => void;
}) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string>();

  function add(names: readonly string[]): void {
    const next = [...sizes];
    for (const raw of names) {
      const name = raw.trim().slice(0, 16);
      if (!name || next.some((size) => size.toLowerCase() === name.toLowerCase())) continue;
      if (next.length >= maximumSizes) {
        setHint(`A product can have up to ${maximumSizes} sizes.`);
        break;
      }
      next.push(name);
    }
    onChange(next, stock);
  }

  function addDraft(): void {
    setHint(undefined);
    // Pasting "A1, A2, A3" adds all three.
    add(draft.split(","));
    setDraft("");
  }

  function remove(size: string): void {
    const rest = { ...stock };
    delete rest[size];
    onChange(
      sizes.filter((item) => item !== size),
      rest,
    );
  }

  function move(index: number, offset: -1 | 1): void {
    const next = [...sizes];
    [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];
    onChange(next, stock);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault(); // Enter adds a size instead of submitting the product.
    addDraft();
  }

  return (
    <fieldset className="shop-admin-field shop-admin-field-wide shop-admin-sizes" disabled={disabled}>
      <legend>Sizes and stock</legend>
      <p className="shop-admin-sizes-help">
        Add the sizes this product comes in. Type the units you have, or leave it blank if you
        don&apos;t count that size. Each order takes units off and a cancelled order puts them
        back. A size at 0 shows as not available in the shop.
      </p>

      <div className="shop-admin-sizes-presets" aria-label="Quick add sizes" role="group">
        {presets.map((preset) => (
          <button
            className="shop-admin-table-button"
            key={preset.label}
            onClick={() => {
              setHint(undefined);
              add(preset.sizes);
            }}
            type="button"
          >
            + {preset.label}
          </button>
        ))}
      </div>

      <div className="shop-admin-sizes-add">
        <label className="visually-hidden" htmlFor="shop-size-new">
          New size
        </label>
        <input
          id="shop-size-new"
          maxLength={60}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a size, e.g. A2 or M"
          value={draft}
        />
        <button
          className="shop-admin-primary-button"
          disabled={draft.trim().length === 0}
          onClick={addDraft}
          type="button"
        >
          Add size
        </button>
      </div>
      {hint ? <p className="shop-admin-sizes-hint">{hint}</p> : null}

      {sizes.length === 0 ? (
        <p className="shop-admin-sizes-empty">
          No sizes: the product is sold as one item (bags, belts, gift cards).
        </p>
      ) : (
        <table className="shop-admin-sizes-table">
          <thead>
            <tr>
              <th scope="col">Size</th>
              <th scope="col">Units in stock</th>
              <th scope="col">In the shop</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((size, index) => {
              const units = stock[size] ?? "";
              const available = units.trim() !== "0";
              const setUnits = (value: string) => onChange(sizes, { ...stock, [size]: value });
              return (
                <tr className={available ? undefined : "shop-admin-size-off"} key={size}>
                  <th scope="row">{size}</th>
                  <td data-label="Units in stock">
                    <input
                      aria-label={`Units in stock for size ${size}`}
                      inputMode="numeric"
                      max={9999}
                      min={0}
                      onChange={(event) => setUnits(event.target.value)}
                      placeholder="Not counted"
                      type="number"
                      value={units}
                    />
                  </td>
                  <td data-label="In the shop">
                    <label className="shop-admin-size-toggle">
                      <input
                        checked={available}
                        onChange={(event) => setUnits(event.target.checked ? "" : "0")}
                        type="checkbox"
                      />
                      {available ? "Available" : "Not available"}
                    </label>
                  </td>
                  <td className="shop-admin-size-actions">
                    <button
                      aria-label={`Move size ${size} up`}
                      className="shop-admin-table-button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      Up
                    </button>
                    <button
                      aria-label={`Move size ${size} down`}
                      className="shop-admin-table-button"
                      disabled={index === sizes.length - 1}
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      Down
                    </button>
                    <button
                      aria-label={`Remove size ${size}`}
                      className="shop-admin-table-button"
                      onClick={() => remove(size)}
                      type="button"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </fieldset>
  );
}
