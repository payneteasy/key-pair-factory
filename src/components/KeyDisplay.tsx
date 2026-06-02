import { useState } from "react";
import { I } from "./icons";
import { copyToClipboard, saveTextFile } from "../ipc";

interface KeyDisplayProps {
  kind: "private" | "public";
  title: string;
  path: string;
  body: string;
  /** default save-as filename (no directory) */
  saveName: string;
  defaultMasked?: boolean;
}

export function KeyDisplay({ kind, title, path, body, saveName, defaultMasked }: KeyDisplayProps) {
  const [masked, setMasked] = useState(!!defaultMasked);
  const [copied, setCopied] = useState(false);

  const doCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await copyToClipboard(body);
    } catch {
      // best-effort fallback to the webview clipboard
      try {
        await navigator.clipboard.writeText(body);
      } catch {
        /* ignore */
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const doSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await saveTextFile(saveName, body);
    } catch {
      /* user cancelled or error — silently ignore */
    }
  };

  return (
    <div className={`key-display ${kind}`}>
      <div className="key-head">
        <div className="badge">{kind === "private" ? I.lockClosed : I.globe}</div>
        <div className="meta">
          <div className="name">{title}</div>
          <div className="path" title={path}>
            {path}
          </div>
        </div>
        <div className="actions">
          {kind === "private" && (
            <button className="key-actions-btn" onClick={() => setMasked((m) => !m)}>
              {masked ? I.eye : I.eyeOff} {masked ? "Reveal" : "Hide"}
            </button>
          )}
          <button className={`key-actions-btn ${copied ? "copied" : ""}`} onClick={doCopy}>
            {copied ? I.check : I.copy} {copied ? "Copied" : "Copy"}
          </button>
          <button className="key-actions-btn" onClick={doSave}>
            {I.download} Save as…
          </button>
        </div>
      </div>
      <div className={`key-body ${masked ? "masked" : ""}`} onClick={() => masked && setMasked(false)}>
        {masked && (
          <div className="mask-overlay">
            {I.lockClosed}
            <div>Private key is hidden for safety</div>
            <div className="reveal">Click to reveal</div>
          </div>
        )}
        <div className={masked ? "underlay" : ""}>{body}</div>
      </div>
    </div>
  );
}
