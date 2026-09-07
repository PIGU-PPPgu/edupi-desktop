use std::{
    collections::HashSet,
    env,
    fs::{self, OpenOptions},
    io::{self, BufRead, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt as _;
#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

use serde::Serialize;
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{Color, NewWindowResponse},
    AppHandle, Emitter, Manager, RunEvent, Theme, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

mod computer_use;

const WINDOW_LABEL: &str = "main";
const DESKTOP_API_TOKEN_ENV: &str = "PI_DESKTOP_API_TOKEN";
const DESKTOP_INSTANCE_ID_ENV: &str = "PI_DESKTOP_INSTANCE_ID";
const DESKTOP_INSTANCE_ID_HEADER: &str = "x-pi-desktop-instance";
const EDUPI_DATA_ROOT_ENV: &str = "EDUPI_DATA_ROOT";
const EDUPI_PROJECT_ROOT_ENV: &str = "EDUPI_PROJECT_ROOT";
const EDUPI_WORKSPACE_ENV: &str = "EDUPI_WORKSPACE";
const EDUPI_CORE_ROOT_ENV: &str = "EDUPI_CORE_ROOT";
const EDUPI_DATA_ALLOWED_ROOT_ENV: &str = "EDUPI_DATA_ALLOWED_ROOT";
const EDUPI_CORE_ALLOWED_ROOT_ENV: &str = "EDUPI_CORE_ALLOWED_ROOT";
const EDUPI_CORE_RELEASE_MODE_ENV: &str = "EDUPI_CORE_RELEASE_MODE";
const EDUPI_DATA_PREF_KEY: &str = "edupiDataRoot";
const MANAGED_DATA_DIRECTORY: &str = "edupi-data";
const FALLBACK_PERSISTED_MISSING: &str = "persisted_missing";
const FALLBACK_PERSISTED_NO_KEY: &str = "persisted_no_key";
const FALLBACK_PERSISTED_UNREADABLE: &str = "persisted_unreadable";
const FALLBACK_PERSISTED_CORRUPT: &str = "persisted_corrupt";
const FALLBACK_PERSISTED_NON_OBJECT: &str = "persisted_non_object";
const FALLBACK_PERSISTED_INVALID: &str = "persisted_invalid";
const FALLBACK_PERSISTED_RELATIVE: &str = "persisted_relative";
const FALLBACK_PERSISTED_SYMLINK: &str = "persisted_symlink";
const FALLBACK_PERSISTED_NOT_DIRECTORY: &str = "persisted_not_directory";
const FALLBACK_PERSISTED_FILESYSTEM_ROOT: &str = "persisted_filesystem_root";
#[cfg(not(feature = "custom-protocol"))]
const DEV_SERVER_URL: &str = "http://127.0.0.1:30141";
/// Preferred localhost port for the packaged Next server. Keeping this stable
/// matters because the webview's localStorage is origin-scoped (`host:port`).
#[cfg(feature = "custom-protocol")]
const DESKTOP_SERVER_PORT: u16 = 38471;
#[cfg(feature = "custom-protocol")]
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LIGHT_WINDOW_BG: Color = Color(247, 247, 245, 255);
const DARK_WINDOW_BG: Color = Color(28, 28, 30, 255);

const PINNED_CORE_COMMIT: &str = "a77d6940bd939a20f42d84f433c1b0c3bb8fea1a";
const PINNED_CORE_MANIFEST_HASH: &str =
    "sha256:d195f2c1b83c447a5fd8a9b5a4db5f9d5c388c3113ab590ebd7a76e7c93e8c1c";
const PINNED_CORE_SCHEMA_HASH: &str =
    "sha256:315be5504ecffa382213d90211fc6263664bdcfcbb7974edb5994d0c3e7aaef2";
const EMBEDDED_CORE_COMPAT_MANIFEST: &str = include_str!("../../contracts/edupi-core-compat.json");

struct DesktopServer {
    child: Mutex<Option<Child>>,
    core_child: Mutex<Option<Child>>,
}

/// When true, closing the main window quits the app; otherwise it hides to tray.
struct CloseQuits(Mutex<bool>);

struct DesktopApiToken(String);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EduPiRootStatus {
    data_root: String,
    data_source: String,
    core_root: String,
    core_source: String,
    fallback_reason: Option<String>,
    can_change_data_root: bool,
    restart_required: bool,
}

fn generate_random_hex() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn load_or_generate_desktop_api_token() -> Result<String, String> {
    if let Ok(value) = env::var(DESKTOP_API_TOKEN_ENV) {
        let value = value.trim();
        if value.len() >= 32 {
            return Ok(value.to_string());
        }
    }

    generate_random_hex()
}

#[tauri::command]
fn get_desktop_api_token(token: tauri::State<'_, DesktopApiToken>) -> String {
    token.0.clone()
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit_application(app: &AppHandle) {
    if let Some(server) = app.try_state::<DesktopServer>() {
        server.stop();
    }
    app.exit(0);
}

impl DesktopServer {
    #[cfg(not(feature = "custom-protocol"))]
    fn empty() -> Self {
        Self {
            child: Mutex::new(None),
            core_child: Mutex::new(None),
        }
    }

    fn running(child: Child) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            core_child: Mutex::new(None),
        }
    }

    fn running_with_core(child: Child, core_child: Option<Child>) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            core_child: Mutex::new(core_child),
        }
    }

    fn stop(&self) {
        if let Ok(mut core_guard) = self.core_child.lock() {
            if let Some(mut child) = core_guard.take() {
                stop_core_supervisor_process(&mut child);
            }
        }
        let Ok(mut guard) = self.child.lock() else {
            return;
        };
        let Some(mut child) = guard.take() else {
            return;
        };

        terminate_process_tree(&mut child);
    }
}

fn stop_core_supervisor_process(child: &mut Child) {
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"stop\n");
        let _ = stdin.flush();
    }
    // The broker owns one 20-second Core drain/force deadline. Give it a small
    // transport/reap margin, then fall back to killing the complete process
    // group before Next is stopped.
    let deadline = Instant::now() + Duration::from_secs(25);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => break,
        }
    }
    terminate_process_tree(child);
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        unsafe {
            // The Node server owns its process group, so this also stops any
            // agent/tool subprocesses that are active when the App quits.
            libc::kill(-(child.id() as i32), libc::SIGTERM);
        }

        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }

        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        // taskkill /T terminates the packaged Node server and any agent/tool
        // subprocesses it started. CREATE_NO_WINDOW avoids flashing a console.
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for DesktopServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn open_external(url: &Url) {
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return;
    }

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("/usr/bin/open").arg(url.as_str()).spawn();
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url.as_str()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(url.as_str()).spawn();
    }
}

fn open_path_with_default_app(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // explorer.exe applies the default file association without going
        // through the cmd parser, where `&` or `^` in an otherwise legal path
        // (`C:\src\R&D\notes.txt`) would be read as a command separator.
        Command::new("explorer.exe")
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening local paths is unsupported on this platform".into())
}

fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .args(["-R"])
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", path.to_string_lossy()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Reveal in folder is unsupported on this platform".into())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Only http, https, and mailto URLs can be opened externally".into());
    }
    open_external(&parsed);
    Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open_path_with_default_app(Path::new(&path))
}

#[tauri::command]
fn reveal_item_in_dir(path: String) -> Result<(), String> {
    reveal_path_in_file_manager(Path::new(&path))
}

#[tauri::command]
fn set_close_quits(app: AppHandle, quit: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<CloseQuits>() {
        *state
            .0
            .lock()
            .map_err(|_| "close-behavior lock poisoned".to_string())? = quit;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) -> Result<(), String> {
    quit_application(&app);
    Ok(())
}

#[tauri::command]
fn show_main_window_cmd(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    Ok(())
}

/// Persist the UI theme outside the webview origin so cold starts keep the
/// user's light/dark choice even when the local server port changes.
#[tauri::command]
fn set_ui_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let theme =
        normalize_theme(&theme).ok_or_else(|| "theme must be \"light\" or \"dark\"".to_string())?;
    write_ui_prefs_theme(&app, theme)?;
    apply_window_theme(&app, theme);
    Ok(())
}

#[tauri::command]
fn get_edupi_root_status(app: AppHandle) -> Result<EduPiRootStatus, String> {
    edupi_launch_roots(&app)
        .map(|roots| roots.status)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_edupi_data_root(app: AppHandle, path: String) -> Result<EduPiRootStatus, String> {
    let current = edupi_launch_roots(&app).map_err(|error| error.to_string())?;
    if !current.status.can_change_data_root {
        return Err("EduPi data root is controlled by an environment override".into());
    }
    let root = validate_selected_data_root(path).map_err(|error| error.to_string())?;
    ensure_data_directories(&root).map_err(|error| error.to_string())?;
    write_edupi_data_root_pref(&app, &root).map_err(|error| error.to_string())?;
    let mut status = edupi_launch_roots(&app)
        .map_err(|error| error.to_string())?
        .status;
    status.restart_required = true;
    Ok(status)
}

#[tauri::command]
fn reset_edupi_data_root(app: AppHandle) -> Result<EduPiRootStatus, String> {
    let current = edupi_launch_roots(&app).map_err(|error| error.to_string())?;
    if !current.status.can_change_data_root {
        return Err("EduPi data root is controlled by an environment override".into());
    }
    remove_edupi_data_root_pref(&app).map_err(|error| error.to_string())?;
    let mut status = edupi_launch_roots(&app)
        .map_err(|error| error.to_string())?
        .status;
    status.restart_required = true;
    Ok(status)
}

fn ui_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join("ui-prefs.json"))
}

