// The texts a file's diff editor shows for its two sides. CodeMirror shows a
// text that ends with a newline with an empty last line, which git doesn't
// count as a line, so a final newline is left out, unless only one side
// has one, which is a change. A side that isn't there, such as the old side
// of an added file, is empty.
import type { FileSide } from '@agent-diff/shared/schemas';

export function editorTexts(
  oldSide: FileSide | null,
  newSide: FileSide | null,
): [string, string] {
  const oldText = oldSide?.type === 'text' ? oldSide.text : null;
  const newText = newSide?.type === 'text' ? newSide.text : null;
  const endsWithNewline = (text: string | null) =>
    text === null || text.endsWith('\n');
  const trim = endsWithNewline(oldText) && endsWithNewline(newText);
  const shown = (text: string | null) =>
    text === null ? '' : trim ? text.slice(0, -1) : text;
  return [shown(oldText), shown(newText)];
}
