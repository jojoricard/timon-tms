import { parseTime, weekdays } from '@timon/domain';
import type { IssueJson, OpeningJson } from '@timon/http';
import { Button } from '@timon/ui';
import { capitalise } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { formatTime, weekdayName } from './customer-labels.ts';

export type RangeDraft = { key: string; start: string; end: string };
export type WeekDraft = Record<number, RangeDraft[]>;

let next = 0;
const key = () => `range-${++next}`;

export function toWeekDraft(openings: readonly OpeningJson[]): WeekDraft {
  const week: WeekDraft = {};
  for (const day of weekdays) {
    week[day] = openings
      .filter((o) => o.weekday === day)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((o) => ({ key: key(), start: formatTime(o.startMinute), end: formatTime(o.endMinute) }));
  }
  return week;
}

/**
 * A time that cannot be read, on the first range of each day that has one, as typed: the error
 * says "25:00", not the range it would make.
 */
export function weekIssues(week: WeekDraft): IssueJson[] {
  return weekdays.flatMap((weekday) => {
    const ranges = week[weekday] ?? [];
    const value = ranges
      .flatMap((r) => [r.start, r.end])
      .find((time) => parseTime(time) === undefined);
    return value === undefined
      ? []
      : [{ field: `openings.${weekday}`, code: 'time-invalid', params: { weekday, value } }];
  });
}

/** The ranges as minutes; an unreadable time becomes -1, which the domain then refuses. */
export function fromWeekDraft(week: WeekDraft): OpeningJson[] {
  return weekdays.flatMap((weekday) =>
    (week[weekday] ?? []).map((r) => ({
      weekday,
      startMinute: parseTime(r.start) ?? -1,
      endMinute: parseTime(r.end) ?? -1,
    })),
  );
}

const errorId = (weekday: number) => `opening-error-${weekday}`;

/**
 * Whether one time of a range is the one in error: the time that cannot be read, or both times
 * of a range that can be read but is wrong.
 */
function invalidTime(start: string, end: string, which: 'start' | 'end'): boolean | undefined {
  const unreadable = { start: parseTime(start) === undefined, end: parseTime(end) === undefined };
  if (unreadable.start || unreadable.end) return unreadable[which] || undefined;
  return true;
}

/**
 * The week as rows: each day shows its ranges on a 24-hour bar and as editable times. Times are
 * typed as text, HH:MM, so that 24:00 can end a day.
 */
export function OpeningHoursEditor({
  week,
  onChange,
  errorFor,
}: {
  week: WeekDraft;
  onChange: (week: WeekDraft) => void;
  errorFor: (weekday: number) => string | undefined;
}) {
  const update = (weekday: number, ranges: RangeDraft[]) =>
    onChange({ ...week, [weekday]: ranges });
  return (
    <div className="week">
      {weekdays.map((weekday) => {
        const day = capitalise(weekdayName(weekday));
        const ranges = week[weekday] ?? [];
        const error = errorFor(weekday);
        return (
          <fieldset key={weekday} className="week-day" data-invalid={error ? 'true' : undefined}>
            <legend>{day}</legend>
            <div className="week-bar" aria-hidden="true">
              {ranges.map((r) => {
                const start = parseTime(r.start);
                const end = parseTime(r.end);
                if (start === undefined || end === undefined || end <= start) return null;
                return (
                  <span
                    key={r.key}
                    style={{
                      left: `${(start / 1440) * 100}%`,
                      width: `${((end - start) / 1440) * 100}%`,
                    }}
                  />
                );
              })}
            </div>
            <div className="week-ranges">
              {ranges.length === 0 ? <span className="muted">{m.closed()}</span> : null}
              {ranges.map((r, index) => (
                <span key={r.key} className="week-range">
                  <input
                    className="t-mono time-input"
                    aria-label={m.range_from({ day })}
                    aria-invalid={error ? invalidTime(r.start, r.end, 'start') : undefined}
                    aria-describedby={error ? errorId(weekday) : undefined}
                    value={r.start}
                    placeholder="06:00"
                    onChange={(e) =>
                      update(
                        weekday,
                        ranges.map((x, i) => (i === index ? { ...x, start: e.target.value } : x)),
                      )
                    }
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    className="t-mono time-input"
                    aria-label={m.range_to({ day })}
                    aria-invalid={error ? invalidTime(r.start, r.end, 'end') : undefined}
                    aria-describedby={error ? errorId(weekday) : undefined}
                    value={r.end}
                    placeholder="12:00"
                    onChange={(e) =>
                      update(
                        weekday,
                        ranges.map((x, i) => (i === index ? { ...x, end: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    variant="link"
                    aria-label={m.action_remove_range({ day, range: `${r.start}–${r.end}` })}
                    onClick={() =>
                      update(
                        weekday,
                        ranges.filter((_, i) => i !== index),
                      )
                    }
                  >
                    ✕
                  </Button>
                </span>
              ))}
              <Button
                variant="link"
                aria-label={m.action_add_range_on({ day })}
                onClick={() =>
                  update(weekday, [
                    ...ranges,
                    ranges.length === 0
                      ? { key: key(), start: '08:00', end: '12:00' }
                      : { key: key(), start: '14:00', end: '17:00' },
                  ])
                }
              >
                + {m.action_add_range()}
              </Button>
            </div>
            {error ? (
              <p className="t-field-error week-error" id={errorId(weekday)}>
                {error}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <p className="t-field-hint">{m.time_format_hint()}</p>
    </div>
  );
}
