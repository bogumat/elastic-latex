import { memo, useEffect, useRef } from 'react';
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';

export interface PageSize {
  width: number;
  height: number;
}

// One in-flight canvas/text render across the viewer, including cancelled jobs.
export class RenderQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run(task: () => Promise<void>) {
    const next = this.tail.then(task);
    this.tail = next.catch(() => {});
    return next;
  }
}

function release(element: HTMLElement) {
  element.querySelectorAll('canvas').forEach((canvas) => {
    canvas.width = canvas.height = 0;
  });
  element.replaceChildren();
}

export const PdfPage = memo(function PdfPage({
  pdf,
  page,
  layout,
  enabled,
  pixelBudget,
  queue,
  onReady,
  onError,
  onLocate,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  layout: PageSize & { scale: number };
  enabled: boolean;
  pixelBudget: number;
  queue: RenderQueue;
  onReady: () => void;
  onError: (message: string) => void;
  onLocate: (page: number, x: number, y: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const { width, height, scale } = layout;
  useEffect(() => {
    const element = host.current!;
    if (!enabled) {
      release(element);
      return;
    }
    let obsolete = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let text: TextLayer | undefined;
    let canvas: HTMLCanvasElement | undefined;
    void queue
      .run(async () => {
        if (obsolete) return;
        const source = await pdf.getPage(page);
        if (obsolete) return;
        const viewport = source.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(pixelBudget / (width * height)),
        );
        const content = document.createElement('div');
        content.style.setProperty('--scale-factor', `${scale}`);
        content.style.setProperty('--total-scale-factor', `${scale * source.userUnit}`);
        canvas = document.createElement('canvas');
        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        content.append(canvas);
        try {
          render = source.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
          await render.promise;
          if (obsolete) return;
          const layer = document.createElement('div');
          layer.className = 'textLayer';
          content.append(layer);
          text = new TextLayer({
            textContentSource: source.streamTextContent(),
            container: layer,
            viewport,
          });
          await text.render();
          if (obsolete) return;
          release(element);
          element.replaceChildren(content);
          canvas = undefined;
          callbacks.current.onReady();
          performance.mark('elastic:pdf-visible');
        } finally {
          if (canvas) canvas.width = canvas.height = 0;
          source.cleanup();
        }
      })
      .catch((reason) => {
        if (!obsolete) callbacks.current.onError(String(reason));
      });
    return () => {
      obsolete = true;
      render?.cancel();
      text?.cancel();
    };
  }, [pdf, page, scale, width, height, enabled, pixelBudget, queue]);
  useEffect(() => {
    const element = host.current!;
    return () => release(element);
  }, []);
  return (
    <div
      className="pdf-page"
      role="region"
      aria-label={`Page ${page}`}
      data-page={page}
      title="Double-click to show source"
      onDoubleClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / scale;
        const y = (event.clientY - bounds.top) / scale;
        void pdf
          .getPage(page)
          .then((source) => {
            const viewport = source.getViewport({ scale: 1 });
            const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
            onLocate(
              page,
              (pdfX - source.view[0]) * source.userUnit,
              (source.view[3] - pdfY) * source.userUnit,
            );
          })
          .catch((reason) => callbacks.current.onError(String(reason)));
      }}
      style={{ width, height }}
      ref={host}
    />
  );
});
