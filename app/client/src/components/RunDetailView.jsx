import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Loader2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ToolCallCard from "./ToolCallCard.jsx";
import Markdown from "./Markdown.jsx";
import { formatDuration } from "@/lib/cron";

export default function RunDetailView({ scheduleId, runId, scheduleName, onBack, fetchRunDetail }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [artifacts, setArtifacts] = useState([]);
  const [previewContent, setPreviewContent] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetchRunDetail(scheduleId, runId)
      .then((data) => {
        setDetail(data);
        // If run has output files, use them; otherwise check run storage
        if (data?.outputFiles?.length > 0) {
          setArtifacts(data.outputFiles);
        } else {
          // Check for archived artifacts
          fetch(`/api/tasks/${scheduleId}/runs/${runId}/artifacts`)
            .then((r) => r.ok ? r.json() : [])
            .then((files) => { if (files.length > 0) setArtifacts(files); })
            .catch(() => {});
        }
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [scheduleId, runId, fetchRunDetail]);

  function handlePreviewArtifact(filename) {
    const url = `/api/tasks/${scheduleId}/runs/${runId}/artifacts/${encodeURIComponent(filename)}`;
    if (filename.endsWith(".md") || filename.endsWith(".txt") || filename.endsWith(".json") || filename.endsWith(".log")) {
      fetch(url)
        .then((r) => r.text())
        .then((text) => {
          setPreviewContent(text);
          setPreviewFile(filename);
        })
        .catch(() => {});
    } else {
      window.open(url, "_blank");
    }
  }

  // Group conversation entries just like App.jsx does
  const groupedConversation = useMemo(() => {
    if (!detail?.conversation) return [];
    const groups = [];
    let toolGroup = null;
    let inToolRun = false;
    for (const msg of detail.conversation) {
      const isToolTile = msg.type === "tool_call" && msg.tool !== "AskUserQuestion";
      if (isToolTile) {
        inToolRun = true;
        if (!toolGroup) {
          toolGroup = { type: "tool_group", msgs: [] };
          groups.push(toolGroup);
        }
        toolGroup.msgs.push(msg);
      } else if (msg.type === "tool_result") {
        continue;
      } else if (inToolRun && msg.type === "assistant_stream") {
        toolGroup = null;
        groups.push({ type: "single", msg });
      } else {
        toolGroup = null;
        inToolRun = false;
        groups.push({ type: "single", msg });
      }
    }
    return groups;
  }, [detail]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading run details...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <p className="text-sm">Run not found</p>
        <Button variant="outline" size="sm" onClick={onBack}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{scheduleName} - Run</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className={detail.status === "success" ? "text-green-500" : "text-red-500"}>
              {detail.status === "success" ? "Success" : "Failed"}
            </span>
            <span>{new Date(detail.startedAt).toLocaleString()}</span>
            {detail.durationMs > 0 && <span>{formatDuration(detail.durationMs)}</span>}
            {detail.cost > 0 && <span>${detail.cost < 0.01 ? detail.cost.toFixed(4) : detail.cost.toFixed(2)}</span>}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {detail.error && (
        <div className="mx-4 mt-3 bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs">
          {detail.error}
        </div>
      )}

      {/* Output artifacts */}
      {artifacts.length > 0 && (
        <div className="mx-4 mt-3 border border-border rounded-md">
          <div className="px-3 py-1.5 bg-muted/50 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground">Output Files</span>
          </div>
          <div className="divide-y divide-border/50">
            {artifacts.map((file) => (
              <button
                key={file.name}
                onClick={() => handlePreviewArtifact(file.name)}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-muted/30 transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium flex-1 truncate">{file.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {file.size < 1024 ? `${file.size}B` : `${(file.size / 1024).toFixed(1)}KB`}
                </span>
                <Download className="h-3 w-3 text-muted-foreground/60" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Artifact preview */}
      {previewContent && previewFile && (
        <div className="mx-4 mt-2 border border-border rounded-md">
          <div className="px-3 py-1.5 bg-muted/50 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{previewFile}</span>
            <button
              onClick={() => { setPreviewContent(null); setPreviewFile(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="p-3 max-h-80 overflow-y-auto">
            {previewFile.endsWith(".md") ? (
              <div className="text-sm"><Markdown>{previewContent}</Markdown></div>
            ) : (
              <pre className="text-xs whitespace-pre-wrap text-foreground/80">{previewContent}</pre>
            )}
          </div>
        </div>
      )}

      {/* Conversation */}
      <ScrollArea className="flex-1 p-4">
        {groupedConversation.map((group, gi) => {
          if (group.type === "tool_group") {
            return (
              <div key={`tg-${gi}`} className="grid grid-cols-2 md:grid-cols-3 gap-2 my-1 text-sm">
                {group.msgs.map((msg, ti) => (
                  <ToolCallCard
                    key={ti}
                    tool={msg.tool}
                    input={msg.input}
                    output={detail.conversation.find(
                      (m) => m.type === "tool_result" && m.toolUseId === msg.toolUseId
                    )?.output}
                  />
                ))}
              </div>
            );
          }
          const msg = group.msg;
          return (
            <div key={gi} className="mb-2 text-sm">
              {msg.type === "user" && (
                <div className="max-w-lg bg-primary text-primary-foreground rounded-lg px-4 py-2 w-fit ml-auto">
                  {msg.text}
                </div>
              )}
              {msg.type === "assistant_stream" && (
                <div className="max-w-3/4 bg-card border border-border rounded-lg px-4 py-2">
                  <Markdown>{msg.text}</Markdown>
                </div>
              )}
              {msg.type === "stats" && (
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground py-1.5 px-2">
                  {msg.cost != null && <span>${msg.cost < 0.01 ? msg.cost.toFixed(4) : msg.cost.toFixed(2)}</span>}
                  {msg.usage && <span>{((msg.usage.input_tokens || 0) / 1000).toFixed(1)}k in</span>}
                  {msg.usage && <span>{((msg.usage.output_tokens || 0) / 1000).toFixed(1)}k out</span>}
                  {msg.numTurns > 0 && <span>{msg.numTurns} {msg.numTurns === 1 ? "turn" : "turns"}</span>}
                  {msg.durationMs > 0 && <span>{(msg.durationMs / 1000).toFixed(1)}s</span>}
                </div>
              )}
              {msg.type === "error" && (
                <div className="max-w-3/4 bg-destructive/20 text-destructive rounded-lg px-4 py-2">
                  {msg.message}
                </div>
              )}
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}
