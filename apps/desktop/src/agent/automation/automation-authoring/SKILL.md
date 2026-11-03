---
name: automation-authoring
description: Write, check and save Pine automations.
---

# Pine automations

An automation wakes an agent run when something happens. Pine's detectors
(schedules, folder watching, system events, small polling scripts) decide
**when** to run without a model; each run is one unattended agent pass with the
instructions and permissions the user approved. Runs always use autonomous
mode inside their permission envelope.

## Workflow

1. Understand the goal. Ask about anything that changes the definition: which
   folder, what time, where results go, whether to process files that already
   exist. Keep the questions few.
2. Call `automation_list` for existing automations, the project's folder ids
   and saved secret names.
3. Draft the definition and call `automation_check` with `spec`. Fix every
   error. Use `dryRun: true` to see which files match, what a script returns
   and what `when`/`payload` evaluate to.
4. Call `automation_save`. The user reviews a card on this computer and
   approves or rejects it; the call waits. Do not describe it as saved until
   it returns an id.
5. Tell the user in one or two sentences what will happen and how to pause it
   (the Automations panel in the sidebar).

To change an automation: `automation_get` → edit the full spec →
`automation_check` → `automation_save` with `id` and `baseRevision`. If the
revision changed, read it again and reapply your change.

Never put secret values in a definition, a script or a message. If a secret is
needed and missing, ask the user to add it under Automations → Secrets, by the
name you choose (lowercase-with-dashes). Only the user enters values.

## Definition (version 1)

```json
{
  "version": 1,
  "name": "Short name",
  "description": "Optional, one sentence",
  "enabled": true,
  "triggers": [ ... ],
  "when": "optional CEL boolean",
  "payload": { "key": "CEL expression" },
  "action": {
    "kind": "agent",
    "instructions": "What the run does, written for an agent with no other context.",
    "skills": ["optional-skill-name"],
    "model": { "providerId": "…", "modelId": "…", "thinkingLevel": "high" },
    "session": "new",
    "permissions": {
      "read": [{ "folderId": "…", "path": "optional/sub/dir" }],
      "write": [{ "folderId": "…", "path": "reports" }],
      "network": ["api.example.com"],
      "tools": ["read", "write", "edit", "bash"],
      "mcp": [{ "server": "github", "tools": ["list_issues"] }]
    }
  },
  "delivery": {
    "notify": "on-findings",
    "outputs": [{ "folderId": "…", "path": "reports" }]
  },
  "secrets": [{ "name": "github-token", "env": "GITHUB_TOKEN" }],
  "limits": { "maxRunsPerDay": 100, "maxMinutesPerRun": 30 }
}
```

- `path` is relative to the project folder, with `/`. Omit it for the whole
  folder. Write grants need a read-write folder; a missing write directory is
  created when the run starts.
- The run's working directory is a private scratch directory. Grants are the
  only project access it has.
- `tools` lists Pine tools by name: `read`, `edit`, `write`, `bash` (or
  `powershell` on Windows), `privileged_bash`/`privileged_powershell`, `todo`,
  `invoke_skill`, `list_skill_resources`, `read_skill_resource`, `web_search`,
  `web_fetch`, `generate_image`, `bg_run`, `bg_status`, `bg_logs`, `bg_kill`,
  `recall`. Ask for the fewest that do the job. Privileged shells run outside
  the sandbox and are reviewed call by call; avoid them.
- `mcp` lists the configured MCP servers the run may use and, for each, the
  server's own tool names it may call. Every other MCP call is refused. MCP
  servers run outside the sandbox with their own file and network access, so
  list only what the task needs; calls are reviewed like in an autonomous
  conversation.
- Leave out `model` and the run uses this conversation's model and thinking
  level (an update keeps the model it had). Set it only when the user asks
  for a specific model or thinking level; take the ids and the supported
  thinking levels from `ui_list_models`.
- `network` opens exact host names to the run's sandboxed shell. Everything
  else stays closed.
- `secrets` become environment variables in the run's shell only (default
  name `PINE_SECRET_<NAME>`). Their values are replaced by `[secret:name]` in
  everything the run reads back.
- `notify`: `on-findings` (default), `always`, or `never`. Failures always
  notify.
- `maxRunsPerDay` (default 100) is a backstop: once reached, later triggers
  that day are skipped and the user is told once.
- `outputs` are where results land. A run that neither calls
  `automation_report` nor changes an output counts as failed.

## Triggers

Schedule — RFC 5545 RRULE without DTSTART, at least 5 minutes apart:

