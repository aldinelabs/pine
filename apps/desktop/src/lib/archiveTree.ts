/** Folders and files of an archive, built from its entry paths. */
export interface ArchiveNode {
  name: string;
  path: string;
  folder: boolean;
  size: number;
  children: ArchiveNode[];
}

export interface ArchiveRow {
  name: string;
  path: string;
  folder: boolean;
  size: number;
  depth: number;
}

function sortNodes(nodes: ArchiveNode[]): ArchiveNode[] {
  nodes.sort(
    (a, b) =>
      Number(b.folder) - Number(a.folder) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  for (const node of nodes) sortNodes(node.children);
  return nodes;
}

export function archiveTree(
  entries: readonly { path: string; size: number }[],
): ArchiveNode[] {
  const root: ArchiveNode[] = [];
  const folders = new Map<string, ArchiveNode>();
  const folder = (path: string): ArchiveNode[] => {
    if (!path) return root;
    const existing = folders.get(path);
    if (existing) return existing.children;
    const slash = path.lastIndexOf("/");
    const node: ArchiveNode = {
      name: path.slice(slash + 1),
      path,
      folder: true,
      size: 0,
      children: [],
    };
    folders.set(path, node);
    folder(slash < 0 ? "" : path.slice(0, slash)).push(node);
    return node.children;
  };
  for (const entry of entries) {
    const path = entry.path.replace(/^\/+|\/+$/g, "");
    if (!path) continue;
    const slash = path.lastIndexOf("/");
    folder(slash < 0 ? "" : path.slice(0, slash)).push({
      name: path.slice(slash + 1),
      path: entry.path,
      folder: false,
      size: entry.size,
      children: [],
    });
  }
  return sortNodes(root);
}

/**
 * Rows to list: children of expanded folders, or, while filtering, the
 * matching files with the folders that lead to them.
 */
export function visibleArchiveRows(
  nodes: readonly ArchiveNode[],
  expanded: ReadonlySet<string>,
  filter: string,
): ArchiveRow[] {
  const query = filter.trim().toLowerCase();
  const rows: ArchiveRow[] = [];
  const matches = (node: ArchiveNode): boolean =>
    node.folder
      ? node.children.some(matches)
      : node.path.toLowerCase().includes(query);
  const walk = (list: readonly ArchiveNode[], depth: number): void => {
    for (const node of list) {
      if (query && !matches(node)) continue;
      rows.push({
        name: node.name,
        path: node.path,
        folder: node.folder,
        size: node.size,
        depth,
      });
      if (node.folder && (query || expanded.has(node.path)))
        walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}
