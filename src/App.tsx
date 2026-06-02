import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { I } from "./components/icons";
import { STEPS, Stepper } from "./components/Stepper";
// Brand mark — the app squircle logo. The mark sits on the themed header
// background, so we show the light squircle on dark and the dark on light to
// keep it crisp on either theme (the Dock/taskbar icon stays the dark master).
import logoDark from "./assets/logo-dark.png";
import logoLight from "./assets/logo-light.png";
import { Welcome } from "./screens/Welcome";
import { Configure } from "./screens/Configure";
import { Generate } from "./screens/Generate";
import { Done } from "./screens/Done";
import {
  buildGenerateInput,
  defaultDocumentsDir,
  existingTargetFiles,
  getPreferences,
  setPreferences,
} from "./ipc";
import type { GenerateOutput } from "./ipc";
import type { FormState, Mode, Step, Theme } from "./util";

const SCREEN_META: Record<Step, { eyebrow: string; title: string; sub: string } | null> = {
  welcome: null,
  configure: {
    eyebrow: "Step 2 of 4",
    title: "Configure your key pair",
    sub: "Defaults match Payneteasy documentation — only change them if you know you need to.",
  },
  generate: null,
  done: { eyebrow: "Step 4 of 4", title: "Your keys are ready", sub: "" },
};

