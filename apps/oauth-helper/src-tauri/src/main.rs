#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::OnceLock;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

static LISTENER_STARTED: OnceLock<()> = OnceLock::new();

fn http_ok_response() -> String {
  let body = "<!doctype html><html><body><p>Callback captured. Return to Keppo.</p></body></html>";
  format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.len(),
    body
  )
}

fn extract_callback_url(request: &str) -> Option<String> {
  let first_line = request.lines().next()?;
  let path = first_line.split_whitespace().nth(1)?;
  if !path.starts_with("/auth/callback") {
    return None;
  }
  Some(format!("http://127.0.0.1:1455{}", path))
}

#[tauri::command]
fn launch_in_browser(url: String) -> Result<(), String> {
  tauri::webbrowser::open(&url).map_err(|error| error.to_string())
}

#[tauri::command]
fn start_local_listener(app: AppHandle) -> Result<(), String> {
  if LISTENER_STARTED.get().is_some() {
    return Ok(());
  }
  let listener = TcpListener::bind("127.0.0.1:1455").map_err(|error| error.to_string())?;
  LISTENER_STARTED
    .set(())
    .map_err(|_| String::from("OpenAI callback listener already started."))?;

  thread::spawn(move || {
    for stream in listener.incoming() {
      let mut stream = match stream {
        Ok(stream) => stream,
        Err(_) => continue,
      };
      let mut buffer = [0; 8192];
      let bytes_read = match stream.read(&mut buffer) {
        Ok(bytes) => bytes,
        Err(_) => continue,
      };
      let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
      let callback_url = extract_callback_url(&request);
      let _ = stream.write_all(http_ok_response().as_bytes());
      let _ = stream.flush();
      if let Some(callback_url) = callback_url {
        let _ = app.emit(
          "oauth-callback-received",
          serde_json::json!({ "callbackUrl": callback_url }),
        );
        break;
      }
    }
  });

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![launch_in_browser, start_local_listener])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
