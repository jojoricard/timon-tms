import type { IssueJson, ReferenceListsJson } from '@timon/http';
import { Banner } from '@timon/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';
import { type FieldLabels, issueSentence } from './issues.ts';

/** An issue on `field` belongs to the input `name` when it is that input or a part of it. */
const within = (field: string, name: string) => field === name || field.startsWith(`${name}.`);

/**
 * Moves the focus to the first invalid input of the form, in the order of the page. A group of
 * radio buttons takes it on its checked option, or its first.
 */
export function focusFirstInvalid(root: ParentNode | null | undefined) {
  const invalid = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!invalid) return;
  const target = invalid.matches('input, select, textarea, button')
    ? invalid
    : (invalid.querySelector<HTMLElement>('input:checked') ??
      invalid.querySelector<HTMLElement>('input, select, textarea, button'));
  target?.focus();
}

/**
 * The issues of a form, one pattern for every form. Each issue shows under its field: those of
 * the domain's rules as soon as the field is left changed, or all at once on the first submit;
 * those the API returns until the field changes. A refused submit moves the focus to the first
 * invalid field. Only a refusal that names no field is left for the banner.
 */
export function useFormIssues({
  issues,
  placed,
  lists,
  labels,
}: {
  /** The domain's rules on the form as it stands. */
  issues: readonly IssueJson[];
  /** The inputs the form shows an error under; an issue on any other goes to the banner. */
  placed: readonly string[];
  lists?: ReferenceListsJson | undefined;
  /** Labels of this form that differ from the shared ones, e.g. `name` for a customer. */
  labels?: FieldLabels;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [server, setServer] = useState<readonly IssueJson[]>([]);
  const [focusRequest, setFocusRequest] = useState(0);

  // After the render that shows the errors, so that the fields carry aria-invalid.
  useEffect(() => {
    if (focusRequest > 0) focusFirstInvalid(formRef.current);
  }, [focusRequest]);

  const shown = [
    ...issues.filter((i) => submitted || [...touched].some((name) => within(i.field, name))),
    ...server.filter((s) => !issues.some((i) => i.field === s.field)),
  ];

  const issueFor = (field: string) => shown.find((i) => i.field === field);
  const isPlaced = (field: string) => placed.some((name) => within(field, name));

  return {
    formRef,
    /** The issues shown now. */
    shown,
    /** The issues of the API on no input of the form, for the banner. */
    unplaced: server.filter((i) => !isPlaced(i.field)),
    issueFor,
    /** The error under a field, as a sentence. */
    errorFor: (field: string) => {
      const issue = issueFor(field);
      return issue ? issueSentence(issue, lists, labels) : undefined;
    },
    /** An input changed: its rules show from now on, and the API's issue on it goes. */
    touch: (name: string) => {
      setTouched((current) => (current.has(name) ? current : new Set(current).add(name)));
      setServer((current) => current.filter((i) => !within(i.field, name)));
    },
    /** Every issue of the API goes, when the inputs they named moved, as a removed row. */
    forgetServer: () => setServer([]),
    /** The API's issues on the form, and the errors it gave the fields, go: a new start. */
    clear: () => {
      setServer([]);
      setSubmitted(false);
      setTouched(new Set());
    },
    /** On submit: true when the form may be sent; otherwise its errors show and take the focus. */
    submit: (): boolean => {
      setSubmitted(true);
      if (issues.length === 0) return true;
      setFocusRequest((n) => n + 1);
      return false;
    },
    /** On a refused write: an `invalid` answer shows its issues under their fields, with focus. */
    refused: (error: unknown) => {
      if (!(error instanceof ApiError) || error.code !== 'invalid') return;
      setServer((error.body as { issues?: IssueJson[] } | undefined)?.issues ?? []);
      setFocusRequest((n) => n + 1);
    },
  };
}

export type FormIssues = ReturnType<typeof useFormIssues>;

/**
 * The error a form shows in its banner, if any: not an `invalid` answer, whose issues show by
 * field (and those on no field as `unplaced`), nor one of the codes the form shows by a field.
 */
export function bannerError(error: unknown, fieldCodes: readonly string[] = []): unknown {
  if (!error) return undefined;
  if (error instanceof ApiError && ['invalid', ...fieldCodes].includes(error.code ?? '')) {
    return undefined;
  }
  return error;
}

/** The issues of a refused write that name no input of the form, in the banner. */
export function IssueBanner({
  issues,
  lists,
  labels,
}: {
  issues: readonly IssueJson[];
  lists?: ReferenceListsJson | undefined;
  labels?: FieldLabels;
}) {
  if (issues.length === 0) return null;
  return (
    <Banner tone="conflict">
      <ul className="issue-list">
        {issues.map((issue) => (
          <li key={`${issue.field}-${issue.code}`}>{issueSentence(issue, lists, labels)}</li>
        ))}
      </ul>
    </Banner>
  );
}
