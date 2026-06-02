import { Fragment, useMemo, useState } from "react";
import { I } from "../components/icons";
import { pickFolder } from "../ipc";
import { previewSlug } from "../util";
import type { FormState, Mode } from "../util";

interface ConfigureProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  mode: Mode;
  error?: string | null;
  onRetryDismiss?: () => void;
}

const mono = { fontFamily: "Geist Mono, monospace" } as const;

export function Configure({ form, setForm, mode, error, onRetryDismiss }: ConfigureProps) {
  const [showPw, setShowPw] = useState(false);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const pwScore = useMemo(() => {
    const p = form.password || "";
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^a-zA-Z0-9]/.test(p)) s++;
    return Math.min(s, 4);
  }, [form.password]);

  const filename = useMemo(() => previewSlug(form.merchant), [form.merchant]);

  const browse = async () => {
    try {
      const picked = await pickFolder();
      if (picked) update({ folder: picked });
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="config-grid">
      <div className="field-group">
        {error && (
          <div
            className="done-banner"
            style={{
              background: "var(--warn-soft)",
              borderColor: "oklch(0.72 0.15 75 / 0.4)",
              color: "var(--warn)",
            }}
          >
            <div className="ico" style={{ background: "var(--warn)" }}>
              {I.warning}
            </div>
            <div className="body">
              <strong>Generation failed</strong>
              <span>{error}</span>
            </div>
            {onRetryDismiss && (
              <button className="key-actions-btn" onClick={onRetryDismiss}>
                Dismiss
              </button>
            )}
          </div>
        )}

        <div className="field">
          <label>
            Project / merchant name <span className="opt">— required</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="e.g. acme_payments_prod"
            value={form.merchant}
            onChange={(e) => update({ merchant: e.target.value })}
          />
          <div className="hint">Names your key files; one set per merchant or environment.</div>
        </div>

        <div className="field">
          <label>
            Private key password <span className="opt">— optional</span>
          </label>
          <div className="password-row">
            <input
              type={showPw ? "text" : "password"}
              className="input"
              placeholder="Leave blank for an unencrypted key"
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
            />
            <button className="toggle-vis" onClick={() => setShowPw((s) => !s)} title={showPw ? "Hide" : "Show"}>
              {showPw ? I.eyeOff : I.eye}
            </button>
          </div>
          {form.password && (
            <div className="password-strength">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`bar ${i < pwScore ? (pwScore < 3 ? "warn" : "on") : ""}`}></div>
              ))}
            </div>
          )}
          <div className="hint">
            Required on every signature. The documentation's request builders expect an unencrypted key.
          </div>
        </div>

        <div className="field">
          <label>Save location</label>
          <div className="input-with-action">
            <input
              type="text"
              className="input mono"
              value={form.folder}
              onChange={(e) => update({ folder: e.target.value })}
            />
            <button className="btn btn-secondary" onClick={browse}>
              {I.folder} Browse…
            </button>
          </div>
          <div className="hint">
            {form.alsoPkcs1 ? "Three files" : "Two files"} will be created in this folder:{" "}
            <code style={mono}>{filename}_private.pem</code>
            {form.alsoPkcs1 ? (
              <Fragment>
                , <code style={mono}>{filename}_private_pkcs1.pem</code>
              </Fragment>
            ) : null}{" "}
            and <code style={mono}>{filename}_public.pem</code>
          </div>
        </div>

        <div className={`checkbox-row ${form.alsoPkcs1 ? "on" : ""}`} onClick={() => update({ alsoPkcs1: !form.alsoPkcs1 })}>
          <div className="ck">{I.check}</div>
          <div className="body">
            <div className="title">
              Also export PKCS#1 container{" "}
              <span style={{ fontWeight: 400, color: "var(--fg-faint)", fontSize: 12, marginLeft: 6 }}>
                — optional, for debugging
              </span>
            </div>
            <div className="desc">
              Adds a second private key file (
              <code style={{ ...mono, fontSize: 11 }}>{filename}_private_pkcs1.pem</code>) for use with the request
              builders in <code style={{ ...mono, fontSize: 11 }}>doc.payneteasy.com</code>. Same key, different
              envelope.
            </div>
          </div>
        </div>

        {mode === "advanced" && (
          <div className="advanced-section">
            <div className="section-label">
              {I.cog} Advanced <span className="line"></span>
            </div>

            <div className="field">
              <label>Key length</label>
              <div className="segmented">
                {[2048, 3072, 4096].map((b) => (
                  <button key={b} className={form.bits === b ? "on" : ""} onClick={() => update({ bits: b })}>
                    {b} bit
                  </button>
                ))}
              </div>
              <div className="hint">Payneteasy documentation recommends 4096. Request builders support up to 4096.</div>
            </div>

            <div className={`checkbox-row ${form.production ? "on" : ""}`} onClick={() => update({ production: !form.production })}>
              <div className="ck">{I.check}</div>
              <div className="body">
                <div className="title">Mark this key for production use</div>
                <div className="desc">
                  Adds a <code style={{ ...mono, fontSize: 11 }}>_prod</code> suffix and shows a reminder to keep test
                  and production keys separate.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="summary">
          <h3>Summary</h3>
          <div className="summary-row">
            <span className="k">Algorithm</span>
            <span className="v">RSA</span>
          </div>
          <div className="summary-row">
            <span className="k">Key length</span>
            <span className="v">{form.bits} bit</span>
          </div>
          <div className="summary-row">
            <span className="k">Encryption</span>
            <span className="v">{form.password ? "Password" : "None"}</span>
          </div>
          <div className="summary-row">
            <span className="k">Environment</span>
            <span className="v">{form.production ? "Production" : "Testing"}</span>
          </div>
          <div className="summary-row">
            <span className="k">Private (PKCS#8)</span>
            <span className="v" title={`${filename}_private.pem`}>
              {filename}_private.pem
            </span>
          </div>
          <div className="summary-row">
            <span className="k">Public</span>
            <span className="v">{filename}_public.pem</span>
          </div>
          {form.alsoPkcs1 && (
            <div className="summary-row">
              <span className="k">Private (PKCS#1)</span>
              <span className="v">{filename}_private_pkcs1.pem</span>
            </div>
          )}
        </div>

        {mode === "beginner" && (
          <div className="what-this" style={{ marginTop: 16 }}>
            <div className="ico">{I.info}</div>
            <div>
              <strong>What's a key pair?</strong> The <strong>private key</strong> stays on your computer and signs
              every API request. The <strong>public key</strong> goes to Payneteasy support so they can verify your
              signature. You'll generate both in the next step.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
