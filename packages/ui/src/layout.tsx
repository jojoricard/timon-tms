import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * Breadcrumb, title and actions. The title takes the room it needs; when the actions no longer
 * fit beside it, they wrap under it instead of leaving the screen.
 */
export function PageHeader({
  breadcrumb,
  lead,
  title,
  subtitle,
  badges,
  actions,
  children,
}: {
  breadcrumb?: ReactNode;
  /** Before the title, such as a plate or a code. */
  lead?: ReactNode;
  title: ReactNode;
  /** Under the title. An empty string keeps its line while the text loads. */
  subtitle?: ReactNode;
  /** After the title, such as status badges. */
  badges?: ReactNode;
  actions?: ReactNode;
  /** Under the title row, such as tabs or steps. */
  children?: ReactNode;
}) {
  return (
    <header className="t-page-header">
      {breadcrumb}
      <div className="t-page-title-row">
        <div className="t-page-title">
          {lead}
          <div className="t-page-heading">
            <div className="t-page-heading-line">
              <h1>{title}</h1>
              {badges}
            </div>
            {subtitle || subtitle === '' ? (
              <span className="t-page-subtitle">{subtitle}</span>
            ) : null}
          </div>
        </div>
        {actions ? <div className="t-actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

type Breakpoint = 'medium' | 'wide';

/**
 * Cards side by side: one grid, so cards in a row share their height and rows share their column
 * edges. Below the breakpoint the cards stack in one column. A track in `fr` never grows past its
 * share because of its content.
 */
export function CardRow({
  columns,
  stackBelow = 'medium',
  className,
  style,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** One track per column, such as `['2fr', '3fr']` or `['1fr', '360px']`. */
  columns: readonly string[];
  stackBelow?: Breakpoint;
}) {
  const tracks = columns.map((t) => (t.endsWith('fr') ? `minmax(0, ${t})` : t)).join(' ');
  return (
    <div
      {...props}
      className={className ? `t-card-row ${className}` : 't-card-row'}
      data-stack={stackBelow}
      style={{ ...style, '--card-row-columns': tracks } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Cards one under the other in a card row column; the last one grows to the row's height. */
export function CardStack({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={className ? `t-card-stack ${className}` : 't-card-stack'}>
      {children}
    </div>
  );
}

/**
 * Fields in four, two or one columns, from the width of the card around it (container query).
 * A child with `t-span-2` takes two columns, `t-span-all` the whole row; a `t-form-actions` child
 * sits at the end of a four-column row, or on its own line when the row wraps.
 */
export function FormGrid({
  columns = 2,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { columns?: 2 | 4 }) {
  return (
    <div
      {...props}
      className={className ? `t-form-grid ${className}` : 't-form-grid'}
      data-columns={columns}
    >
      {children}
    </div>
  );
}

/**
 * Whether a sideways scroller has more to show before its start and after its end. Checked after
 * every render, on scroll, and when the scroller or its content changes size.
 */
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const before = el.scrollLeft > 0;
    const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.before === before && e.after === after ? e : { before, after }));
  }, []);
  useLayoutEffect(update);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update]);
  return { ref, edges, update };
}

/**
 * A table that scrolls sideways inside its frame instead of widening the page. The first column
 * stays in place; once scrolled, its edge casts a shadow over the columns passing under it. While
 * more columns lie past the trailing edge, that edge is shaded too.
 */
export function TableFrame({
  actions = false,
  children,
}: {
  /** The last column holds the actions of the row: it stays in place while the row scrolls. */
  actions?: boolean;
  children: ReactNode;
}) {
  const { ref, edges, update } = useScrollEdges<HTMLDivElement>();
  return (
    <div
      className="t-table-frame"
      data-actions={actions || undefined}
      data-scrolled={edges.before || undefined}
      data-more={edges.after || undefined}
    >
      <div ref={ref} className="t-table-scroll" onScroll={update}>
        {children}
      </div>
    </div>
  );
}

/**
 * Navigation tabs, the current one marked with `aria-current="page"` by the caller. They scroll
 * sideways when they do not fit, with a shade on each edge that has more tabs behind it, and the
 * current tab is brought into view.
 */
export function Tabs({ label, children }: { label: string; children: ReactNode }) {
  const { ref, edges, update } = useScrollEdges<HTMLUListElement>();
  // Brought into view once per current tab and content width: counts and fonts that arrive later
  // widen the tabs, but a tab the user scrolled away from is left where it is.
  const shown = useRef<{ tab: Element; width: number } | null>(null);
  const reveal = useCallback(() => {
    const list = ref.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    if (shown.current?.tab === current && shown.current.width === list.scrollWidth) return;
    shown.current = { tab: current, width: list.scrollWidth };
    const start = current.offsetLeft;
    const end = start + current.offsetWidth;
    if (start < list.scrollLeft) list.scrollLeft = start;
    else if (end > list.scrollLeft + list.clientWidth) list.scrollLeft = end - list.clientWidth;
    update();
  }, [ref, update]);
  useLayoutEffect(reveal);
  useEffect(() => {
    document.fonts?.ready.then(reveal);
  }, [reveal]);
  return (
    <nav
      aria-label={label}
      className="t-tabs-frame"
      data-scrolled={edges.before || undefined}
      data-more={edges.after || undefined}
    >
      <ul ref={ref} className="t-tabs" onScroll={update}>
        {children}
      </ul>
    </nav>
  );
}
