import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './button.tsx';

const focusable =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: the page behind is inert, Tab and Shift+Tab stay inside, Escape closes it.
 * Closing, by Escape or by the page, calls `onClose`; the page removes the dialog then.
 */
export function Dialog({
  title,
  description,
  size = 'medium',
  alert = false,
  onClose,
  children,
}: {
  title: ReactNode;
  /** A sentence under the title, read with it when the dialog opens. */
  description?: ReactNode;
  size?: 'small' | 'medium' | 'large';
  /** A question that interrupts the person, such as a confirmation. */
  alert?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // The browser keeps the focus out of the inert page, but lets it reach its own toolbar after
  // the last field: the focus wraps around inside the dialog instead.
  const trap = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(focusable) ?? [])];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialog}
      role={alert ? 'alertdialog' : undefined}
      className="t-panel t-dialog"
      data-size={size}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-text` : undefined}
      onClose={onClose}
      onKeyDown={trap}
    >
      <h2 id={`${id}-title`} className="t-dialog-title">
        {title}
      </h2>
      {description ? (
        <p id={`${id}-text`} className="t-dialog-text">
          {description}
        </p>
      ) : null}
      {children}
    </dialog>
  );
}

/**
 * Asks before an action that is hard to undo. The safe choice has the focus when it opens;
 * Escape is the safe choice too.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: ReactNode;
  text: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} description={text} size="small" alert onClose={onCancel}>
      <div className="t-actions t-dialog-actions">
        <Button autoFocus onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
