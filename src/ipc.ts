/* Typed wrappers around the Tauri command surface (see BUILD §7).
 *
 * Crypto, the platform default folder, and the secure file write live in Rust
 * commands. Dialogs / clipboard / opener / preference storage use the official
 * Tauri JS plugins directly. */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openerPath, openUrl as openerUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { load } from "@tauri-apps/plugin-store";
import { slugify } from "./util";
import type { FormState } from "./util";

export interface GenerateInput {
  merchantSlug: string;
  password: string | null;
  bits: number;
  alsoPkcs1: boolean;
  production: boolean;
  folder: string;
}

export interface GenerateOutput {
  privatePem: string;
  privatePkcs1Pem: string | null;
  publicPem: string;
  files: string[];
}

export interface Preferences {
  theme: "light" | "dark";
  mode: "beginner" | "advanced";
  folder: string;
}

export interface KeyGenError {
  kind: string;
  message: string;
}

/** Build the Rust GenerateInput from the wizard form (single source of truth). */
export function buildGenerateInput(form: FormState): GenerateInput {
  return {
    merchantSlug: slugify(form.merchant),
    password: form.password ? form.password : null,
    bits: form.bits,
    alsoPkcs1: form.alsoPkcs1,
    production: form.production,
    folder: form.folder,
  };
}

/** Generate the RSA key pair and write the PEM files to disk. Long-running. */
export function generateKeyPair(input: GenerateInput): Promise<GenerateOutput> {
  return invoke<GenerateOutput>("generate_key_pair", { input });
}

/** Absolute paths of target files that already exist (would be overwritten). */
export function existingTargetFiles(input: GenerateInput): Promise<string[]> {
  return invoke<string[]>("existing_target_files", { input });
}

/** Resolve the platform default save folder (Documents/Payneteasy Keys). */
export function defaultDocumentsDir(): Promise<string> {
  return invoke<string>("default_documents_dir");
}

/** Open a native folder picker. Returns the chosen path or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false, title: "Choose save location" });
  return typeof picked === "string" ? picked : null;
}

/** Open a "save as" dialog and write `contents` through the Rust file writer
 *  (so PEM files land with restrictive permissions). Returns the path written,
 *  or null if cancelled. */
export async function saveTextFile(defaultName: string, contents: string): Promise<string | null> {
  const path = await saveDialog({ defaultPath: defaultName });
  if (!path) return null;
  await invoke<void>("write_text_file", { path, contents });
  return path;
}

/** Reveal a file or folder using the OS opener. */
export function openPath(path: string): Promise<void> {
  return openerPath(path);
}

/** Open a URL in the user's default browser. */
export function openUrl(url: string): Promise<void> {
  return openerUrl(url);
}

/** Copy text to the system clipboard. */
export function copyToClipboard(text: string): Promise<void> {
  return writeText(text);
}

const PREFS_FILE = "preferences.json";
const PREFS_KEY = "preferences";

export async function getPreferences(): Promise<Preferences> {
  const store = await load(PREFS_FILE);
  const value = (await store.get<Preferences>(PREFS_KEY)) ?? null;
  if (!value) throw new Error("no preferences stored");
  return value;
}

export async function setPreferences(prefs: Preferences): Promise<void> {
  const store = await load(PREFS_FILE);
  await store.set(PREFS_KEY, prefs);
  await store.save();
}
