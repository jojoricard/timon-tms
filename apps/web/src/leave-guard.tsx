import { useBlocker } from '@tanstack/react-router';
import { Button } from '@timon/ui';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { m } from './paraglide/messages.js';

/**
 * Keeps the input of a changed form: leaving it for another screen asks first, in the product's
 * language; closing or reloading the tab asks through the browser, whose words cannot be chosen.
 * Both only while the form has changes. `release` lets a successful save leave without asking,
 * as when a new record opens its own page.
 */
export function useLeaveGuard(dirty: boolean): { release: () => void; dialog: ReactNode } {
  const released = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    released.current = false;
    const ask = (event: BeforeUnloadEvent) => {
      if (released.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);

  const blocker = useBlocker({
    shouldBlockFn: () => !released.current,
    disabled: !dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  return {
    release: () => {
      released.current = true;
    },
    dialog:
      blocker.status === 'blocked' ? (
        <LeaveDialog onStay={blocker.reset} onLeave={blocker.proceed} />
      ) : null,
  };
}

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    // Escape closes the dialog: the person stays on the page, as with "Stay".
    <dialog
      ref={dialog}
      role="alertdialog"
      className="t-panel leave-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onClose={onStay}
    >
      <h2 id={`${id}-title`}>{m.leave_title()}</h2>
      <p id={`${id}-text`}>{m.leave_text()}</p>
      <div className="t-actions dialog-actions">
        {/* The safe choice takes the focus when the dialog opens. */}
        <Button autoFocus onClick={onStay}>
          {m.action_stay()}
        </Button>
        <Button variant="danger" onClick={onLeave}>
          {m.action_leave()}
        </Button>
      </div>
    </dialog>
  );
}

/** Whether a form's state differs from the state it opened with. */
export function changed<T>(initial: T, current: T): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
