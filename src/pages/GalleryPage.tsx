import { useCallback, useEffect, useRef, useState } from 'react';
import { GALLERY_ITEMS, type GalleryItem } from '../gallery/catalog.ts';
import { GlobeWall } from '../gallery/GlobeWall.tsx';

export function GalleryPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const items = GALLERY_ITEMS;
  const openIndex = openId ? items.findIndex((item) => item.id === openId) : -1;
  const openItem = openIndex >= 0 ? items[openIndex] : undefined;

  const close = useCallback(() => {
    setOpenId(null);
  }, []);

  const go = useCallback((delta: number) => {
    setOpenId((current) => {
      const idx = items.findIndex((item) => item.id === current);
      if (idx < 0) return current;
      return items[(idx + delta + items.length) % items.length].id;
    });
  }, [items]);

  useEffect(() => {
    if (!openItem) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [openItem, close, go]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 md:px-5 pt-6">
          <header className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label-caps mb-1.5">실물</div>
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink-100">
                출력 기록
              </h1>
            </div>
            <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-ink-400">
              기록은 구 위에 붙었습니다. 끌어다 돌리고, 앞장을 누르면 크게 봅니다.
            </p>
          </header>

          <GlobeWall items={items} onOpen={setOpenId} enabled={!openItem} />
          <p className="shrink-0 py-2.5 text-center text-[11px] text-ink-500">
            끌어다 사방으로 굴리세요. 휠로 거리를 맞출 수 있습니다.
          </p>
        </div>
      </div>

      {openItem && (
        <Lightbox
          items={items}
          index={openIndex}
          onClose={close}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onPick={setOpenId}
        />
      )}
    </>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onPrev,
  onNext,
  onPick,
}: {
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPick: (id: string) => void;
}) {
  const item = items[index];
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = stripRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950/94 backdrop-blur-md" onClick={onClose}>
      <div className="flex items-center justify-between px-5 py-3">
        <div>
          <div className="text-[15px] text-ink-100">{item.caption}</div>
          {item.note && <div className="text-[12px] text-ink-500">{item.note}</div>}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-500">
            {index + 1} / {items.length}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="rounded-md px-2.5 py-1 text-[12.5px] text-ink-300 hover:bg-ink-800 hover:text-ink-100"
          >
            닫기
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-12 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onPrev}
          className="absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink-900/80 text-ink-300 hover:text-ink-100 md:flex"
          aria-label="이전"
        >
          ‹
        </button>
        <div className="flex h-full max-h-full w-full max-w-[1200px] items-center justify-center">
          {item.kind === 'photo' ? (
            <img
              src={item.src}
              alt={item.caption}
              className="max-h-full max-w-full object-contain shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            />
          ) : (
            <video
              key={item.id}
              src={item.src}
              poster={item.poster}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="max-h-full max-w-full bg-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            />
          )}
        </div>
        <button
          type="button"
          onClick={onNext}
          className="absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink-900/80 text-ink-300 hover:text-ink-100 md:flex"
          aria-label="다음"
        >
          ›
        </button>
      </div>

      <div
        ref={stripRef}
        className="shrink-0 overflow-x-auto border-t border-ink-800 px-3 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-max gap-1.5">
          {items.map((entry, i) => {
            const thumb = entry.kind === 'video' ? entry.poster ?? entry.src : entry.src;
            const active = i === index;
            return (
              <button
                key={entry.id}
                type="button"
                data-active={active ? 'true' : 'false'}
                onClick={() => onPick(entry.id)}
                className={`relative h-[64px] shrink-0 overflow-hidden rounded-sm ${
                  entry.kind === 'video' ? 'w-[84px]' : 'w-[48px]'
                } ${active ? 'ring-2 ring-amber-accent' : 'opacity-55 hover:opacity-100'}`}
              >
                <img src={thumb} alt="" className="h-full w-full object-cover" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
