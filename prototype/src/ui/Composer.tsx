import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  body: string;
  onChange: (body: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
}

/** The inline comment composer, shown under the selected lines. */
export function Composer({ label, body, onChange, onSave, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Monaco and CodeMirror attach the composer's element after React mounts it, so autoFocus would miss.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      input.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  const save = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer inline">
      <div className="composer-target">{label}</div>
      <textarea
        ref={input}
        value={body}
        placeholder="Leave a comment for the agent"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {error && <div className="error">{error}</div>}
      <div className="row-actions">
        <button
          className="primary"
          disabled={busy || !body.trim()}
          onClick={() => void save()}
        >
          Save draft
        </button>
        <button onClick={onCancel}>Cancel</button>
        <span className="hint">⌘↵ to save, Esc to cancel</span>
      </div>
    </div>
  );
}
