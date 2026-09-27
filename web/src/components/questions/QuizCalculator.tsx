import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { GhostButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

// Basic, keyboard-accessible calculator for the quiz toolkit (Q2a). Session
// scoped — no persistence, no history leaves the panel. Deliberately minimal:
// exam-realistic basic arithmetic, not a scientific suite.
const KEYS: string[][] = [
  ["C", "←", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "="],
];
const OPS: Record<string, string> = { "÷": "/", "×": "*", "−": "-", "+": "+" };

function evaluate(expr: string): string {
  const cleaned = expr.replace(/[×]/g, "*").replace(/[÷]/g, "/").replace(/[−]/g, "-").replace(/%/g, "/100");
  if (!/^[-+*/.()\d\s]+$/.test(cleaned)) return "Error";
  try {
    const value = Function(`"use strict"; return (${cleaned})`)() as number;
    if (!Number.isFinite(value)) return "Error";
    return String(Math.round(value * 1e10) / 1e10);
  } catch {
    return "Error";
  }
}

export interface QuizCalculatorValue {
  expression: string;
  result: string;
}

export function QuizCalculator({ onClose, value, onChange, showClose = true }: {
  onClose: () => void;
  value?: QuizCalculatorValue;
  onChange?: (value: QuizCalculatorValue) => void;
  showClose?: boolean;
}) {
  const [expr, setExpr] = useState(value?.expression ?? "");
  const [result, setResult] = useState(value?.result ?? "");
  const panelRef = useRef<HTMLDivElement>(null);

  const update = useCallback((nextExpression: string, nextResult = result) => {
    setExpr(nextExpression);
    setResult(nextResult);
    onChange?.({ expression: nextExpression, result: nextResult });
  }, [onChange, result]);

  const press = (k: string) => {
    if (k === "C") { update("", ""); return; }
    if (k === "←") { update(expr.slice(0, -1)); return; }
    if (k === "=") { update(expr, evaluate(expr)); return; }
    update(expr + (OPS[k] ? k : k));
  };

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (/^[0-9.]$/.test(e.key)) { update(expr + e.key); e.preventDefault(); }
      else if (["+", "-", "*", "/"].includes(e.key)) {
        const disp = { "+": "+", "-": "−", "*": "×", "/": "÷" }[e.key]!;
        update(expr + disp); e.preventDefault();
      } else if (e.key === "Enter" || e.key === "=") { update(expr, evaluate(expr)); e.preventDefault(); }
      else if (e.key === "Backspace") { update(expr.slice(0, -1)); e.preventDefault(); }
    }
    const node = panelRef.current;
    node?.addEventListener("keydown", onKey);
    return () => node?.removeEventListener("keydown", onKey);
  }, [expr, onClose, update]);

  return (
    <div className="quiz-calculator" ref={panelRef} role="dialog" aria-label="Calculator">
      <div className="quiz-calc-head">
        <span className="field-label">Calculator</span>
        {showClose && <GhostButton className="icon-only" aria-label="Close calculator" onClick={onClose}><X size={ICON_SIZE.body} /></GhostButton>}
      </div>
      <div className="quiz-calc-display" aria-live="polite">
        <div className="quiz-calc-expr">{expr || "0"}</div>
        {result !== "" && <div className="quiz-calc-result">= {result}</div>}
      </div>
      <div className="quiz-calc-keys">
        {KEYS.flat().map((k) => (
          <button
            type="button"
            key={k}
            className={`quiz-calc-key${k === "=" ? " span2 primary" : ""}${/[0-9.]/.test(k) ? "" : " op"}`}
            aria-label={k === "←" ? "Backspace" : k === "C" ? "Clear" : k}
            onClick={() => press(k)}
          >{k}</button>
        ))}
      </div>
    </div>
  );
}
