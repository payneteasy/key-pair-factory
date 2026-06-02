import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { I } from "../components/icons";
import { buildGenerateInput, generateKeyPair } from "../ipc";
import type { GenerateOutput, KeyGenError } from "../ipc";
import type { FormState } from "../util";

interface GenerateProps {
  form: FormState;
  onDone: (result: GenerateOutput) => void;
  onError: (message: string) => void;
}

export function Generate({ form, onDone, onError }: GenerateProps) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const phases = useMemo(() => {
    const base = [
      { t: "Initializing entropy pool" },
      { t: `Generating ${form.bits}-bit RSA key` },
      { t: "Deriving public key" },
      { t: "Encoding PKCS#8 PEM" },
    ];
    if (form.alsoPkcs1) base.push({ t: "Converting to PKCS#1 PEM" });
    base.push({ t: "Writing files to disk" });
    return base;
  }, [form.bits, form.alsoPkcs1]);

  useEffect(() => {
    let cancelled = false;

    const t0 = performance.now();
    const intv = setInterval(() => setElapsed((performance.now() - t0) / 1000), 60);

    // The phase indicator is driven by REAL backend progress events (emitted at
    // the start of each Rust phase), not a synthetic timer — so it reflects
    // actual work and honestly dwells on "Generating … RSA key" (the slow step)
    // instead of racing ahead to "Writing files to disk". Monotonic via max().
    const unlistenPromise = listen<number>("keygen-progress", (e) => {
      if (!cancelled && typeof e.payload === "number") {
        setPhase((p) => Math.max(p, Math.min(e.payload, phases.length - 1)));
      }
    });

    // Kick off the real crypto work.
    generateKeyPair(buildGenerateInput(form))
      .then((result) => {
        if (cancelled) return;
        setPhase(phases.length);
        onDone(result);
      })
      .catch((err: KeyGenError | string) => {
        if (cancelled) return;
        const message = typeof err === "string" ? err : err?.message || "Unknown error during key generation.";
        onError(message);
      });

    return () => {
      cancelled = true;
      clearInterval(intv);
      unlistenPromise.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="gen-stage">
      <div className="gen-visual">
        <div className="ring ring-1"></div>
        <div className="ring ring-2"></div>
        <div className="ring ring-3"></div>
        <div className="center">{I.key}</div>
      </div>
      <div className="gen-body">
        <div className="gen-phase">Step 3 of 4 — Generating</div>
        <h2>{phase < phases.length ? phases[phase].t : "Finishing up"}…</h2>
        <p>Elapsed {elapsed.toFixed(1)}s. Generation typically takes 2–5 seconds depending on your machine.</p>
      </div>
      <div className="gen-log">
        {phases.map((p, i) => (
          <div
            key={i}
            className={`row ${i < phase ? "done" : i === phase ? "curr" : ""}`}
            style={{ opacity: i > phase ? 0.5 : 1 }}
          >
            <span className="t">{String(i + 1).padStart(2, "0")}</span>
            <span className="m">{p.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
