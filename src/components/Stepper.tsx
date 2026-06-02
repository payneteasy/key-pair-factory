import { Fragment } from "react";
import { I } from "./icons";
import type { Step } from "../util";

export const STEPS: { key: Step; label: string }[] = [
  { key: "welcome", label: "Welcome" },
  { key: "configure", label: "Configure" },
  { key: "generate", label: "Generate" },
  { key: "done", label: "Done" },
];

export function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <Fragment key={s.key}>
          <div className={`step ${i === idx ? "active" : ""} ${i < idx ? "done" : ""}`}>
            <div className="step-num">{i < idx ? I.check : i + 1}</div>
            <div className="step-label">{s.label}</div>
          </div>
          {i < STEPS.length - 1 && <div className={`step-line ${i < idx ? "done" : ""}`}></div>}
        </Fragment>
      ))}
    </div>
  );
}