fn normalize_theme(theme: &str) -> Option<&'static str> {
    match theme {
        "light" => Some("light"),
        "dark" => Some("dark"),
        _ => None,
    }
}

fn read_ui_prefs(app: &AppHandle) -> serde_json::Value {
    let Ok(path) = ui_prefs_path(app) else {
        return serde_json::json!({});
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_ui_prefs(app: &AppHandle, prefs: &serde_json::Value) -> Result<(), String> {
    let path = ui_prefs_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn read_stored_theme(app: &AppHandle) -> Option<&'static str> {
    read_ui_prefs(app)
        .get("theme")
        .and_then(|value| value.as_str())
        .and_then(normalize_theme)
}

fn write_ui_prefs_theme(app: &AppHandle, theme: &str) -> Result<(), String> {
    let mut prefs = read_ui_prefs(app);
    if !prefs.is_object() {
        prefs = serde_json::json!({});
    }
    prefs["theme"] = serde_json::Value::String(theme.to_string());
    write_ui_prefs(app, &prefs)
}

fn write_edupi_data_root_pref(app: &AppHandle, root: &str) -> Result<(), String> {
    let mut prefs = read_ui_prefs(app);
    if !prefs.is_object() {
        prefs = serde_json::json!({});
    }
    prefs[EDUPI_DATA_PREF_KEY] = serde_json::Value::String(root.to_string());
    write_ui_prefs(app, &prefs)
}

fn remove_edupi_data_root_pref(app: &AppHandle) -> Result<(), String> {
    let mut prefs = read_ui_prefs(app);
    if let Some(object) = prefs.as_object_mut() {
        object.remove(EDUPI_DATA_PREF_KEY);
    } else {
        prefs = serde_json::json!({});
    }
    write_ui_prefs(app, &prefs)
}

#[cfg(feature = "custom-protocol")]
fn read_last_server_port(app: &AppHandle) -> Option<u16> {
    read_ui_prefs(app)
        .get("serverPort")
        .and_then(|value| value.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
}

#[cfg(feature = "custom-protocol")]
fn write_last_server_port(app: &AppHandle, port: u16) {
    let Ok(path) = ui_prefs_path(app) else {
        return;
    };
    let _ = update_server_port_in_prefs(&path, port);
}

#[cfg(feature = "custom-protocol")]
fn update_server_port_in_prefs(path: &Path, port: u16) -> Result<bool, io::Error> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let prefs = serde_json::json!({ "serverPort": port });
            let updated = serde_json::to_string_pretty(&prefs).map_err(io::Error::other)?;
            fs::write(path, updated)?;
            return Ok(true);
        }
        Err(error) => return Err(error),
    };
    let mut prefs: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let Some(object) = prefs.as_object_mut() else {
        return Ok(false);
    };
    object.insert("serverPort".to_string(), serde_json::Value::from(port));
    let updated = serde_json::to_string_pretty(&prefs).map_err(io::Error::other)?;
    fs::write(path, updated)?;
    Ok(true)
}

fn theme_background_color(theme: &str) -> Color {
    if theme == "dark" {
        DARK_WINDOW_BG
    } else {
        LIGHT_WINDOW_BG
    }
}

fn theme_bootstrap_script(theme: &str) -> String {
    // Runs before page scripts so localStorage/class match the persisted
    // preference even on a fresh webview origin (new localhost port).
    format!(
        r#"(function(){{try{{localStorage.setItem("pi-theme","{theme}");var d="{theme}"==="dark";document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}}catch(e){{}}}})();"#
    )
}

fn apply_window_theme(app: &AppHandle, theme: &str) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    let tauri_theme = if theme == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    };
    let _ = window.set_theme(Some(tauri_theme));
    let _ = window.set_background_color(Some(theme_background_color(theme)));
}

fn same_origin(candidate: &Url, app_url: &Url) -> bool {
    candidate.scheme() == app_url.scheme()
        && candidate.host_str() == app_url.host_str()
        && candidate.port_or_known_default() == app_url.port_or_known_default()
}

fn build_window(app: &tauri::AppHandle, app_url: Url) -> tauri::Result<WebviewWindow> {
    let navigation_origin = app_url.clone();
    let stored_theme = read_stored_theme(app);

    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(app_url))
        .title("EduPi")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        // Pi Agent already handles browser drag/drop for image attachments.
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if same_origin(url, &navigation_origin) {
                true
            } else {
                open_external(url);
                false
            }
        })
        .on_new_window(|url, _features| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        });

    // Force the native window chrome/background to match an explicit UI theme
    // before the page paints — otherwise macOS dark mode flashes a black
    // webview while the user has chosen light mode.
    if let Some(theme) = stored_theme {
        let tauri_theme = if theme == "dark" {
            Theme::Dark
        } else {
            Theme::Light
        };
        builder = builder
            .theme(Some(tauri_theme))
            .background_color(theme_background_color(theme))
            .initialization_script(theme_bootstrap_script(theme));
    }

    // Hide the native title bar. macOS keeps the traffic-light controls
    // (overlaid on our own top bar); other platforms go fully frameless and
    // rely on custom window controls drawn in the web content instead.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }

    builder.build()
}

#[cfg(all(feature = "custom-protocol", unix))]
fn login_shell_path() -> Option<String> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let output = Command::new(shell)
        .args(["-l", "-c", "/usr/bin/env"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("PATH="))
        .map(str::to_string)
        .filter(|path| !path.is_empty())
}

#[cfg(all(feature = "custom-protocol", windows))]
fn login_shell_path() -> Option<String> {
    env::var("PATH").ok().filter(|path| !path.is_empty())
}

#[cfg(all(feature = "custom-protocol", target_os = "macos"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/Pi Agent Server.app/Contents/MacOS/node")
}

#[cfg(all(feature = "custom-protocol", target_os = "windows"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/node/node.exe")
}

#[cfg(all(feature = "custom-protocol", target_os = "linux"))]
fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/node/node")
}

#[cfg(feature = "custom-protocol")]
fn child_process_compatible_path(path: &Path) -> PathBuf {
    // Tauri resolves its Windows resource directory from a canonicalized
    // executable path. `std::fs::canonicalize` uses the verbatim `\\?\C:\...`
    // form on Windows, but Node's entry-point resolver is not verbatim-path
    // aware and reduces that argument to the bare drive (`C:`). Simplify the
    // path before it crosses the process boundary. On non-Windows platforms
    // this is intentionally a no-op.
    dunce::simplified(path).to_path_buf()
}

#[cfg(feature = "custom-protocol")]
fn server_process_path(node_path: &Path) -> Option<std::ffi::OsString> {
    let inherited = login_shell_path().unwrap_or_default();
    let mut paths = vec![node_path.parent()?.to_path_buf()];
    paths.extend(env::split_paths(&inherited));
    env::join_paths(paths).ok()
}

#[cfg(feature = "custom-protocol")]
struct CoreProxyReady {
    endpoint: String,
    supervisor_session_id: String,
}

#[cfg(feature = "custom-protocol")]
#[derive(Clone)]
struct CoreMonitorIdentity {
    proxy_endpoint: String,
    core_endpoint: String,
    core_token: String,
    schema_hash: String,
    supervisor_session_id: String,
    core_commit: String,
    component_manifest_hash: String,
}

#[cfg(feature = "custom-protocol")]
fn read_bounded_json_line<R: BufRead>(reader: &mut R) -> io::Result<Option<JsonValue>> {
    const MAX_LINE_BYTES: usize = 64 * 1024;
    let mut bytes = Vec::with_capacity(1024);
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Core supervisor emitted an unterminated envelope",
            ));
        }
        if let Some(index) = available.iter().position(|byte| *byte == b'\n') {
            if bytes.len() + index > MAX_LINE_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Core supervisor envelope is oversized",
                ));
            }
            bytes.extend_from_slice(&available[..index]);
            reader.consume(index + 1);
            let text = std::str::from_utf8(&bytes)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Core supervisor envelope is not UTF-8"))?;
            let value = serde_json::from_str(text)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            return Ok(Some(value));
        }
        if bytes.len() + available.len() > MAX_LINE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Core supervisor envelope is oversized",
            ));
        }
        let length = available.len();
        bytes.extend_from_slice(available);
        reader.consume(length);
    }
}

#[cfg(feature = "custom-protocol")]
fn has_exact_json_keys(value: &JsonValue, expected: &[&str]) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
}

