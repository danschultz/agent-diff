// Language names per viewer: highlight.js names for git-diff-view, Monaco
// language ids for Monaco. CodeMirror matches file names on its own and falls
// back to the highlight.js name for extensions it doesn't know, like .sbt.

const BY_EXTENSION: Record<string, { hljs: string; monaco: string }> = {
  ts: { hljs: 'typescript', monaco: 'typescript' },
  tsx: { hljs: 'typescript', monaco: 'typescript' },
  mts: { hljs: 'typescript', monaco: 'typescript' },
  js: { hljs: 'javascript', monaco: 'javascript' },
  jsx: { hljs: 'javascript', monaco: 'javascript' },
  mjs: { hljs: 'javascript', monaco: 'javascript' },
  cjs: { hljs: 'javascript', monaco: 'javascript' },
  json: { hljs: 'json', monaco: 'json' },
  md: { hljs: 'markdown', monaco: 'markdown' },
  css: { hljs: 'css', monaco: 'css' },
  scss: { hljs: 'scss', monaco: 'scss' },
  html: { hljs: 'xml', monaco: 'html' },
  xml: { hljs: 'xml', monaco: 'xml' },
  yml: { hljs: 'yaml', monaco: 'yaml' },
  yaml: { hljs: 'yaml', monaco: 'yaml' },
  py: { hljs: 'python', monaco: 'python' },
  rb: { hljs: 'ruby', monaco: 'ruby' },
  go: { hljs: 'go', monaco: 'go' },
  rs: { hljs: 'rust', monaco: 'rust' },
  java: { hljs: 'java', monaco: 'java' },
  kt: { hljs: 'kotlin', monaco: 'kotlin' },
  scala: { hljs: 'scala', monaco: 'scala' },
  sc: { hljs: 'scala', monaco: 'scala' },
  sbt: { hljs: 'scala', monaco: 'scala' },
  swift: { hljs: 'swift', monaco: 'swift' },
  c: { hljs: 'c', monaco: 'c' },
  h: { hljs: 'c', monaco: 'c' },
  cpp: { hljs: 'cpp', monaco: 'cpp' },
  cs: { hljs: 'csharp', monaco: 'csharp' },
  sh: { hljs: 'bash', monaco: 'shell' },
  sql: { hljs: 'sql', monaco: 'sql' },
};

export function languageFor(path: string): { hljs: string; monaco: string } {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? { hljs: 'plaintext', monaco: 'plaintext' };
}
