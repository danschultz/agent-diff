# Helpers for run.sh. Sourced, not run.
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Scratch dirs must sit under the repo's .claude/worktrees so Claude Code trusts them.
REPO=${REPO:-$(cd "$HERE/../../../.." && pwd)}
SCRATCH_ROOT=${SCRATCH_ROOT:-$REPO/.claude/worktrees}
DAEMON_LOG=${DAEMON_LOG:-$HOME/.claude/daemon.log}
JOBS=${JOBS:-$HOME/.claude/jobs}
PROJECTS=${PROJECTS:-$HOME/.claude/projects}
ROSTER=${ROSTER:-$HOME/.claude/daemon/roster.json}
MODEL=${MODEL:-haiku}

# claude with a clean environment, as implement runs it.
cclaude() {
  env -i HOME="$HOME" USER="$USER" PATH="$PATH" TERM=xterm-256color LANG=C.UTF-8 \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" claude "$@"
}

ts() { date -u +%H:%M:%S; }
say() { printf '[%s] %s\n' "$(ts)" "$*"; }

# new_scratch <case>: creates and enters nothing; sets SCR, NAME, HOOKLOG.
new_scratch() {
  local c=$1
  N=$(date -u +%H%M%S)$RANDOM
  SCR=$SCRATCH_ROOT/ad8-exit-causes-$N
  NAME=ad8-exit-causes-$c-$N
  mkdir -p "$SCR"
  HOOKLOG=$SCR/hooks.log
  : > "$HOOKLOG"
  node -e '
    const [hook, log, out] = process.argv.slice(1);
    const cmd = { type: "command", command: `node ${hook} ${log}`, timeout: 30 };
    const events = ["SessionStart","UserPromptSubmit","Notification","Stop","SubagentStop","StopFailure","SessionEnd"];
    const hooks = Object.fromEntries(events.map((e) => [e, [{ hooks: [cmd] }]]));
    require("fs").writeFileSync(out, JSON.stringify({ hooks }, null, 2));
  ' "$HERE/hook.mjs" "$HOOKLOG" "$SCR/settings.json"
  DLOG_START=$(wc -l < "$DAEMON_LOG")
}

