"use client";

import { useEffect, useRef, useState } from "react";

const NUM = /^([^\d−-]*)([−-]?)([\d,]+(?:\.\d+)?)(.*)$/;

/**
 * Counts a formatted figure up from zero when it first scrolls into view.
 * The server renders the final text, so crawlers, tests and no-JS readers see the
 * real value; screen readers are given the final value only.
 */
export function CountUp({ value, durationMs = 900, className }: { value: string; durationMs?: number; className?: string }) {
  // Animated text, tagged with the value it belongs to so a new value shows at once.
  const [anim, setAnim] = useState<{ of: string; text: string } | null>(null);
  const shown = anim && anim.of === value ? anim.text : value;
  const ref = useRef<HTMLSpanElement>(null);
  const m = NUM.exec(value);

  useEffect(() => {
    const parts = NUM.exec(value);
    const el = ref.current;
    if (!parts || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const [, pre, sign, digits, post] = parts;
    const target = Number(digits.replace(/,/g, ""));
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const grouped = digits.includes(",");
    if (!Number.isFinite(target) || target === 0) return;
    const format = (n: number) => {
      const s = grouped ? n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n.toFixed(decimals);
      return `${pre}${sign}${s}${post}`;
    };
    let raf = 0;
    let started = false;
    const run = () => {
      started = true;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / durationMs);
        const eased = 1 - Math.pow(1 - k, 3);
        setAnim({ of: value, text: k >= 1 ? value : format(target * eased) });
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (!started && entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);

  if (!m) return <span className={className}>{value}</span>;
  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
