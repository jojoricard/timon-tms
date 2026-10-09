import { useMutation } from '@tanstack/react-query';
import type { IssueJson, ReferenceListsJson } from '@timon/http';
import { Banner, Button, Chip, ChipGroup, type StepState, Steps } from '@timon/ui';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../api.ts';
import { errorText } from '../data.ts';
import { fieldLabel, issueSentence, issueText } from '../issues.ts';
import { inSentence } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { Breadcrumb } from '../resources/section.tsx';

// The import screen of SPEC-001, shared by resources, customers and sites: template, upload,
// check, import. Each caller says how to check and import, and what to show.

/** Same limit as the server: a larger file is refused before it is sent. */
const maxBytes = 1_000_000;

type Problem = { code: string; params?: Record<string, unknown> | undefined };

export type ImportRowLike = {
  readonly line: number;
  readonly cells: Readonly<Record<string, string>>;
  readonly issues: readonly IssueJson[];
};

export type ImportCheckLike<Row extends ImportRowLike> = {
  readonly problem: Problem | null;
  readonly rows: readonly Row[];
  readonly summary: { readonly lines: number };
  readonly ready: boolean;
};

export type PreviewColumn<Row> = {
  readonly header: string;
  /** Codes, figures and dates are set in the monospaced face. */
  readonly mono?: boolean;
  readonly cell: (row: Row) => ReactNode;
};

/** A preview column showing a cell of the file as typed. */
export function cellColumn<Row extends ImportRowLike>(
  field: string,
  lists?: ReferenceListsJson,
  mono = true,
): PreviewColumn<Row> {
  return { header: fieldLabel(field, lists), mono, cell: (row) => row.cells[field] ?? '' };
}

function problemText(problem: Problem, lists: ReferenceListsJson | undefined): string {
  const params = problem.params ?? {};
  switch (problem.code) {
    case 'too-large':
      return m.problem_too_large({ max: Number(params.maxBytes ?? maxBytes) / 1_000_000 });
    case 'too-many-lines':
      return m.problem_too_many_lines({ max: Number(params.maxLines ?? 2000) });
    case 'missing-columns':
      return m.problem_missing_columns({
        columns: ((params.fields as string[]) ?? []).map((f) => fieldLabel(f, lists)).join(', '),
      });
    default:
      return m.problem_empty();
  }
}

