import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ResilientImage } from './ResilientImage';

export interface LightboxImageItem {
  src: string;
  alt: string;
  title?: string;
  subtitle?: string;
}

interface ImageLightboxProps {
  images: LightboxImageItem[];
  initialIndex?: number;
  onClose: () => void;
  onOpenSpecs?: () => void;
  onRequestSimilar?: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function ImageLightbox({
  images,
  initialIndex = 0,
  onClose,
  onOpenSpecs,
  onRequestSimilar,
}: ImageLightboxProps) {
  const safeInitial =
    initialIndex >= 0 && initialIndex < images.length ? initialIndex : 0;
  const [activeIndex, setActiveIndex] = useState(safeInitial);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragOriginRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const current = images[activeIndex] || images[0];

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const goPrev = useCallback(() => {
    if (images.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
    resetView();
  }, [images.length, resetView]);

  const goNext = useCallback(() => {
    if (images.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % images.length);
    resetView();
  }, [images.length, resetView]);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((prev + delta).toFixed(2))));
      if (next <= 1) {
        setPan({ x: 0, y: 0 });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setActiveIndex(safeInitial);
    resetView();
  }, [safeInitial, resetView]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        goNext();
      } else if (e.key === 'ArrowRight') {
        goPrev();
      } else if (e.key === '+' || e.key === '=') {
        adjustZoom(0.5);
      } else if (e.key === '-') {
        adjustZoom(-0.5);
      } else if (e.key === '0') {
        resetView();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, goNext, goPrev, adjustZoom, resetView]);

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.35 : -0.35;
    adjustZoom(step);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragOriginRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.pointerId !== e.pointerId) return;
    setPan({
      x: origin.panX + (e.clientX - origin.startX),
      y: origin.panY + (e.clientY - origin.startY),
    });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    if (origin && origin.pointerId === e.pointerId) {
      dragOriginRef.current = null;
      setDragging(false);
    }
  };

  const handleDoubleClick = () => {
    if (zoom > 1) {
      resetView();
    } else {
      setZoom(2);
    }
  };

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.title || current.alt}
      className="fixed inset-0 z-50 bg-slate-950/92 backdrop-blur-sm flex flex-col select-none"
      onClick={onClose}
    >
      {/* Top Toolbar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-16 px-4 sm:px-6 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-4 shrink-0"
      >
        <div className="min-w-0">
          {current.title && (
            <h3 className="text-sm sm:text-base font-bold text-white truncate">
              {current.title}
            </h3>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 truncate">
            {current.subtitle && <span>{current.subtitle}</span>}
            {current.subtitle && images.length > 1 && <span aria-hidden="true">·</span>}
            {images.length > 1 && (
              <span className="font-mono-tech tabular-nums text-slate-300">
                صورة {activeIndex + 1} من {images.length}
              </span>
            )}
          </div>
        </div>

        {/* Zoom & Close Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="inline-flex items-center bg-slate-900 border border-slate-700 rounded-lg p-1 gap-1">
            <button
              type="button"
              onClick={() => adjustZoom(-0.5)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="تصغير الصورة"
              title="تصغير"
              className="w-8 h-8 rounded-md flex items-center justify-center text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono-tech text-xs font-semibold text-slate-200 tabular-nums min-w-[46px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => adjustZoom(0.5)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="تكبير الصورة"
              title="تكبير"
              className="w-8 h-8 rounded-md flex items-center justify-center text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            {zoom > 1 && (
              <button
                type="button"
                onClick={resetView}
                aria-label="إعادة ضبط التكبير"
                title="إعادة ضبط (100%)"
                className="w-8 h-8 rounded-md flex items-center justify-center text-sky-400 hover:bg-slate-800 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق عرض الصورة"
            className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Zoomable Image Stage */}
      <div
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex-1 min-h-0 overflow-hidden flex items-center justify-center p-4 sm:p-8 touch-none ${
          zoom > 1
            ? dragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-zoom-in'
        }`}
      >
        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transition: dragging ? 'none' : 'transform 160ms ease-out',
          }}
          className="max-w-full max-h-full flex items-center justify-center"
        >
          <ResilientImage
            src={current.src}
            alt={current.alt}
            className="max-w-[92vw] max-h-[68vh] sm:max-h-[72vh] w-auto h-auto object-contain rounded-lg shadow-2xl border border-slate-800 pointer-events-none"
          />
        </div>

        {/* Navigation Arrows (RTL: Right = Prev, Left = Next) */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="الصورة السابقة"
              className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-lg bg-slate-900/90 border border-slate-700 text-white hover:bg-slate-800 flex items-center justify-center shadow-lg cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="الصورة التالية"
              className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-lg bg-slate-900/90 border border-slate-700 text-white hover:bg-slate-800 flex items-center justify-center shadow-lg cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Helper Hint */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 whitespace-nowrap">
          {zoom > 1
            ? 'اسحب الصورة للتحريك · اضغط مرتين لإرجاع الحجم الطبيعي'
            : 'اضغط مرتين أو استخدم عجلة الماوس لتكبير التفاصيل'}
        </div>
      </div>

      {/* Bottom Thumbnail Strip & Optional CTA */}
      {(images.length > 1 || onOpenSpecs || onRequestSimilar) && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="border-t border-slate-800 bg-slate-950/90 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0"
        >
          {images.length > 1 ? (
            <div className="flex items-center gap-2 overflow-x-auto max-w-full py-0.5">
              {images.map((img, idx) => (
                <button
                  key={`${img.src}-${idx}`}
                  type="button"
                  onClick={() => {
                    setActiveIndex(idx);
                    resetView();
                  }}
                  aria-label={`عرض صورة ${idx + 1}`}
                  className={`w-14 h-10 rounded-md overflow-hidden border-2 shrink-0 transition-all cursor-pointer ${
                    idx === activeIndex
                      ? 'border-sky-500 opacity-100'
                      : 'border-slate-700 opacity-60 hover:opacity-95'
                  }`}
                >
                  <ResilientImage
                    src={img.src}
                    alt={img.alt}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div />
          )}

          {(onOpenSpecs || onRequestSimilar) && (
            <div className="flex items-center gap-2.5 ms-auto">
              {onOpenSpecs && (
                <button
                  type="button"
                  onClick={onOpenSpecs}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
                >
                  المواصفات الفنية
                </button>
              )}
              {onRequestSimilar && (
                <button
                  type="button"
                  onClick={onRequestSimilar}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg cursor-pointer"
                >
                  اطلب تنفيذ مشروع مشابه
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
