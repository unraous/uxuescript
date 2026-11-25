# Tauri close barrier probe

This opt-in GUI probe creates local Data URL child WebViews under one host window. It reuses one child label across generations and verifies each generation's token with `eval_with_callback`; `PageLoadEvent` callbacks are logged when available but are not the readiness gate. It closes on the UI thread, waits for the closure result off-thread, then queues a second UI checkpoint before immediately recreating the same label. That checkpoint runs after the close closure has returned. The probe tests a retained stale clone, then rechecks the replacement token. A stale-clone callback timeout or dropped callback is recorded separately and does not count as a close barrier. Any unknown close/checkpoint/token result stops further generations. It does not call `close()` twice on a stale clone because Tauri's label-based registry removal could affect the replacement.

`registry_missing` is only Level-1 Tauri registry evidence. A verified replacement token demonstrates that the new same-label child is functional; together with the pinned Wry source path that removes the old child wrapper synchronously on the event-loop thread, this is evidence for Level 2 on the tested runtime. The probe cannot observe WebView2/COM final destruction (Level 3). It closes the final child and destroys the host window before exiting.

Run on Windows from the repository root:

```powershell
cmd /d /s /c "call D:\Vs\Common7\Tools\VsDevCmd.bat -arch=x64 -host_arch=x64 && cargo run --manifest-path src-tauri\Cargo.toml --features close-barrier-probe --bin close-barrier-probe -- 5"
```

The optional argument is the number of generations (2-100; default 2). Each stdout line is a JSON object with phase, generation, elapsed milliseconds, outcome, and optional error. A timeout/channel failure is `unknown`, never successful retirement. This exercises Tauri/WebView2 behavior locally and is not wired into normal app startup, IPC, or the DeepSeek solver; it does not prove Level 3 or production lifecycle behavior.

## Windows probe run

On 2026-11-23, the probe completed 5 generations on Windows 11 build `10.0.26200.0`, MSVC 19.42, Tauri/Wry 2.12.1, and WebView2 Runtime `157.0.4341.60`. All 5 child creations and 5 generation-token checks succeeded; each close returned successfully on `ThreadId(1)`, the Tauri registry was absent afterward, and an event-loop checkpoint completed before the next same-label create. All 4 retained prior-generation handles had their eval callback dropped; the replacement token remained correct after each probe. No label collision, crash, or visible host-window failure occurred. The final child and host window were closed.

This is Level-2 supporting evidence for this machine/runtime, not a direct inspection of Wry's private child vector or proof of WebView2 COM destruction. No `PageLoadEvent` callback was observed for the local Data URL, so token eval—not that callback—was used as page readiness. Window termination racing a pending close, forced dispatch failure, panic, and completion timeout were not induced on the real app window; the harness treats any close/checkpoint timeout as unknown and stops before another generation. The stale-clone repeated-`close()` hazard is intentionally not executed because Tauri removes registry entries by label; do not treat duplicate close as safe.
