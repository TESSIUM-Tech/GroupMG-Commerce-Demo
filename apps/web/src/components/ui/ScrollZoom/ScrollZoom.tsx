"use client";

import { useRef, type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import styles from "./ScrollZoom.module.css";

interface ScrollZoomProps {
  children: ReactNode;
  /** Maximum enlargement as the section leaves the viewport. */
  zoom?: number;
  blur?: number;
  fade?: number;
  className?: string;
  mode?: "scroll" | "reveal";
}

/** Reveal on entry, staying stable until the entire section leaves the viewport. */
function ScrollReveal({
  children,
  blur = 8,
  fade = 0.3,
  className = "",
}: ScrollZoomProps) {
  const reducedMotion = useReducedMotion();
  return (
    <div className={`${styles.frame} ${className}`}>
      <motion.div
        className={styles.reveal}
        initial={false}
        animate={
          reducedMotion
            ? { scale: 1, opacity: 1, filter: "blur(0px)" }
            : { scale: 0.92, opacity: fade, filter: `blur(${blur}px)` }
        }
        whileInView={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
        viewport={{ once: false, amount: "some", margin: "0px 0px -160px 0px" }}
        transition={{ duration: reducedMotion ? 0 : 0.8, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}

export function ScrollZoom(props: ScrollZoomProps) {
  return props.mode === "reveal" ? (
    <ScrollReveal {...props} />
  ) : (
    <ScrollLinkedZoom {...props} />
  );
}

/** Scroll-linked entry and exit effect, with a clear reading interval in between. */
function ScrollLinkedZoom({
  children,
  zoom = 1.16,
  blur = 8,
  fade = 0.3,
  className = "",
}: ScrollZoomProps) {
  const target = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target,
    offset: ["start end", "end start"],
  });
  const scale = useTransform(
    scrollYProgress,
    [0, 0.3, 0.65, 1],
    [0.88, 1, 1, zoom],
  );
  const opacity = useTransform(
    scrollYProgress,
    [0, 0.3, 0.65, 1],
    [fade, 1, 1, fade],
  );
  const filter = useTransform(
    scrollYProgress,
    [0, 0.3, 0.65, 1],
    [`blur(${blur}px)`, "blur(0px)", "blur(0px)", `blur(${blur}px)`],
  );

  return (
    <div ref={target} className={`${styles.frame} ${className}`}>
      <motion.div
        className={styles.content}
        style={reducedMotion ? undefined : { scale, opacity, filter }}
      >
        {children}
      </motion.div>
    </div>
  );
}
