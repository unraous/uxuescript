<script setup lang="ts">
defineProps<{
  coverSrc: string;
}>();
</script>

<template>
  <div class="cover">
    <Transition name="fade">
      <!-- 真实封面展示组（绑定 key 确保 URL 改变时也能直接叠化过渡） -->
      <div
        v-if="coverSrc"
        :key="coverSrc"
        class="cover-group"
      >
        <!-- 底层彩色氛围光晕投影 -->
        <img
          :src="coverSrc"
          aria-hidden="true"
          referrerpolicy="no-referrer"
          class="cover-glow"
        />
        <!-- 顶层封面主体 -->
        <img
          :src="coverSrc"
          referrerpolicy="no-referrer"
          class="cover-main"
        />
      </div>

      <!-- 封面为空时的占位圆角矩形卡片 -->
      <div
        v-else
        key="placeholder"
        class="cover-placeholder"
      >
        <span class="placeholder-text">课程待加载···</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.cover {
  height: 65%;
  aspect-ratio: 2 / 1;
  position: relative;
}

/* 封面组合容器：绝对定位贴齐，实现直接叠化 */
.cover-group {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
}

/* 顶层封面主体 */
.cover-main {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  object-fit: cover;
  position: relative;
  z-index: 2;
}

/* 底层彩色氛围光晕投影 */
.cover-glow {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  object-fit: cover;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  transform: translateY(40px) scale(0.9);
  transform-origin: center bottom;
  filter: blur(20px) saturate(145%);
  opacity: 0.75;
  will-change: transform, filter;
}

/* 空状态圆角矩形占位卡片：同样绝对定位重叠 */
.cover-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  position: absolute;
  top: 0;
  left: 0;
  --brand-color: var(--theme-brand);
  color: var(--theme-surface);
  background: conic-gradient(
    from 145deg at 50% 0%,
    color-mix(in srgb, var(--brand-color), black 25%) 0deg,
    var(--brand-color) 160deg,
    color-mix(in srgb, var(--brand-color), white 75%) 180deg,
    var(--brand-color) 200deg,
    color-mix(in srgb, var(--brand-color), black 25%) 360deg
  );
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  box-sizing: border-box;
}

.placeholder-text {
  font-size: 2rem;
  letter-spacing: 1px;
  text-shadow: 0 5px 2px color-mix(in srgb, black 70%, transparent);
}

/* 交叉渐变动画：旧元素淡出的同时新元素直接在其上淡入，无空白间隙 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
