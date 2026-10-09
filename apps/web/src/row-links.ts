/**
 * A table row whose header holds a `.row-link` opens that link wherever the row is clicked. The
 * link stays the way in for the keyboard and screen readers; the row is only a larger target for
 * the pointer. A click on a control inside the row (a button, another link, a field) keeps its own
 * meaning, and so does selecting text in a cell.
 */
export function followRowLinks(root: HTMLElement) {
  root.addEventListener('click', (event) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.isCollapsed === false) return;
    const link = target.closest('.t-table tbody tr')?.querySelector('a.row-link');
    if (!(link instanceof HTMLAnchorElement)) return;
    // The link handles the click as its own, modifier keys included (a new tab with Ctrl).
    link.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }),
    );
  });
}
