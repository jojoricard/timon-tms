// Temporal is native in Chrome, Firefox and Node 26, not yet in Safari or Node 24.
// Every module takes it from here, so removing the polyfill is a one-line change.
export { Temporal } from 'temporal-polyfill';
