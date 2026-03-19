/** True if element is no longer in the document (e.g. user navigated away during await). */
export function isDetached(el) {
  return !el || !el.isConnected;
}
