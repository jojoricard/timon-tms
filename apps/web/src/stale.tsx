import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@timon/ui';
import { Fragment, type ReactNode, useSyncExternalStore } from 'react';
import { m } from './paraglide/messages.js';

// ADR-005: a write refused because the record changed since it was read (412) is answered in one
// place for every screen, the forms and the one-click actions alike: a dialog offers to reload the
// record or to stay on the page, to copy what was typed first.

type State = { readonly open: boolean; readonly generation: number };

let state: State = { open: false, generation: 0 };
const listeners = new Set<() => void>();

function update(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

/** Opens the dialog; `useSubmit` calls it on a 412. */
export function reportStale() {
  if (!state.open) update({ ...state, open: true });
}

/**
 * The page, remounted when the person reloads: every form then starts again from the record the
 * API now holds. Remounting is no navigation, so the leave guard does not ask.
 */
export function Reloadable({ children }: { children: ReactNode }) {
  const { generation } = useSyncExternalStore(subscribe, snapshot);
  return <Fragment key={generation}>{children}</Fragment>;
}

/** The dialog, in the product's language; Escape stays on the page, as the safe choice. */
export function StaleDialog() {
  const queryClient = useQueryClient();
  const { open, generation } = useSyncExternalStore(subscribe, snapshot);
  if (!open) return null;
  return (
    <ConfirmDialog
      title={m.stale_title()}
      text={m.stale_text()}
      cancelLabel={m.action_stay_on_this_page()}
      confirmLabel={m.action_reload()}
      onCancel={() => update({ open: false, generation })}
      onConfirm={() => {
        // The cache goes first, so that the remounted page reads the records afresh.
        queryClient.removeQueries();
        update({ open: false, generation: generation + 1 });
      }}
    />
  );
}
