// One changed file in a session's diff, from decision 0045: a header that
// sticks to the top while the file is in view, and the file's diff. The
// diff's editor mounts when the file comes within about 1,200 px of the
// visible area, and unmounts when it's more than about 4,000 px away, which
// leaves a placeholder with the editor's last height. A file's contents are
// fetched the first time its editor mounts.
import { useQuery } from '@tanstack/react-query';
import { useSelector } from '@tanstack/react-store';
import { useEffect, useRef, useState } from 'react';
import type {
  ChangedFile,
  FileContents,
  FileStatus,
} from '@agent-diff/shared/schemas';
import { orpc } from '../client.ts';
import { editorTexts } from '../editorText.ts';
import { fileHeightsStore, fileKey } from '../stores/fileHeights.ts';
import { DiffEditor } from './DiffEditor.tsx';

const mountMargin = '1200px 0px';
const unmountMargin = '4000px 0px';
// The editor's line height, set in styles.css, which estimates a file's
// height before its editor has mounted.
const lineHeight = 18;

const statusLabels = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  type_changed: 'type changed',
  conflicted: 'conflicted',
  untracked: 'untracked',
} as const satisfies Record<FileStatus, string>;

// About the changed lines and 3 lines of context on each side. Files with no
// line counts, such as binary files, show a one-line placeholder.
function estimatedHeight(file: ChangedFile): number {
  if (file.added === null || file.removed === null) return 2 * lineHeight;
  return (file.added + file.removed + 6) * lineHeight;
}

// Why a file's diff isn't shown, or null when it is.
function notShown(contents: FileContents): string | null {
  const sides = [contents.old, contents.new].filter((side) => side !== null);
  if (sides.some((side) => side.type === 'submodule')) {
    return "This is a submodule, so there's no diff to show.";
  }
  if (sides.some((side) => side.type === 'binary')) {
    return "This file is binary, so its diff isn't shown.";
  }
  if (sides.some((side) => side.type === 'too_large')) {
    return "This file is over 2 MB, so its diff isn't shown.";
  }
  return null;
}

function FileBody({
  sessionId,
  workingDirectory,
  file,
  height,
}: {
  sessionId: string;
  workingDirectory: string;
  file: ChangedFile;
  height: number;
}) {
  const key = fileKey(workingDirectory, file.path);
  const body = useRef<HTMLDivElement>(null);
  const { data: contents, error } = useQuery(
    orpc.diff.contents.queryOptions({
      input: { sessionId, mode: 'all', workingDirectory, path: file.path },
    }),
  );
  useEffect(() => {
    const element = body.current!;
    const observer = new ResizeObserver(() => {
      if (element.offsetHeight > 0) {
        fileHeightsStore.actions.setHeight(key, element.offsetHeight);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  let content;
  if (error) {
    content = <p className="file-note error">{error.message}</p>;
  } else if (!contents) {
    content = <div className="file-placeholder" style={{ height }} />;
  } else {
    const reason = notShown(contents);
    const [oldText, newText] = editorTexts(contents.old, contents.new);
    content = reason ? (
      <p className="file-note">{reason}</p>
    ) : (
      <DiffEditor path={file.path} oldText={oldText} newText={newText} />
    );
  }
  return (
    <div className="file-body" ref={body}>
      {content}
    </div>
  );
}

export function FileDiff({
  sessionId,
  workingDirectory,
  file,
}: {
  sessionId: string;
  workingDirectory: string;
  file: ChangedFile;
}) {
  const key = fileKey(workingDirectory, file.path);
  const section = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  const height = useSelector(
    fileHeightsStore,
    () => fileHeightsStore.actions.height(key) ?? estimatedHeight(file),
  );
  useEffect(() => {
    const element = section.current!;
    // A busy main thread can deliver several entries at once, and only the
    // last one is current.
    const mount = new IntersectionObserver(
      (entries) => {
        if (entries.at(-1)!.isIntersecting) setMounted(true);
      },
      { rootMargin: mountMargin },
    );
    const unmount = new IntersectionObserver(
      (entries) => {
        if (!entries.at(-1)!.isIntersecting) setMounted(false);
      },
      { rootMargin: unmountMargin },
    );
    mount.observe(element);
    unmount.observe(element);
    return () => {
      mount.disconnect();
      unmount.disconnect();
    };
  }, []);

  return (
    <section className="file-diff" ref={section} aria-label={file.path}>
      <header className="file-header">
        <span className={`file-status file-status-${file.status}`}>
          {statusLabels[file.status]}
        </span>
        <span className="file-path">
          {file.oldPath !== null && <>{file.oldPath} → </>}
          {file.path}
        </span>
        {file.added !== null && file.removed !== null && (
          <span className="line-counts">
            <span className="added">+{file.added}</span>{' '}
            <span className="removed">−{file.removed}</span>
          </span>
        )}
      </header>
      {mounted ? (
        <FileBody
          sessionId={sessionId}
          workingDirectory={workingDirectory}
          file={file}
          height={height}
        />
      ) : (
        <div className="file-placeholder" style={{ height }} />
      )}
    </section>
  );
}