// Resolve the boot theme synchronously (same source the index.html inline
// script uses) so React's first render matches the pre-paint <html> attribute
// and there's no flash.
function readInitialTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* localStorage unavailable */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [step, setStep] = useState<Step>("welcome");
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [mode, setMode] = useState<Mode>("beginner");
  const [result, setResult] = useState<GenerateOutput | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    merchant: "acme_payments",
    password: "",
    folder: "~/Documents/Payneteasy Keys",
    bits: 4096,
    alsoPkcs1: false,
    production: false,
  });

  const prefsLoaded = useRef(false);

  // Load persisted preferences (mode/folder) and resolve the default save
  // folder on first run. Theme is handled synchronously (see readInitialTheme
  // + the index.html inline script) to avoid a startup flash, so it is not
  // re-applied here.
  useEffect(() => {
    (async () => {
      let initialMode: Mode = "beginner";
      let folder = "";
      try {
        const prefs = await getPreferences();
        if (prefs.mode === "beginner" || prefs.mode === "advanced") initialMode = prefs.mode;
        if (prefs.folder) folder = prefs.folder;
      } catch {
        /* no store yet — use defaults */
      }

      if (!folder) {
        try {
          folder = await defaultDocumentsDir();
        } catch {
          folder = "~/Documents/Payneteasy Keys";
        }
      }

      setMode(initialMode);
      setForm((f) => ({ ...f, folder }));
      prefsLoaded.current = true;
    })();
  }, []);

  // Reveal the window once React has rendered the themed first frame (the
  // window is created hidden in tauri.conf.json to avoid a white flash).
  useEffect(() => {
    getCurrentWindow().show().catch(() => {});
  }, []);

  // Apply theme/mode to <html> and mirror the theme to localStorage so the
  // next launch's inline script can pick it up synchronously.
  useEffect(() => {
    const de = document.documentElement;
    de.setAttribute("data-theme", theme);
    de.setAttribute("data-mode", mode);
    de.style.colorScheme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme, mode]);

  // Persist preferences after the initial load.
  useEffect(() => {
    if (!prefsLoaded.current) return;
    setPreferences({ theme, mode, folder: form.folder }).catch(() => {});
  }, [theme, mode, form.folder]);

  const idx = STEPS.findIndex((s) => s.key === step);
  const meta = SCREEN_META[step];
  const nextDisabled = step === "configure" && !form.merchant.trim();

  const goBack = () => {
    if (step === "configure") setStep("welcome");
    else if (step === "done") {
      setResult(null);
      setStep("welcome");
    }
  };

  const startGenerate = async () => {
    setGenError(null);
    // Warn before overwriting existing key files — a second run with the same
    // name/folder would otherwise silently replace (and lose) earlier keys.
    try {
      const existing = await existingTargetFiles(buildGenerateInput(form));
      if (existing.length > 0) {
        const list = existing.map((p) => p.split(/[/\\]/).pop()).join("\n");
        const overwrite = await ask(
          `These files already exist in this folder and will be overwritten:\n\n${list}\n\n` +
            `Overwriting the private key permanently replaces the old one. Continue?`,
          { title: "Files already exist", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" },
        );
        if (!overwrite) return; // stay on Configure
      }
    } catch {
      /* check failed — proceed; generation will surface any real error */
    }
    setStep("generate");
  };

  const restart = () => {
    setResult(null);
    setGenError(null);
    setStep("welcome");
  };

  const stepBody = useMemo(() => {
    switch (step) {
      case "welcome":
        return <Welcome onNext={() => setStep("configure")} />;
      case "configure":
        return (
          <Configure
            form={form}
            setForm={setForm}
            mode={mode}
            error={genError}
            onRetryDismiss={() => setGenError(null)}
          />
        );
      case "generate":
        return (
          <Generate
            form={form}
            onDone={(r) => {
              setResult(r);
              setStep("done");
            }}
            onError={(message) => {
              setGenError(message);
              setStep("configure");
            }}
          />
        );
      case "done":
        return result ? <Done form={form} result={result} onRestart={restart} /> : null;
    }
  }, [step, form, mode, genError, result]);

  return (
    <div className="viewport">
      <div className="window" data-screen-label={`${String(idx + 1).padStart(2, "0")} ${STEPS[idx].label}`}>
        {/* Header — the native OS title bar provides the window chrome; the
            theme toggle lives here next to the mode pill (per BUILD §4). */}
        <div className="app-header">
          <div className="brand">
            <img
              className="brand-mark"
              src={theme === "dark" ? logoLight : logoDark}
              alt="Payneteasy API Key Pair Factory"
            />
            <div className="brand-text">
              <div className="name">API Key Pair Factory</div>
              <div className="sub">Payneteasy · v1.0</div>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="mode-tag"
              onClick={() => setMode((m) => (m === "beginner" ? "advanced" : "beginner"))}
              title="Switch detail level"
            >
              {I.expand}
              {mode === "beginner" ? "Beginner mode" : "Advanced mode"}
            </button>
            <button
              className="icon-btn"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title="Toggle theme"
            >
              {theme === "light" ? I.moon : I.sun}
            </button>
          </div>
        </div>

        {/* Stepper */}
        <Stepper current={step} />

        {/* Screen */}
        <div className="screen">
          {meta && meta.title && (
            <div className="screen-head">
              {meta.eyebrow && <div className="screen-eyebrow">{meta.eyebrow}</div>}
              <h2 className="screen-title">{meta.title}</h2>
              {meta.sub && <p className="screen-subtitle">{meta.sub}</p>}
            </div>
          )}
          <div className="screen-body">{stepBody}</div>
        </div>

        {/* Wizard nav */}
        <div className="wizard-nav">
          <div className="nav-meta">
            {I.shield}
            <span>All cryptographic operations happen locally on this device</span>
            <span className="dot-sep"></span>
            <span>v1.0.2</span>
          </div>
          <div className="row">
            {step !== "welcome" && step !== "generate" && (
              <button className="btn btn-secondary" onClick={goBack}>
                {I.arrowLeft} Back
              </button>
            )}
            {step === "welcome" && (
              <button className="btn btn-primary" onClick={() => setStep("configure")}>
                Get started {I.arrowRight}
              </button>
            )}
            {step === "configure" && (
              <button className="btn btn-primary" disabled={nextDisabled} onClick={startGenerate}>
                Generate keys {I.arrowRight}
              </button>
            )}
            {step === "done" && (
              <button className="btn btn-primary" onClick={restart}>
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