```json
{
  "kind": "schedule",
  "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
  "timezone": "Asia/Shanghai",
  "missed": "run-once"
}
```

`timezone` defaults to the computer's. `missed: "run-once"` runs once after
the computer was off or asleep through one or more occurrences; `"skip"` waits
for the next.

Folder — files added, changed or removed under a folder:

```json
{
  "kind": "folder",
  "folderId": "…",
  "path": "inbox",
  "include": ["**/*.pdf"],
  "exclude": ["drafts/**"],
  "events": ["added", "changed"],
  "settleSeconds": 5,
  "batchSeconds": 30
}
```

A file counts once its size and modification time hold for `settleSeconds`.
Changes within `batchSeconds` go to one run (at most 100 files). By default
only changes after saving trigger runs; pass `includeExisting: true` to
`automation_save` when the user wants existing files processed too. Changes
the run itself makes inside its write grants never trigger it again.

System — `app-start`, `resume` (wake from sleep), `unlock`, `idle`
(`idleMinutes` required), with an optional window and once-per limit:

```json
{
  "kind": "system",
  "event": "unlock",
  "window": {
    "days": ["MO", "TU", "WE", "TH", "FR"],
    "from": "07:00",
    "to": "11:00"
  },
  "oncePer": "day"
}
```

Manual — `{ "kind": "manual" }`: runs only when the user or
`automation_run_now` starts it.

Script — a small JavaScript poller for websites, feeds and APIs, run every
`every` (ISO 8601 duration, at least `PT5M`) in an isolated interpreter with
no Node, no imports and no timers:

```json
{
  "kind": "script",
  "every": "PT30M",
  "window": { "from": "08:00", "to": "22:00" },
  "capabilities": { "network": ["api.github.com"], "read": [] },
  "source": "export default async function poll(ctx) { … }"
}
```

```js
export default async function poll(ctx) {
  const response = await ctx.fetch(
    "https://api.github.com/repos/owner/repo/releases?per_page=10",
    { headers: { Authorization: `Bearer ${ctx.secrets["github-token"]}` } },
  );
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const releases = await response.json();
  const seen = ctx.cursor?.newest ?? 0;
  const fresh = releases.filter((release) => release.id > seen);
  return {
    events: fresh.map((release) => ({
      id: String(release.id),
      data: {
        tag: release.tag_name,
        url: release.html_url,
        name: release.name,
      },
    })),
    cursor: {
      newest: Math.max(seen, ...releases.map((release) => release.id)),
    },
  };
}
```

- `ctx.fetch(url, { method, headers, body })` reaches only the declared hosts
  over http(s), redirects included; responses have `status`, `ok`, `headers`,
  `text()`, `json()`.
- `ctx.fs.list(grant, { include })`, `ctx.fs.stat(grant, path)`,
  `ctx.fs.readText(grant, path)` read only declared `read` grants (text files
  up to 1 MiB).
- `ctx.parse.xml(text)` (attributes as `@name`, text as `#text`) and
  `ctx.parse.csv(text)` (array of rows).
- `ctx.cursor` is what the previous poll returned; `ctx.now` is an ISO string;
  `ctx.secrets` holds the secrets the definition names; `ctx.log(...)`.
- Return `{ events: [{ id, data }], cursor }`. Event ids must be stable: Pine
  drops ids it has seen. Keep `data` small: only what the run needs.
- Limits: 30 s, 64 MiB, 10 requests, 5 MiB per response, 100 events.
- The first poll after saving sets the baseline; its events do not start a
  run unless `includeExisting` was set.

## when and payload (CEL)

Both see `events` (list), `state` (`cursor`, `lastRunAt`, `lastSuccessAt`),
`now` (timestamp) and `automation` (`id`, `name`). Extra functions:
`glob(path, pattern)`, `isWorkday(now)`, `formatDate(now, "yyyy-MM-dd")`.

```
when: "events.exists(e, e.file.size > 0)"
payload: { "pdfs": "events.filter(e, glob(e.file.path, '**/*.pdf')).map(e, e.file.path)", "day": "formatDate(now, 'yyyy-MM-dd')" }
```

Folder events carry `file` (`folderId`, `path`, `name`, `ext`, `size`,
`mtime`, `change`); script events carry `script.data`; system events carry
`system.event`. Use `when` to skip runs cheaply.

## Writing instructions

The run reads only its instructions, its payload and the files it may open.
Write instructions as a complete brief: what to look at, what to produce,
where to save it, what to do with files it cannot handle, and what counts as
nothing new. Tell it to report "nothing" when appropriate. Do not ask the run
to contact the user or wait for answers.
