import { useState, useEffect, useCallback } from "react";
import { Plus, Clock, CheckCircle, XCircle, Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import ScheduleForm from "./ScheduleForm.jsx";
import ScheduleDetail from "./ScheduleDetail.jsx";
import RunDetailView from "./RunDetailView.jsx";
import { useSchedules } from "@/hooks/useSchedules";
import { describeCron, formatRelativeTime } from "@/lib/cron";
import { cn } from "@/lib/utils";

export default function SchedulesPage() {
  const {
    schedules,
    loading,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    triggerSchedule,
    fetchRuns,
    fetchRunDetail,
    setSchedules,
  } = useSchedules();

  const [view, setView] = useState("list"); // "list" | "detail" | "run"
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editSchedule, setEditSchedule] = useState(null);

  useEffect(() => {
    fetchSchedules();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchSchedules, 30000);
    return () => clearInterval(interval);
  }, [fetchSchedules]);

  // Listen for WebSocket schedule_run_complete events
  useEffect(() => {
    function handleMessage(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "schedule_run_complete") {
          fetchSchedules();
        }
      } catch {}
    }
    // Try to add listener to any existing WebSocket connections
    // This is a lightweight approach - we just refresh the schedule list
    // The main WebSocket is managed by useWebSocket hook in App.jsx
    return () => {};
  }, [fetchSchedules]);

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId);

  function handleSelectSchedule(id) {
    setSelectedScheduleId(id);
    setView("detail");
  }

  function handleViewRun(runId) {
    setSelectedRunId(runId);
    setView("run");
  }

  function handleBackToList() {
    setSelectedScheduleId(null);
    setView("list");
  }

  function handleBackToDetail() {
    setSelectedRunId(null);
    setView("detail");
  }

  function handleEdit(schedule) {
    setEditSchedule(schedule);
    setShowForm(true);
  }

  async function handleFormSubmit(config) {
    if (editSchedule) {
      await updateSchedule(editSchedule.id, config);
    } else {
      await createSchedule(config);
    }
  }

  function handleFormClose() {
    setShowForm(false);
    setEditSchedule(null);
  }

  async function handleToggle(id, enabled) {
    await toggleSchedule(id, enabled);
  }

  // Run detail view
  if (view === "run" && selectedScheduleId && selectedRunId) {
    return (
      <RunDetailView
        scheduleId={selectedScheduleId}
        runId={selectedRunId}
        scheduleName={selectedSchedule?.name || "Schedule"}
        onBack={handleBackToDetail}
        fetchRunDetail={fetchRunDetail}
      />
    );
  }

  // Schedule detail view
  if (view === "detail" && selectedSchedule) {
    return (
      <>
        <ScheduleDetail
          schedule={selectedSchedule}
          onBack={handleBackToList}
          onEdit={handleEdit}
          onDelete={deleteSchedule}
          onToggle={handleToggle}
          onTrigger={triggerSchedule}
          onViewRun={handleViewRun}
          fetchRuns={fetchRuns}
        />
        <ScheduleForm
          open={showForm}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
          initial={editSchedule}
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
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Scheduled Tasks</h2>
          {schedules.length > 0 && (
            <Badge variant="secondary" className="text-[10px] py-0">{schedules.length}</Badge>
          )}
        </div>
        <Button size="sm" className="text-xs h-7" onClick={() => { setEditSchedule(null); setShowForm(true); }}>
          <Plus className="h-3 w-3 mr-1" />
          New Schedule
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {loading && schedules.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading schedules...
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 border border-border/50 flex items-center justify-center mb-4">
              <Clock className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground/60 mb-1">No scheduled tasks</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs mb-4">
              Schedule automated tasks like PR reviews, code quality checks, or dependency audits to run on a recurring basis.
            </p>
            <Button size="sm" onClick={() => { setEditSchedule(null); setShowForm(true); }}>
              <Plus className="h-3 w-3 mr-1" />
              Create Your First Schedule
            </Button>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {schedules.map((schedule) => (
              <button
                key={schedule.id}
                onClick={() => handleSelectSchedule(schedule.id)}
                className="w-full text-left rounded-lg border border-border/50 hover:border-border hover:bg-muted/20 transition-colors px-4 py-3 group"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{schedule.name}</span>
                      {!schedule.enabled && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          <Pause className="h-2.5 w-2.5 mr-0.5" />
                          Paused
                        </Badge>
                      )}
                      {schedule.running && (
                        <Badge variant="outline" className="text-[10px] py-0 text-yellow-500 border-yellow-500/50">
                          <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />
                          Running
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{describeCron(schedule.cronExpression)}</span>
                      <span className="text-muted-foreground/60">{schedule.provider}/{schedule.repoFullName}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    {schedule.lastRunAt ? (
                      <div className="flex items-center gap-1 text-xs">
                        {schedule.lastRunStatus === "success" ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-500" />
                        )}
                        <span className="text-muted-foreground">{formatRelativeTime(schedule.lastRunAt)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">No runs yet</span>
                    )}
                    {schedule.nextRunAt && schedule.enabled && (
                      <span className="text-[11px] text-muted-foreground/50">
                        Next: {formatRelativeTime(schedule.nextRunAt)}
                      </span>
                    )}
                  </div>

                  {/* Quick toggle button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(schedule.id, !schedule.enabled);
                    }}
                    className={cn(
                      "p-1 rounded transition-colors shrink-0",
                      schedule.enabled
                        ? "text-green-500 hover:bg-green-500/10"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    title={schedule.enabled ? "Pause schedule" : "Resume schedule"}
                  >
                    {schedule.enabled ? (
                      <Play className="h-3.5 w-3.5 fill-current" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      <ScheduleForm
        open={showForm}
        onClose={handleFormClose}
        onSubmit={handleFormSubmit}
        initial={editSchedule}
      />
    </div>
  );
}
