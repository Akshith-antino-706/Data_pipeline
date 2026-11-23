/**
 * Human label for a journey node id. Ids are stored as "node_1", "node-12" or "n3";
 * people should read "Node 1". Anything that isn't that shape is returned unchanged.
 */
export function nodeLabel(id: string | number | null | undefined): string {
  if (id == null || id === '') return '';
  const s = String(id).trim();
  const m = /^(?:node|n)[_\s-]*(\d+)$/i.exec(s);
  return m ? `Node ${m[1]}` : s;
}
