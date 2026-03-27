import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { submitHelperCallback } from "./lib/api";
import { formatUiStateLabel, type HelperUiState } from "./lib/oauth";
import { readLaunchContext, type LaunchContext } from "./lib/session";

type CallbackEventPayload = {
  callbackUrl: string;
};

export function App() {
  const [launchContext, setLaunchContext] = useState<LaunchContext | null>(null);
  const [status, setStatus] = useState<HelperUiState>("starting");
  const [detail, setDetail] = useState("Preparing the localhost callback listener.");

  useEffect(() => {
    const context = readLaunchContext();
    setLaunchContext(context);
    if (!context) {
      setStatus("error");
      setDetail("Missing helper launch metadata. Relaunch from the Keppo dashboard.");
      return;
    }

    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        unlisten = await listen<CallbackEventPayload>("oauth-callback-received", async (event) => {
          setStatus("captured");
          setDetail("Captured the localhost callback. Sending it back to Keppo now.");
          try {
            setStatus("submitting");
            await submitHelperCallback({
              ...context,
              callbackUrl: event.payload.callbackUrl,
            });
            setStatus("connected");
            setDetail("Keppo accepted the callback. You can close this helper.");
          } catch (error) {
            setStatus("error");
            setDetail(error instanceof Error ? error.message : "Failed to submit callback.");
          }
        });
        await invoke("start_local_listener");
        setStatus("waiting");
        setDetail("Listening on 127.0.0.1:1455 and opening ChatGPT sign-in.");
        await invoke("launch_in_browser", { url: context.oauthStartUrl });
      } catch (error) {
        setStatus("error");
        setDetail(error instanceof Error ? error.message : "Failed to start the helper.");
      }
    })();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Keppo OAuth Helper</p>
        <h1>{formatUiStateLabel(status)}</h1>
        <p className="detail">{detail}</p>
        <dl className="meta">
          <div>
            <dt>Redirect</dt>
            <dd>127.0.0.1:1455/auth/callback</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{launchContext?.helperSessionToken ? "Loaded" : "Missing"}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