#[cfg(feature = "custom-protocol")]
fn is_sha256_identity(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(feature = "custom-protocol")]
fn monitor_core_envelope(value: &JsonValue, identity: &CoreMonitorIdentity) -> bool {
    let status = value.get("status").and_then(JsonValue::as_str);
    if status == Some("failed") {
        return has_exact_json_keys(value, &["status", "code", "external_send"])
            && value.get("external_send").and_then(JsonValue::as_bool) == Some(false);
    }
    if !matches!(status, Some("ready" | "restarted"))
        || !has_exact_json_keys(
            value,
            &[
                "status",
                "child_pid",
                "endpoint",
                "protocol",
                "protocol_version",
                "schema_hash",
                "supervisor_session_id",
                "core_commit",
                "component_manifest_hash",
                "data_root_fingerprint",
                "instance_nonce",
                "fencing_generation",
                "external_send",
            ],
        )
        || value.get("endpoint").and_then(JsonValue::as_str)
            != Some(identity.proxy_endpoint.as_str())
        || value.get("protocol").and_then(JsonValue::as_str) != Some("edupi-core-runtime")
        || value.get("protocol_version").and_then(JsonValue::as_u64) != Some(1)
        || value.get("schema_hash").and_then(JsonValue::as_str)
            != Some(identity.schema_hash.as_str())
        || value.get("supervisor_session_id").and_then(JsonValue::as_str)
            != Some(identity.supervisor_session_id.as_str())
        || value.get("core_commit").and_then(JsonValue::as_str)
            != Some(identity.core_commit.as_str())
        || value.get("component_manifest_hash").and_then(JsonValue::as_str)
            != Some(identity.component_manifest_hash.as_str())
        || value.get("child_pid").and_then(JsonValue::as_u64).is_none_or(|pid| pid == 0)
        || value.get("external_send").and_then(JsonValue::as_bool) != Some(false)
    {
        return false;
    }
    let Some(fingerprint) = value.get("data_root_fingerprint").and_then(JsonValue::as_str) else {
        return false;
    };
    let Some(nonce) = value.get("instance_nonce").and_then(JsonValue::as_str) else {
        return false;
    };
    let Some(generation) = value.get("fencing_generation").and_then(JsonValue::as_u64) else {
        return false;
    };
    is_sha256_identity(fingerprint)
        && nonce.len() >= 8
        && generation > 0
        && core_health_matches(
            &identity.core_endpoint,
            &identity.core_token,
            &identity.schema_hash,
            &identity.supervisor_session_id,
            &identity.core_commit,
            &identity.component_manifest_hash,
            fingerprint,
            nonce,
            generation,
        )
        .unwrap_or(false)
}

#[cfg(feature = "custom-protocol")]
fn start_supervisor_output_monitor(
    stdout: impl Read + Send + 'static,
    app: AppHandle,
    identity: Option<CoreMonitorIdentity>,
) -> mpsc::Receiver<io::Result<JsonValue>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let first = match read_bounded_json_line(&mut reader) {
            Ok(Some(value)) => Ok(value),
            Ok(None) => Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Core supervisor exited before broker readiness",
            )),
            Err(error) => Err(error),
        };
        let continue_monitoring = first.is_ok();
        let _ = sender.send(first);
        if !continue_monitoring {
            return;
        }
        loop {
            match read_bounded_json_line(&mut reader) {
                Ok(Some(value)) => {
                    if let Some(expected) = identity.as_ref() {
                        if !monitor_core_envelope(&value, expected) {
                            app.exit(1);
                            return;
                        }
                    } else if value.get("status").and_then(JsonValue::as_str) != Some("failed") {
                        // One-shot mode has no resident Core identity stream.
                        app.exit(1);
                        return;
                    }
                }
                Ok(None) => return,
                Err(_) => {
                    app.exit(1);
                    return;
                }
            }
        }
    });
    receiver
}

#[cfg(feature = "custom-protocol")]
fn start_core_supervisor(
    app: &tauri::AppHandle,
    node_path: &Path,
    roots: &EduPiLaunchRoots,
    release_mode: &str,
    desktop_state_dir: &Path,
    client_port: u16,
    core_port: Option<u16>,
) -> Result<(Child, CoreProxyReady, String, String), Box<dyn std::error::Error>> {
    let resource_dir = child_process_compatible_path(&app.path().resource_dir()?);
    let supervisor_script = resource_dir.join("resources/server/core-supervisor.cjs");
    if !supervisor_script.is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "Core supervisor is missing").into());
    }
    let client_token = generate_random_hex().map_err(io::Error::other)?;
    let core_token = if release_mode == "daemon" {
        Some(generate_random_hex().map_err(io::Error::other)?)
    } else {
        None
    };
    let session = generate_random_hex().map_err(io::Error::other)?;
    let attestation = generate_random_hex().map_err(io::Error::other)?;
    let mut command = Command::new(node_path);
    command
        .arg(&supervisor_script)
        .current_dir(&resource_dir)
        .env("EDUPI_CORE_RELEASE_MODE", release_mode)
        .env("EDUPI_CORE_ROOT", &roots.core_root)
        .env("EDUPI_DATA_ROOT", &roots.data_root)
        .env("EDUPI_CORE_CLIENT_TOKEN", &client_token)
        .env("EDUPI_CORE_CLIENT_PORT", client_port.to_string())
        .env("EDUPI_CORE_SUPERVISOR_SESSION", &session)
        .env("EDUPI_CORE_COMMIT", PINNED_CORE_COMMIT)
        .env("EDUPI_CORE_COMPONENT_MANIFEST_HASH", PINNED_CORE_MANIFEST_HASH)
        .env("EDUPI_CORE_SCHEMA_HASH", PINNED_CORE_SCHEMA_HASH)
        .env("PI_DESKTOP_STATE_DIR", desktop_state_dir)
        .env("PI_WEB_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let (Some(port), Some(token)) = (core_port, core_token.as_ref()) {
        command
            .env("EDUPI_CORE_PORT", port.to_string())
            .env("EDUPI_CORE_TOKEN", token);
    }
    if let Some(path) = server_process_path(node_path) {
        command.env("PATH", path);
    }
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn()?;
    let Some(stdout) = child.stdout.take() else {
        terminate_process_tree(&mut child);
        return Err(io::Error::other("Core supervisor stdout unavailable").into());
    };
    let proxy_endpoint = format!("http://127.0.0.1:{client_port}/runtime/v1");
    let monitor_identity = match (core_port, core_token) {
        (Some(port), Some(token)) => Some(CoreMonitorIdentity {
            proxy_endpoint: proxy_endpoint.clone(),
            core_endpoint: format!("http://127.0.0.1:{port}/runtime/v1"),
            core_token: token,
            schema_hash: PINNED_CORE_SCHEMA_HASH.to_string(),
            supervisor_session_id: session.clone(),
            core_commit: PINNED_CORE_COMMIT.to_string(),
            component_manifest_hash: PINNED_CORE_MANIFEST_HASH.to_string(),
        }),
        _ => None,
    };
    let receiver = start_supervisor_output_monitor(stdout, app.clone(), monitor_identity);
    let ready = match receiver.recv_timeout(SERVER_START_TIMEOUT) {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            terminate_process_tree(&mut child);
            return Err(error.into());
        }
        Err(_) => {
            terminate_process_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Core broker readiness timeout",
            )
            .into());
        }
    };
    if !has_exact_json_keys(
        &ready,
        &[
            "status",
            "mode",
            "endpoint",
            "protocol",
            "protocol_version",
            "schema_hash",
            "supervisor_session_id",
            "core_commit",
            "component_manifest_hash",
            "external_send",
        ],
    )
        || ready.get("status").and_then(JsonValue::as_str) != Some("supervisor_ready")
        || ready.get("mode").and_then(JsonValue::as_str) != Some(release_mode)
        || ready.get("endpoint").and_then(JsonValue::as_str) != Some(proxy_endpoint.as_str())
        || ready.get("protocol").and_then(JsonValue::as_str) != Some("edupi-core-runtime")
        || ready.get("protocol_version").and_then(JsonValue::as_u64) != Some(1)
        || ready.get("schema_hash").and_then(JsonValue::as_str)
            != Some(PINNED_CORE_SCHEMA_HASH)
        || ready.get("supervisor_session_id").and_then(JsonValue::as_str)
            != Some(session.as_str())
        || ready.get("core_commit").and_then(JsonValue::as_str) != Some(PINNED_CORE_COMMIT)
        || ready.get("component_manifest_hash").and_then(JsonValue::as_str)
            != Some(PINNED_CORE_MANIFEST_HASH)
        || ready.get("external_send").and_then(JsonValue::as_bool) != Some(false)
    {
        terminate_process_tree(&mut child);
        return Err(io::Error::other("Core broker identity mismatch").into());
    }
    Ok((
        child,
        CoreProxyReady {
            endpoint: proxy_endpoint,
            supervisor_session_id: session,
        },
        client_token,
        attestation,
    ))
}

