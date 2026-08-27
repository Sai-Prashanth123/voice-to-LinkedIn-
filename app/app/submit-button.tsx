"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that admits it is working.
 *
 * Every action on this page is a server action that crosses to the database and back, so a click is
 * not instant. Without this, the button did nothing visible for a second or more — no press state,
 * no label change, nothing — which reads as a dead control. So the click gets pressed again, and
 * some actions are not safe to run twice.
 *
 * WHY IT TRACKS ITS OWN CLICK
 *
 * `useFormStatus` reports the whole FORM as pending, and several forms here carry three buttons —
 * "Mark ready", "Save, decide later", "Note it". Showing "Working…" on all three would say three
 * things are happening when one is. So each button remembers whether it was the one pressed, and
 * only that one changes its label. The rest still disable, because a second submit while the first
 * is in flight is exactly what should not happen.
 */
export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className,
  formAction,
  name,
  value,
  title,
}: {
  children: React.ReactNode;
  /** What the button says while its own action is in flight. */
  pendingLabel?: string;
  className?: string;
  // deno-lint-ignore no-explicit-any
  formAction?: any;
  name?: string;
  value?: string | number;
  title?: string;
}) {
  const { pending } = useFormStatus();
  const [mine, setMine] = useState(false);

  // Cleared when the form settles, so a second click on the same button works normally.
  useEffect(() => {
    if (!pending && mine) setMine(false);
  }, [pending, mine]);

  return (
    <button
      type="submit"
      className={className}
      formAction={formAction}
      name={name}
      value={value}
      title={title}
      disabled={pending}
      aria-busy={pending && mine}
      data-pending={pending && mine ? "" : undefined}
      onClick={() => setMine(true)}
    >
      {pending && mine ? pendingLabel : children}
    </button>
  );
}
