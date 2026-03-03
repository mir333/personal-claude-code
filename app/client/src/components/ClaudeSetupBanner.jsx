import { useState, useEffect } from "react";
import { AlertTriangle, Terminal, Key, RefreshCw, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ClaudeSetupBanner() {
  const [status, setStatus] = useState(null); // null = loading, { hasCredentials, authMethod }
  const [checking, setChecking] = useState(false);

  function checkStatus() {
    setChecking(true);
    fetch("/api/claude-status")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ hasCredentials: false, authMethod: null }))
      .finally(() => setChecking(false));
  }

  useEffect(() => {
    checkStatus();
  }, []);

  // Don't show anything while loading
  if (status === null) return null;

  // Credentials are configured - don't show banner
  if (status.hasCredentials) return null;

  return (
    <div className="mx-4 mt-4 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="shrink-0 h-10 w-10 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Claude Authentication Required</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              No Claude credentials found. Set up authentication to start using the Web UI.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Option 1: OAuth */}
          <div className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">Option 1: OAuth Login (Claude Pro/Max)</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Authenticate with your Claude Pro or Max subscription via the browser-based OAuth flow.
            </p>
            <div className="space-y-2">
              <Step number={1}>
                Open a terminal into the container:
                <Code>docker compose exec claude-code zsh</Code>
              </Step>
              <Step number={2}>
                Run the Claude CLI:
                <Code>claude</Code>
              </Step>
              <Step number={3}>
                Follow the browser-based login flow to authenticate.
                Your tokens will be saved automatically.
              </Step>
              <Step number={4}>
                Come back here and click <strong>Re-check</strong> below.
              </Step>
            </div>
          </div>

          {/* Option 2: API Key */}
          <div className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Key className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">Option 2: API Key</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Use an Anthropic API key from{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                console.anthropic.com
              </a>.
            </p>
            <div className="space-y-2">
              <Step number={1}>
                Add the key to your <Code inline>docker-compose.yml</Code> environment section:
                <Code>
{`environment:
  ANTHROPIC_API_KEY: "sk-ant-api03-..."`}
                </Code>
              </Step>
              <Step number={2}>
                Restart the container:
                <Code>docker compose up -d</Code>
              </Step>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={checkStatus}
            disabled={checking}
            className="border-yellow-500/30 hover:bg-yellow-500/10 hover:text-yellow-500"
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1.5" />
            )}
            Re-check credentials
          </Button>
          <span className="text-xs text-muted-foreground">
            This banner disappears once credentials are detected.
          </span>
        </div>
      </div>
    </div>
  );
}

function Step({ number, children }) {
  return (
    <div className="flex gap-2.5 text-xs">
      <span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center mt-0.5">
        {number}
      </span>
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

function Code({ children, inline }) {
  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-foreground/80 text-[11px] font-mono">
        {children}
      </code>
    );
  }
  return (
    <pre className="mt-1.5 mb-1 px-3 py-2 rounded-md bg-[#1a1a2e] text-green-400 text-[11px] font-mono overflow-x-auto leading-relaxed">
      {children}
    </pre>
  );
}