#[cfg(feature = "custom-protocol")]
fn core_health_matches(
    endpoint: &str,
    token: &str,
    schema_hash: &str,
    session: &str,
    commit: &str,
    manifest_hash: &str,
    data_fingerprint: &str,
    instance_nonce: &str,
    fencing_generation: u64,
) -> io::Result<bool> {
    let parsed = endpoint
        .strip_prefix("http://127.0.0.1:")
        .and_then(|value| value.strip_suffix("/runtime/v1"))
        .ok_or_else(|| io::Error::other("invalid Core endpoint"))?;
    let port: u16 = parsed
        .parse()
        .map_err(|_| io::Error::other("invalid Core port"))?;
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let body = serde_json::json!({"protocol":"edupi-core-runtime","protocol_version":1,"schema_hash":schema_hash,"request_id":"tauri-health","operation":"health","payload":null}).to_string();
    let request = format!("POST /runtime/v1 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    stream.write_all(request.as_bytes())?;
    let mut response = Vec::new();
    let mut chunk = [0_u8; 8192];
    while response.len() <= 4_259_840 {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
    }
    if response.len() > 4_259_840 {
        return Ok(false);
    }
    let Ok(text) = std::str::from_utf8(&response) else {
        return Ok(false);
    };
    let Some((headers, body)) = text.split_once("\r\n\r\n") else {
        return Ok(false);
    };
    if !headers.starts_with("HTTP/1.1 200 ") {
        return Ok(false);
    }
    let lengths = headers
        .lines()
        .skip(1)
        .filter_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case("content-length")
                    .then_some(value.trim())
            })
        })
        .collect::<Vec<_>>();
    if lengths.len() != 1
        || lengths[0].parse::<usize>().ok() != Some(body.as_bytes().len())
    {
        return Ok(false);
    }
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| io::Error::other("invalid Core health response"))?;
    Ok(
        has_exact_json_keys(
            &value,
            &[
                "protocol",
                "protocol_version",
                "schema_hash",
                "request_id",
                "operation",
                "ok",
                "result",
                "error_code",
                "external_send",
            ],
        ) && value.get("ok").and_then(serde_json::Value::as_bool) == Some(true)
            && value.get("protocol").and_then(serde_json::Value::as_str)
                == Some("edupi-core-runtime")
            && value
                .get("protocol_version")
                .and_then(serde_json::Value::as_u64)
                == Some(1)
            && value.get("schema_hash").and_then(serde_json::Value::as_str) == Some(schema_hash)
            && value.get("request_id").and_then(serde_json::Value::as_str)
                == Some("tauri-health")
            && value.get("operation").and_then(serde_json::Value::as_str) == Some("health")
            && value.get("error_code").is_some_and(JsonValue::is_null)
            && value
                .get("external_send")
                .and_then(serde_json::Value::as_bool)
                == Some(false)
            && value
                .get("result")
                .and_then(|result| result.get("lifecycle"))
                .and_then(serde_json::Value::as_str)
                == Some("ready")
            && value
                .get("result")
                .and_then(|result| result.get("supervisor_session_id"))
                .and_then(serde_json::Value::as_str)
                == Some(session)
            && value
                .get("result")
                .and_then(|result| result.get("core_commit"))
                .and_then(serde_json::Value::as_str)
                == Some(commit)
            && value
                .get("result")
                .and_then(|result| result.get("component_manifest_hash"))
                .and_then(serde_json::Value::as_str)
                == Some(manifest_hash)
            && value
                .get("result")
                .and_then(|result| result.get("data_root_fingerprint"))
                .and_then(serde_json::Value::as_str)
                == Some(data_fingerprint)
            && value
                .get("result")
                .and_then(|result| result.get("instance_nonce"))
                .and_then(serde_json::Value::as_str)
                == Some(instance_nonce)
            && value
                .get("result")
                .and_then(|result| result.get("fencing_generation"))
                .and_then(serde_json::Value::as_u64)
                == Some(fencing_generation),
    )
}

struct EduPiLaunchRoots {
    data_root: String,
    core_root: String,
    core_allowed_root: String,
    data_allowed_root: String,
    core_validation_mode: &'static str,
    status: EduPiRootStatus,
}

fn first_configured_root(names: &[&str]) -> Option<(String, String)> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| ((*name).to_string(), value))
    })
}

fn validate_edupi_directory(name: &str, value: String) -> Result<String, io::Error> {
    let path = PathBuf::from(&value);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{name} must be an absolute directory: {}", path.display()),
        ));
    }
    if !path.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{name} does not exist: {}", path.display()),
        ));
    }
    Ok(dunce::canonicalize(path)?.to_string_lossy().into_owned())
}

fn canonical_json(value: &JsonValue) -> JsonValue {
    match value {
        JsonValue::Array(values) => JsonValue::Array(values.iter().map(canonical_json).collect()),
        JsonValue::Object(object) => {
            let mut sorted = serde_json::Map::new();
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), canonical_json(&object[key]));
            }
            JsonValue::Object(sorted)
        }
        other => other.clone(),
    }
}

fn core_path_is_safe(value: &str) -> bool {
    !value.is_empty()
        && !Path::new(value).is_absolute()
        && !value.contains(':')
        && !value.split('/').any(|part| part.is_empty() || part == "..")
}

fn core_file_hash(path: &Path) -> Result<(u64, String), io::Error> {
    let bytes = fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok((
        bytes.len() as u64,
        format!("sha256:{:x}", hasher.finalize()),
    ))
}

fn core_file_within(
    root: &Path,
    allowed_root: &Path,
    path: &Path,
    allow_node_modules_symlink: bool,
) -> Result<PathBuf, io::Error> {
    let lexical = path.to_path_buf();
    let resolved = dunce::canonicalize(&lexical)?;
    if !resolved.starts_with(root) {
        if !(allow_node_modules_symlink && resolved.starts_with(allowed_root)) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Core closure escapes allowed root",
            ));
        }
    }
    let mut current = root.to_path_buf();
    for component in lexical.strip_prefix(root).unwrap_or(&lexical).components() {
        let Component::Normal(part) = component else {
            continue;
        };
        current.push(part);
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink()
            && !(allow_node_modules_symlink && current == root.join("node_modules"))
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Core closure contains a disallowed symlink",
            ));
        }
    }
    if !fs::metadata(&lexical)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core closure entry is not a regular file",
        ));
    }
    Ok(resolved)
}

fn validate_core_manifest_metadata(
    object: &serde_json::Map<String, JsonValue>,
) -> Result<(), io::Error> {
    if object
        .get("component_manifest_version")
        .and_then(JsonValue::as_str)
        != Some("1")
        || object.get("algorithm").and_then(JsonValue::as_str)
            != Some("sha256-canonical-component-payload-v1")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core manifest version or algorithm mismatch",
        ));
    }
    Ok(())
}

fn validate_core_dependency_metadata(dependency: &JsonValue) -> Result<(), io::Error> {
    let dep = dependency
        .as_object()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core dependency invalid"))?;
    let name = dep.get("name").and_then(JsonValue::as_str).ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "Core dependency name missing")
    })?;
    let version = dep
        .get("version")
        .and_then(JsonValue::as_str)
        .unwrap_or_default();
    if version.split('.').count() != 3
        || version.chars().any(|character| {
            !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+'))
        })
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core dependency version invalid",
        ));
    }
    let expected_root = format!("node_modules/{name}");
    if dep.get("root").and_then(JsonValue::as_str) != Some(expected_root.as_str()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core dependency root invalid",
        ));
    }
    let files = dep
        .get("files")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "Core dependency files missing")
        })?;
    let package_json = format!("{expected_root}/package.json");
    if !files
        .iter()
        .any(|entry| entry.get("path").and_then(JsonValue::as_str) == Some(package_json.as_str()))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core dependency package.json missing",
        ));
    }
    for entry in files {
        let path = entry
            .get("path")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        if !core_path_is_safe(path)
            || (path != expected_root && !path.starts_with(&format!("{expected_root}/")))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Core dependency file escapes its package root",
            ));
        }
    }
    Ok(())
}

fn verify_core_component_closure(
    root: &Path,
    allowed_root: &Path,
    validation_mode: &str,
) -> Result<(), io::Error> {
    if !matches!(validation_mode, "external" | "bundled") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Core validation mode is invalid",
        ));
    }
    let manifest_path = root.join("contracts/edupi-core-runtime-component-manifest.json");
    let manifest_path = core_file_within(root, allowed_root, &manifest_path, false)?;
    let manifest_bytes = fs::read(&manifest_path)?;
    let manifest: JsonValue = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    let object = manifest.as_object().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "Core manifest is not an object")
    })?;
    validate_core_manifest_metadata(object)?;
    let recorded = object
        .get("component_manifest_hash")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core manifest hash missing"))?;
    let mut payload = manifest.clone();
    payload
        .as_object_mut()
        .unwrap()
        .remove("component_manifest_hash");
    let canonical = serde_json::to_vec(&canonical_json(&payload))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(canonical);
    let calculated = format!("sha256:{:x}", hasher.finalize());
    if recorded != calculated || recorded != PINNED_CORE_MANIFEST_HASH {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core manifest hash mismatch",
        ));
    }
    if object.get("entrypoint").and_then(JsonValue::as_str)
        != Some("scripts/core_runtime_daemon.mjs")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core daemon entrypoint mismatch",
        ));
    }
    let modules = object
        .get("modules")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core modules missing"))?;
    let assets = object
        .get("assets")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core assets missing"))?;
    let dependencies = object
        .get("runtime_dependencies")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core dependencies missing"))?;
    let mut seen = HashSet::new();
    let mut verify_entry = |entry: &JsonValue,
                            allow_node_modules_symlink: bool|
     -> Result<(), io::Error> {
        let entry_object = entry
            .as_object()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core entry invalid"))?;
        let relative = entry_object
            .get("path")
            .and_then(JsonValue::as_str)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Core entry path missing"))?;
        if !core_path_is_safe(relative) || !seen.insert(relative.to_string()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Core entry path invalid or duplicated",
            ));
        }
        let path = root.join(relative);
        let resolved = core_file_within(root, allowed_root, &path, allow_node_modules_symlink)?;
        let (size, hash) = core_file_hash(&resolved)?;
        if entry_object.get("size").and_then(JsonValue::as_u64) != Some(size)
            || entry_object.get("sha256").and_then(JsonValue::as_str) != Some(hash.as_str())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Core entry bytes mismatch",
            ));
        }
        Ok(())
    };
    for entry in modules.iter().chain(assets.iter()) {
        verify_entry(entry, false)?;
    }
    let mut packages = HashSet::new();
    for dependency in dependencies {
        validate_core_dependency_metadata(dependency)?;
        let dep = dependency.as_object().unwrap();
        let name = dep.get("name").and_then(JsonValue::as_str).unwrap();
        if !packages.insert(name.to_string()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Core dependency duplicated",
            ));
        }
        let files = dep
            .get("files")
            .and_then(JsonValue::as_array)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "Core dependency files missing")
            })?;
        for entry in files {
            verify_entry(entry, true)?;
        }
    }
    let daemon = root.join("scripts/core_runtime_daemon.mjs");
    let rollback = root.join("scripts/desktop_bridge_port.mjs");
    if !seen.contains("scripts/core_runtime_daemon.mjs")
        || !seen.contains("scripts/desktop_bridge_port.mjs")
        || !daemon.is_file()
        || !rollback.is_file()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core entrypoints are not pinned",
        ));
    }
    let schema_hash = root.join("contracts/edupi-core-runtime-v1-hash.json");
    let schema_record: JsonValue = serde_json::from_slice(&fs::read(schema_hash)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    if schema_record.get("schema_hash").and_then(JsonValue::as_str) != Some(PINNED_CORE_SCHEMA_HASH)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Core schema hash mismatch",
        ));
    }
    if validation_mode == "external" {
        let head = Command::new("git")
            .args(["-C", root.to_string_lossy().as_ref(), "rev-parse", "HEAD"])
            .output()?;
        if !head.status.success()
            || String::from_utf8_lossy(&head.stdout).trim() != PINNED_CORE_COMMIT
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Core commit mismatch",
            ));
        }
    }
    Ok(())
}

