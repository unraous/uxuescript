import { gsap } from "gsap";

export interface RippleOptions {
  scale?: number;
  duration?: number;
  disabled?: boolean;
}

export function createRipple(
  event: MouseEvent,
  { scale = 2.0, duration = 0.6, disabled = false }: RippleOptions = {},
) {
  if (disabled) return;

  const target = event.currentTarget as HTMLElement;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * scale;
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  const circle = document.createElement("span");
  circle.className = "gsap-ripple";
  circle.style.position = "absolute";
  circle.style.borderRadius = "50%";
  circle.style.pointerEvents = "none";
  circle.style.left = `${x}px`;
  circle.style.top = `${y}px`;
  circle.style.width = `${size}px`;
  circle.style.height = `${size}px`;

  target.appendChild(circle);

  gsap.fromTo(
    circle,
    { scale: 0, opacity: 0.5 },
    {
      scale: 1,
      opacity: 0,
      duration,
      ease: "power2.out",
      onComplete: () => {
        circle.remove();
      },
    },
  );
}
