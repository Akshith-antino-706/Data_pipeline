// Node >= 25 ships its own (disabled) Web Storage globals whose getters return undefined,
// and they shadow jsdom's. Under the jsdom environment, put jsdom's storage back.
interface JsdomHandle { window: { localStorage: Storage; sessionStorage: Storage } }
const handle = (globalThis as { jsdom?: JsdomHandle }).jsdom;
if (handle) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const store = handle.window[key];
    Object.defineProperty(globalThis, key, { value: store, configurable: true, writable: true });
  }
}
