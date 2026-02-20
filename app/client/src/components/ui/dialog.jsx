import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

function Dialog({ open, onClose, children, className }) {
  React.useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg",
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export { Dialog };