fn edupi_root_label(name: &str) -> &str {
    match name {
        "EDUPI_DATA_ROOT" => "EduPi data root",
        "EDUPI_CORE_ROOT" => "EduPi Core root",
        "EDUPI_WORKSPACE" => "EduPi workspace",
        _ => "EduPi project root",
    }
}

fn default_allowed_root(root: &str) -> Result<String, io::Error> {
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("cannot default an allowed root from a relative root: {root}"),
        ));
    }
    path.parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("cannot default an allowed root from root: {root}"),
            )
        })
}

fn edupi_allowed_root(name: &str, root: &str) -> Result<String, io::Error> {
    let value = first_configured_root(&[name])
        .map(|(_, value)| value)
        .unwrap_or(default_allowed_root(root)?);

    validate_edupi_directory(name, value)
}

fn is_filesystem_root(path: &Path) -> bool {
    let text = path.to_string_lossy();
    let is_separator = |value: char| value == '/' || value == '\\';
    if text == "/" || text == "\\" || (!text.is_empty() && text.chars().all(is_separator)) {
        return true;
    }
    let is_drive_root = |value: &str| {
        let bytes = value.as_bytes();
        bytes.len() == 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && is_separator(bytes[2] as char)
    };
    if is_drive_root(&text) {
        return true;
    }
    if let Some(verbatim) = text.strip_prefix("\\\\?\\") {
        if is_drive_root(verbatim) {
            return true;
        }
        if let Some(unc) = verbatim
            .strip_prefix("UNC\\")
            .or_else(|| verbatim.strip_prefix("UNC/"))
        {
            let parts: Vec<_> = unc
                .split(is_separator)
                .filter(|part| !part.is_empty())
                .collect();
            return parts.len() == 2;
        }
    }
    if let Some(unc) = text.strip_prefix("\\\\") {
        let parts: Vec<_> = unc
            .split(is_separator)
            .filter(|part| !part.is_empty())
            .collect();
        return parts.len() == 2;
    }
    let mut components = path.components();
    matches!(
        components.next(),
        Some(Component::RootDir) | Some(Component::Prefix(_))
    ) && components.next().is_none()
}

fn validate_selected_data_root(value: String) -> Result<String, io::Error> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root must be an absolute directory",
        ));
    }
    let metadata = fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root cannot be a symlink",
        ));
    }
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root must be an existing directory",
        ));
    }
    let canonical = dunce::canonicalize(path)?;
    if is_filesystem_root(&canonical) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "selected EduPi data root cannot be a filesystem root",
        ));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn ensure_data_directories(root: &str) -> Result<(String, String, String), io::Error> {
    let root_path = Path::new(root);
    let edupi = root_path.join(".edupi");
    if let Ok(metadata) = fs::symlink_metadata(&edupi) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "EduPi data directory is not a normal directory: {}",
                    edupi.display()
                ),
            ));
        }
    }
    fs::create_dir_all(&edupi)?;
    let canonical_edupi = dunce::canonicalize(&edupi)?;
    if !is_inside_path(root_path, &canonical_edupi) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "EduPi data directory escapes the data root: {}",
                edupi.display()
            ),
        ));
    }
    for directory in ["memory", "output", "locks"] {
        let path = edupi.join(directory);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "EduPi data directory is not a normal directory: {}",
                        path.display()
                    ),
                ));
            }
        }
        fs::create_dir_all(&path)?;
        let canonical = dunce::canonicalize(&path)?;
        if !is_inside_path(root_path, &canonical) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "EduPi data directory escapes the data root: {}",
                    path.display()
                ),
            ));
        }
    }
    Ok((
        edupi.join("memory").to_string_lossy().into_owned(),
        edupi.join("output").to_string_lossy().into_owned(),
        edupi.join("locks").to_string_lossy().into_owned(),
    ))
}

fn is_inside_path(root: &Path, candidate: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}

fn managed_data_root(app: &AppHandle) -> Result<String, io::Error> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| io::Error::other(error.to_string()))?
        .join(MANAGED_DATA_DIRECTORY);
    fs::create_dir_all(&root)?;
    let root = dunce::canonicalize(root)?;
    ensure_data_directories(&root.to_string_lossy())?;
    Ok(root.to_string_lossy().into_owned())
}

fn persisted_data_root_from_prefs(path: &Path) -> Result<Result<String, &'static str>, io::Error> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(FALLBACK_PERSISTED_NO_KEY))
        }
        Err(_) => return Ok(Err(FALLBACK_PERSISTED_UNREADABLE)),
    };
    let prefs: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(Err(FALLBACK_PERSISTED_CORRUPT)),
    };
    if !prefs.is_object() {
        return Ok(Err(FALLBACK_PERSISTED_NON_OBJECT));
    }
    let Some(value) = prefs.get(EDUPI_DATA_PREF_KEY) else {
        return Ok(Err(FALLBACK_PERSISTED_NO_KEY));
    };
    let Some(value) = value.as_str() else {
        return Ok(Err(FALLBACK_PERSISTED_INVALID));
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Ok(Err(FALLBACK_PERSISTED_RELATIVE));
    }
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(FALLBACK_PERSISTED_MISSING))
        }
        Err(_) => return Ok(Err(FALLBACK_PERSISTED_UNREADABLE)),
    };
    if metadata.file_type().is_symlink() {
        return Ok(Err(FALLBACK_PERSISTED_SYMLINK));
    }
    if !metadata.is_dir() {
        return Ok(Err(FALLBACK_PERSISTED_NOT_DIRECTORY));
    }
    let canonical = dunce::canonicalize(path)
        .map_err(|_| io::Error::other("persisted root cannot be canonicalized"))?;
    if is_filesystem_root(&canonical) {
        return Ok(Err(FALLBACK_PERSISTED_FILESYSTEM_ROOT));
    }
    if ensure_data_directories(&canonical.to_string_lossy()).is_err() {
        return Ok(Err(FALLBACK_PERSISTED_INVALID));
    }
    Ok(Ok(canonical.to_string_lossy().into_owned()))
}

fn persisted_data_root(app: &AppHandle) -> Result<Result<String, &'static str>, io::Error> {
    let path = ui_prefs_path(app).map_err(io::Error::other)?;
    persisted_data_root_from_prefs(&path)
}

fn resolve_data_root(app: &AppHandle) -> Result<(String, &'static str, Option<String>), io::Error> {
    if let Some((name, value)) = first_configured_root(&[
        EDUPI_DATA_ROOT_ENV,
        EDUPI_PROJECT_ROOT_ENV,
        EDUPI_WORKSPACE_ENV,
    ]) {
        let root = validate_edupi_directory(edupi_root_label(&name), value)?;
        ensure_data_directories(&root)?;
        return Ok((root, "environment", None));
    }

    match persisted_data_root(app)? {
        Ok(root) => return Ok((root, "persisted", None)),
        Err(FALLBACK_PERSISTED_NO_KEY) => {}
        Err(reason) => {
            let root = managed_data_root(app)?;
            return Ok((root, "managed", Some(reason.to_string())));
        }
    }

    Ok((managed_data_root(app)?, "managed", None))
}

fn bundled_core_root(app: &AppHandle) -> Result<String, io::Error> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let root = resource_dir.join("resources/edupi-core");
    validate_edupi_directory(
        "bundled EduPi Core root",
        root.to_string_lossy().into_owned(),
    )
}

fn resolve_core_root(app: &AppHandle) -> Result<(String, &'static str, &'static str), io::Error> {
    if let Some((_, value)) = first_configured_root(&[EDUPI_CORE_ROOT_ENV]) {
        let root = validate_edupi_directory("EduPi Core root", value)?;
        return Ok((root, "environment", "external"));
    }
    let root = bundled_core_root(app)?;
    Ok((root, "bundled", "bundled"))
}

fn build_root_status(
    data_root: String,
    data_source: &str,
    core_root: String,
    core_source: &str,
    fallback_reason: Option<String>,
) -> EduPiRootStatus {
    EduPiRootStatus {
        data_root,
        data_source: data_source.to_string(),
        core_root,
        core_source: core_source.to_string(),
        fallback_reason,
        can_change_data_root: data_source != "environment",
        restart_required: false,
    }
}

fn edupi_launch_roots(app: &AppHandle) -> Result<EduPiLaunchRoots, io::Error> {
    let (data_root, data_source, fallback_reason) = resolve_data_root(app)?;
    let (core_root, core_source, core_validation_mode) = resolve_core_root(app)?;
    let data_allowed_root = edupi_allowed_root(EDUPI_DATA_ALLOWED_ROOT_ENV, &data_root)?;
    let core_allowed_root = edupi_allowed_root(EDUPI_CORE_ALLOWED_ROOT_ENV, &core_root)?;
    verify_core_component_closure(
        Path::new(&core_root),
        Path::new(&core_allowed_root),
        core_validation_mode,
    )?;
    let status = build_root_status(
        data_root.clone(),
        data_source,
        core_root.clone(),
        core_source,
        fallback_reason,
    );
    Ok(EduPiLaunchRoots {
        data_root,
        core_root,
        core_allowed_root,
        data_allowed_root,
        core_validation_mode,
        status,
    })
}

