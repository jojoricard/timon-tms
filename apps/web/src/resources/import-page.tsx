import { Link, useNavigate } from '@tanstack/react-router';
import type { ResourceKind } from '@timon/domain';
import type { ImportCheckJson } from '@timon/http';
import { api, ok } from '../api.ts';
import { useReferenceLists, useRefreshResources } from '../data.ts';
import { cellColumn, ImportScreen } from '../import/import-screen.tsx';
import { importTitle, kindSlugs, tabLabel } from '../kinds.ts';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';

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

export function ImportPage({ kind }: { kind: ResourceKind }) {
  const navigate = useNavigate();
  const refresh = useRefreshResources();
  const lists = useReferenceLists().data;
  type Row = ImportCheckJson['rows'][number];

  return (
    <ImportScreen<Row, ImportCheckJson>
      breadcrumb={
        <>
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
        </>
      }
      title={importTitle[kind]()}
      cancel={
        <Link className="t-button" to="/resources/$kind" params={{ kind: kindSlugs[kind] }}>
          {m.action_cancel()}
        </Link>
      }
      lists={lists}
      check={async (csv) =>
        ok(await api.imports[':kind'].check.$post({ param: { kind }, json: { csv } }))
      }
      run={async (csv) => {
        const { imported } = await ok(
          await api.imports[':kind'].$post({ param: { kind }, json: { csv } }),
        );
        await refresh();
        await navigate({
          to: '/resources/$kind',
          params: { kind: kindSlugs[kind] },
          search: { imported },
        });
      }}
      columns={previewFields[kind].map((f) => cellColumn<Row>(f, lists, !textFields.has(f)))}
      summary={(check) => [
        { label: m.summary_lines(), value: check.summary.lines },
        { label: m.summary_valid(), value: check.summary.valid },
        { label: m.summary_invalid(), value: check.summary.invalid },
        { label: m.summary_already(), value: check.summary.alreadyInTimon },
        { label: m.summary_documents(), value: check.summary.documents },
      ]}
      rules={[m.rule_all_or_nothing(), m.rule_plates(), m.rule_kinds(), m.rule_formats()]}
      templates={[
        {
          href: `/api/imports/${kind}/template?lang=${getLocale()}`,
          download: `timon-${kindSlugs[kind]}-${getLocale()}.csv`,
          label: m.download_template(),
        },
      ]}
    />
  );
}
