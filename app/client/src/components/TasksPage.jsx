import { useState, useEffect, useCallback } from "react";
import { Plus, ListTodo, CheckCircle, XCircle, Loader2, Pause, Play, Clock, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import TaskForm from "./TaskForm.jsx";
import TaskDetail from "./TaskDetail.jsx";
import RunDetailView from "./RunDetailView.jsx";
import RunsOverview from "./RunsOverview.jsx";
import { useTasks } from "@/hooks/useTasks";
import { describeCron, formatRelativeTime } from "@/lib/cron";
import { cn } from "@/lib/utils";

export default function TasksPage() {
  const {
    tasks,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
    fetchRuns,
    fetchRunDetail,
    fetchAllRuns,
    setTasks,
  } = useTasks();

  const [view, setView] = useState("list"); // "list" | "detail" | "run" | "runs-overview"
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);

  useEffect(() => {
    fetchTasks();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Listen for WebSocket task_run_complete events
  useEffect(() => {
    function handleMessage(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "task_run_complete") {
          fetchTasks();
        }
      } catch {}
    }
    return () => {};
  }, [fetchTasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  function handleSelectTask(id) {
    setSelectedTaskId(id);
    setView("detail");
  }

  function handleViewRun(runId) {
    setSelectedRunId(runId);
    setView("run");
  }

  function handleViewRunFromOverview(taskId, runId) {
    setSelectedTaskId(taskId);
    setSelectedRunId(runId);
    setView("run");
  }

  function handleBackToList() {
    setSelectedTaskId(null);
    setView("list");
  }

  function handleBackToDetail() {
    setSelectedRunId(null);
    setView("detail");
  }

  function handleBackFromRunOverviewRun() {
    setSelectedRunId(null);
    setView("runs-overview");
  }

  function handleEdit(task) {
    setEditTask(task);
    setShowForm(true);
  }

  async function handleFormSubmit(config) {
    if (editTask) {
      await updateTask(editTask.id, config);
    } else {
      await createTask(config);
    }
  }

  function handleFormClose() {
    setShowForm(false);
    setEditTask(null);
  }

  async function handleToggle(id, enabled) {
    await toggleTask(id, enabled);
  }

  // Runs overview
  if (view === "runs-overview") {
    // If viewing a specific run from the overview
    if (selectedTaskId && selectedRunId) {
      return (
        <RunDetailView
          scheduleId={selectedTaskId}
          runId={selectedRunId}
          scheduleName={tasks.find((t) => t.id === selectedTaskId)?.name || "Task"}
          onBack={handleBackFromRunOverviewRun}
          fetchRunDetail={fetchRunDetail}
        />
      );
    }
    return (
      <RunsOverview
        onBack={handleBackToList}
        onViewRun={handleViewRunFromOverview}
        fetchAllRuns={fetchAllRuns}
      />
    );
  }

  // Run detail view
  if (view === "run" && selectedTaskId && selectedRunId) {
    return (
      <RunDetailView
        scheduleId={selectedTaskId}
        runId={selectedRunId}
        scheduleName={selectedTask?.name || "Task"}
        onBack={handleBackToDetail}
        fetchRunDetail={fetchRunDetail}
      />
    );
  }

  // Task detail view
  if (view === "detail" && selectedTask) {
    return (
      <>
        <TaskDetail
          task={selectedTask}
          onBack={handleBackToList}
          onEdit={handleEdit}
          onDelete={deleteTask}
          onToggle={handleToggle}
          onTrigger={triggerTask}
          onViewRun={handleViewRun}
          fetchRuns={fetchRuns}
        />
        <TaskForm
          open={showForm}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
          initial={editTask}
        />
      </>
    );
  }

  // List view
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Tasks</h2>
          {tasks.length > 0 && (
            <Badge variant="secondary" className="text-[10px] py-0">{tasks.length}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setView("runs-overview")}>
            <BarChart3 className="h-3 w-3 mr-1" />
            All Runs
          </Button>
          <Button size="sm" className="text-xs h-7" onClick={() => { setEditTask(null); setShowForm(true); }}>
            <Plus className="h-3 w-3 mr-1" />
            New Task
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 border border-border/50 flex items-center justify-center mb-4">
              <ListTodo className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground/60 mb-1">No tasks</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs mb-4">
              Create tasks to automate work like PR reviews, code quality checks, dependency audits, or any one-off operation.
            </p>
            <Button size="sm" onClick={() => { setEditTask(null); setShowForm(true); }}>
              <Plus className="h-3 w-3 mr-1" />
              Create Your First Task
            </Button>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => handleSelectTask(task.id)}
                className="w-full text-left rounded-lg border border-border/50 hover:border-border hover:bg-muted/20 transition-colors px-4 py-3 group"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{task.name}</span>
                      {!task.cronExpression && (
                        <Badge variant="outline" className="text-[10px] py-0 text-blue-500 border-blue-500/50">
                          One-off
                        </Badge>
                      )}
                      {task.cronExpression && !task.enabled && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          <Pause className="h-2.5 w-2.5 mr-0.5" />
                          Paused
                        </Badge>
                      )}
                      {task.running && (
                        <Badge variant="outline" className="text-[10px] py-0 text-yellow-500 border-yellow-500/50">
                          <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />
                          Running
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {task.cronExpression ? (
                        <span>{describeCron(task.cronExpression)}</span>
                      ) : (
                        <span>Manual execution</span>
                      )}
                      <span className="text-muted-foreground/60">
                        {task.workingDirectory.split("/").pop()}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    {task.lastRunAt ? (
                      <div className="flex items-center gap-1 text-xs">
                        {task.lastRunStatus === "success" ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-500" />
                        )}
                        <span className="text-muted-foreground">{formatRelativeTime(task.lastRunAt)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">No runs yet</span>
                    )}
                    {task.nextRunAt && task.enabled && (
                      <span className="text-[11px] text-muted-foreground/50">
                        Next: {formatRelativeTime(task.nextRunAt)}
                      </span>
                    )}
                  </div>

                  {/* Quick toggle button - only for scheduled tasks */}
                  {task.cronExpression && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(task.id, !task.enabled);
                      }}
                      className={cn(
                        "p-1 rounded transition-colors shrink-0",
                        task.enabled
                          ? "text-green-500 hover:bg-green-500/10"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                      title={task.enabled ? "Pause schedule" : "Resume schedule"}
                    >
                      {task.enabled ? (
                        <Play className="h-3.5 w-3.5 fill-current" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      <TaskForm
        open={showForm}
        onClose={handleFormClose}
        onSubmit={handleFormSubmit}
        initial={editTask}
      />
    </div>
  );
}
