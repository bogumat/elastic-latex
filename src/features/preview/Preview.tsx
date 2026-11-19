import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './text-layer.css';
import type { Backend } from '../../shared/contracts/backend';

GlobalWorkerOptions.workerSrc = workerUrl;
export interface Artifact {
  projectId: string;
  buildId: string;
}

// A paginated viewport: only one page has a canvas/text layer. Memory and work are
// independent of page count; continuous scrolling can be added after measurement.
export default function Preview({
  api,
  artifact,
  active,
}: {
  api: Backend;
  artifact: Artifact;
  active: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pageHost = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [width, setWidth] = useState(500);
  const [visible, setVisible] = useState(!document.hidden);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
        return task.promise.then((next) => {
          if (!obsolete) {
            setPage((p) => Math.min(p, next.numPages));
            setPdf(next);
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
  useEffect(() => {
    if (!pdf || !visible || !active) return;
    let obsolete = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let text: TextLayer | undefined;
    let pendingCanvas: HTMLCanvasElement | undefined;
    setLoading(true);
    setError('');
    void (async () => {
      const source = await pdf.getPage(page);
      if (obsolete) return;
      const natural = source.getViewport({ scale: 1 });
      const scale = zoom || Math.max(0.2, (width - 48) / natural.width);
      const viewport = source.getViewport({ scale });
      // Two canvases (displayed and replacement) together stay within 64 MiB.
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        Math.sqrt((8 * 1024 * 1024) / (viewport.width * viewport.height)),
      );
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page';
      wrapper.style.width = `${viewport.width}px`;
      wrapper.style.height = `${viewport.height}px`;
      wrapper.style.setProperty('--scale-factor', `${scale}`);
      wrapper.style.setProperty('--total-scale-factor', `${scale * source.userUnit}`);
      const canvas = document.createElement('canvas');
      pendingCanvas = canvas;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      wrapper.append(canvas);
      render = source.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (obsolete) {
        canvas.width = 0;
        return;
      }
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      wrapper.append(layer);
      text = new TextLayer({
        textContentSource: source.streamTextContent(),
        container: layer,
        viewport,
      });
      await text.render();
      if (obsolete) {
        canvas.width = 0;
        return;
      }
      pageHost.current?.querySelectorAll('canvas').forEach((previous) => {
        previous.width = 0;
        previous.height = 0;
      });
      pageHost.current?.replaceChildren(wrapper);
      pendingCanvas = undefined;
      setLoading(false);
      performance.mark('elastic:pdf-visible');
      source.cleanup();
    })().catch((reason) => {
      if (!obsolete) {
        setError(String(reason));
        setLoading(false);
      }
    });
    return () => {
      obsolete = true;
      render?.cancel();
      text?.cancel();
      if (pendingCanvas) {
        pendingCanvas.width = 0;
        pendingCanvas.height = 0;
      }
    };
  }, [pdf, page, zoom, width, visible, active]);
  return (
    <section className="preview" aria-label="PDF preview">
      <div className="pane-toolbar">
        <div className="toolbar-group">
          <button
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span>
            {page} / {pdf?.numPages ?? '—'}
          </span>
          <button
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
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
        <div className="pdf-pages" ref={pageHost} />
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