#[cfg(not(feature = "custom-protocol"))]
fn edupi_project_root() -> Result<String, io::Error> {
    env::var("EDUPI_PROJECT_ROOT").map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "EDUPI_PROJECT_ROOT is not configured; choose the EduPi workspace before starting the desktop app",
        )
    })
}

#[cfg(feature = "custom-protocol")]
fn choose_port(app: &AppHandle) -> io::Result<u16> {
    let mut candidates = Vec::with_capacity(36);
    if let Some(last) = read_last_server_port(app) {
        candidates.push(last);
    }
    candidates.push(DESKTOP_SERVER_PORT);
    for offset in 1u16..=32 {
        candidates.push(DESKTOP_SERVER_PORT.saturating_add(offset));
    }

    for port in candidates {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            let chosen = listener.local_addr()?.port();
            drop(listener);
            write_last_server_port(app, chosen);
            return Ok(chosen);
        }
    }

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let chosen = listener.local_addr()?.port();
    drop(listener);
    write_last_server_port(app, chosen);
    Ok(chosen)
}

#[cfg(feature = "custom-protocol")]
fn choose_core_port(excluded: &[u16]) -> io::Result<u16> {
    for _ in 0..32 {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        if !excluded.contains(&port) {
            return Ok(port);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AddrNotAvailable,
        "unable to allocate a distinct Core port",
    ))
}

#[cfg(feature = "custom-protocol")]
fn response_has_instance_id(response: &[u8], expected_instance_id: &str) -> bool {
    let Ok(response) = std::str::from_utf8(response) else {
        return false;
    };
    let Some((headers, _)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let mut lines = headers.lines();
    let Some(status) = lines.next() else {
        return false;
    };
    if !(status.starts_with("HTTP/1.1 204 ") || status.starts_with("HTTP/1.0 204 ")) {
        return false;
    }

    lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case(DESKTOP_INSTANCE_ID_HEADER)
                && value.trim() == expected_instance_id
        })
    })
}

#[cfg(feature = "custom-protocol")]
fn server_identity_matches(address: SocketAddr, expected_instance_id: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(200)) else {
        return false;
    };
    let timeout = Some(Duration::from_millis(500));
    if stream.set_read_timeout(timeout).is_err() || stream.set_write_timeout(timeout).is_err() {
        return false;
    }

    let request = format!(
        "GET /api/desktop/identity HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 512];
    while response.len() < 8 * 1024 {
        let Ok(read) = stream.read(&mut chunk) else {
            return false;
        };
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    response_has_instance_id(&response, expected_instance_id)
}

#[cfg(feature = "custom-protocol")]
fn wait_for_server(
    child: &mut Child,
    address: SocketAddr,
    expected_instance_id: &str,
    log_path: &Path,
) -> io::Result<()> {
    let deadline = Instant::now() + SERVER_START_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "Pi Agent server exited early with {status}; see {}",
                log_path.display()
            )));
        }
        if server_identity_matches(address, expected_instance_id) {
            // Re-check after the HTTP handshake. A losing child can exit with
            // EADDRINUSE while another process is answering on the same port.
            if let Some(status) = child.try_wait()? {
                return Err(io::Error::other(format!(
                    "Pi Agent server exited during startup with {status}; see {}",
                    log_path.display()
                )));
            }
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        format!(
            "Pi Agent server did not start within {} seconds; see {}",
            SERVER_START_TIMEOUT.as_secs(),
            log_path.display()
        ),
    ))
}

#[cfg(feature = "custom-protocol")]
fn start_packaged_server(
    app: &tauri::AppHandle,
    desktop_api_token: &str,
    desktop_instance_id: &str,
) -> Result<(Url, DesktopServer), Box<dyn std::error::Error>> {
    let resource_dir = child_process_compatible_path(&app.path().resource_dir()?);
    let node_path = bundled_node_path(&resource_dir);
    if !node_path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Bundled Node runtime is missing: {}", node_path.display()),
        )
        .into());
    }

    let server_dir = resource_dir.join("resources/server");
    let server_script = server_dir.join("desktop-server.cjs");
    if !server_script.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Bundled Next.js server is missing: {}",
                server_script.display()
            ),
        )
        .into());
    }

    let log_dir = app.path().app_log_dir()?;
    fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("server.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let stderr = stdout.try_clone()?;

    let roots = edupi_launch_roots(app)?;
    let release_mode =
        env::var(EDUPI_CORE_RELEASE_MODE_ENV).unwrap_or_else(|_| "daemon".to_string());
    if release_mode != "daemon" && release_mode != "one-shot" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "EDUPI_CORE_RELEASE_MODE must be daemon or one-shot",
        )
        .into());
    }
    let port = choose_port(app)?;
    let desktop_state_dir = app.path().app_config_dir()?;
    fs::create_dir_all(&desktop_state_dir)?;
    let client_port = choose_core_port(&[port])?;
    let core_port = if release_mode == "daemon" {
        Some(choose_core_port(&[port, client_port])?)
    } else {
        None
    };
    let url: Url = format!("http://127.0.0.1:{port}").parse()?;
    // Every fallible path/setup needed by Next is resolved before the broker
    // starts. From this point until DesktopServer takes ownership, explicit
    // cleanup covers each error.
    let (core_process, core_ready, core_client_token, core_attestation) =
        start_core_supervisor(
            app,
            &node_path,
            &roots,
            &release_mode,
            &desktop_state_dir,
            client_port,
            core_port,
        )?;
    let core_child = Some(core_process);
    let mut command = Command::new(&node_path);
    command
        .arg(&server_script)
        .current_dir(&server_dir)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("EDUPI_PROJECT_ROOT", &roots.data_root)
        .env("EDUPI_DATA_ROOT", &roots.data_root)
        .env("EDUPI_CORE_ROOT", &roots.core_root)
        .env("EDUPI_CORE_VALIDATION_MODE", roots.core_validation_mode)
        .env("EDUPI_CORE_ALLOWED_ROOT", &roots.core_allowed_root)
        .env("EDUPI_DATA_ALLOWED_ROOT", &roots.data_allowed_root)
        .env("PI_DESKTOP_STATE_DIR", &desktop_state_dir)
        .env("PI_WEB_PARENT_PID", std::process::id().to_string())
        .env(DESKTOP_API_TOKEN_ENV, desktop_api_token)
        .env(DESKTOP_INSTANCE_ID_ENV, desktop_instance_id)
        .env("EDUPI_CORE_RELEASE_MODE", &release_mode)
        .env("EDUPI_CORE_SCHEMA_HASH", PINNED_CORE_SCHEMA_HASH)
        .env("EDUPI_CORE_COMMIT", PINNED_CORE_COMMIT)
        .env(
            "EDUPI_CORE_COMPONENT_MANIFEST_HASH",
            PINNED_CORE_MANIFEST_HASH,
        )
        .env("EDUPI_CORE_ATTESTATION", &core_attestation)
        .env(
            "EDUPI_CORE_SUPERVISOR_SESSION",
            &core_ready.supervisor_session_id,
        )
        .env("EDUPI_CORE_ENDPOINT", &core_ready.endpoint)
        .env("EDUPI_CORE_CLIENT_TOKEN", &core_client_token)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    if let Some(path) = server_process_path(&node_path) {
        command.env("PATH", path);
    }
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            if let Some(mut core) = core_child {
                stop_core_supervisor_process(&mut core);
            }
            return Err(error.into());
        }
    };

    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    if let Err(error) = wait_for_server(&mut child, address, desktop_instance_id, &log_path) {
        if let Some(mut core) = core_child {
            stop_core_supervisor_process(&mut core);
        }
        let server = DesktopServer::running(child);
        server.stop();
        return Err(error.into());
    }

    Ok((url, DesktopServer::running_with_core(child, core_child)))
}

