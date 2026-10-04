"use client";

import { useState } from "react";
import Link from "next/link";
import type { Product } from "../../../types/product";
import { formatPrice } from "../../../utils/format-price";
import { products } from "../../index/data/products";
import styles from "./ProductInformation.module.css";
import { addCartItem } from "../../../services/cart-storage";

const colors = [
  { name: "Titanio", value: "#a1a69c" },
  { name: "Grafito", value: "#26332d" },
  { name: "Azul", value: "#718e99" },
];

export function ProductInformation({ product }: { product: Product }) {
  const [color, setColor] = useState("Titanio");
  const [message, setMessage] = useState("");
  const taxMinor = Math.round((product.priceMinor * 1500) / 10000);
  const totalMinor = product.priceMinor + taxMinor;
  const phones = products.filter((item) => item.category === "celulares");

  function addToCart() {
    try {
      addCartItem(product.sku, color);
      setMessage(
        "Agregado al carrito local de demostración. El checkout aún no está conectado.",
      );
    } catch {
      setMessage(
        "No se pudo guardar el carrito en este navegador. Inténtalo de nuevo.",
      );
    }
  }

  return (
    <section className={styles.information} aria-labelledby="product-title">
      <p className="eyebrow">
        {product.category === "celulares" ? "Nova series" : "Colección GroupMG"}
      </p>
      <h1 id="product-title">{product.name}</h1>
      <p className={styles.description}>{product.description}</p>
      <div className={styles.price}>
        {formatPrice(totalMinor)}
        <span>IVA incluido</span>
      </div>
      <p className={styles.breakdown}>
        Base {formatPrice(product.priceMinor)} + IVA (15 %){" "}
        {formatPrice(taxMinor)}
      </p>
      <div className={styles.options}>
        {product.category === "celulares" && (
          <div>
            <p className={styles.optionLabel}>Elige tu equipo</p>
            <div className={styles.models}>
              {phones.map((phone) => (
                <Link
                  href={`/producto/${phone.sku}`}
                  key={phone.sku}
                  aria-current={phone.sku === product.sku ? "page" : undefined}
                >
                  {phone.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        <fieldset className={styles.colors}>
          <legend>
            Color de presentación: <strong>{color}</strong>
          </legend>
          {colors.map((item) => (
            <label key={item.name} title={item.name}>
              <input
                type="radio"
                name={`color-${product.sku}`}
                checked={color === item.name}
                onChange={() => {
                  setColor(item.name);
                  setMessage("");
                }}
                value={item.name}
              />
              <span style={{ backgroundColor: item.value }} />
              <span className={styles.srOnly}>{item.name}</span>
            </label>
          ))}
          <p>Selección ilustrativa; no representa variantes de inventario.</p>
        </fieldset>
      </div>
      <p className={styles.demo}>
        ● Producto demo · Disponibilidad por confirmar
      </p>
      <button type="button" className={styles.add} onClick={addToCart}>
        Agregar al carrito <span>{formatPrice(totalMinor)}</span>
      </button>
      <p className={styles.feedback} role="status">
        {message}
        {message.startsWith("Agregado") && (
          <>
            {" "}
            <Link href="/carrito">Ver carrito →</Link>
          </>
        )}
      </p>
      <div className={styles.benefits}>
        <div>
          <span aria-hidden="true">♧</span>
          <p>
            <strong>Elige cómo recibirlo</strong>
            <small>Retiro o entrega por zona</small>
          </p>
        </div>
        <div>
          <span aria-hidden="true">◇</span>
          <p>
            <strong>Compra con claridad</strong>
            <small>Envío se calcula en checkout</small>
          </p>
        </div>
      </div>
      <div className={styles.details}>
        <h2>Hecho para tu día a día</h2>
        <p>
          Explora la colección de tecnología GroupMG. Esta vista usa productos
          ficticios para presentar la experiencia de compra.
        </p>
        <span>Referencia: {product.sku}</span>
      </div>
    </section>
  );
}
