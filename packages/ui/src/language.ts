// Syntax highlighting for a file, from @codemirror/language-data, which is
// loaded the first time a file needs it, and loads each language the first
// time it's needed. A file with no known language is plain text (decision
// 0045).
import {
  LanguageDescription,
  type LanguageSupport,
} from '@codemirror/language';

export async function languageFor(
  path: string,
): Promise<LanguageSupport | null> {
  const { languages } = await import('@codemirror/language-data');
  const name = path.slice(path.lastIndexOf('/') + 1);
  const description = LanguageDescription.matchFilename(languages, name);
  return description ? description.load() : null;
}
