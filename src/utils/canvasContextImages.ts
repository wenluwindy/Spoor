import type { CanvasNode, Edge } from '../db';

const LOG_PREFIX = '[Scribe AI]';

/** Max images attached to one Agent API call (plan default). */
export const MAX_AGENT_CONTEXT_IMAGES = 4;

/** Skip data URLs longer than this (~9MB raw upper bound for base64 payload). */
export const MAX_DATA_URL_CHARS = 12_000_000;

function isImageDataUrl(s: string): boolean {
  return s.startsWith('data:image/') && s.includes('base64,');
}

/** Neighbor image nodes reachable from context note or agent card (undirected edges). */
export function collectAgentContextImagePayload(
  contextNodeId: string,
  agentNodeId: string,
  nodes: CanvasNode[],
  edges: Edge[],
): { nodeIds: string[]; dataUrls: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchorIds = new Set([contextNodeId, agentNodeId]);
  const seen = new Set<string>();

  for (const edge of edges) {
    if (!anchorIds.has(edge.from) && !anchorIds.has(edge.to)) continue;
    const other = anchorIds.has(edge.from) ? edge.to : edge.from;
    if (seen.has(other)) continue;
    const n = byId.get(other);
    if (!n || n.type !== 'image') continue;
    const c = (n.content ?? '').trim();
    if (!isImageDataUrl(c)) continue;
    if (c.length > MAX_DATA_URL_CHARS) {
      console.warn(`${LOG_PREFIX} skip oversized image node ${n.id} (${c.length} chars)`);
      continue;
    }
    seen.add(other);
  }

  const nodeIds = [...seen].sort().slice(0, MAX_AGENT_CONTEXT_IMAGES);
  const dataUrls = nodeIds.map((id) => (byId.get(id)!.content ?? '').trim());
  return { nodeIds, dataUrls };
}

/** Resolve current data URLs for persisted thread image ids (order preserved; missing nodes skipped). */
export function resolveImageDataUrlsFromNodeIds(
  nodeIds: string[] | undefined,
  nodes: CanvasNode[],
): string[] {
  if (!nodeIds?.length) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dataUrls: string[] = [];
  for (const id of nodeIds) {
    const n = byId.get(id);
    if (!n || n.type !== 'image') continue;
    const c = (n.content ?? '').trim();
    if (!isImageDataUrl(c)) continue;
    if (c.length > MAX_DATA_URL_CHARS) {
      console.warn(`${LOG_PREFIX} skip oversized image node ${id} (${c.length} chars)`);
      continue;
    }
    dataUrls.push(c);
  }
  return dataUrls;
}
