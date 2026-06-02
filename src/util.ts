/* Shared helpers used across screens. */

/** Derive a filesystem-safe slug, matching the prototype's logic exactly. */
export function slugify(value: string): string {
  const slug = (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug;
}

/** Slug used for live previews (Configure summary, hints) — falls back to a
 *  placeholder so the UI never shows an empty filename. */
export function previewSlug(value: string): string {
  return slugify(value || "merchant") || "merchant";
}

export interface FormState {
  merchant: string;
  password: string;
  folder: string;
  bits: number;
  alsoPkcs1: boolean;
  production: boolean;
}

export type Mode = "beginner" | "advanced";
export type Theme = "light" | "dark";
export type Step = "welcome" | "configure" | "generate" | "done";
