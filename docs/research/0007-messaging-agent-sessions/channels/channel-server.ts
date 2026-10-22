// The channel server. Claude Code spawns it over stdio (see .mcp.json) and,
// when started with `--dangerously-load-development-channels server:review`,
// registers it as a channel. It connects to the review server's event stream,
// turns each message into a `notifications/claude/channel` event, and gives
// the agent a `reply` tool that posts the answer back to the review server.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const reviewServer = process.env.AD_REVIEW_SERVER ?? 'http://127.0.0.1:47101';
const label = process.env.AD_SESSION_LABEL ?? `ppid-${process.ppid}`;
const AD_ALWAYS_LOAD = process.env.AD_ALWAYS_LOAD !== '0';
let sid: string | undefined;

function log(...args: unknown[]): void {
  // stdout carries MCP, so logs go to stderr.
  console.error(new Date().toISOString(), '[channel]', ...args);
}

async function post(path: string, body: object): Promise<Response> {
  return fetch(`${reviewServer}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid, ...body }),
  });
}

const mcp = new Server(
  { name: 'review', version: '0.0.1' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    // Worded like the fakechat channel's instructions. Rewording alone didn't
    // make the agent call the reply tool: loading it upfront did (see below).
    instructions:
      'The reviewer reads the agent-diff review UI, not this terminal. Anything you want them to see ' +
      'must go through the reply tool: your transcript output never reaches them.\n\n' +
      'Messages from the review server arrive as <channel source="review" message_id="...">. ' +
      'Do what the message asks, then call the reply tool with the same message_id and your answer. ' +
      "Always reply to every message, even if you can't do what it asks.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send an answer back to the agent-diff review server',
      inputSchema: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description:
              "The message_id attribute of the message you're answering",
          },
          text: { type: 'string', description: 'The answer' },
        },
        required: ['message_id', 'text'],
      },
      // Load the tool upfront. Without this, Claude Code defers it behind
      // tool search, and Haiku and Sonnet answered channel messages in the
      // terminal instead of calling it.
      _meta: { 'anthropic/alwaysLoad': AD_ALWAYS_LOAD },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const { message_id, text } = req.params.arguments as {
    message_id: string;
    text: string;
  };
  const res = await post('/channel/reply', { message_id, text });
  const body = await res.text();
  return {
    content: [{ type: 'text', text: res.ok ? 'delivered' : `failed: ${body}` }],
    isError: !res.ok,
  };
});

const PermissionRequest = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

mcp.setNotificationHandler(PermissionRequest, async ({ params }) => {
  log('permission request', params.request_id, params.tool_name);
  await post('/channel/permission-request', params);
});

await mcp.connect(new StdioServerTransport());
log('connected to Claude Code over stdio, label', label);

type StreamEvent =
  | { type: 'hello'; sid: string }
  | { type: 'message'; message_id: string; text: string }
  | { type: 'verdict'; request_id: string; behavior: 'allow' | 'deny' };

async function handle(event: StreamEvent): Promise<void> {
  if (event.type === 'hello') {
    sid = event.sid;
    log('registered as', sid);
    // Report what the review server could use to identify the agent session:
    // Claude Code's process, folder and session ID, and the names (not the
    // values) of the other Claude Code variables the channel server sees.
    const names = Object.keys(process.env).filter((k) =>
      /^(CLAUDE|AI_AGENT)/.test(k),
    );
    await post('/channel/info', {
      claude_pid: process.ppid,
      cwd: process.cwd(),
      session_id: process.env.CLAUDE_CODE_SESSION_ID,
      env_names: names,
    });
  } else if (event.type === 'message') {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: event.text,
        meta: { message_id: event.message_id },
      },
    });
    await post('/channel/delivered', { message_id: event.message_id });
  } else if (event.type === 'verdict') {
    await mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: { request_id: event.request_id, behavior: event.behavior },
    });
  }
}

// Holds the review server's event stream open and reconnects when it drops.
async function stream(): Promise<never> {
  for (;;) {
    try {
      const url = `${reviewServer}/channel/connect?label=${encodeURIComponent(label)}&pid=${process.pid}`;
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('\n');
          if (data) await handle(JSON.parse(data) as StreamEvent);
        }
      }
      log('stream ended');
    } catch (err) {
      log('stream error', (err as Error).message);
    }
    sid = undefined;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

void stream();
