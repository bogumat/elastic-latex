import { useRef, useState, type ReactNode } from 'react';

export function Sidebar({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const [width, setWidth] = useState(() => {
    try {
      return Math.min(
        480,
        Math.max(180, Number(localStorage.getItem('elastic.sidebar.width')) || 240),
      );
    } catch {
      return 240;
    }
  });
  const host = useRef<HTMLDivElement>(null),
    value = useRef(width),
    frame = useRef(0);
  function update(next: number) {
    value.current = Math.max(180, Math.min(480, window.innerWidth * 0.45, next));
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (host.current) host.current.style.width = `${value.current}px`;
    });
  }
  function commit() {
    cancelAnimationFrame(frame.current);
    if (host.current) host.current.style.width = `${value.current}px`;
    setWidth(value.current);
    try {
      localStorage.setItem('elastic.sidebar.width', String(value.current));
    } catch {
      /* In-memory layout still works. */
    }
  }
  return (
    <div className="sidebar-shell" hidden={hidden} style={{ width }} ref={host}>
      {children}
      <div
        className="sidebar-divider"
        role="separator"
        aria-label="Sidebar width"
        aria-orientation="vertical"
        aria-valuenow={Math.round(width)}
        aria-valuemin={180}
        aria-valuemax={480}
        tabIndex={0}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            update(event.clientX - host.current!.getBoundingClientRect().left);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            commit();
          }
        }}
        onPointerCancel={commit}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            update(width + (event.key === 'ArrowRight' ? 20 : -20));
            commit();
          }
        }}
      />
    </div>
  );
}
