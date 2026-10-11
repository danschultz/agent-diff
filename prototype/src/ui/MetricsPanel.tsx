import { useState } from 'react';
import type { Settings } from '../shared/types.ts';

export interface ReloadMetric {
  at: number;
  rawEvents: number;
  paths: number;
  ignored: number;
  gitMetadata: boolean;
  /** First file event to the server's debounced flush. */
  detectMs: number;
  /** Flush to the UI having refetched and painted. */
  refreshMs: number;
  /** First file event to painted. */
  totalMs: number;
  fetchMs: number | null;
  viewer: string;
  sample: string[];
}

export interface RenderMetric {
  viewer: string;
  ms: number;
  lines: number;
}

interface Props {
  reloads: ReloadMetric[];
  renders: RenderMetric[];
  settings: Settings | null;
  onSettings: (patch: Partial<Settings>) => void;
}

export function MetricsPanel({ reloads, renders, settings, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const last = reloads[0];
  const lastRender = renders[0];
  return (
    <div className={`metrics ${open ? 'open' : ''}`}>
      <div className="metrics-bar" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'} Live reload and rendering</span>
        {last && (
          <span className="metric-summary">
            last reload {last.totalMs.toFixed(0)} ms ({last.rawEvents} events, {last.paths} paths)
          </span>
        )}
        {lastRender && (
          <span className="metric-summary">
            last render {lastRender.viewer} {lastRender.ms.toFixed(0)} ms ({lastRender.lines} lines)
          </span>
        )}
      </div>
      {open && (
        <div className="metrics-body">
          <div className="metrics-tables">
            <table>
              <thead>
                <tr>
                  <th>time</th>
                  <th title="Raw file system events in the batch">events</th>
                  <th title="Changed paths after dropping ignored files">paths</th>
                  <th>ignored</th>
                  <th title="First event to debounced flush on the server">detect</th>
                  <th title="Flush to refetched and painted in the UI">refresh</th>
                  <th title="First event to painted">total</th>
                  <th title="Server time to compute the selected file">fetch</th>
                  <th>viewer</th>
                  <th>sample</th>
                </tr>
              </thead>
              <tbody>
                {reloads.map((r) => (
                  <tr key={r.at}>
                    <td>{new Date(r.at).toLocaleTimeString()}</td>
                    <td>{r.rawEvents}</td>
                    <td>
                      {r.paths}
                      {r.gitMetadata ? ' +git' : ''}
                    </td>
                    <td>{r.ignored}</td>
                    <td>{r.detectMs.toFixed(0)}</td>
                    <td>{r.refreshMs.toFixed(0)}</td>
                    <td>
                      <b>{r.totalMs.toFixed(0)}</b>
                    </td>
                    <td>{r.fetchMs === null ? '' : r.fetchMs.toFixed(0)}</td>
                    <td>{r.viewer}</td>
                    <td className="sample">{r.sample.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>viewer</th>
                  <th>render ms</th>
                  <th>lines</th>
                </tr>
              </thead>
              <tbody>
                {renders.map((r, i) => (
                  <tr key={i}>
                    <td>{r.viewer}</td>
                    <td>{r.ms.toFixed(0)}</td>
                    <td>{r.lines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {settings && (
            <div className="settings">
              <NumberSetting label="Debounce (ms)" value={settings.debounceMs} onChange={(v) => onSettings({ debounceMs: v })} />
              <NumberSetting label="Max wait (ms)" value={settings.maxWaitMs} onChange={(v) => onSettings({ maxWaitMs: v })} />
              <NumberSetting
                label="Match threshold"
                step={0.05}
                value={settings.reanchor.minSimilarity}
                onChange={(v) => onSettings({ reanchor: { ...settings.reanchor, minSimilarity: v } })}
              />
              <NumberSetting
                label="Context lines"
                value={settings.reanchor.contextLines}
                onChange={(v) => onSettings({ reanchor: { ...settings.reanchor, contextLines: v } })}
              />
              <label>
                <input type="checkbox" checked={settings.holdWhileBusy} onChange={(e) => onSettings({ holdWhileBusy: e.target.checked })} />
                Hold notifications while the agent is mid-turn
              </label>
              <p className="hint">Metrics are also appended to prototype/.data/metrics.jsonl.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumberSetting({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" step={step} defaultValue={value} onBlur={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
