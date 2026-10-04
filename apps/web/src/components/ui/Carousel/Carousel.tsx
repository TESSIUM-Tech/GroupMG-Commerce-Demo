"use client";

import {
  Children,
  useState,
  useRef,
  type ReactNode,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import { motion, useReducedMotion, type PanInfo } from "motion/react";
import styles from "./Carousel.module.css";

interface CarouselProps {
  children: ReactNode;
  label: string;
  slideWidth?: string;
  initialIndex?: number;
}

/** Reusable coverflow: the selected item faces forward; its neighbors rotate in 3D. */
export function Carousel({
  children,
  label,
  slideWidth = "72%",
  initialIndex = 0,
}: CarouselProps) {
  const slides = Children.toArray(children);
  const [selected, setSelected] = useState(
    Math.max(0, Math.min(initialIndex, slides.length - 1)),
  );
  const [dragOffset, setDragOffset] = useState(0);
  const reducedMotion = useReducedMotion();
  const dragged = useRef(false);
  const active = Math.max(0, Math.min(selected, slides.length - 1));

  function move(direction: number) {
    setSelected(Math.max(0, Math.min(slides.length - 1, active + direction)));
    setDragOffset(0);
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
    }
  }

  function finishPan(_: unknown, info: PanInfo) {
    if (Math.abs(info.offset.x) > 45 || Math.abs(info.velocity.x) > 400) {
      move(info.offset.x < 0 ? 1 : -1);
    } else setDragOffset(0);
  }

  return (
    <div
      className={styles.carousel}
      role="region"
      aria-roledescription="carrusel"
      aria-label={label}
      style={{ "--slide-width": slideWidth } as CSSProperties}
    >
      <motion.div
        className={styles.viewport}
        tabIndex={0}
        onKeyDown={handleKey}
        aria-label="Usa las flechas izquierda y derecha para explorar"
        onPointerDownCapture={() => {
          dragged.current = false;
        }}
        onPanStart={() => {
          dragged.current = true;
        }}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onPan={(_, info) =>
          setDragOffset(Math.max(-80, Math.min(80, info.offset.x)))
        }
        onPanEnd={finishPan}
        onPointerCancel={() => setDragOffset(0)}
      >
        {slides.map((slide, index) => {
          const offset = index - active;
          return (
            <motion.div
              key={index}
              className={styles.slide}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${index + 1} de ${slides.length}`}
              inert={offset !== 0}
              initial={false}
              animate={{
                x: `calc(${offset * 72}% + ${dragOffset}px)`,
                rotateY: reducedMotion
                  ? 0
                  : offset === 0
                    ? 0
                    : offset < 0
                      ? 42
                      : -42,
                scale: offset === 0 ? 1 : 0.82,
                opacity: Math.abs(offset) > 1 ? 0 : offset === 0 ? 1 : 0.65,
              }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 210, damping: 30 }
              }
              style={{
                zIndex: slides.length - Math.abs(offset),
                visibility: Math.abs(offset) > 1 ? "hidden" : "visible",
              }}
            >
              {slide}
            </motion.div>
          );
        })}
      </motion.div>
      {slides.length > 1 && (
        <div className={styles.controls}>
          <button
            type="button"
            aria-label="Anterior"
            disabled={active === 0}
            onClick={() => move(-1)}
          >
            ←
          </button>
          <div className={styles.pagination}>
            {slides.map((_, index) => (
              <button
                type="button"
                key={index}
                aria-label={`Mostrar diapositiva ${index + 1}`}
                aria-current={index === active ? "true" : undefined}
                onClick={() => {
                  setSelected(index);
                  setDragOffset(0);
                }}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Siguiente"
            disabled={active === slides.length - 1}
            onClick={() => move(1)}
          >
            →
          </button>
          <span className={styles.status} aria-live="polite">
            Diapositiva {active + 1} de {slides.length}
          </span>
        </div>
      )}
    </div>
  );
}
