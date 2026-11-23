use std::{
    env,
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};

use tauri::{
    webview::PageLoadEvent, AppHandle, LogicalPosition, LogicalSize, Manager, Webview,
    WebviewBuilder, WebviewUrl, Window, WindowBuilder,
};

const LABEL: &str = "close-barrier-child";
const WAIT: Duration = Duration::from_secs(5);

fn report(started: Instant, phase: &str, generation: usize, outcome: &str, error: Option<String>) {
    println!(
        "{}",
        serde_json::json!({
            "phase": phase,
            "generation": generation,
            "elapsed_ms": started.elapsed().as_millis(),
            "outcome": outcome,
            "error": error,
        })
    );
}

fn report_stage(
    started: Instant,
    phase: &str,
    generation: usize,
    stage: &str,
    outcome: &str,
    error: Option<String>,
    thread_id: Option<String>,
) {
    println!(
        "{}",
        serde_json::json!({
            "phase": phase,
            "generation": generation,
            "stage": stage,
            "elapsed_ms": started.elapsed().as_millis(),
            "outcome": outcome,
            "error": error,
            "thread_id": thread_id,
            "evidence_level": if stage == "registry_check" { Some(1) } else { None },
            "evidence_note": if stage == "token_verified" {
                Some("same-label JS functionality; not native destruction proof")
            } else {
                None
            },
        })
    );
}

fn main_thread<T: Send + 'static>(
    app: &AppHandle,
    phase: &'static str,
    generation: usize,
    action: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let started = Instant::now();
    let (send, receive) = mpsc::sync_channel(1);
    report_stage(
        started,
        phase,
        generation,
        "dispatch_requested",
        "pending",
        None,
        None,
    );
    app.run_on_main_thread(move || {
        let closure_started = Instant::now();
        report_stage(
            closure_started,
            phase,
            generation,
            "closure_started",
            "running",
            None,
            Some(format!("{:?}", thread::current().id())),
        );
        let result = action();
        report_stage(
            closure_started,
            phase,
            generation,
            if phase == "close" {
                "close_return"
            } else {
                "action_return"
            },
            if result.is_ok() { "ok" } else { "error" },
            result.as_ref().err().cloned(),
            Some(format!("{:?}", thread::current().id())),
        );
        report_stage(
            closure_started,
            phase,
            generation,
            "closure_body_finished",
            "body_finished",
            None,
            Some(format!("{:?}", thread::current().id())),
        );
        let completion_sent = send.send(result).is_ok();
        report_stage(
            closure_started,
            phase,
            generation,
            if completion_sent {
                "completion_sent"
            } else {
                "completion_receiver_gone"
            },
            if completion_sent { "sent" } else { "unknown" },
            None,
            Some(format!("{:?}", thread::current().id())),
        );
    })
    .map_err(|error| {
        let detail = format!("{phase} dispatch failed: {error}");
        report_stage(
            started,
            phase,
            generation,
            "dispatch_error",
            "unknown",
            Some(detail.clone()),
            None,
        );
        detail
    })?;
    let result = receive.recv_timeout(WAIT).map_err(|error| match error {
        RecvTimeoutError::Timeout => format!("{phase} completion timeout"),
        RecvTimeoutError::Disconnected => format!("{phase} completion channel closed"),
    });
    match result {
        Ok(Ok(value)) => {
            report_stage(
                started,
                phase,
                generation,
                "completion_received",
                "received",
                None,
                None,
            );
            Ok(value)
        }
        Ok(Err(error)) => {
            report_stage(
                started,
                phase,
                generation,
                "completion_received",
                "operation_error",
                Some(error.clone()),
                None,
            );
            Err(error)
        }
        Err(error) => {
            report_stage(
                started,
                phase,
                generation,
                "completion_unknown",
                "unknown",
                Some(error.clone()),
                None,
            );
            Err(error)
        }
    }
}

fn create_child(window: &Window, generation: usize) -> Result<Webview, String> {
    let token = format!("generation-{generation}");
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>close barrier probe</title><script>window.__probeToken='{token}'</script><body>{token}</body>"
    );
    let url = tauri::Url::parse(&format!("data:text/html;charset=utf-8,{html}"))
        .map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let logical_size: LogicalSize<f64> = LogicalSize::from_physical(
        size,
        window.scale_factor().map_err(|error| error.to_string())?,
    );
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::CustomProtocol(url)).on_page_load(
        move |_, payload| {
            println!(
                "{}",
                serde_json::json!({
                    "phase": "page_load",
                    "generation": generation,
                    "event": if payload.event() == PageLoadEvent::Started { "started" } else { "finished" },
                    "url": payload.url().as_str(),
                })
            );
        },
    );
    let child = window
        .add_child(builder, LogicalPosition::new(0.0, 0.0), logical_size)
        .map_err(|error| error.to_string())?;
    Ok(child)
}

fn probe_stale_clone(view: &Webview, generation: usize, started: Instant) {
    let (send, receive) = mpsc::sync_channel(1);
    match view.eval_with_callback("window.__probeToken", move |raw| {
        let _ = send.send(raw);
    }) {
        Err(error) => {
            report(
                started,
                "stale_clone_probe",
                generation,
                "rejected",
                Some(error.to_string()),
            );
        }
        Ok(()) => match receive.recv_timeout(WAIT) {
            Ok(raw) => {
                report(
                    started,
                    "stale_clone_probe",
                    generation,
                    "callback_received",
                    Some(raw),
                );
            }
            Err(RecvTimeoutError::Timeout) => {
                report(
                    started,
                    "stale_clone_probe",
                    generation,
                    "no_callback",
                    None,
                );
            }
            Err(RecvTimeoutError::Disconnected) => {
                report(
                    started,
                    "stale_clone_probe",
                    generation,
                    "callback_dropped",
                    Some("callback channel closed".to_owned()),
                );
            }
        },
    }
}

