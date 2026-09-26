<script setup lang="ts">
import { gsap } from "gsap";
import { onMounted, onUnmounted, ref } from "vue";
import AppLogo from "@/assets/logo/raven-scroll-logo.svg?component";
import { commands } from "@/services/cmds";

const emit = defineEmits<{ finished: [] }>();

const root = ref<HTMLElement | null>(null);
const logo = ref<HTMLElement | null>(null);
const titleAnchor = ref<HTMLElement | null>(null);
const title = ref<HTMLElement | null>(null);
const intro = gsap.timeline();

onMounted(async () => {
  const rootElement = root.value;
  const logoElement = logo.value;
  const titleAnchorElement = titleAnchor.value;
  const titleElement = title.value;

  await intro
    .fromTo(
      logoElement,
      { y: "8vh", opacity: 0 },
      { y: 0, opacity: 1, duration: 2, ease: "power3.out" },
      0,
    )
    .fromTo(
      titleElement,
      { y: "6vh", opacity: 0, scale: 1.1 },
      { y: 0, opacity: 1, scale: 1.25, duration: 2, ease: "power3.out" },
      0,
    )
    .then(() => commands.showContent());

  await intro
    .to(logoElement, { opacity: 0, duration: 0.5, ease: "power3.in" }, 2)
    .to(
      titleAnchorElement,
      { top: "2.5vh", duration: 1, ease: "power3.out" },
      2.5,
    )
    .to(titleElement, { scale: 1, duration: 1, ease: "power3.out" }, 2.5)
    .to(rootElement, { opacity: 0, duration: 0.8, ease: "power1.out" }, 3.5)
    .then(() => emit("finished"));
});

onUnmounted(() => intro.kill());
</script>

<template>
  <div
    ref="root"
    class="intro-mask"
  >
    <div
      ref="logo"
      class="logo"
    >
      <AppLogo aria-hidden="true" />
    </div>
    <div
      ref="titleAnchor"
      class="title-anchor"
    >
      <div
        ref="title"
        class="title"
      >
        uXueScript
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro-mask {
  position: absolute;
  inset: 0;
  color: var(--theme-brand);
  background: var(--theme-page-gradient);
  font-family: "DefaultFont", Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.logo,
.title-anchor {
  position: absolute;
  left: 50vw;
  transform: translate(-50%, -50%);
}

.logo {
  top: calc(50vh - 12px - 1vh);
  width: min(21vmin, 224px);
  height: min(21vmin, 224px);
  opacity: 0;
}

.logo svg {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 10px 12px color-mix(in srgb, var(--theme-brand) 28%, transparent));
}

.title-anchor {
  top: calc(50vh + min(10.5vmin, 112px) + 1vh);
}

.title {
  opacity: 0;
  letter-spacing: 1px;
  -webkit-text-stroke: 1px currentColor;
  font-size: 2rem;
}
</style>
