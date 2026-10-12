import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Maximize2, ShieldCheck, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { fetchStationDocument } from '@/api/admin'
import { stationKeys } from '@/api/keys'
import { ErrorState } from '@/components/feedback/error-state'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ta } from '@/i18n/admin'

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }

/**
 * Visionneuse du justificatif IFU. Le fichier est récupéré par l'endpoint admin dédié (audité),
 * gardé en mémoire (Blob), affiché par une URL objet révoquée à la fermeture ; jamais mis en
 * cache. Images : <img> ; PDF : rendu en canvas par pdf.js (aucun script du document exécuté).
 */
export function DocumentViewer({
  open,
  onOpenChange,
  stationId,
  stationName,
  ifu,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stationId: string
  stationName: string
  ifu: string
}) {
  const q = useQuery({
    queryKey: stationKeys.document(stationId),
    queryFn: ({ signal }) => fetchStationDocument(stationId, signal),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(2) // index dans ZOOMS : 100 %
  const regionRef = useRef<HTMLDivElement>(null)

  // URL objet créée pour le Blob courant, révoquée dès qu'il change ou à la fermeture.
  useEffect(() => {
    if (!open || !q.data) return
    const u = URL.createObjectURL(q.data.blob)
    // Ressource externe (URL objet) créée et libérée avec l'effet : l'état ne fait que la refléter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [open, q.data])

  const mime = q.data?.mime
  const ext = mime ? (EXT[mime] ?? 'bin') : 'bin'
  const scale = ZOOMS[zoom]!

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setZoom(2)
        onOpenChange(o)
      }}
    >
      <DialogContent
        className="flex h-[min(92dvh,900px)] w-[min(96vw,1100px)] max-w-none flex-col gap-0 p-0 sm:max-w-none"
        // Focus initial sur le document (défilement au clavier), pas sur un bouton à info-bulle.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          regionRef.current?.focus()
        }}
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 pr-12">
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogTitle className="text-base">{ta.station.document.title}</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 text-2xs">
              <ShieldCheck className="size-3.5" aria-hidden />
              {ta.station.document.audited}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={ta.station.document.zoomLevel(scale * 100)}>
            <IconButton
              label={ta.station.document.zoomOut}
              onClick={() => setZoom((z) => Math.max(0, z - 1))}
              disabled={zoom === 0}
            >
              <ZoomOut />
            </IconButton>
            <output className="w-12 text-center text-xs tabular-nums" aria-live="polite">
              {Math.round(scale * 100)} %
            </output>
            <IconButton
              label={ta.station.document.zoomIn}
              onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
              disabled={zoom === ZOOMS.length - 1}
            >
              <ZoomIn />
            </IconButton>
            <IconButton label={ta.station.document.fit} onClick={() => setZoom(2)} disabled={zoom === 2}>
              <Maximize2 />
            </IconButton>
          </div>
          <Button asChild={!!url} size="sm" variant="outline" disabled={!url}>
            {url ? (
              <a href={url} download={ta.station.document.fileName(ifu, ext)}>
                <Download aria-hidden />
                {ta.station.document.download}
              </a>
            ) : (
              <>
                <Download aria-hidden />
                {ta.station.document.download}
              </>
            )}
          </Button>
        </div>
        {/* Zone défilante focusable : défilement au clavier quand le document dépasse (zoom). */}
        <div
          ref={regionRef}
          // Zone défilante : focusable pour défiler au clavier (WCAG 2.1.1, règle axe
          // scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label={ta.station.document.title}
          className="relative min-h-0 flex-1 overflow-auto bg-surface-sunken outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {q.isPending ? (
            <div className="flex h-full flex-col items-center justify-center gap-3" role="status">
              <Skeleton className="h-[70%] w-[min(80%,560px)]" />
              <span className="text-xs text-muted-foreground">{ta.station.document.loading}</span>
            </div>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-10" />
          ) : !url ? null : mime === 'application/pdf' ? (
            <PdfView url={url} scale={scale} />
          ) : mime === 'image/png' || mime === 'image/jpeg' ? (
            <div className="grid min-h-full place-items-center p-6">
              <img
                src={url}
                alt={ta.station.document.alt(stationName)}
                className="max-w-none rounded-sm shadow-elevation-2"
                style={{ width: `${scale * 100}%`, maxWidth: scale <= 1 ? '100%' : undefined }}
              />
            </div>
          ) : (
            <p className="p-10 text-center text-sm text-muted-foreground">{ta.station.document.unsupported}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy

/** Rendu PDF page par page (canvas), pdf.js et son worker chargés au premier PDF ouvert. */
function PdfView({ url, scale }: { url: string; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [page, setPage] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        if (cancelled) return
        task = pdfjs.getDocument({ url, enableXfa: false })
        const loaded = await task.promise
        if (!cancelled) setDoc(loaded)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [url])

  useEffect(() => {
    if (!doc || !canvasRef.current) return
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    let cancelled = false
    void (async () => {
      const p = await doc.getPage(page)
      if (cancelled || !canvasRef.current) return
      const ratio = window.devicePixelRatio || 1
      const viewport = p.getViewport({ scale: scale * 1.25 })
      const canvas = canvasRef.current
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      task = p.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      await task.promise.catch(() => undefined)
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, page, scale])

  if (failed) return <p className="p-10 text-center text-sm text-muted-foreground">{ta.station.document.renderError}</p>
  return (
    <div className="flex min-h-full flex-col items-center gap-3 p-6">
      {!doc && <Skeleton className="h-[60vh] w-[min(80%,560px)]" />}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={doc ? ta.station.document.page(page, doc.numPages) : ta.station.document.loading}
        className={doc ? 'rounded-sm bg-white shadow-elevation-2' : 'hidden'}
      />
      {doc && doc.numPages > 1 && (
        <div className="sticky bottom-0 flex items-center gap-2 rounded-full border bg-popover px-2 py-1 shadow-elevation-2">
          <IconButton label={ta.station.document.pagePrev} onClick={() => setPage((n) => n - 1)} disabled={page === 1}>
            <ChevronLeft />
          </IconButton>
          <span className="text-xs tabular-nums" aria-live="polite">
            {ta.station.document.page(page, doc.numPages)}
          </span>
          <IconButton
            label={ta.station.document.pageNext}
            onClick={() => setPage((n) => n + 1)}
            disabled={page === doc.numPages}
          >
            <ChevronRight />
          </IconButton>
        </div>
      )}
    </div>
  )
}