fn read_token(view: &Webview, generation: usize, started: Instant) -> Result<(), String> {
    let expected = format!("generation-{generation}");
    let deadline = Instant::now() + WAIT;
    let mut last_value = None;
    while Instant::now() < deadline {
        let (send, receive) = mpsc::sync_channel(1);
        view.eval_with_callback("window.__probeToken ?? null", move |raw| {
            let _ = send.send(raw);
        })
        .map_err(|error| {
            let detail = format!("eval dispatch failed: {error}");
            report(
                started,
                "token_eval",
                generation,
                "unknown",
                Some(detail.clone()),
            );
            detail
        })?;

        match receive.recv_timeout(Duration::from_millis(500)) {
            Ok(raw) => {
                let actual = serde_json::from_str::<String>(&raw).unwrap_or(raw.clone());
                if actual == expected {
                    report_stage(
                        started,
                        "token_eval",
                        generation,
                        "token_verified",
                        "ok",
                        None,
                        None,
                    );
                    return Ok(());
                }
                last_value = Some(raw);
            }
            Err(RecvTimeoutError::Timeout) => last_value = Some("callback_timeout".to_owned()),
            Err(RecvTimeoutError::Disconnected) => {
                let detail = "callback channel closed".to_owned();
                report(
                    started,
                    "token_eval",
                    generation,
                    "unknown",
                    Some(detail.clone()),
                );
                return Err(detail);
            }
        }
        thread::sleep(Duration::from_millis(100));
    }

    let detail = format!(
        "token was not observable within {WAIT:?}; last callback={}",
        last_value.unwrap_or_else(|| "none".to_owned())
    );
    report(
        started,
        "token_eval",
        generation,
        "unknown",
        Some(detail.clone()),
    );
    Err(detail)
}

fn close_view(
    app: &AppHandle,
    window: &Window,
    view: Webview,
    generation: usize,
    phase: &'static str,
    started: Instant,
) -> Result<(), String> {
    let window = window.clone();
    match main_thread(app, phase, generation, move || {
        view.close().map_err(|e| e.to_string())?;
        let missing = window.get_webview(LABEL).is_none();
        report_stage(
            Instant::now(),
            phase,
            generation,
            "registry_check",
            if missing {
                "registry_missing"
            } else {
                "registry_present"
            },
            None,
            Some(format!("{:?}", thread::current().id())),
        );
        Ok(())
    }) {
        Ok(()) => {
            report(started, phase, generation, "ok", None);
            Ok(())
        }
        Err(error) => {
            report(started, phase, generation, "unknown", Some(error.clone()));
            Err(error)
        }
    }?;

    // A second event-loop task is processed only after the close closure has returned.
    main_thread(app, "close_eventloop_checkpoint", generation, || Ok(()))?;
    report(
        started,
        "close_eventloop_checkpoint",
        generation,
        "returned",
        None,
    );
    Ok(())
}

fn run_probe(app: AppHandle, window: Window, rounds: usize) {
    let started = Instant::now();
    let mut current: Option<Webview> = None;
    let mut current_generation = 0;
    let mut previous: Option<(usize, Webview)> = None;

    for generation in 1..=rounds {
        if let Some(old) = current.take() {
            let old_generation = generation - 1;
            let old_clone = old.clone();
            if close_view(&app, &window, old, old_generation, "close", Instant::now()).is_err() {
                break;
            }
            previous = Some((old_generation, old_clone));
        }

        let create_started = Instant::now();
        let child = match main_thread(&app, "create", generation, {
            let window = window.clone();
            move || create_child(&window, generation)
        }) {
            Ok(child) => {
                report(create_started, "create", generation, "ok", None);
                child
            }
            Err(error) => {
                report(create_started, "create", generation, "unknown", Some(error));
                break;
            }
        };
        let replacement = child.clone();
        current = Some(child);
        current_generation = generation;
        if read_token(&replacement, generation, Instant::now()).is_err() {
            break;
        }

        if let Some((old_generation, old_clone)) = previous.take() {
            probe_stale_clone(&old_clone, old_generation, Instant::now());
            if read_token(&replacement, generation, Instant::now()).is_err() {
                break;
            }
        }
    }

    if let Some(view) = current.take() {
        let _ = close_view(
            &app,
            &window,
            view,
            current_generation,
            "final_close",
            Instant::now(),
        );
    }
    let end_started = Instant::now();
    match main_thread(&app, "owner_destroy", 0, move || {
        window.destroy().map_err(|error| error.to_string())
    }) {
        Ok(()) => report(end_started, "owner_destroy", 0, "ok", None),
        Err(error) => report(end_started, "owner_destroy", 0, "unknown", Some(error)),
    }
    report(started, "run", rounds, "finished", None);
    app.exit(0);
}

fn main() {
    let rounds = env::args()
        .nth(1)
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|rounds| (2..=100).contains(rounds))
        .unwrap_or(2);

    tauri::Builder::default()
        .setup(move |app| {
            let window = WindowBuilder::new(app, "close-barrier-host")
                .title("Tauri close barrier probe")
                .inner_size(640.0, 480.0)
                .build()?;
            let handle = app.handle().clone();
            thread::spawn(move || run_probe(handle, window, rounds));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("close barrier probe failed");
}
