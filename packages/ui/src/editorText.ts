// The texts a file's diff editor shows for its two sides. CodeMirror shows a
// text that ends with a newline with an empty last line, which git doesn't
// count as a line, so a final newline on both sides is left out. One on only
// one side is kept, since it changed.
//
// A side that isn't there, such as the old side of an added file, is empty.
// CodeMirror's empty document still has one empty line, so the other side
// then ends with a newline, and its empty last line lines up with it, rather
// than showing the empty line as changed.
import type { FileSide } from '@agent-diff/shared/schemas';

export function editorTexts(
  oldSide: FileSide | null,
  newSide: FileSide | null,
): [string, string] {
  const oldText = oldSide?.type === 'text' ? oldSide.text : null;
  const newText = newSide?.type === 'text' ? newSide.text : null;
  if (oldText === null || newText === null) {
    const withNewline = (text: string | null) =>
      text === null ? '' : text.endsWith('\n') ? text : `${text}\n`;
    return [withNewline(oldText), withNewline(newText)];
  }
  if (oldText.endsWith('\n') && newText.endsWith('\n')) {
    return [oldText.slice(0, -1), newText.slice(0, -1)];
  }
  return [oldText, newText];
}
