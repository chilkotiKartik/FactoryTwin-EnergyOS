"use client";

import { motion, useReducedMotion } from "motion/react";

/** Small entrance animation for state changes (e.g. a decision just recorded). */
export function Appear({ children, className, ...rest }: { children: React.ReactNode; className?: string; "data-testid"?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} {...rest} initial={reduce ? false : { opacity: 0, scale: 0.96, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}>
      {children}
    </motion.div>
  );
}
