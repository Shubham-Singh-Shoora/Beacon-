"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="copy-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("error");
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2500);
      }}
      aria-label={state === "copied" ? "Copied" : label}
    >
      <Icon name={state === "copied" ? "check" : "copy"} width="15" height="15" />
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "error" ? "Could not copy" : label}
      </span>
    </button>
  );
}
