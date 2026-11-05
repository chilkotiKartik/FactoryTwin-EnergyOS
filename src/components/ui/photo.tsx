"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { PHOTOS, type PhotoKey } from "@/lib/photos";
import { cn } from "@/lib/cn";

/**
 * A credited real photograph. The credit line is part of the licence, so it is
 * always rendered. If the image cannot load (offline, blocked), a plain panel
 * with the place name takes its place: never a broken-image icon.
 */
export function Photo({ name, className, imgClassName, credit = "below", priority = false }: { name: PhotoKey; className?: string; imgClassName?: string; credit?: "below" | "overlay" | "none"; priority?: boolean }) {
  const p = PHOTOS[name];
  const [failed, setFailed] = useState(false);
  const line = (
    <>
      Photo: {p.place} ·{" "}
      <a href={p.page} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
        {p.author}
      </a>
      ,{" "}
      <a href={p.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
        {p.licence}
      </a>
      , via Wikimedia Commons
    </>
  );
  return (
    <figure className={cn("relative overflow-hidden", className)}>
      {failed ? (
        credit === "none" ? (
          // A background photo that failed: leave the plain panel behind it.
          <div className="h-full w-full" aria-hidden />
        ) : (
          <div className={cn("flex h-full w-full items-center justify-center gap-2 bg-surface-3 text-[12px] text-ink-3", imgClassName)} role="img" aria-label={p.alt}>
            <ImageOff className="size-4" aria-hidden /> {p.place}
          </div>
        )
      ) : (
        // A plain <img>: the files are already sized by Wikimedia's thumbnail service.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.src}
          alt={p.alt}
          width={p.width}
          height={p.height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          // An image that failed before the page became interactive never fires onError: check on mount.
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0) setFailed(true);
          }}
          className={cn("h-full w-full bg-surface-3 object-cover text-[0px] text-transparent", imgClassName)}
        />
      )}
      {credit === "overlay" ? <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-1.5 text-[10.5px] leading-snug text-white/85">{line}</figcaption> : null}
      {credit === "below" ? <figcaption className="mt-1.5 text-[11px] leading-snug text-ink-3">{line}</figcaption> : null}
    </figure>
  );
}
