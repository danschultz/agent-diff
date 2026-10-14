// Stub actions shared by every example. Each prints what the parser produced.
export type StartOptions = { paths: string[]; base?: string; title?: string; open: boolean };
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function start(o: StartOptions): void {
  console.log(JSON.stringify({ command: 'start', ...o }));
}
export function review(o: { json: boolean }): void {
  console.log(JSON.stringify({ command: 'review', ...o }));
}
export function hookClaude(event: HookEvent): void {
  console.log(JSON.stringify({ command: 'hook claude', event }));
}
