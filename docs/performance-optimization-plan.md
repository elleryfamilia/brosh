# Performance Optimization Plan

This document outlines concrete, incremental performance optimizations for the current brosh desktop app without doing a full native rewrite.

The emphasis is on improving the Claude Code workflow, terminal responsiveness, and overall renderer load inside the existing Electron architecture.

## Summary

The main performance problems do not appear to come from Electron alone. They come from a combination of:

- duplicated terminal work across backend and renderer
- base64 encoding/decoding of terminal output for GUI transport
- broad renderer event fanout
- multiple background polling and watcher loops
- keeping inactive Claude terminal tabs mounted in the renderer
- a rich xterm addon stack even for heavy Claude sessions

Because of that, replacing Electron with Tauri is not the best first move. Tauri still uses a webview + IPC architecture, so it would not remove the most important costs unless the same data flow is redesigned at the same time.

## Main Findings

### 1. Terminal output is doing extra work

Current path:

- PTY output enters the backend session
- the backend encodes output as base64 and sends it over IPC
- the renderer decodes base64 back into text
- xterm writes the decoded data into the visible terminal

Relevant files:

- [src/transport/gui-protocol.ts](/Users/ellery/_git/brosh/src/transport/gui-protocol.ts)
- [packages/desktop-electron/src/main/terminal-bridge.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/terminal-bridge.ts)
- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)

### 2. Renderer event handling fans out too broadly

Multiple components independently subscribe to `terminal:message` and then filter events locally.

Relevant files:

- [packages/desktop-electron/src/main/preload.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/preload.ts)
- [packages/desktop-electron/src/renderer/App.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/App.tsx)
- [packages/desktop-electron/src/renderer/plugins/git/useGitData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/git/useGitData.ts)
- [packages/desktop-electron/src/renderer/plugins/docs/useDocsData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/docs/useDocsData.ts)
- [packages/desktop-electron/src/renderer/plugins/docs/useMemoryFiles.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/docs/useMemoryFiles.ts)
- [packages/desktop-electron/src/renderer/plugins/plans/usePlansData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/plans/usePlansData.ts)
- [packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx)

### 3. Claude tabs stay mounted in the renderer

The Claude panel intentionally keeps inactive tabs mounted with `display:none`.

Relevant files:

- [packages/desktop-electron/src/renderer/components/ClaudePanel.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudePanel.tsx)
- [packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx)

Important architectural observation:

- the backend already maintains terminal state
- hidden renderer terminals do not need to stay mounted to preserve state

That means inactive Claude tabs are a strong optimization target.

### 4. Claude sessions use the same heavy terminal surface as normal terminals

Every terminal initializes:

- FitAddon
- WebGL or Canvas renderer addon
- WebLinksAddon
- ImageAddon
- ClipboardAddon
- SearchAddon

Relevant file:

- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)

This is useful for general terminals, but Claude sessions are the worst possible place to pay for unnecessary renderer features.

### 5. Background data refresh is fragmented

The app currently has separate refresh loops for:

- git status
- files
- docs
- memory files
- plans
- MCP dashboard cleanup

Some are event-driven, some are polled, and several wake up independently.

## Optimization Priorities

### Priority 0: Measure First

Do not optimize blind. Add instrumentation before touching behavior.

### Work

- add per-session counters for:
  - output chunks per second
  - bytes per second
  - IPC messages per second
  - renderer write calls per second
- add renderer metrics for:
  - average xterm write batch size
  - time spent decoding output
  - mounted terminal count
  - mounted Claude tab count
- log addon initialization cost for terminal creation
- measure memory use with:
  - one terminal only
  - one terminal + one Claude panel
  - one terminal + three Claude tabs

### Suggested touch points

- [packages/desktop-electron/src/main/terminal-bridge.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/terminal-bridge.ts)
- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)
- [packages/desktop-electron/src/renderer/components/ClaudePanel.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudePanel.tsx)

### Expected impact

- No direct user-facing speedup
- High decision value

### Priority 1: Reduce Terminal Output Overhead

This is the highest-ROI area.

### 1A. Batch PTY output before IPC send

Current behavior sends output chunk-by-chunk.

Change:

- buffer PTY output per session in the main process
- flush on a short timer or frame-style cadence
- send fewer, larger messages

Implementation sketch:

- accumulate raw output for a session
- flush every 8-16ms, or when buffered bytes cross a threshold
- coalesce metadata emitted from the same chunk window where possible