export function ImportScreen<Row extends ImportRowLike, Check extends ImportCheckLike<Row>>({
  breadcrumb,
  title,
  cancel,
  checkLabel = m.step_check(),
  lists,
  check: checkFile,
  run: runImport,
  columns,
  filters = [],
  summary,
  rules,
  templates,
  templateText = m.template_text(),
  readyText = m.import_ready(),
  errorsText = m.import_errors_text(),
  rowNote,
}: {
  breadcrumb: ReactNode;
  title: string;
  /** The link back, with the same look as a button. */
  cancel: ReactNode;
  checkLabel?: string;
  lists?: ReferenceListsJson | undefined;
  check: (csv: string) => Promise<Check>;
  /** Imports; a refusal throws an ApiError whose body holds a fresh check. */
  run: (csv: string, check: Check) => Promise<void>;
  columns: readonly PreviewColumn<Row>[];
  /** Filters besides "all lines" and "with errors". */
  filters?: readonly { label: string; test: (row: Row) => boolean }[];
  summary: (check: Check) => readonly { label: string; value: number }[];
  rules: readonly string[];
  templates: readonly { href: string; download: string; label: string }[];
  templateText?: string;
  readyText?: string;
  errorsText?: string;
  /** What the check column says of a valid line, when there is more than "ready". */
  rowNote?: (row: Row) => ReactNode;
}) {
  const [file, setFile] = useState<{ name: string; csv: string }>();
  const [problem, setProblem] = useState<Problem>();
  const [filter, setFilter] = useState<number | 'all' | 'errors'>('all');

  const check = useMutation({
    mutationFn: checkFile,
    onSuccess: (result) => setProblem(result.problem ?? undefined),
  });
  const run = useMutation({
    mutationFn: ({ csv, check: current }: { csv: string; check: Check }) => runImport(csv, current),
  });

  const choose = async (chosen: File | undefined) => {
    check.reset();
    run.reset();
    setProblem(undefined);
    setFile(undefined);
    setFilter('all');
    if (!chosen) return;
    if (chosen.size > maxBytes) {
      setProblem({ code: 'too-large', params: { maxBytes } });
      return;
    }
    const csv = await chosen.text();
    setFile({ name: chosen.name, csv });
    check.mutate(csv);
  };

  // A refused import answers with a new check, as fresh as the database.
  const refused =
    run.error instanceof ApiError && run.error.code === 'import-invalid'
      ? (run.error.body as { check: Check }).check
      : undefined;
  const result = refused ?? check.data;
  const ready = result?.ready === true && !problem;
  const steps: { label: string; state: StepState }[] = [
    { label: m.step_template(), state: 'done' },
    { label: m.step_upload(), state: file ? 'done' : 'current' },
    { label: checkLabel, state: result ? (ready ? 'done' : 'current') : file ? 'current' : 'todo' },
    { label: m.step_import(), state: ready ? 'current' : 'todo' },
  ];
  const allRows = result?.rows ?? [];
  const errorLines = allRows.filter((r) => r.issues.length > 0);
  const shown = allRows.filter((r) =>
    filter === 'all'
      ? true
      : filter === 'errors'
        ? r.issues.length > 0
        : (filters[filter]?.test(r) ?? true),
  );
  const generalError = (check.error ?? (refused ? null : run.error)) as unknown;

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb>{breadcrumb}</Breadcrumb>
        <div className="page-title-row">
          <div className="page-title">
            <h1>{title}</h1>
          </div>
          <div className="page-actions">
            {cancel}
            <Button
              variant="primary"
              disabled={!ready || !file || !result || run.isPending}
              onClick={() => file && result && run.mutate({ csv: file.csv, check: result })}
            >
              {m.action_import_all({ count: result?.summary.lines ?? 0 })}
            </Button>
          </div>
        </div>
        <Steps steps={steps} />
      </header>

      <div className="import-layout">
        <div className="import-main">
          <div className="upload">
            <label className="t-field">
              <span className="t-field-label">
                {file ? m.upload_corrected() : m.upload_label()}
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-describedby="upload-hint"
                onChange={(e) => choose(e.target.files?.[0])}
              />
              <span className="t-field-hint" id="upload-hint">
                {m.upload_hint()}
              </span>
            </label>
          </div>

          {check.isPending ? <p role="status">{m.loading()}</p> : null}
          {problem ? <Banner tone="conflict">{problemText(problem, lists)}</Banner> : null}
          {generalError ? <Banner tone="conflict">{errorText(generalError)}</Banner> : null}
          {result && !problem ? (
            ready ? (
              <Banner tone="ok">{readyText}</Banner>
            ) : (
              <Banner tone="conflict">
                <p className="banner-title">{m.import_errors({ count: errorLines.length })}</p>
                <ul className="issue-list">
                  {errorLines.flatMap((row) =>
                    row.issues.map((issue) => (
                      <li key={`${row.line}-${issue.field}-${issue.code}`}>
                        {m.line_issue({
                          line: row.line,
                          issue: inSentence(issueText(issue, lists)),
                        })}
                      </li>
                    )),
                  )}
                </ul>
                <p>{errorsText}</p>
              </Banner>
            )
          ) : null}

          {result && allRows.length > 0 ? (
            <>
              <ChipGroup label={m.lines_label()}>
                <Chip
                  pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                  count={allRows.length}
                >
                  {m.filter_all_lines()}
                </Chip>
                <Chip
                  pressed={filter === 'errors'}
                  onClick={() => setFilter('errors')}
                  count={errorLines.length}
                >
                  {m.filter_with_errors()}
                </Chip>
                {filters.map((f, index) => (
                  <Chip
                    key={f.label}
                    pressed={filter === index}
                    onClick={() => setFilter(index)}
                    count={allRows.filter(f.test).length}
                  >
                    {f.label}
                  </Chip>
                ))}
              </ChipGroup>
              <div className="t-table-frame">
                <table className="t-table">
                  <caption className="t-visually-hidden">
                    {m.import_caption({ file: file?.name ?? '' })}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{m.col_line()}</th>
                      {columns.map((c) => (
                        <th key={c.header} scope="col">
                          {c.header}
                        </th>
                      ))}
                      <th scope="col">{m.col_check()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.line} data-tone={row.issues.length > 0 ? 'conflict' : undefined}>
                        <th scope="row" className="t-mono">
                          {row.line}
                        </th>
                        {columns.map((c) => (
                          <td key={c.header} className={c.mono ? 't-mono' : undefined}>
                            {c.cell(row)}
                          </td>
                        ))}
                        <td>
                          {row.issues.length === 0
                            ? (rowNote?.(row) ?? (
                                <span className="check-ready">✓ {m.check_ready()}</span>
                              ))
                            : row.issues.map((issue) => (
                                <span
                                  key={`${issue.field}-${issue.code}`}
                                  className="t-field-error check-issue"
                                >
                                  ✕ {issueSentence(issue, lists)}
                                </span>
                              ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        <aside className="import-side">
          {result ? (
            <section className="t-panel">
              <h2>{m.file_title()}</h2>
              <p className="t-mono">{file?.name}</p>
              <dl className="summary">
                {summary(result).map((s) => (
                  <div key={s.label} className="summary-row">
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          <section className="t-panel">
            <h2>{m.rules_title()}</h2>
            <ul className="rules">
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
          <section className="t-panel">
            <h2>{m.template_title()}</h2>
            <p>{templateText}</p>
            <div className="template-links">
              {templates.map((t) => (
                <a key={t.href} className="t-button" href={t.href} download={t.download}>
                  {t.label}
                </a>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