# start_agent <prompt> [extra claude args]: starts the agent session in $SCR; sets ID, SID.
start_agent() {
  local prompt=$1; shift
  local out
  out=$( cd "$SCR" && cclaude --bg --remote-control "$NAME" --name "$NAME" --permission-mode auto \
    --settings "$SCR/settings.json" --model "$MODEL" "$@" "$prompt" 2>&1 )
  echo "$out" | sed 's/^/  start> /'
  ID=$(cclaude agents --json --all | node -e '
    const n=process.argv[1];const a=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const s=a.find(x=>x.name===n);console.log(s?.id??"")' "$NAME")
  SID=$(cclaude agents --json --all | node -e '
    const n=process.argv[1];const a=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const s=a.find(x=>x.name===n);console.log(s?.sessionId??"")' "$NAME")
  say "agent session $NAME id=$ID"
}

row() { # JSON row of this agent session from `claude agents --json --all`
  cclaude agents --json --all | node -e '
    const n=process.argv[1];const a=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const s=a.find(x=>x.name===n);
    if(!s){console.log("  agents --all: (no row)");process.exit()}
    const {id,pid,kind,status,state,outcome,detail,tempo}=s;
    console.log("  agents --all:",JSON.stringify({id,pid,status,state,outcome,detail:detail&&String(detail).slice(0,80)}));' "$NAME"
}
row_live() { # is it in plain `claude agents --json`?
  cclaude agents --json | node -e '
    const n=process.argv[1];const a=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const s=a.find(x=>x.name===n);
    console.log("  agents (no --all):", s?JSON.stringify({pid:s.pid,status:s.status,state:s.state}):"NOT LISTED");' "$NAME"
}
jobstate() {
  node -e '
    const f=process.argv[1];let d;try{d=JSON.parse(require("fs").readFileSync(f,"utf8"))}catch(e){console.log("  state.json: (none)");process.exit()}
    const pick=["state","detail","tempo","inFlight","fan","needs","queuedPrompt","firstTerminalAt","lastTerminalAt","updatedAt","tokens","cliVersion"];
    const o={};for(const k of pick) if(d[k]!==undefined) o[k]=typeof d[k]==="string"?d[k].slice(0,80):d[k];
    o.respawnFlags=(d.respawnFlags||[]).filter(x=>x.startsWith("--")).join(" ");
    o.bridgeSessionId=d.bridgeSessionId?"present":"absent";
    console.log("  state.json:",JSON.stringify(o));' "$JOBS/$ID/state.json"
}
timeline() { tail -n "${1:-4}" "$JOBS/$ID/timeline.jsonl" 2>/dev/null | cut -c1-170 | sed 's/^/  timeline> /'; }
daemon_new() { tail -n +$((DLOG_START+1)) "$DAEMON_LOG" | grep -E "$ID|supervisor|adopt|low memory" | cut -c1-260 | sed 's/^/  daemon.log> /'; }
transcript() {
  local f; f=$(ls "$PROJECTS"/*/"$SID".jsonl 2>/dev/null | head -1)
  [ -z "$f" ] && { echo "  transcript: (none)"; return; }
  node -e '
    const L=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>{try{return JSON.parse(l)}catch{return {}}});
    const brief=e=>{let t=e.type; const m=e.message; if(m&&Array.isArray(m.content)){t+=":"+m.content.map(c=>c.type+(c.name?"("+c.name+")":"")).join(",")} else if(m&&typeof m.content==="string") t+=":text"; if(e.subtype) t+="/"+e.subtype; if(e.isApiErrorMessage||e.error) t+="[API-ERROR]"; return t};
    console.log("  transcript: "+L.length+" entries; last 6:",L.slice(-6).map(brief).join(" | "));
    const err=L.filter(e=>e.isApiErrorMessage||e.error).slice(-1)[0];
    const lastUser=L.filter(e=>e.type==="user").slice(-1)[0];
    if(lastUser) console.log("  transcript last user entry:",(lastUser.isMeta?"[meta] ":"")+JSON.stringify(lastUser.message?.content).slice(0,170));
    if(err) console.log("  transcript api error text:",JSON.stringify(err.message?.content?.[0]?.text||err.error).slice(0,200));
  ' "$f"
}
hooks() { echo "  hooks.log:"; sed 's/"session_id":"\([^"]\{8\}\)[^"]*"/"sid":"\1.."/' "$HOOKLOG" | cut -c1-160 | sed 's/^/    /'; }
procs() { # process tree for this agent session's worker
  node -e '
    const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).workers[process.argv[2]];
    console.log(r?JSON.stringify({pid:r.pid,replPid:r.replPid}):"(not in roster)")' "$ROSTER" "$ID" | sed 's/^/  roster> /'
}
snapshot() {
  say "--- snapshot: $1"
  row; row_live; jobstate; timeline 3; transcript; hooks; daemon_new
}
roster_pid() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).workers[process.argv[2]];console.log(r?.[process.argv[3]]??"")' "$ROSTER" "$ID" "$1"; }

# wait_state <regex> <max seconds>: waits for state.json "state" to match.
wait_state() {
  local want=$1 max=$2 i=0 s
  while [ $i -lt "$max" ]; do
    s=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).state)}catch{console.log("")}' "$JOBS/$ID/state.json")
    echo "$s" | grep -Eq "$want" && { say "state=$s after ${i}s"; return 0; }
    sleep 3; i=$((i+3))
  done
  say "state did not match /$want/ in ${max}s (last: $s)"; return 1
}

cleanup() {
  [ -n "${ID:-}" ] && { cclaude stop "$ID" >/dev/null 2>&1; cclaude rm "$ID" >/dev/null 2>&1; }
  [ -n "${EXTRA_IDS:-}" ] && for i in $EXTRA_IDS; do cclaude stop "$i" >/dev/null 2>&1; cclaude rm "$i" >/dev/null 2>&1; done
  tmux -L ad8-exit-causes kill-server 2>/dev/null
  [ -n "${SCR:-}" ] && [ -z "${KEEP:-}" ] && rm -rf "$SCR"
}
