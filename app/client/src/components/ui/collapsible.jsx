import * as React from "react";
import { cn } from "@/lib/utils";

const CollapsibleContext = React.createContext({ open: false, toggle: () => {} });

function Collapsible({ open: controlledOpen, onOpenChange, defaultOpen = false, children, className, ...props }) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const toggle = React.useCallback(() => {
    const next = !open;
    setInternalOpen(next);
    onOpenChange?.(next);
  }, [open, onOpenChange]);

  return (
    <CollapsibleContext.Provider value={{ open, toggle }}>
      <div className={cn(className)} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

function CollapsibleTrigger({ children, className, asChild, ...props }) {
  const { toggle } = React.useContext(CollapsibleContext);
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: toggle, ...props });
  }
  return (
    <button type="button" onClick={toggle} className={cn(className)} {...props}>
      {children}
    </button>
  );
}

function CollapsibleContent({ children, className, ...props }) {
  const { open } = React.useContext(CollapsibleContext);
  if (!open) return null;
  return (
    <div className={cn(className)} {...props}>
      {children}
    </div>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
