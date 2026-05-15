import { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import { ChevronRight, File, Folder, FolderOpen, Loader2, Save, RefreshCw, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  File Tree                                                          */
/* ------------------------------------------------------------------ */
function FileTreeEntry({ name, type, depth, expanded, selected, loading, onClick }) {
  const indent = depth * 14;
  const isDir = type === "directory";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "w-full flex items-center gap-1 py-[3px] pr-2 text-xs text-left transition-colors hover:bg-accent/50 rounded-sm",
        selected && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      style={{ paddingLeft: `${indent + 6}px` }}
    >
      {isDir ? (
        <>
          <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </>
      ) : (
        <>
          <span className="w-3 shrink-0" />
          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </>
      )}
      <span className="truncate flex-1">{name}</span>
      {loading && <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground" />}
    </button>
  );
}

function FileTree({ agentId, onSelectFile, selectedPath, refreshKey }) {
  const [entries, setEntries] = useState({}); // dirPath -> items[]
  const [expanded, setExpanded] = useState(new Set([""]));
  const [loadingDirs, setLoadingDirs] = useState(new Set());

  const loadDir = useCallback(async (dirPath) => {
    setLoadingDirs((prev) => new Set([...prev, dirPath]));
    try {
      const res = await fetch(`/api/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`);
      if (res.ok) {
        const items = await res.json();
        setEntries((prev) => ({ ...prev, [dirPath]: items }));
      }
    } catch {
      // ignore
    } finally {
      setLoadingDirs((prev) => { const next = new Set(prev); next.delete(dirPath); return next; });
    }
  }, [agentId]);

  // Load root on mount or when agentId / refreshKey changes
  useEffect(() => {
    setEntries({});
    setExpanded(new Set([""]));
    loadDir("");
  }, [agentId, refreshKey, loadDir]);

  function toggleDir(dirPath) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        if (!entries[dirPath]) loadDir(dirPath);
      }
      return next;
    });
  }

  function renderEntries(parentPath, depth) {
    const items = entries[parentPath];
    if (!items) return null;

    return items.map((item) => {
      const itemPath = parentPath ? `${parentPath}/${item.name}` : item.name;
      const isDir = item.type === "directory";
      const isExpanded = expanded.has(itemPath);
      const isSelected = selectedPath === itemPath;
      const isLoading = loadingDirs.has(itemPath);

      return (
        <div key={itemPath}>
          <FileTreeEntry
            name={item.name}
            type={item.type}
            depth={depth}
            expanded={isExpanded}
            selected={isSelected}
            loading={isLoading}
            onClick={() => {
              if (isDir) {
                toggleDir(itemPath);
              } else {
                onSelectFile(itemPath);
              }
            }}
          />
          {isDir && isExpanded && renderEntries(itemPath, depth + 1)}
        </div>
      );
    });
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1 px-1">
        {loadingDirs.has("") && !entries[""] ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            <span className="text-xs">Loading...</span>
          </div>
        ) : (
          renderEntries("", 0)
        )}
      </div>
    </ScrollArea>
  );
}

/* ------------------------------------------------------------------ */
/*  Main CodeEditor component                                          */
/* ------------------------------------------------------------------ */
export default function CodeEditor({ agentId, visible }) {
  const [selectedFile, setSelectedFile] = useState(null); // { path, content, language }
  const [currentContent, setCurrentContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const editorRef = useRef(null);
  const [treeWidth, setTreeWidth] = useState(224); // default w-56 = 224px
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  // Drag-to-resize handler for the file tree panel
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMouseMove(ev) {
      const delta = ev.clientX - startX;
      const newWidth = Math.min(500, Math.max(120, startWidth + delta));
      setTreeWidth(newWidth);
    }

    function onMouseUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [treeWidth]);

  // Reset when agent changes
  useEffect(() => {
    setSelectedFile(null);
    setCurrentContent("");
    setDirty(false);
    setError("");
  }, [agentId]);

  // Keyboard shortcut: Ctrl+S / Cmd+S
  useEffect(() => {
    if (!visible) return;
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && selectedFile && !saving) {
          handleSave();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, dirty, selectedFile, saving, currentContent]);

  async function handleSelectFile(relativePath) {
    if (dirty) {
      if (!confirm("You have unsaved changes. Discard?")) return;
    }
    setFileLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/file?path=${encodeURIComponent(relativePath)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load file");
        setFileLoading(false);
        return;
      }
      if (data.binary) {
        setSelectedFile({ path: relativePath, content: null, language: "plaintext", binary: true });
        setCurrentContent("");
        setDirty(false);
      } else {
        setSelectedFile({ path: relativePath, content: data.content, language: data.language, binary: false });
        setCurrentContent(data.content);
        setDirty(false);
      }
    } catch {
      setError("Failed to load file");
    } finally {
      setFileLoading(false);
    }
  }

  async function handleSave() {
    if (!selectedFile || selectedFile.binary) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile.path, content: currentContent }),
      });
      if (res.ok) {
        setDirty(false);
        setSelectedFile((prev) => ({ ...prev, content: currentContent }));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save file");
      }
    } catch {
      setError("Failed to save file");
    } finally {
      setSaving(false);
    }
  }

  function handleEditorMount(editor) {
    editorRef.current = editor;
    // Add Ctrl+S command inside Monaco itself
    editor.addCommand(
      // eslint-disable-next-line no-bitwise
      2048 | 49, // KeyMod.CtrlCmd | KeyCode.KeyS
      () => {
        // This will be handled by the window keydown listener
      }
    );
  }

  if (!visible) return null;

  return (
    <div className="flex h-full" ref={containerRef}>
      {/* File tree panel */}
      <div className="border-r border-border bg-card flex flex-col shrink-0" style={{ width: treeWidth }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Files</span>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Refresh file tree"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <FileTree
            agentId={agentId}
            onSelectFile={handleSelectFile}
            selectedPath={selectedFile?.path}
            refreshKey={refreshKey}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleDragStart}
        className="w-1 cursor-col-resize bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0"
        title="Drag to resize file tree"
      />

      {/* Editor panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {error && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 text-destructive text-xs border-b border-border">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="hover:text-foreground">&times;</button>
          </div>
        )}
        {fileLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Loading file...</span>
          </div>
        ) : selectedFile ? (
          <>
            {/* Editor header */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card">
              <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate flex-1">
                {selectedFile.path}
                {dirty && <span className="text-primary ml-1">●</span>}
              </span>
              <a
                href={`/api/agents/${agentId}/file/download?path=${encodeURIComponent(selectedFile.path)}`}
                download
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Download file"
              >
                <Download className="h-3 w-3" />
              </a>
              {dirty && !selectedFile.binary && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
              )}
            </div>
            {/* Editor body */}
            {selectedFile.binary ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                <span>Binary file — cannot display</span>
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  language={selectedFile.language}
                  value={selectedFile.content}
                  theme="vs-dark"
                  onChange={(value) => {
                    setCurrentContent(value || "");
                    setDirty(true);
                  }}
                  onMount={handleEditorMount}
                  options={{
                    readOnly: false,
                    minimap: { enabled: true },
                    fontSize: 13,
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    renderWhitespace: "selection",
                    smoothScrolling: true,
                    cursorSmoothCaretAnimation: "on",
                    padding: { top: 8 },
                  }}
                  loading={
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  }
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <File className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm">Select a file to view</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Browse the file tree on the left</p>
          </div>
        )}
      </div>
    </div>
  );
}
