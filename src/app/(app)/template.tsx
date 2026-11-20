"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

// The first page is server-rendered and should paint immediately; only later
// client-side navigations animate in.
const session = { navigated: false };

/** Page transition for signed-in pages: a short fade and lift on navigation. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [animate] = useState(() => session.navigated && !reduce);
  useEffect(() => {
    session.navigated = true;
  }, []);
  return (
    <motion.div initial={animate ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
