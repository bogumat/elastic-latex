import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './text-layer.css';
import { PdfPage, type PageSize, RenderQueue } from './PdfPage';
import type { Backend } from '../../shared/contracts/backend';

GlobalWorkerOptions.workerSrc = workerUrl;
export interface Artifact {
  projectId: string;
  buildId: string;
}

// Page geometry stays mounted; canvases and text layers are limited to the viewport.
export default function Preview({
  api,
  artifact,
  active,
  onSource,
  defaultZoom = 0,
}: {
  api: Backend;
  artifact: Artifact;
  active: boolean;
  onSource: (path: string, line: number) => void;
  defaultZoom?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setDocument] = useState<{ pdf: PDFDocumentProxy; sizes: PageSize[] }>();
  const pdf = loaded?.pdf;
  const queue = useRef(new RenderQueue());
  const [range, setRange] = useState({ first: 0, last: 0 });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(defaultZoom);
  useEffect(() => setZoom(defaultZoom), [defaultZoom]);
  const [width, setWidth] = useState(500);
  const [visible, setVisible] = useState(!document.hidden);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lookupSequence = useRef(0);
  useEffect(
    () => () => {
      lookupSequence.current++;
    },
    [artifact.buildId],
  );
  async function locate(page: number, x: number, y: number) {
    const sequence = ++lookupSequence.current;
    setError('');
    try {
      const location = await api.sourceLocation(artifact.projectId, artifact.buildId, page, x, y);
      if (sequence === lookupSequence.current) onSource(location.path, location.line);
    } catch (reason) {
      if (sequence === lookupSequence.current) setError(String(reason));
    }
  }
  useEffect(() => {
    let obsolete = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setLoading(true);
    setError('');
    void api
      .readArtifact(artifact.projectId, artifact.buildId)
      .then((bytes) => {
        if (obsolete) return;
        const base = new URL('./pdf/', document.baseURI).href;
        task = getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: `${base}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${base}standard_fonts/`,
          wasmUrl: `${base}wasm/`,
        });
        return task.promise.then(async (next) => {
          const sizes: PageSize[] = [];
          // Read dimensions only, with bounded concurrency; never paint offscreen pages.
          for (let first = 1; first <= next.numPages; first += 8) {
            if (obsolete) return;
            sizes.push(
              ...(await Promise.all(
                Array.from(
                  { length: Math.min(8, next.numPages - first + 1) },
                  async (_, offset) => {
                    const source = await next.getPage(first + offset);
                    const viewport = source.getViewport({ scale: 1 });
                    return { width: viewport.width, height: viewport.height };
                  },
                ),
              )),
            );
          }
          if (!obsolete) {
            setPage((p) => Math.min(p, next.numPages));
            setDocument({ pdf: next, sizes });
          }
        });
      })
      .catch((reason) => {
        if (!obsolete) {
          setError(String(reason));
          setLoading(false);
        }
      });
    return () => {
      obsolete = true;
      void task?.destroy();
    };
  }, [api, artifact.projectId, artifact.buildId]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(entry.contentRect.width), 150);
    });
    observer.observe(host.current!);
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const layouts =
    loaded?.sizes.map((size) => {
      const scale = zoom || Math.max(0.2, (width - 48) / size.width);
      return { scale, width: size.width * scale, height: size.height * scale };
    }) ?? [];
  const offsets: number[] = [];
  let total = 24;
  for (const layout of layouts) {
    offsets.push(total);
    total += layout.height + 24;
  }
  useEffect(() => {
    const viewport = host.current!;
    let frame = 0;
    const update = () => {
      const top = viewport.scrollTop;
      const bottom = top + viewport.clientHeight;
      let first = offsets.findIndex((offset, index) => offset + layouts[index].height > top);
      if (first < 0) first = Math.max(0, layouts.length - 1);
      let last = first;
      let current = first,
        mostVisible = -1;
      while (last + 1 < layouts.length && offsets[last + 1] < bottom) last++;
      for (let index = first; index <= last; index++) {
        const overlap =
          Math.min(bottom, offsets[index] + (layouts[index]?.height ?? 0)) -
          Math.max(top, offsets[index]);
        if (overlap > mostVisible) {
          mostVisible = overlap;
          current = index;
        }
      }
      setPage(current + 1);
      setRange((previous) =>
        previous.first === first && previous.last === last ? previous : { first, last },
      );
    };
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scroll);
    observer.observe(viewport);
    viewport.addEventListener('scroll', scroll, { passive: true });
    // Preserve the current page on zoom, resize and successful PDF replacement.
    const index = Math.min(page - 1, Math.max(0, layouts.length - 1));
    viewport.scrollTop = Math.max(0, (offsets[index] ?? 24) - 24);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener('scroll', scroll);
    };
    // Page/range changes from scrolling must not reset scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, width, zoom, active]);
  const firstRendered = Math.max(0, range.first - 1);
  const lastRendered = Math.min(layouts.length - 1, range.last + 1);
  const renderCount = Math.max(1, lastRendered - firstRendered + 1);
  function goToPage(next: number) {
    host.current!.scrollTop = Math.max(0, (offsets[next - 1] ?? 24) - 24);
  }
  return (
    <section className="preview" aria-label="PDF preview">
      <div className="pane-toolbar">
        <div className="toolbar-group">
          <button
            disabled={!pdf || page <= 1}
            onClick={() => goToPage(page - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span>
            {page} / {pdf?.numPages ?? '—'}
          </span>
          <button
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => goToPage(page + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
        <div className="toolbar-group">
          <button
            onClick={() => setZoom((z) => Math.max(0.25, (z || 1) - 0.25))}
            aria-label="Zoom out"
          >
            −
          </button>
          <button onClick={() => setZoom(0)}>
            {zoom ? `${Math.round(zoom * 100)}%` : 'Fit width'}
          </button>
          <button onClick={() => setZoom((z) => Math.min(3, (z || 1) + 0.25))} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>
      <div className="pdf-viewport" ref={host}>
        <div className="pdf-pages">
          {pdf &&
            layouts.map((layout, index) => (
              <PdfPage
                key={`${pdf.loadingTask.docId}:${index}`}
                pdf={pdf}
                page={index + 1}
                layout={layout}
                queue={queue.current}
                enabled={visible && active && index >= firstRendered && index <= lastRendered}
                pixelBudget={Math.floor((8 * 1024 * 1024) / (renderCount * 2))}
                onReady={() => setLoading(false)}
                onError={setError}
                onLocate={locate}
              />
            ))}
        </div>
      </div>
      {loading && (
        <div className="preview-notice" role="status">
          Updating PDF…
        </div>
      )}
      {error && (
        <div className="preview-notice error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
