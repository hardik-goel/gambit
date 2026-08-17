"use client";
/**
 * Host options, generated from the game's own `configSchema`.
 *
 * A new game gets a lobby panel for free: describe the options in Zod and the
 * controls appear. This is one of the places the plugin promise has to hold.
 */
import React from "react";
import { z, type ZodTypeAny } from "zod";
import { SmallCaps } from "@gambit/ui";

interface Field {
  key: string;
  label: string;
  kind: "enum" | "boolean" | "number";
  options?: string[];
  min?: number;
  max?: number;
  description?: string;
}

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; description?: string } {
  let inner = schema;
  let description = schema.description;
  // Peel defaults/optionals until we reach something we can render.
  for (let i = 0; i < 6; i++) {
    if (inner instanceof z.ZodDefault) inner = inner._def.innerType as ZodTypeAny;
    else if (inner instanceof z.ZodOptional) inner = inner._def.innerType as ZodTypeAny;
    else break;
    description = description ?? inner.description;
  }
  return { inner, description };
}

export function describeSchema(schema: ZodTypeAny): Field[] {
  if (!(schema instanceof z.ZodObject)) return [];
  const shape = schema.shape as Record<string, ZodTypeAny>;
  const fields: Field[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    const { inner, description } = unwrap(raw);
    // camelCase splits on capitals, but a digit is neither: `seat0Color`
    // came out as "Seat0 Color". Seats are numbered from one everywhere a
    // player can see them, so the index is shown the way the seat list shows
    // it rather than the way the state stores it.
    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/(\d+)/g, (digits) => ` ${Number(digits) + 1}`)
      .replace(/^./, (c) => c.toUpperCase())
      .replace(/\s+/g, " ")
      .trim();
    if (inner instanceof z.ZodEnum) {
      fields.push({ key, label, kind: "enum", options: inner.options as string[], description });
    } else if (inner instanceof z.ZodBoolean) {
      fields.push({ key, label, kind: "boolean", description });
    } else if (inner instanceof z.ZodNumber) {
      const checks = inner._def.checks ?? [];
      const min = checks.find((c) => c.kind === "min");
      const max = checks.find((c) => c.kind === "max");
      fields.push({
        key,
        label,
        kind: "number",
        min: min && "value" in min ? (min.value as number) : 0,
        max: max && "value" in max ? (max.value as number) : 10,
        description
      });
    }
  }
  return fields;
}

export function ConfigPanel({
  schema,
  config,
  disabled,
  onChange
}: {
  schema: ZodTypeAny;
  config: Record<string, unknown>;
  disabled?: boolean;
  onChange(patch: Record<string, unknown>): void;
}) {
  const fields = describeSchema(schema);
  if (fields.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <SmallCaps>table options</SmallCaps>
      {fields.map((f) => (
        <div key={f.key} style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 14 }}>{f.label}</label>
          {f.description && <div style={{ fontSize: 12, color: "var(--mut)" }}>{f.description}</div>}

          {f.kind === "enum" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {f.options!.map((opt) => (
                <button
                  key={opt}
                  disabled={disabled}
                  onClick={() => onChange({ [f.key]: opt })}
                  className="gambit-mini"
                  style={
                    config[f.key] === opt
                      ? { borderColor: "var(--accent)", color: "var(--accent)" }
                      : undefined
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {f.kind === "boolean" && (
            <button
              disabled={disabled}
              className="gambit-mini"
              onClick={() => onChange({ [f.key]: !config[f.key] })}
              style={config[f.key] ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            >
              {config[f.key] ? "On" : "Off"}
            </button>
          )}

          {f.kind === "number" && (
            <input
              type="range"
              disabled={disabled}
              min={f.min}
              max={f.max}
              value={Number(config[f.key] ?? f.min ?? 0)}
              onChange={(e) => onChange({ [f.key]: Number(e.target.value) })}
              style={{ accentColor: "var(--accent)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