### 1B. Stop using base64 for Electron-only transport

Current GUI protocol was designed for generic JSON transport and encodes terminal output as base64.

For the Electron app:

- add a dedicated IPC path that sends `Uint8Array` or `Buffer` instead of base64 strings
- keep the current base64 protocol only for generic socket/web transports if needed

Implementation sketch:

- introduce an Electron-specific message contract
- structured-clone binary data directly if supported in the current preload/IPC path
- if binary transfer is awkward, at least batch strings and avoid per-chunk base64 churn

### 1C. Batch renderer writes too

Even after IPC batching, the renderer can still write too frequently.

Change:

- queue decoded output per terminal
- write to xterm once per animation frame or small interval

### Suggested touch points

- [src/transport/gui-protocol.ts](/Users/ellery/_git/brosh/src/transport/gui-protocol.ts)
- [packages/desktop-electron/src/main/preload.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/preload.ts)
- [packages/desktop-electron/src/main/terminal-bridge.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/terminal-bridge.ts)
- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)

### Expected impact

- Very high for Claude-heavy sessions
- Lower CPU usage
- Lower GC pressure
- Smoother scrolling and typing

### Priority 2: Unmount Inactive Claude Terminals

This is likely the next biggest win.

Current behavior:

- inactive Claude tabs stay mounted with `display:none`

Change:

- keep the backend session alive
- unmount inactive renderer `Terminal` components
- remount and hydrate from backend terminal state when the user switches back

Why this is safe:

- backend session state already exists
- renderer mounting is not the source of truth

Implementation sketch:

- in `ClaudePanel`, only render the active tab's `ClaudeTabContent`
- on remount, fetch current terminal content with `getContent`
- restore cursor, scrollback, and title state from backend before live updates resume
- keep a small tab snapshot model in React state instead of hidden xterm instances

### Suggested touch points

- [packages/desktop-electron/src/renderer/components/ClaudePanel.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudePanel.tsx)
- [packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx)
- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)
- [src/terminal/session.ts](/Users/ellery/_git/brosh/src/terminal/session.ts)

### Expected impact

- High memory reduction
- Lower renderer CPU use
- Better stability with multiple Claude tabs

### Priority 3: Introduce A Lean Claude Terminal Profile

Claude terminals should not pay for everything normal terminals support.

### Changes

- create a terminal feature profile for Claude sessions
- disable or defer nonessential addons in `claudeMode`
- use smaller scrollback defaults for Claude panels

### Candidate reductions for Claude terminals

- disable `ImageAddon`
- defer `SearchAddon` until the user actually opens find
- consider disabling `WebLinksAddon` if link handling is not important inside Claude
- reevaluate whether WebGL is actually a win for Claude output or whether canvas/default rendering is more stable

### Suggested touch points

- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)
- [packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx)
- [packages/desktop-electron/src/renderer/settings/defaults.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/settings/defaults.ts)

### Expected impact

- Medium to high
- Faster terminal creation
- Lower steady-state renderer cost in Claude workflows

### Priority 4: Centralize Renderer Terminal Events

The renderer should subscribe once to terminal events and fan out locally from a store.

### Changes

- replace many `window.terminalAPI.onMessage` subscriptions with one central event dispatcher
- normalize events by type and session
- expose derived stores/hooks instead of raw event subscriptions

Implementation sketch:

- create a `terminalEventStore` in the renderer
- subscribe once in a top-level provider
- route:
  - session closed
  - cwd changed
  - process changed
  - title changed
  - command marks
  - error detected
- let components subscribe to the minimum derived state they need

### Suggested touch points

- [packages/desktop-electron/src/main/preload.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/preload.ts)
- [packages/desktop-electron/src/renderer/App.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/App.tsx)
- [packages/desktop-electron/src/renderer/plugins/git/useGitData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/git/useGitData.ts)
- [packages/desktop-electron/src/renderer/plugins/docs/useDocsData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/docs/useDocsData.ts)
- [packages/desktop-electron/src/renderer/plugins/docs/useMemoryFiles.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/docs/useMemoryFiles.ts)
- [packages/desktop-electron/src/renderer/plugins/plans/usePlansData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/plans/usePlansData.ts)
- [packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/ClaudeTabContent.tsx)

### Expected impact

- Medium
- Less repeated work on every terminal event
- Simpler performance reasoning

### Priority 5: Consolidate Background Project State

