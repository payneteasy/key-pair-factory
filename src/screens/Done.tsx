import { I } from "../components/icons";
import { KeyDisplay } from "../components/KeyDisplay";
import { openPath, saveTextFile } from "../ipc";
import { previewSlug } from "../util";
import type { FormState } from "../util";
import type { GenerateOutput } from "../ipc";

interface DoneProps {
  form: FormState;
  result: GenerateOutput;
  onRestart: () => void;
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(0, idx) : p;
}

export function Done({ form, result, onRestart }: DoneProps) {
  const slug = previewSlug(form.merchant);
  const fileCount = result.files.length;

  // Match the real written paths by suffix; fall back to the form folder.
  const pkcs1Path = result.files.find((f) => f.endsWith("_private_pkcs1.pem"));
  const privatePath =
    result.files.find((f) => f.endsWith("_private.pem") && !f.endsWith("_private_pkcs1.pem")) ?? form.folder;
  const publicPath = result.files.find((f) => f.endsWith("_public.pem")) ?? form.folder;
  const folder = dirname(privatePath);

  const downloadPublic = async () => {
    try {
      await saveTextFile(basename(publicPath), result.publicPem);
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="done-grid">
      <div className="done-banner">
        <div className="ico">{I.check}</div>
        <div className="body">
          <strong>{fileCount} files generated successfully</strong>
          <span>
            Saved to{" "}
            <code style={{ fontFamily: "Geist Mono, monospace", fontSize: 12 }}>{folder}</code>. Treat the private key
            {form.alsoPkcs1 ? " files" : ""} like a password — never share {form.alsoPkcs1 ? "them" : "it"}.
          </span>
        </div>
        <button
          className="key-actions-btn"
          onClick={() => openPath(folder).catch((e) => console.error("open folder failed:", e))}
        >
          {I.folder} Open folder
        </button>
      </div>

      <div className="key-pair-row">
        <KeyDisplay
          kind="private"
          title={form.alsoPkcs1 ? "Private key — PKCS#8" : "Private key"}
          path={privatePath}
          body={result.privatePem}
          saveName={basename(privatePath)}
          defaultMasked
        />
        <KeyDisplay
          kind="public"
          title="Public key"
          path={publicPath}
          body={result.publicPem}
          saveName={basename(publicPath)}
        />
      </div>

      {form.alsoPkcs1 && pkcs1Path && result.privatePkcs1Pem && (
        <KeyDisplay
          kind="private"
          title="Private key — PKCS#1 (for documentation request builders)"
          path={pkcs1Path}
          body={result.privatePkcs1Pem}
          saveName={basename(pkcs1Path)}
          defaultMasked
        />
      )}

      <div className="next-step">
        <div className="num">→</div>
        <div className="body">
          <h4>Next: send the public key to support</h4>
          <p>
            Forward <code>{slug}_public.pem</code> to your Payneteasy account manager so they can register it for your
            merchant. The private key{form.alsoPkcs1 ? " files stay" : " stays"} on this computer.
          </p>
        </div>
        <button className="btn btn-primary" onClick={downloadPublic}>
          {I.download} Download public_key.pem
        </button>
        <button className="btn btn-ghost" onClick={onRestart}>
          Generate another
        </button>
      </div>
    </div>
  );
}
