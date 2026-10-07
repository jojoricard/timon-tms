import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ResourceKind } from '@timon/domain';
import type { ImportCheckJson, ReferenceListsJson } from '@timon/http';
import { Banner, Button, Chip, ChipGroup, type StepState, Steps } from '@timon/ui';
import { useState } from 'react';
import { ApiError, api, ok } from '../api.ts';
import { errorText, useReferenceLists, useRefreshResources } from '../data.ts';
import { fieldLabel, issueSentence, issueText } from '../issues.ts';
import { importTitle, kindSlugs, tabLabel } from '../kinds.ts';
import { inSentence } from '../labels.ts';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import { Breadcrumb } from './section.tsx';

// Same limits as the server: a larger file is refused before it is sent.
const maxBytes = 1_000_000;

/** The columns shown in the preview, by kind; the file may hold more. */
const previewFields: Record<ResourceKind, string[]> = {
  driver: ['lastName', 'firstName', 'employeeNumber', 'document:cpc', 'document:driver-card'],
  'power-unit': [
    'plate',
    'vehicleKind',
    'category',
    'gvwKg',
    'makeModel',
    'document:roadworthiness',
  ],
  trailer: ['plate', 'vehicleKind', 'category', 'gvwKg', 'bodyTypeId', 'document:roadworthiness'],
};

// Free text in the preview; the other columns are codes, figures and dates.
const textFields = new Set(['lastName', 'firstName', 'vehicleKind', 'makeModel', 'bodyTypeId']);

type Problem = { code: string; params?: Record<string, unknown> | undefined };

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

export function ImportPage({ kind }: { kind: ResourceKind }) {
  const navigate = useNavigate();
  const refresh = useRefreshResources();
  const lists = useReferenceLists().data;
  const [file, setFile] = useState<{ name: string; csv: string }>();
  const [problem, setProblem] = useState<Problem>();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const check = useMutation({
    mutationFn: async (csv: string) =>
      ok(await api.imports[':kind'].check.$post({ param: { kind }, json: { csv } })),
    onSuccess: (result) => setProblem(result.problem ?? undefined),
  });

  const run = useMutation({
    mutationFn: async (csv: string) =>
      ok(await api.imports[':kind'].$post({ param: { kind }, json: { csv } })),
    onSuccess: async ({ imported }) => {
      await refresh();
      await navigate({
        to: '/resources/$kind',
        params: { kind: kindSlugs[kind] },
        search: { imported },
      });
    },
  });

  const choose = async (chosen: File | undefined) => {
    check.reset();
    run.reset();
    setProblem(undefined);
    setFile(undefined);
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
      ? (run.error.body as { check: ImportCheckJson }).check
      : undefined;
  const result = refused ?? check.data;
  const ready = result?.ready === true && !problem;
  const steps: { label: string; state: StepState }[] = [
    { label: m.step_template(), state: 'done' },
    { label: m.step_upload(), state: file ? 'done' : 'current' },
    { label: m.step_check(), state: result ? (ready ? 'done' : 'current') : 'todo' },
    { label: m.step_import(), state: ready ? 'current' : 'todo' },
  ];
  const rows = (result?.rows ?? []).filter((r) => !onlyErrors || r.issues.length > 0);
  const errorLines = (result?.rows ?? []).filter((r) => r.issues.length > 0);
  const generalError = (check.error ?? (refused ? null : run.error)) as unknown;

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb>
          <li>
            <Link to="/resources/$kind" params={{ kind: 'drivers' }}>
              {m.resources_title()}
            </Link>
          </li>
          <li>
            <Link to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
              {tabLabel[kind]()}
            </Link>
          </li>
          <li aria-current="page">{m.import()}</li>
        </Breadcrumb>
        <div className="page-title-row">
          <div className="page-title">
            <h1>{importTitle[kind]()}</h1>
          </div>
          <div className="page-actions">
            <Link className="t-button" to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
              {m.action_cancel()}
            </Link>
            <Button
              variant="primary"
              disabled={!ready || !file || run.isPending}
              onClick={() => file && run.mutate(file.csv)}
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

          {problem ? <Banner tone="conflict">{problemText(problem, lists)}</Banner> : null}
          {generalError ? <Banner tone="conflict">{errorText(generalError)}</Banner> : null}
          {result && !problem ? (
            ready ? (
              <Banner tone="ok">{m.import_ready()}</Banner>
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
                <p>{m.import_errors_text()}</p>
              </Banner>
            )
          ) : null}

          {result && result.rows.length > 0 ? (
            <>
              <ChipGroup label={m.lines_label()}>
                <Chip
                  pressed={!onlyErrors}
                  onClick={() => setOnlyErrors(false)}
                  count={result.rows.length}
                >
                  {m.filter_all_lines()}
                </Chip>
                <Chip
                  pressed={onlyErrors}
                  onClick={() => setOnlyErrors(true)}
                  count={errorLines.length}
                >
                  {m.filter_with_errors()}
                </Chip>
              </ChipGroup>
              <div className="t-table-frame">
                <table className="t-table">
                  <caption className="t-visually-hidden">
                    {m.import_caption({ file: file?.name ?? '' })}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{m.col_line()}</th>
                      {previewFields[kind].map((f) => (
                        <th key={f} scope="col">
                          {fieldLabel(f, lists)}
                        </th>
                      ))}
                      <th scope="col">{m.col_check()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.line} data-tone={row.issues.length > 0 ? 'conflict' : undefined}>
                        <th scope="row" className="t-mono">
                          {row.line}
                        </th>
                        {previewFields[kind].map((f) => (
                          <td key={f} className={textFields.has(f) ? undefined : 't-mono'}>
                            {row.cells[f] ?? ''}
                          </td>
                        ))}
                        <td>
                          {row.issues.length === 0 ? (
                            <span className="check-ready">✓ {m.check_ready()}</span>
                          ) : (
                            row.issues.map((issue) => (
                              <span
                                key={`${issue.field}-${issue.code}`}
                                className="t-field-error check-issue"
                              >
                                ✕ {issueSentence(issue, lists)}
                              </span>
                            ))
                          )}
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
                <dt>{m.summary_lines()}</dt>
                <dd>{result.summary.lines}</dd>
                <dt>{m.summary_valid()}</dt>
                <dd>{result.summary.valid}</dd>
                <dt>{m.summary_invalid()}</dt>
                <dd>{result.summary.invalid}</dd>
                <dt>{m.summary_already()}</dt>
                <dd>{result.summary.alreadyInTimon}</dd>
                <dt>{m.summary_documents()}</dt>
                <dd>{result.summary.documents}</dd>
              </dl>
            </section>
          ) : null}
          <section className="t-panel">
            <h2>{m.rules_title()}</h2>
            <ul className="rules">
              <li>{m.rule_all_or_nothing()}</li>
              <li>{m.rule_plates()}</li>
              <li>{m.rule_kinds()}</li>
              <li>{m.rule_formats()}</li>
            </ul>
          </section>
          <section className="t-panel">
            <h2>{m.template_title()}</h2>
            <p>{m.template_text()}</p>
            <a
              className="t-button"
              href={`/api/imports/${kind}/template?lang=${getLocale()}`}
              download={`timon-${kindSlugs[kind]}-${getLocale()}.csv`}
            >
              {m.download_template()}
            </a>
          </section>
        </aside>
      </div>
    </div>
  );
}
