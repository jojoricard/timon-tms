import { Link, useNavigate } from '@tanstack/react-router';
import type { LocatedBy } from '@timon/domain';
import type { CustomerImportCheckJson, SiteImportCheckJson } from '@timon/http';
import { api, ok } from '../api.ts';
import { useReferenceLists } from '../data.ts';
import { cellColumn, ImportScreen } from '../import/import-screen.tsx';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import { useRefreshCustomers } from './customer-data.ts';
import { LocatedBadge } from './section.tsx';

const template = (kind: 'customers' | 'sites', label: string) => [
  {
    href: `/api/imports/${kind}/template?lang=${getLocale()}`,
    download: `timon-${kind}-${getLocale()}.csv`,
    label,
  },
];

export function CustomerImportPage() {
  const navigate = useNavigate();
  const refresh = useRefreshCustomers();
  const lists = useReferenceLists().data;
  type Row = CustomerImportCheckJson['rows'][number];

  return (
    <ImportScreen<Row, CustomerImportCheckJson>
      breadcrumb={
        <>
          <li>
            <Link to="/customers">{m.customers_title()}</Link>
          </li>
          <li aria-current="page">{m.import()}</li>
        </>
      }
      title={m.import_title_customers()}
      cancel={
        <Link className="t-button" to="/customers">
          {m.action_cancel()}
        </Link>
      }
      lists={lists}
      check={async (csv) => ok(await api.imports.customers.check.$post({ json: { csv } }))}
      run={async (csv) => {
        const { imported } = await ok(await api.imports.customers.$post({ json: { csv } }));
        await refresh();
        await navigate({ to: '/customers', search: { imported } });
      }}
      columns={[
        cellColumn<Row>('code', lists),
        cellColumn<Row>('name', lists, false),
        cellColumn<Row>('siret', lists),
        cellColumn<Row>('billingCity', lists, false),
        cellColumn<Row>('contacts.0.name', lists, false),
      ]}
      summary={(check) => [
        { label: m.summary_lines(), value: check.summary.lines },
        { label: m.summary_valid(), value: check.summary.valid },
        { label: m.summary_invalid(), value: check.summary.invalid },
        { label: m.summary_already(), value: check.summary.alreadyInTimon },
        { label: m.summary_contacts(), value: check.summary.contacts },
      ]}
      rules={[m.rule_all_or_nothing(), m.rule_codes()]}
      templates={template('customers', m.download_customer_template())}
      templateText={m.template_text_customers()}
    />
  );
}

export function SiteImportPage() {
  const navigate = useNavigate();
  const refresh = useRefreshCustomers();
  const lists = useReferenceLists().data;
  type Row = SiteImportCheckJson['rows'][number];
  const valid = (row: Row) => row.issues.length === 0;

  return (
    <ImportScreen<Row, SiteImportCheckJson>
      breadcrumb={
        <>
          <li>
            <Link to="/customers">{m.customers_title()}</Link>
          </li>
          <li>
            <Link to="/customers/sites">{m.sites_title()}</Link>
          </li>
          <li aria-current="page">{m.import()}</li>
        </>
      }
      title={m.import_title_sites()}
      cancel={
        <Link className="t-button" to="/customers/sites">
          {m.action_cancel()}
        </Link>
      }
      checkLabel={m.step_check_locate()}
      lists={lists}
      check={async (csv) => ok(await api.imports.sites.check.$post({ json: { csv } }))}
      run={async (csv, check) => {
        // The locations found by the preview go back with the file: no second geocoding.
        const locations = check.rows.map((r) => ({
          line: r.line,
          latitude: r.latitude,
          longitude: r.longitude,
          locatedBy: r.locatedBy ?? 'not-located',
        }));
        const result = await ok(await api.imports.sites.$post({ json: { csv, locations } }));
        await refresh();
        await navigate({
          to: '/customers/sites',
          search: { imported: result.imported, notLocated: result.notLocated },
        });
      }}
      columns={[
        cellColumn<Row>('name', lists, false),
        cellColumn<Row>('street1', lists, false),
        cellColumn<Row>('postcode', lists),
        cellColumn<Row>('city', lists, false),
        {
          header: m.col_located_by(),
          cell: (row) =>
            row.locatedBy ? <LocatedBadge locatedBy={row.locatedBy as LocatedBy} /> : '—',
        },
      ]}
      filters={[
        { label: m.filter_not_located(), test: (r) => valid(r) && r.locatedBy === 'not-located' },
        {
          label: m.filter_approximate(),
          test: (r) => valid(r) && (r.locatedBy === 'street' || r.locatedBy === 'city'),
        },
      ]}
      rowNote={(row) =>
        row.locatedBy === 'not-located' ? (
          <span className="check-note">{m.imported_as_not_located()}</span>
        ) : row.nearby.length > 0 ? (
          <span className="check-note">
            {row.nearby[0]?.distanceMetres !== null && row.nearby[0]?.distanceMetres !== undefined
              ? m.nearby_warning({
                  distance: row.nearby[0].distanceMetres,
                  name: row.nearby[0].name,
                })
              : m.nearby_same_street({ name: row.nearby[0]?.name ?? '' })}
          </span>
        ) : undefined
      }
      summary={(check) => [
        { label: m.summary_located_address(), value: check.summary.address },
        { label: m.summary_approximate(), value: check.summary.approximate },
        { label: m.summary_by_hand(), value: check.summary.byHand },
        { label: m.summary_not_located(), value: check.summary.notLocated },
        { label: m.summary_invalid(), value: check.summary.invalid },
        { label: m.summary_near(), value: check.summary.nearExisting },
      ]}
      rules={[m.rule_all_or_nothing(), m.rule_locate(), m.rule_coordinates(), m.rule_hours()]}
      templates={template('sites', m.download_site_template())}
      templateText={m.template_text_sites()}
      readyText={m.site_import_ready()}
      errorsText={m.site_import_errors_text()}
    />
  );
}
