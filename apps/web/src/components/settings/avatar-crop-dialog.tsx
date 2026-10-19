'use client';

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** On-screen crop frame, in CSS px. */
const FRAME = 240;
/** Uploaded avatar size, in px. */
const OUTPUT = 256;
const MAX_ZOOM = 3;
const NUDGE = 8;

interface Crop {
  zoom: number;
  /** Image top-left inside the frame, in frame px (always <= 0). */
  x: number;
  y: number;
}

/**
 * Crop a picked image to a square: drag (or arrow keys) to position, slider to
 * zoom. `onSave` receives a 256px JPEG as base64, without the data: prefix.
 */
export function AvatarCropDialog({
  file,
  onClose,
  onSave,
}: {
  file: File | null;
  onClose: () => void;
  onSave: (base64: string) => Promise<void>;
}) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {/* Keyed so each pick starts centred. */}
        {file && <CropForm key={`${file.name}:${file.lastModified}`} file={file} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function CropForm({ file, onSave }: { file: File; onSave: (base64: string) => Promise<void> }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // The cleanup revokes `url`, which fails a load still in flight; that
    // image's handlers must not report it.
    let current = true;
    img.onload = () => {
      if (!current) return;
      setImage(img);
      const s = coverScale(img);
      setCrop({
        zoom: 1,
        x: (FRAME - img.naturalWidth * s) / 2,
        y: (FRAME - img.naturalHeight * s) / 2,
      });
    };
    img.onerror = () => current && setError("We couldn't read that image. Try a PNG or JPEG.");
    img.src = url;
    return () => {
      current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const scale = image ? coverScale(image) * crop.zoom : 1;

  /** Keep the image covering the whole frame. */
  const clamp = (next: Crop): Crop => {
    if (!image) return next;
    const s = coverScale(image) * next.zoom;
    const minX = FRAME - image.naturalWidth * s;
    const minY = FRAME - image.naturalHeight * s;
    return {
      zoom: next.zoom,
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    };
  };

  const zoomTo = (zoom: number) => {
    if (!image) return;
    // Zoom around the frame centre so the subject stays put.
    const ratio = zoom / crop.zoom;
    const centre = FRAME / 2;
    setCrop(
      clamp({
        zoom,
        x: centre - (centre - crop.x) * ratio,
        y: centre - (centre - crop.y) * ratio,
      }),
    );
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, x: crop.x, y: crop.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setCrop(
      clamp({
        zoom: crop.zoom,
        x: start.x + event.clientX - start.pointerX,
        y: start.y + event.clientY - start.pointerY,
      }),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [NUDGE, 0],
      ArrowRight: [-NUDGE, 0],
      ArrowUp: [0, NUDGE],
      ArrowDown: [0, -NUDGE],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setCrop(clamp({ ...crop, x: crop.x + move[0], y: crop.y + move[1] }));
  };

  const save = async () => {
    if (!image) return;
    setSaving(true);
    setError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const context = canvas.getContext('2d');
      if (!context) throw new Error("Your browser couldn't crop the image.");
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        image,
        -crop.x / scale,
        -crop.y / scale,
        FRAME / scale,
        FRAME / scale,
        0,
        0,
        OUTPUT,
        OUTPUT,
      );
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      await onSave(dataUrl.slice(dataUrl.indexOf(',') + 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Crop your photo</DialogTitle>
        <DialogDescription>Drag to position it. Use the slider to zoom.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-5 py-6">
        <div
          role="group"
          tabIndex={0}
          aria-label="Crop area. Drag or use the arrow keys to move the photo."
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-control bg-background-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 active:cursor-grabbing"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob, nothing to optimise
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={{
                width: image.naturalWidth * scale,
                height: image.naturalHeight * scale,
                transform: `translate(${crop.x}px, ${crop.y}px)`,
              }}
            />
          ) : (
            !error && (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
              </div>
            )
          )}
          {/* How the round avatar will look; the square is what is saved. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full ring-[999px] ring-background/60"
          />
        </div>

        <label className="flex w-full max-w-[240px] items-center gap-3 text-xs text-foreground-muted">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={!image}
            onChange={(event) => zoomTo(Number(event.target.value))}
            className="h-1 flex-1 cursor-pointer accent-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="button" disabled={!image || saving} onClick={save}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

/** Scale at which the image just covers the frame. */
function coverScale(image: HTMLImageElement): number {
  return Math.max(FRAME / image.naturalWidth, FRAME / image.naturalHeight);
}
