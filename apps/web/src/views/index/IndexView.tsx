import { HeroSection } from "./sections/HeroSection";
import { FeaturedProductsSection } from "./sections/FeaturedProductsSection";
import { StoreSection } from "./sections/StoreSection";
import { ScrollZoom } from "../../components/ui/ScrollZoom/ScrollZoom";
export function IndexView() {
  return (
    <>
      <ScrollZoom>
        <HeroSection />
      </ScrollZoom>
      <ScrollZoom mode="reveal">
        <FeaturedProductsSection />
      </ScrollZoom>
      <ScrollZoom mode="reveal">
        <StoreSection />
      </ScrollZoom>
    </>
  );
}
