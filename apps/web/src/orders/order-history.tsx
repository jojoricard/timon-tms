import type { ReferenceListsJson } from '@timon/http';
import { Banner, CardRow, CardStack } from '@timon/ui';
import { errorText } from '../data.ts';
import { m } from '../paraglide/messages.js';
import { useOrderHistory } from './order-data.ts';
import { eventLines, eventTime, eventTitle } from './order-labels.ts';

/** The history of an order, newest first (SPEC-004, Numbering and history). */
export function OrderHistory({ id, lists }: { id: string; lists: ReferenceListsJson | undefined }) {
  const history = useOrderHistory(id);
  return (
    <CardRow columns={['3fr', '2fr']}>
      <section className="t-panel" aria-labelledby="history-title">
        <div className="panel-title-row">
          <h2 id="history-title">
            {m.tab_history()} <span className="t-field-hint">{m.newest_first()}</span>
          </h2>
        </div>
        {history.error ? <Banner tone="conflict">{errorText(history.error)}</Banner> : null}
        {history.data ? (
          <ol className="history">
            {history.data.events.map((event) => {
              const { time, year } = eventTime(event.at);
              return (
                <li key={event.id} className="history-entry">
                  <span className="history-time t-mono">
                    {time}
                    <span className="t-secondary">{year}</span>
                  </span>
                  <span className="history-dot" aria-hidden="true" />
                  <div className="history-body">
                    <p className="history-title">
                      <strong>{eventTitle(event)}</strong>{' '}
                      <span className="muted">{m.author_not_recorded()}</span>
                    </p>
                    {eventLines(event, lists).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>{m.loading()}</p>
        )}
      </section>
      <CardStack>
        <section className="t-panel" aria-labelledby="recorded-title">
          <h2 id="recorded-title" className="label-heading">
            {m.history_recorded_title()}
          </h2>
          <p>{m.history_recorded_text()}</p>
        </section>
        <section className="t-panel panel-note" aria-labelledby="author-title">
          <h2 id="author-title" className="label-heading">
            {m.history_author_title()}
          </h2>
          <p>{m.history_author_text()}</p>
        </section>
      </CardStack>
    </CardRow>
  );
}