Git/files/docs/plans should not each manage their own refresh loops independently.

### Changes

- build a single backend project-state service in the main process
- maintain cached state for:
  - git root
  - git status
  - docs list
  - memory files
  - plans
- push coalesced invalidation events to the renderer

### Immediate lower-cost version

Before a full service exists:

- remove polling where watchers already exist
- pause all project polling when Claude panel is active and the related sidebar is closed
- lower refresh cadence
- ensure only the active project is being watched

### Specific current targets

- `useGitData` polls every 3 seconds even when the git sidebar is not active
- `usePlansData` polls every 5 seconds while active
- docs and memory files re-fetch on overlapping visibility and cwd events

### Suggested touch points

- [packages/desktop-electron/src/renderer/plugins/git/useGitData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/git/useGitData.ts)
- [packages/desktop-electron/src/renderer/plugins/files/useFilesData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/files/useFilesData.ts)
- [packages/desktop-electron/src/renderer/plugins/docs/useDocsData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/docs/useDocsData.ts)
- [packages/desktop-electron/src/renderer/plugins/docs/useMemoryFiles.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/docs/useMemoryFiles.ts)
- [packages/desktop-electron/src/renderer/plugins/plans/usePlansData.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/plugins/plans/usePlansData.ts)
- [packages/desktop-electron/src/main/index.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/index.ts)

### Expected impact

- Medium
- Lower idle CPU
- Better responsiveness under file churn

### Priority 6: Coalesce Main-Process Terminal Metadata Events

The terminal bridge currently emits multiple separate renderer messages for:

- output
- process change
- title change
- command marks
- cwd change
- resize

### Changes

- batch metadata changes detected from the same PTY output flush
- send a single event envelope per flush window where possible
- avoid repeated `webContents.send` calls in the same cycle

### Suggested touch points

- [packages/desktop-electron/src/main/terminal-bridge.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/terminal-bridge.ts)

### Expected impact

- Medium
- Reduces IPC overhead and renderer wakeups

### Priority 7: Make Terminal Creation Cheaper

Terminal creation currently pays for renderer setup, addon initialization, and fitting behavior immediately.

### Changes

- defer more addons
- gate expensive terminal behaviors behind interaction
- review whether speculative session creation is still worth its cost profile
- consider separate defaults for:
  - normal shell pane
  - Claude pane
  - background/inactive pane

### Suggested touch points

- [packages/desktop-electron/src/main/terminal-bridge.ts](/Users/ellery/_git/brosh/packages/desktop-electron/src/main/terminal-bridge.ts)
- [packages/desktop-electron/src/renderer/components/Terminal.tsx](/Users/ellery/_git/brosh/packages/desktop-electron/src/renderer/components/Terminal.tsx)

### Expected impact

- Medium
- Faster open-tab/open-Claude flows

### Priority 8: Only Evaluate Tauri After The Above

Do not switch frameworks before fixing the hot path.

### Reason

Tauri still uses:

- webviews
- frontend JavaScript
- IPC between frontend and privileged backend

So if the app still:

- base64-encodes output
- duplicates terminal work
- keeps hidden xterm instances alive
- fans out events to many listeners

then the biggest costs remain.

### Recommendation

- do not treat Tauri as a near-term performance project
- revisit it only if Electron-specific profiling still dominates after the architectural optimizations above

## Recommended Execution Order

1. Add instrumentation and capture baseline numbers.
2. Batch output transport and remove base64 from the Electron path if possible.
3. Unmount inactive Claude terminals and rehydrate on focus.
4. Add a lean Claude terminal profile.
5. Centralize renderer terminal event handling.
6. Consolidate project-state refresh logic.
7. Reprofile before considering any framework migration.

## Execution Guardrails

The optimization work should follow these rules:

- do not switch frameworks as part of this effort
- do not change the product model while optimizing
- keep backend session ownership exactly where it is today
- avoid combining transport changes, Claude lifecycle changes, and sidebar refactors in one patch
- land each optimization behind a clear behavior boundary so regressions are easy to isolate

Specific constraints:

- unmounting renderer terminals must not close backend sessions
- batching output must not introduce visible typing lag
- Claude optimizations must preserve current shell and TUI correctness
- project sidebar refresh changes must not break git/files/docs/plans correctness

## Benchmark Scenarios

Use the same scenarios before and after each milestone.

### Scenario A: Idle Desktop

