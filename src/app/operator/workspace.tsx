import type { ReactNode } from "react";

/** A task-sized section: cards keep their natural height rather than stretching to a neighbour. */
export function WorkspaceGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="operator-workspace-group">
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="operator-section-grid">{children}</div>
    </section>
  );
}

export function WorkspaceTool({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="operator-tool" open={open || undefined}>
      <summary>{title}</summary>
      <div className="operator-tool-content">{children}</div>
    </details>
  );
}
