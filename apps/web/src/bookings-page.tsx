import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { findOverlaps, type Period, periodOf, Temporal } from '@timon/domain';
import { Banner, Button, Field } from '@timon/ui';
import { type FormEvent, useState } from 'react';
import { ApiError, api, ok } from './api.ts';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';

type Booking = { id: string; resourceId: string; start: string; end: string; label: string };
type Outcome = { tone: 'ok' | 'conflict'; text: string } | undefined;

const kindLabel = {
  driver: m.kind_driver,
  'power-unit': m.kind_power_unit,
  trailer: m.kind_trailer,
} as const;

const timeZone = Temporal.Now.timeZoneId();

/** `datetime-local` value, in the browser's time zone, to an instant. */
function toInstant(local: string) {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone).toInstant();
}

function nextHour(hours: number) {
  const now = Temporal.Now.plainDateTimeISO(timeZone).round({
    smallestUnit: 'hour',
    roundingMode: 'ceil',
  });
  return now.add({ hours }).toString({ smallestUnit: 'minute' });
}

function safePeriod(start: string, end: string): Period | undefined {
  try {
    return periodOf(toInstant(start), toInstant(end));
  } catch {
    return undefined;
  }
}

/** What went wrong, in the interface's language. */
function errorText(error: unknown) {
  if (error instanceof ApiError) {
    return error.code === 'demo-unavailable'
      ? m.demo_unavailable()
      : m.request_failed({ status: error.status });
  }
  return m.server_unreachable();
}

function formatPeriod({ start, end }: Booking) {
  const format = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  return format.formatRange(Date.parse(start), Date.parse(end));
}

export function BookingsPage() {
  const queryClient = useQueryClient();
  const [resourceId, setResourceId] = useState<string>();
  const [label, setLabel] = useState('CMD-2053');
  const [start, setStart] = useState(() => nextHour(1));
  const [end, setEnd] = useState(() => nextHour(5));
  const [outcome, setOutcome] = useState<Outcome>();

  const resources = useQuery({
    queryKey: ['resources'],
    queryFn: async () => ok(await api.resources.$get()),
  });
  const selected = resourceId ?? resources.data?.[0]?.id;

  const bookings = useQuery({
    queryKey: ['bookings', selected],
    enabled: selected !== undefined,
    queryFn: async () =>
      ok(
        await api.resources[':resourceId'].bookings.$get({ param: { resourceId: selected ?? '' } }),
      ),
  });
  const failure = resources.error ?? bookings.error;

  // The same rule as the server, run before sending: the dispatcher sees the conflict first.
  const period = safePeriod(start, end);
  const overlapping =
    selected && period && bookings.data
      ? findOverlaps(
          selected,
          period,
          bookings.data.map((b) => ({ ...b, period: periodOf(b.start, b.end) })),
        )
      : [];

  const book = useMutation({
    mutationFn: async () => {
      if (!selected || !period) return;
      const response = await api.bookings.$post({
        json: {
          resourceId: selected,
          label,
          start: period.start.toString(),
          end: period.end.toString(),
        },
      });
      if (response.status === 409) {
        const { conflicts } = await response.json();
        const labels = conflicts.map((c) => c.label).join(', ');
        setOutcome({ tone: 'conflict', text: m.conflict_refused({ labels }) });
      } else {
        await ok(response);
        setOutcome({ tone: 'ok', text: m.booking_created() });
      }
      await queryClient.invalidateQueries({ queryKey: ['bookings', selected] });
    },
    onError: (error) => setOutcome({ tone: 'conflict', text: errorText(error) }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setOutcome(undefined);
    book.mutate();
  };

  return (
    <div className="page">
      <h1>{m.bookings_title()}</h1>
      <p className="intro">{m.bookings_intro()}</p>

      <form className="booking-form" onSubmit={submit}>
        <Field label={m.field_resource()}>
          <select value={selected ?? ''} onChange={(e) => setResourceId(e.target.value)}>
            {resources.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {kindLabel[r.kind]()}
              </option>
            ))}
          </select>
        </Field>
        <Field label={m.field_label()}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        </Field>
        <Field label={m.field_start()}>
          <input
            type="datetime-local"
            step={3600}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </Field>
        <Field label={m.field_end()}>
          <input
            type="datetime-local"
            step={3600}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" disabled={!selected || !period || book.isPending}>
          {m.action_book()}
        </Button>
      </form>

      {overlapping.length > 0 && (
        <Banner tone="warning">
          {m.warning_overlap({ labels: overlapping.map((b) => b.label).join(', ') })}
        </Banner>
      )}
      {failure && <Banner tone="conflict">{errorText(failure)}</Banner>}
      {outcome && <Banner tone={outcome.tone}>{outcome.text}</Banner>}

      <h2>{m.bookings_heading()}</h2>
      {failure ? null : resources.isPending || bookings.isLoading ? (
        <p>{m.loading()}</p>
      ) : bookings.data?.length ? (
        <ul className="bookings">
          {bookings.data.map((b) => (
            <li key={b.id}>
              <span className="mono">{formatPeriod(b)}</span>
              <span>{b.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{m.bookings_empty()}</p>
      )}
    </div>
  );
}