- one terminal pane
- no Claude panel
- no sidebars open
- app focused for 60 seconds

Measure:

- renderer CPU
- main process CPU
- memory
- IPC message count per second

### Scenario B: One Active Claude Session

- one terminal pane
- Claude panel open
- one Claude session actively streaming output

Measure:

- renderer CPU during output bursts
- main process CPU during output bursts
- terminal output messages per second
- xterm write batches per second
- frame drops or visible jank while scrolling

### Scenario C: Three Claude Tabs

- Claude panel open
- three Claude tabs created
- only one visible at a time

Measure:

- memory footprint
- tab-switch latency
- idle CPU with hidden Claude tabs

### Scenario D: Sidebars Under Load

- terminal pane active
- git/files/docs/plans sidebars exercised in the same project

Measure:

- idle CPU
- refresh latency after file changes
- terminal responsiveness while watchers/polls are active

## Acceptance Thresholds

These do not need to be perfect before starting work, but every patch should move at least one of them in the right direction.

- terminal output IPC message count should drop materially after batching
- renderer CPU during heavy Claude output should drop materially after transport and batching work
- memory growth from multiple Claude tabs should flatten after renderer unmounting work
- inactive Claude tabs should contribute little renderer cost
- idle CPU with no sidebars open should remain low and stable
- no noticeable typing latency should be introduced by batching

## Validation Matrix

Every performance patch touching terminal behavior should be manually checked against:

- normal shell prompt usage
- Claude Code session startup
- Claude Code streaming output
- multiple Claude tabs
- `vim`
- `less`
- `tmux`
- long command output
- terminal resize during active output
- copy/paste
- prompt marks and prompt navigation
- cwd tracking
- title tracking
- MCP attachment if enabled

## Patch Slicing

Recommended implementation slices:

### Slice 1: Instrumentation only

- add counters and timing
- no behavior changes

### Slice 2: Main-process output batching

- batch PTY output before IPC
- keep current renderer decoding path

### Slice 3: Renderer write batching

- queue terminal writes
- preserve current semantics

### Slice 4: Claude tab renderer unmounting

- keep backend sessions alive
- remount from backend state

### Slice 5: Lean Claude profile

- reduce addons and renderer cost for Claude sessions

### Slice 6: Event-store consolidation

- centralize `terminal:message` handling

### Slice 7: Sidebar/project-state cleanup

- reduce polling
- consolidate refresh logic

## Rollout Advice

For riskier changes, prefer temporary flags or scoped rollout controls.

Good candidates:

- output batching enabled or disabled
- Claude renderer unmounting enabled or disabled
- lean Claude terminal profile enabled or disabled

These do not need to become permanent user-facing settings. They are useful as development kill switches while behavior stabilizes.

## Suggested Milestones

### Milestone A: Hot Path

- instrumentation
- output batching
- renderer write batching
- Electron binary transport experiment

Success criteria:

- fewer IPC messages per second
- lower CPU during Claude output bursts
- smoother terminal scrolling

### Milestone B: Claude Panel

- only one mounted Claude renderer terminal at a time
- tab rehydration from backend state
- lean Claude terminal profile

Success criteria:

- memory use scales better with multiple Claude tabs
- less jank while switching Claude tabs

### Milestone C: Idle Load

- unified terminal event store
- reduced polling
- coalesced backend project state

Success criteria:

- lower idle CPU
- fewer background wakeups
- better foreground responsiveness while sidebars are open

## Risks

### Risk: Remounting terminals loses UI state

Mitigation:

- use backend terminal state as the source of truth
- explicitly rehydrate content, title, cwd, and command marks on mount

### Risk: Batching output hurts perceived latency

Mitigation:

- keep flush windows short
- benchmark 8ms vs 16ms
- prefer a small time budget over large buffers

### Risk: Event store refactor touches many files

Mitigation:

- start by wrapping the existing `onMessage` API in one renderer module
- migrate consumers gradually

### Risk: Transport optimization hides lost-output bugs

Mitigation:

- add byte and chunk counters before batching
- verify that total output received by the renderer matches backend totals
- keep batching windows short and deterministic

## Definition Of Success

This optimization pass is successful if:

- Claude-heavy sessions feel materially smoother without a framework rewrite
- multiple Claude tabs no longer cause a large renderer penalty
- idle CPU drops noticeably
- terminal throughput improves
- the app remains architecturally recognizable and shippable without a migration freeze
