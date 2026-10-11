import { useMemo, useState } from 'react';
import type { ChangedFile, FileStatus } from '../shared/types.ts';

export const STATUS_LETTER: Record<FileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: 'U',
};

interface Props {
  files: ChangedFile[];
  /** The file at the top of the diff. */
  active: string | null;
  viewed: Record<string, boolean>;
  onSelect: (file: ChangedFile) => void;
}

/** The file viewer in the side panel. Clicking a file scrolls the diff to it. */
export function FileView({ files, active, viewed, onSelect }: Props) {
  const [view, setView] = useState<'tree' | 'list'>('tree');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(files), [files]);
  const viewedCount = files.filter((f) => viewed[f.path]).length;

  const toggle = (dir: string) => {
    const next = new Set(collapsed);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    setCollapsed(next);
  };

  const renderFile = (file: ChangedFile, label: string, depth: number) => (
    <li
      key={file.path}
      className={`file${file.path === active ? ' selected' : ''}${viewed[file.path] ? ' viewed' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(file)}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
    >
      <span className={`status status-${file.status}`}>{STATUS_LETTER[file.status]}</span>
      <span className="file-name">{label}</span>
      {file.commentCount > 0 && <span className="comment-count">{file.commentCount}</span>}
      <span className="counts">
        {file.binary ? 'bin' : (
          <>
            {file.added ? <span className="added">+{file.added}</span> : null}
            {file.removed ? <span className="removed">−{file.removed}</span> : null}
          </>
        )}
      </span>
      <span className="viewed-mark" title={viewed[file.path] ? 'Viewed' : 'Not viewed'}>
        {viewed[file.path] ? '✓' : ''}
      </span>
    </li>
  );

  const renderDir = (dir: TreeDir, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    for (const child of dir.dirs) {
      const isCollapsed = collapsed.has(child.path);
      out.push(
        <li key={`d:${child.path}`} className="dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(child.path)}>
          <span className="chevron">{isCollapsed ? '▸' : '▾'}</span>
          <span className="file-name">{child.name}</span>
          {isCollapsed && <span className="dir-changes">{child.fileCount} changed</span>}
        </li>,
      );
      if (!isCollapsed) out.push(...renderDir(child, depth + 1));
    }
    for (const file of dir.files) out.push(renderFile(file, file.path.split('/').pop()!, depth));
    return out;
  };

  return (
    <div className="file-view">
      <div className="file-view-head">
        <span>
          {files.length} changed file{files.length === 1 ? '' : 's'} · {viewedCount} viewed
        </span>
        <div className="segmented small">
          <button className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>
            Tree
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            List
          </button>
        </div>
      </div>
      <ul className="files">{view === 'tree' ? renderDir(tree, 0) : files.map((f) => renderFile(f, f.path, 0))}</ul>
      {files.length === 0 && <p className="empty">No changes in this diff mode.</p>}
    </div>
  );
}

interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: ChangedFile[];
  fileCount: number;
}

function buildTree(files: ChangedFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [], fileCount: 0 };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    dir.fileCount++;
    for (const part of parts.slice(0, -1)) {
      const childPath = dir.path ? `${dir.path}/${part}` : part;
      let child = dir.dirs.find((d) => d.name === part);
      if (!child) {
        child = { name: part, path: childPath, dirs: [], files: [], fileCount: 0 };
        dir.dirs.push(child);
      }
      child.fileCount++;
      dir = child;
    }
    dir.files.push(file);
  }
  return compact(root);
}

/** Merges single-child directory chains, like `src/server`, into one row. */
function compact(dir: TreeDir): TreeDir {
  dir.dirs = dir.dirs.map((child) => {
    let c = child;
    while (c.files.length === 0 && c.dirs.length === 1) {
      const only = c.dirs[0];
      c = { ...only, name: `${c.name}/${only.name}` };
    }
    return compact(c);
  });
  return dir;
}

/** The order files appear in the tree, so the diff can follow it. */
export function treeOrder(files: ChangedFile[]): ChangedFile[] {
  const out: ChangedFile[] = [];
  const walk = (dir: TreeDir) => {
    dir.dirs.forEach(walk);
    out.push(...dir.files);
  };
  walk(buildTree(files));
  return out;
}
