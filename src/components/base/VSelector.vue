<script lang="ts">
export type { SelectorData, SelectorMethods } from "./VSelector.types";
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  watch,
} from "vue";
import VLabel from "./VLabel.vue";
import VRollTransition from "./VRollTransition.vue";
import VSelectorDropdown from "./VSelectorDropdown.vue";
import VSelectorEditor from "./VSelectorEditor.vue";
import type { SelectorData, SelectorMethods } from "./VSelector.types";

const { data, methods } = defineProps<{
  data: SelectorData;
  methods: SelectorMethods;
}>();

const id = useId();
const isOpen = ref(false);
const editTarget = ref<number | "new" | null>(null);
const draft = ref("");
const dropdownRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const editorRef = ref<InstanceType<typeof VSelectorEditor> | null>(null);
const optionHeight = ref("48px");
let triggerResizeObserver: ResizeObserver | undefined;

const showDirectNew = computed(() => data.mutable && data.items.length === 0);
const hasDropdown = computed(() => data.items.length > 0 || data.mutable);
const displayText = computed(() =>
  showDirectNew.value ? "+ New" : (data.items[data.selectedIndex]?.label ?? ""),
);

watch(editTarget, async (target) => {
  isOpen.value = false;
  await nextTick();
  if (target !== null) editorRef.value?.focus();
  else triggerRef.value?.focus();
});

const closeEditor = () => {
  editTarget.value = null;
  draft.value = "";
};

const selectOption = (index: number) => {
  isOpen.value = false;
  methods.select(index);
};

const startCreate = () => {
  isOpen.value = false;
  draft.value = "";
  editTarget.value = "new";
};

const startEdit = (index: number) => {
  isOpen.value = false;
  draft.value = data.items[index]?.label ?? "";
  editTarget.value = index;
};

const saveEditor = () => {
  if (!draft.value.trim()) return;

  if (editTarget.value === "new") methods.create(draft.value);
  else if (editTarget.value !== null)
    methods.edit(editTarget.value, draft.value);

  closeEditor();
};

const removeOption = (index: number) => {
  isOpen.value = false;
  methods.remove(index);
};

const toggleDropdown = () => {
  if (editTarget.value !== null) return;
  if (showDirectNew.value) startCreate();
  else if (hasDropdown.value) isOpen.value = !isOpen.value;
};

const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
  if (!triggerRef.value) return;

  const updateOptionHeight = () => {
    optionHeight.value = `${triggerRef.value?.getBoundingClientRect().height ?? 48}px`;
  };

  triggerResizeObserver = new ResizeObserver(updateOptionHeight);
  triggerResizeObserver.observe(triggerRef.value);
  updateOptionHeight();
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
  triggerResizeObserver?.disconnect();
});
</script>

<template>
  <div class="base-config-select">
    <VLabel
      :label="data.label"
      :for="editTarget !== null ? `${id}-editor` : id"
    />

    <div
      ref="dropdownRef"
      class="input-section"
    >
      <div
        :id="editTarget !== null ? undefined : id"
        ref="triggerRef"
        class="select-trigger"
        :class="{ 'is-editing': editTarget !== null }"
        :tabindex="editTarget !== null ? -1 : 0"
        :role="editTarget !== null ? undefined : 'button'"
        :aria-expanded="
          editTarget !== null || !hasDropdown ? undefined : isOpen
        "
        :aria-disabled="editTarget === null && !hasDropdown"
        @click="toggleDropdown"
        @keydown.space.self.prevent="toggleDropdown"
        @keydown.enter.self.prevent="toggleDropdown"
        @keydown.escape.prevent="isOpen = false"
      >
        <VRollTransition
          v-show="editTarget === null"
          :value="displayText"
          class="selected-value"
        >
          <template #default="{ value }">
            <span class="selected-text">{{ value }}</span>
          </template>
        </VRollTransition>
        <VSelectorEditor
          ref="editorRef"
          :data="{
            active: editTarget !== null,
            draft,
            id: `${id}-editor`,
          }"
          :methods="{
            updateDraft: (value) => (draft = value),
            save: saveEditor,
            cancel: closeEditor,
          }"
        />
        <span
          v-show="editTarget === null && !showDirectNew && hasDropdown"
          class="select-arrow"
          :class="{ 'is-open': isOpen }"
        >
          <svg
            viewBox="0 -960 960 960"
            width="24"
            height="24"
            fill="currentColor"
          >
            <path d="m256-424-56-56 280-280 280 280-56 56-224-223-224 223Z" />
          </svg>
        </span>
        <span
          v-for="edge in ['top', 'right', 'bottom', 'left']"
          :key="edge"
          class="select-edge"
          :class="`edge-${edge}`"
          aria-hidden="true"
        />
      </div>

      <Transition name="dropdown">
        <VSelectorDropdown
          v-show="isOpen && hasDropdown && editTarget === null"
          :data="{
            items: data.items,
            selectedIndex: data.selectedIndex,
            mutable: data.mutable,
            optionHeight,
          }"
          :methods="{
            select: selectOption,
            create: startCreate,
            edit: startEdit,
            remove: removeOption,
          }"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.base-config-select {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.input-section {
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  height: 100%;
  position: relative;
}

.select-trigger {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.select-trigger {
  position: relative;
  width: 100%;
  min-height: calc(1.5em + 4px);
  font-size: 1rem;
  border: 0;
  padding: 2px 14px;
  isolation: isolate;
  justify-content: space-between;
}

.select-edge {
  position: absolute;
  z-index: 3;
  background: var(--theme-brand);
  pointer-events: none;
  transition: transform 0.24s cubic-bezier(0.25, 1, 0.5, 1);
}

.edge-top,
.edge-bottom {
  left: 0;
  right: 0;
  height: 2px;
  transform-origin: right;
}

.edge-left,
.edge-right {
  top: 0;
  bottom: 0;
  width: 2px;
  transform-origin: bottom;
}

.edge-top {
  top: 0;
}
.edge-bottom {
  bottom: 0;
}
.edge-left {
  left: 0;
}
.edge-right {
  right: 0;
}

.is-editing .edge-top,
.is-editing .edge-bottom {
  transform: scaleX(0);
}

.is-editing .edge-left,
.is-editing .edge-right {
  transform: scaleY(0);
}

.select-trigger.is-editing {
  cursor: text;
}

.select-trigger[aria-disabled="true"] {
  cursor: default;
}

.selected-value {
  position: relative;
  z-index: 2;
  flex: 1;
  height: 100%;
  min-height: 1.5em;
}

.select-editor {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  user-select: text;
}

.select-editor :deep(.input-field) {
  box-sizing: border-box;
  padding-right: 7rem;
}

.select-trigger:not(.is-editing)::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background-image: var(--theme-page-gradient);
  background-size: 100vw 100vh;
  background-position: left top;
  background-repeat: no-repeat;
  background-attachment: fixed;
}

.selected-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-arrow {
  position: relative;
  z-index: 2;
  display: flex;
  transition: transform 0.2s;
  color: var(--theme-brand);
  transform: rotate(180deg);
}

.select-arrow.is-open {
  transform: rotate(0deg);
}

/* 下拉菜单缓动动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: max-height 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.dropdown-enter-from,
.dropdown-leave-to {
  max-height: 0 !important;
}

.dropdown-enter-to,
.dropdown-leave-from {
  max-height: 175px !important;
}
</style>
