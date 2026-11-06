import { ConfirmDialog } from '@timon/ui';
import { type ReactNode, useState } from 'react';
import { m } from './paraglide/messages.js';

/** What to ask, and what to do once confirmed. */
export type ConfirmRequest = {
  readonly title: string;
  readonly text: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
};

/**
 * Asks before archiving or deleting (SPEC-001 rule 11, SPEC-002 rule 6, SPEC-003 rule 6), in
 * the product's language. `ask` opens the dialog; `dialog` goes in the page.
 */
export function useConfirm(): { ask: (request: ConfirmRequest) => void; dialog: ReactNode } {
  const [request, setRequest] = useState<ConfirmRequest>();
  return {
    ask: setRequest,
    dialog: request ? (
      <ConfirmDialog
        title={request.title}
        text={request.text}
        confirmLabel={request.confirmLabel}
        cancelLabel={m.action_cancel()}
        onCancel={() => setRequest(undefined)}
        onConfirm={() => {
          setRequest(undefined);
          request.onConfirm();
        }}
      />
    ) : null,
  };
}
