import { gsap } from "gsap";

export interface ScaleAnimationOptions {
  duration: number;
  ease: string;
  x?: number;
  y?: number;
}

export interface UseScaleFeedbackOptions {
  hoverScale?: number;
  pressScale?: number;
  hoverDuration?: number;
  pressDuration?: number;
}

export function animateScale(
  target: HTMLElement | SVGElement,
  scale: number,
  options: ScaleAnimationOptions,
) {
  gsap.to(target, {
    scale,
    ...options,
    overwrite: "auto",
  });
}

export function useScaleFeedback(options: UseScaleFeedbackOptions = {}) {
  const {
    hoverScale = 1.05,
    pressScale = 0.95,
    hoverDuration = 0.75,
    pressDuration = 0.25,
  } = options;

  const animate = (event: PointerEvent, scale: number, duration: number) => {
    const target = event.currentTarget as HTMLElement;
    animateScale(target, scale, { duration, ease: "elastic.out" });
  };

  return {
    handlePointerEnter: (event: PointerEvent) =>
      animate(event, hoverScale, hoverDuration),
    handlePointerLeave: (event: PointerEvent) => {
      const target = event.currentTarget as HTMLElement;
      animateScale(target, 1, { duration: 0.5, ease: "back.out" });
    },
    handlePointerDown: (event: PointerEvent) =>
      animateScale(event.currentTarget as HTMLElement, pressScale, {
        duration: pressDuration,
        ease: "power1.out",
      }),
    handlePointerUp: (event: PointerEvent) =>
      animate(event, hoverScale, hoverDuration),
  };
}
