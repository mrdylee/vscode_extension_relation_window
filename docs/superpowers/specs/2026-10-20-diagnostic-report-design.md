# Persistent diagnostic reports

Improve the existing Diagnostics / Report issue flow; no new panel or remote access.
The approved goal is one report containing current diagnostics, surviving prior-run
measurements, recent navigation action types and available host failure evidence.

- Store bounded JSONL records in workspace-specific extension storage. Use a unique
  session name, two 256 KiB segments per session and retain three sessions. Sample
  every 10 seconds and record navigation action types and index/Worker transitions.
  No source, symbols, paths or settings values in these records. Writes are async,
  bounded, serialized and best effort; an abrupt kill may lose pending records.
- Existing Report issue drafts add recent history and selected lifecycle/OOM lines
  from exthost.log / remoteagent.log in VS Code's known log layout. Discover only
  fixed log filenames near context.logUri and the immediately previous session;
  do not scan source folders or other extensions' private logs. Bounded tail reads,
  explicit missing/permission/layout status, no Worker request or index rebuild.
- Host excerpts may contain sensitive metadata. Label separately from the sanitized
  summary, redact known home/workspace roots, and require manual review before share.
  Never automatically upload. WSL cannot promise access to Windows Window logs.
- Keep draft editing/copy actions; add Save report to save the reviewed Markdown as
  one file. Save cancellation is harmless. Existing draft reuse remains intact.
- Host restart evidence is not proof of Dynsight causality. No crash-recovery or
  performance fix claimed. No diagnostics predating installation can be reconstructed
  except existing host logs. Full host freeze means the recorder also pauses.

Verify restart retention, bounded growth/queue, redaction, unreadable/missing files,
report UI/copy/save cancellation, no analysis requests, native and browser tests.
