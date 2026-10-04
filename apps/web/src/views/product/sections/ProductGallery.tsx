"use client";

import Image from "next/image";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Product } from "../../../types/product";
import styles from "./ProductGallery.module.css";

export function ProductGallery({ product }: { product: Product }) {
  const [selected, setSelected] = useState(0);
  const reducedMotion = useReducedMotion();
  const images =
    product.category === "celulares"
      ? [
          { src: product.imageUrl, label: "Vista principal" },
          {
            src:
              product.imageUrl === "/images/phone-back.svg"
                ? "/images/phone-front.svg"
                : "/images/phone-back.svg",
            label: "Vista alternativa ilustrativa",
          },
        ]
      : [{ src: product.imageUrl, label: "Vista principal" }];

  return (
    <div className={styles.gallery}>
      <div
        className={styles.thumbnails}
        role="group"
        aria-label="Imágenes del producto"
      >
        {images.map((image, index) => (
          <button
            type="button"
            key={image.src}
            aria-label={image.label}
            aria-pressed={index === selected}
            onClick={() => setSelected(index)}
          >
            <Image src={image.src} alt="" width={80} height={96} />
          </button>
        ))}
      </div>
      <div className={styles.stage}>
        <span className={styles.badge}>COLECCIÓN DEMO</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selected}
            className={styles.image}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
          >
            <Image
              src={(images[selected] ?? images[0]!).src}
              alt={`${product.name} · ${(images[selected] ?? images[0]!).label}`}
              fill
              sizes="(max-width: 950px) 90vw, 45vw"
              priority
            />
          </motion.div>
        </AnimatePresence>
        <span className={styles.caption}>
          Ilustración de referencia · Producto ficticio
        </span>
      </div>
    </div>
  );
}