#[cfg(all(test, feature = "custom-protocol"))]
mod tests {
    use super::{
        build_root_status, child_process_compatible_path, core_file_within, core_path_is_safe,
        default_allowed_root, ensure_data_directories, is_filesystem_root,
        persisted_data_root_from_prefs, response_has_instance_id, update_server_port_in_prefs,
        read_bounded_json_line, validate_core_dependency_metadata, validate_core_manifest_metadata,
        validate_selected_data_root, verify_core_component_closure, EMBEDDED_CORE_COMPAT_MANIFEST,
        FALLBACK_PERSISTED_CORRUPT, FALLBACK_PERSISTED_MISSING, FALLBACK_PERSISTED_NON_OBJECT,
        FALLBACK_PERSISTED_NOT_DIRECTORY, FALLBACK_PERSISTED_NO_KEY, FALLBACK_PERSISTED_SYMLINK,
        PINNED_CORE_COMMIT, PINNED_CORE_MANIFEST_HASH, PINNED_CORE_SCHEMA_HASH,
    };
    use serde_json::Value as JsonValue;
    use std::fs;
    use std::io::Cursor;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("edupi-{label}-{}-{id}", std::process::id()));
            fs::create_dir(&path).expect("create isolated test root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn task7_core_pin_and_manifest_paths_are_strict() {
        assert_eq!(PINNED_CORE_COMMIT.len(), 40);
        assert!(PINNED_CORE_COMMIT
            .chars()
            .all(|value| value.is_ascii_hexdigit()));
        assert!(PINNED_CORE_MANIFEST_HASH.starts_with("sha256:"));
        assert!(PINNED_CORE_SCHEMA_HASH.starts_with("sha256:"));
        assert!(core_path_is_safe("scripts/core_runtime_daemon.mjs"));
        assert!(core_path_is_safe("node_modules/typebox/package.json"));
        assert!(!core_path_is_safe("../outside.mjs"));
        assert!(!core_path_is_safe("/absolute.mjs"));
        assert!(!core_path_is_safe("scripts//duplicate.mjs"));
        let manifest: serde_json::Value =
            serde_json::from_str(EMBEDDED_CORE_COMPAT_MANIFEST).unwrap();
        let runtime = manifest.get("core_runtime").unwrap();
        assert_eq!(
            runtime
                .get("core_commit")
                .and_then(serde_json::Value::as_str),
            Some(PINNED_CORE_COMMIT)
        );
        assert_eq!(
            runtime
                .get("component_manifest_path")
                .and_then(serde_json::Value::as_str),
            Some("contracts/edupi-core-runtime-component-manifest.json")
        );
        assert_eq!(
            runtime
                .get("component_manifest_hash")
                .and_then(serde_json::Value::as_str),
            Some(PINNED_CORE_MANIFEST_HASH)
        );
    }

    #[test]
    fn task7_external_core_closure_matches_the_desktop_pin_when_configured() {
        let Some(root) = std::env::var_os("EDUPI_CORE_ROOT") else {
            return;
        };
        let Some(allowed) = std::env::var_os("EDUPI_CORE_ALLOWED_ROOT") else {
            return;
        };
        let result =
            verify_core_component_closure(Path::new(&root), Path::new(&allowed), "external");
        let node_modules = Path::new(&root).join("node_modules");
        let resolves_outside = dunce::canonicalize(&node_modules)
            .map(|resolved| {
                !resolved.starts_with(dunce::canonicalize(Path::new(&allowed)).unwrap())
            })
            .unwrap_or(false);
        if resolves_outside {
            assert!(result.is_err());
        } else {
            result.unwrap();
        }
    }

    #[test]
    fn task7_manifest_and_dependency_metadata_reject_drift() {
        let mut wrong_manifest = serde_json::Map::new();
        wrong_manifest.insert(
            "component_manifest_version".into(),
            JsonValue::String("2".into()),
        );
        wrong_manifest.insert("algorithm".into(), JsonValue::String("wrong".into()));
        assert!(validate_core_manifest_metadata(&wrong_manifest).is_err());
        let escaped = serde_json::json!({"name":"typebox","version":"1.3.8","root":"node_modules/typebox","files":[{"path":"node_modules/other/file.mjs"},{"path":"node_modules/typebox/package.json"}]});
        assert!(validate_core_dependency_metadata(&escaped).is_err());
        let missing_package = serde_json::json!({"name":"typebox","version":"1.3.8","root":"node_modules/typebox","files":[{"path":"node_modules/typebox/index.mjs"}]});
        assert!(validate_core_dependency_metadata(&missing_package).is_err());
    }

    #[test]
    fn task7_supervisor_envelopes_are_bounded_before_json_parsing() {
        let mut valid = Cursor::new(b"{\"status\":\"supervisor_ready\"}\n".to_vec());
        assert_eq!(
            read_bounded_json_line(&mut valid)
                .unwrap()
                .unwrap()["status"],
            "supervisor_ready"
        );

        let mut oversized = vec![b'x'; (64 * 1024) + 1];
        oversized.push(b'\n');
        assert!(read_bounded_json_line(&mut Cursor::new(oversized)).is_err());

        let mut unterminated = Cursor::new(b"{\"status\":\"ready\"}".to_vec());
        assert!(read_bounded_json_line(&mut unterminated).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn task7_node_modules_symlink_outside_allowed_root_is_rejected() {
        let temp = TempRoot::new("core-node-modules-symlink");
        let allowed = temp.path().join("allowed");
        let root = allowed.join("core");
        let outside = temp.path().join("outside");
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("file.mjs"), "x").unwrap();
        fs::remove_dir(root.join("node_modules")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("node_modules")).unwrap();
        assert!(
            core_file_within(&root, &allowed, &root.join("node_modules/file.mjs"), true).is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn simplifies_verbatim_windows_path_before_launching_node() {
        let path = Path::new(
            r"\\?\C:\Users\毕良霞\AppData\Local\Pi Agent\resources\server\desktop-server.cjs",
        );

        assert_eq!(
            child_process_compatible_path(path),
            PathBuf::from(
                r"C:\Users\毕良霞\AppData\Local\Pi Agent\resources\server\desktop-server.cjs"
            )
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn leaves_non_windows_path_unchanged() {
        let path = Path::new("/Applications/Pi Agent.app/Contents/Resources/server");
        assert_eq!(child_process_compatible_path(path), PathBuf::from(path));
    }

    #[test]
    fn packaged_server_handshake_requires_the_expected_instance_header() {
        let expected = "instance-123";
        let matching = b"HTTP/1.1 204 No Content\r\nx-pi-desktop-instance: instance-123\r\n\r\n";
        let wrong = b"HTTP/1.1 204 No Content\r\nx-pi-desktop-instance: other\r\n\r\n";
        let body_spoof = b"HTTP/1.1 204 No Content\r\nContent-Type: text/plain\r\n\r\ninstance-123";

        assert!(response_has_instance_id(matching, expected));
        assert!(!response_has_instance_id(wrong, expected));
        assert!(!response_has_instance_id(body_spoof, expected));
    }

    #[test]
    fn allowed_roots_default_to_the_parent_of_an_absolute_root() {
        #[cfg(unix)]
        assert_eq!(default_allowed_root("/tmp/edupi-data").unwrap(), "/tmp");
        #[cfg(windows)]
        assert_eq!(default_allowed_root(r"C:\edupi-data").unwrap(), r"C:\");
        assert!(default_allowed_root("relative/edupi-data").is_err());
    }

    #[test]
    fn selected_directory_is_canonicalized_and_data_children_are_created() {
        let temp = TempRoot::new("selected-data");
        let selected = temp.path().join("selected");
        fs::create_dir(&selected).expect("create selected directory");

        let root = validate_selected_data_root(selected.to_string_lossy().into_owned()).unwrap();
        assert_eq!(Path::new(&root), dunce::canonicalize(&selected).unwrap());
        let (memory, output, locks) = ensure_data_directories(&root).unwrap();
        for directory in [memory, output, locks] {
            assert!(
                Path::new(&directory).is_dir(),
                "created data directory: {directory}"
            );
            assert!(Path::new(&directory).starts_with(&root));
        }
    }

    #[test]
    fn selected_directory_rejects_a_filesystem_root() {
        assert!(
            validate_selected_data_root(Path::new("/").to_string_lossy().into_owned()).is_err()
        );
        assert!(is_filesystem_root(Path::new("/")));
        for root in [
            r"C:\",
            "C:/",
            r"\\server\share\",
            r"\\?\C:\",
            r"\\?\UNC\server\share\",
        ] {
            assert!(
                is_filesystem_root(Path::new(root)),
                "expected filesystem root: {root}"
            );
        }
        for child in [
            r"C:\Users\teacher",
            "C:/Users/teacher",
            r"\\server\share\folder",
            r"\\?\C:\Users\teacher",
            r"\\?\UNC\server\share\folder",
        ] {
            assert!(
                !is_filesystem_root(Path::new(child)),
                "ordinary child must remain allowed: {child}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn selected_directory_rejects_a_symlink_root() {
        let temp = TempRoot::new("selected-symlink");
        let target = temp.path().join("target");
        let link = temp.path().join("link");
        fs::create_dir(&target).expect("create symlink target");
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");
        let error = validate_selected_data_root(link.to_string_lossy().into_owned()).unwrap_err();
        assert!(error.to_string().contains("symlink"));
    }

    #[test]
    fn persisted_root_parser_accepts_valid_path_and_creates_children() {
        let temp = TempRoot::new("persisted-valid");
        let selected = temp.path().join("selected");
        fs::create_dir(&selected).expect("create persisted directory");
        let prefs = temp.path().join("ui-prefs.json");
        fs::write(
            &prefs,
            serde_json::json!({ "edupiDataRoot": selected }).to_string(),
        )
        .expect("write prefs");

        let result = persisted_data_root_from_prefs(&prefs).unwrap().unwrap();
        assert_eq!(Path::new(&result), dunce::canonicalize(&selected).unwrap());
        for child in ["memory", "output", "locks"] {
            assert!(Path::new(&result).join(".edupi").join(child).is_dir());
        }
    }

    #[test]
    fn persisted_root_parser_reports_corrupt_and_missing_directory_reasons() {
        let temp = TempRoot::new("persisted-reasons");
        let corrupt = temp.path().join("corrupt.json");
        fs::write(&corrupt, "{not-json").expect("write corrupt prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&corrupt).unwrap(),
            Err(FALLBACK_PERSISTED_CORRUPT)
        );

        let missing = temp.path().join("missing.json");
        let missing_root = temp.path().join("not-present");
        fs::write(
            &missing,
            serde_json::json!({ "edupiDataRoot": missing_root }).to_string(),
        )
        .expect("write missing prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&missing).unwrap(),
            Err(FALLBACK_PERSISTED_MISSING)
        );

        let no_key = temp.path().join("no-key.json");
        fs::write(&no_key, serde_json::json!({ "theme": "dark" }).to_string())
            .expect("write no-key prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&no_key).unwrap(),
            Err(FALLBACK_PERSISTED_NO_KEY)
        );

        let non_object = temp.path().join("non-object.json");
        fs::write(&non_object, "[]").expect("write non-object prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&non_object).unwrap(),
            Err(FALLBACK_PERSISTED_NON_OBJECT)
        );

        let file = temp.path().join("file");
        fs::write(&file, "not a directory").expect("write non-directory root");
        let not_directory = temp.path().join("not-directory.json");
        fs::write(
            &not_directory,
            serde_json::json!({ "edupiDataRoot": file }).to_string(),
        )
        .expect("write non-directory prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&not_directory).unwrap(),
            Err(FALLBACK_PERSISTED_NOT_DIRECTORY)
        );

        #[cfg(unix)]
        {
            let symlink = temp.path().join("symlink");
            let symlink_prefs = temp.path().join("symlink.json");
            std::os::unix::fs::symlink(temp.path(), &symlink).expect("create persisted symlink");
            fs::write(
                &symlink_prefs,
                serde_json::json!({ "edupiDataRoot": symlink }).to_string(),
            )
            .expect("write symlink prefs");
            assert_eq!(
                persisted_data_root_from_prefs(&symlink_prefs).unwrap(),
                Err(FALLBACK_PERSISTED_SYMLINK)
            );
        }
    }

    #[test]
    fn root_status_preserves_fallback_reason_and_editability() {
        let status = build_root_status(
            "/tmp/managed".into(),
            "managed",
            "/tmp/core".into(),
            "bundled",
            Some(FALLBACK_PERSISTED_CORRUPT.into()),
        );
        assert_eq!(
            status.fallback_reason.as_deref(),
            Some(FALLBACK_PERSISTED_CORRUPT)
        );
        assert!(status.can_change_data_root);

        let environment = build_root_status(
            "/tmp/environment".into(),
            "environment",
            "/tmp/core".into(),
            "environment",
            None,
        );
        assert!(!environment.can_change_data_root);
        assert_eq!(environment.fallback_reason, None);
    }

    #[test]
    fn passive_server_port_persistence_preserves_invalid_preferences() {
        let temp = TempRoot::new("port-prefs");
        let corrupt = temp.path().join("corrupt.json");
        let corrupt_bytes = b"{not-json";
        fs::write(&corrupt, corrupt_bytes).expect("write corrupt prefs");
        assert!(!update_server_port_in_prefs(&corrupt, 38471).unwrap());
        assert_eq!(fs::read(&corrupt).unwrap(), corrupt_bytes);
        assert_eq!(
            persisted_data_root_from_prefs(&corrupt).unwrap(),
            Err(FALLBACK_PERSISTED_CORRUPT)
        );

        let non_object = temp.path().join("non-object.json");
        let non_object_bytes = b"[\"keep\"]";
        fs::write(&non_object, non_object_bytes).expect("write non-object prefs");
        assert!(!update_server_port_in_prefs(&non_object, 38471).unwrap());
        assert_eq!(fs::read(&non_object).unwrap(), non_object_bytes);
        assert_eq!(
            persisted_data_root_from_prefs(&non_object).unwrap(),
            Err(FALLBACK_PERSISTED_NON_OBJECT)
        );
    }

    #[test]
    fn passive_server_port_persistence_updates_only_valid_object_port() {
        let temp = TempRoot::new("port-valid-prefs");
        let prefs = temp.path().join("ui-prefs.json");
        let selected = temp.path().join("selected-data");
        fs::create_dir(&selected).expect("create selected data");
        fs::write(
            &prefs,
            serde_json::json!({ "edupiDataRoot": selected, "theme": "dark" }).to_string(),
        )
        .expect("write valid prefs");

        assert!(update_server_port_in_prefs(&prefs, 38471).unwrap());
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&prefs).unwrap()).unwrap();
        assert_eq!(updated["serverPort"], 38471);
        assert_eq!(updated["theme"], "dark");
        assert_eq!(
            updated["edupiDataRoot"],
            selected.to_string_lossy().as_ref()
        );
    }

    #[test]
    fn passive_server_port_persistence_creates_a_valid_prefs_file_when_missing() {
        let temp = TempRoot::new("port-missing-prefs");
        let prefs = temp.path().join("nested").join("ui-prefs.json");

        assert!(update_server_port_in_prefs(&prefs, 38471).unwrap());
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&prefs).unwrap()).unwrap();
        assert_eq!(updated, serde_json::json!({ "serverPort": 38471 }));
    }

    #[test]
    fn passive_startup_distinguishes_unconfigured_prefs_from_a_missing_configured_root() {
        let temp = TempRoot::new("startup-order-prefs");
        let absent = temp.path().join("absent").join("ui-prefs.json");

        assert_eq!(
            persisted_data_root_from_prefs(&absent).unwrap(),
            Err(FALLBACK_PERSISTED_NO_KEY)
        );
        assert!(update_server_port_in_prefs(&absent, 38471).unwrap());
        assert_eq!(
            persisted_data_root_from_prefs(&absent).unwrap(),
            Err(FALLBACK_PERSISTED_NO_KEY)
        );

        let missing_target = temp.path().join("missing-target");
        let configured = temp.path().join("configured.json");
        fs::write(
            &configured,
            serde_json::json!({ "edupiDataRoot": missing_target }).to_string(),
        )
        .expect("write configured missing-root prefs");
        assert_eq!(
            persisted_data_root_from_prefs(&configured).unwrap(),
            Err(FALLBACK_PERSISTED_MISSING)
        );
        assert!(update_server_port_in_prefs(&configured, 38472).unwrap());
        let updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&configured).unwrap()).unwrap();
        assert_eq!(updated["serverPort"], 38472);
        assert_eq!(
            updated["edupiDataRoot"],
            missing_target.to_string_lossy().as_ref()
        );
        assert_eq!(
            persisted_data_root_from_prefs(&configured).unwrap(),
            Err(FALLBACK_PERSISTED_MISSING)
        );
    }

    #[cfg(windows)]
    #[test]
    fn child_process_core_root_normalization_strips_verbatim_prefix_without_truncating_path() {
        let verbatim = Path::new(r"\\?\C:\Users\teacher\AppData\Local\EduPi\resources\edupi-core");
        let normalized = child_process_compatible_path(verbatim);
        let text = normalized.to_string_lossy();
        assert!(!text.starts_with(r"\\?\"));
        assert!(text.starts_with(r"C:\Users\teacher\AppData\Local\EduPi\"));
        assert!(text.ends_with(r"resources\edupi-core"));
    }
}

#[cfg(not(feature = "custom-protocol"))]
fn start_development_server(
    _app: &tauri::AppHandle,
) -> Result<(Url, DesktopServer), Box<dyn std::error::Error>> {
    Ok((DEV_SERVER_URL.parse()?, DesktopServer::empty()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let desktop_api_token = load_or_generate_desktop_api_token()
        .expect("failed to create desktop API authorization token");
    let desktop_instance_id =
        generate_random_hex().expect("failed to create desktop server instance id");
    #[cfg(feature = "custom-protocol")]
    let server_api_token = desktop_api_token.clone();
    #[cfg(feature = "custom-protocol")]
    let server_instance_id = desktop_instance_id.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(CloseQuits(Mutex::new(false)))
        .manage(DesktopApiToken(desktop_api_token))
        .manage(computer_use::ComputerUseState::new())
        .invoke_handler(tauri::generate_handler![
            get_desktop_api_token,
            open_external_url,
            open_path,
            reveal_item_in_dir,
            set_close_quits,
            quit_app,
            show_main_window_cmd,
            set_ui_theme,
            get_edupi_root_status,
            set_edupi_data_root,
            reset_edupi_data_root,
            computer_use::computer_use_status,
            computer_use::computer_use_set_enabled,
            computer_use::computer_use_emergency_stop,
            computer_use::computer_use_request_permission,
            computer_use::computer_use_execute
        ])
        .setup(move |app| {
            // The updater public key is embedded at compile time by the release
            // workflow. Local development builds intentionally omit it, which
            // keeps unsigned builds from accepting production updates.
            if let Some(public_key) = option_env!("PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY")
                .map(str::trim)
                .filter(|key| !key.is_empty())
            {
                app.handle().plugin(
                    tauri_plugin_updater::Builder::new()
                        .pubkey(public_key)
                        .build(),
                )?;
            }

            #[cfg(feature = "custom-protocol")]
            let (url, server) =
                start_packaged_server(app.handle(), &server_api_token, &server_instance_id)?;
            #[cfg(not(feature = "custom-protocol"))]
            let (url, server) = start_development_server(app.handle())?;

            app.manage(server);
            build_window(app.handle(), url)?;

            let quick_entry_item =
                MenuItem::with_id(app, "quick_entry", "Quick Entry", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show EduPi", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit EduPi", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quick_entry_item, &show_item, &quit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::other("missing default window icon"))?;

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("EduPi")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick_entry" => {
                        show_main_window(app);
                        let _ = app.emit("edupi://quick-entry", ());
                    }
                    "show" => show_main_window(app),
                    "quit" => quit_application(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let quit = window
                        .app_handle()
                        .try_state::<CloseQuits>()
                        .and_then(|state| state.0.lock().ok().map(|guard| *guard))
                        .unwrap_or(false);
                    if quit {
                        quit_application(window.app_handle());
                    } else {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Pi Agent desktop app");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => {
            if let Some(server) = app_handle.try_state::<DesktopServer>() {
                server.stop();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Some(window) = app_handle.get_webview_window(WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }
        _ => {}
    });
}
