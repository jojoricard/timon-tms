import { Link } from '@tanstack/react-router';

/**
 * A sentence naming another order, its number a link to it: "Split: the new order is
 * CMD-2026-000423." The sentence is translated whole; the number is found in it.
 */
export function NumberLink({ text, number, id }: { text: string; number: string; id: string }) {
  const at = text.indexOf(number);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link to="/orders/$id" params={{ id }} search={{}}>
        {number}
      </Link>
      {text.slice(at + number.length)}
    </>
  );
}
