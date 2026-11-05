/**
 * Column widths in percent of the table. While the content fits them, tables of the same kind keep
 * their columns in the same place from one page to the next. Content that cannot wrap, such as a
 * code or a date, sets the least width of its column, so it never runs into the next one.
 */
export function Columns({ widths }: { widths: readonly number[] }) {
  return (
    <colgroup>
      {widths.map((width, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and never reordered.
        <col key={index} style={{ width: `${width}%` }} />
      ))}
    </colgroup>
  );
}
