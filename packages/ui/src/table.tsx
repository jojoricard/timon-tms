/**
 * Column widths in percent of the table. A table that declares them is laid out from them alone,
 * not from its content, so tables of the same kind keep their columns in the same place from one
 * page to the next, and filtering a list never moves a column.
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
