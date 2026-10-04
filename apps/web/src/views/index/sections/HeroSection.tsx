import Image from "next/image";
import { Carousel } from "../../../components/ui/Carousel/Carousel";
import { heroSlides } from "../data/hero-slides";
import styles from "./HeroSection.module.css";
export function HeroSection() {
  return (
    <section className="container" id="hero" aria-labelledby="hero-title">
      <Carousel label="Novedades de GroupMG" slideWidth="72%" initialIndex={1}>
        {heroSlides.map((slide, index) => (
          <div className={styles.hero} key={slide.id}>
            <div className={styles.art}>
              <Image
                src={slide.image}
                alt={slide.alt}
                width={1200}
                height={650}
                priority={index === 0}
                draggable={false}
              />
              <span className={styles.badge}>↗ {slide.badge}</span>
            </div>
            <div className={styles.copy}>
              <div>
                <span className={styles.label}>▣ GroupMG</span>
                <p className={styles.overline}>{slide.eyebrow}</p>
                {index === 0 ? (
                  <h1 id="hero-title">
                    {slide.title[0]}
                    <br />
                    {slide.title[1]}
                  </h1>
                ) : (
                  <h2 className={styles.title}>
                    {slide.title[0]}
                    <br />
                    {slide.title[1]}
                  </h2>
                )}
              </div>
              <div className={styles.intro}>
                <p>{slide.description}</p>
                <a href={slide.link} className={styles.button}>
                  {slide.action} ↗
                </a>
              </div>
            </div>
          </div>
        ))}
      </Carousel>
      <nav className={styles.categories} aria-label="Explorar colección">
        {["CELULARES", "AUDIO", "ACCESORIOS", "FAVORITOS"].map((label) => (
          <a
            href={label === "FAVORITOS" ? "#productos-estrella" : "#tienda"}
            key={label}
          >
            ✦{" "}
            <span>
              {label}
              <small>Encuentra tu próximo favorito</small>
            </span>
          </a>
        ))}
      </nav>
      <div className={styles.benefits} id="beneficios">
        <div>
          ◇{" "}
          <span>
            Compra a tu ritmo<small>Explora y compara tus favoritos</small>
          </span>
        </div>
        <div>
          ♧{" "}
          <span>
            Elige cómo recibirlo<small>Retiro o entrega a domicilio</small>
          </span>
        </div>
        <div>
          ♡{" "}
          <span>
            Tecnología para todos<small>Opciones para cada momento</small>
          </span>
        </div>
      </div>
    </section>
  );
}
