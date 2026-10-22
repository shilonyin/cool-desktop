<template>
  <!-- 页面操作浮层：固定在右下角，刷新常驻，回到顶部在页面滚动后出现 -->
  <div
    class="floating-page-actions"
    :style="{
      '--floating-actions-right': `${layout.rightPx}px`,
      '--floating-actions-bottom': `${layout.bottomPx}px`,
      '--floating-actions-size': `${layout.sizePx}px`,
      '--floating-actions-gap': `${layout.gapPx}px`,
    }"
  >
    <Transition name="floating-action-fade">
      <button
        v-if="showBackToTop"
        class="floating-action-btn"
        type="button"
        title="回到顶部"
        aria-label="回到顶部"
        @click="scrollToTop"
      >
        <i class="fas fa-arrow-up"></i>
        <span class="floating-action-tooltip">回到顶部</span>
      </button>
    </Transition>
    <button
      class="floating-action-btn"
      type="button"
      title="刷新当前页面"
      aria-label="刷新当前页面"
      @click="refreshPage"
    >
      <i class="fas fa-rotate-right"></i>
      <span class="floating-action-tooltip">刷新当前页面</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { usePageTabsStore } from '../../stores/pageTabs';
import { refreshPageTabGeneration } from '../../utils/pageTabs';
import { useBackToTop } from '../../composables/useBackToTop';
import { FLOATING_ACTIONS_LAYOUT } from '../../utils/floatingActionsLayout';

const layout = FLOATING_ACTIONS_LAYOUT;
const route = useRoute();
const pageTabsStore = usePageTabsStore();
const { showButton: showBackToTop, scrollToTop } = useBackToTop();

function refreshPage() {
  refreshPageTabGeneration(pageTabsStore.tabs, route);
}
</script>

<style scoped>
.floating-page-actions {
  position: fixed;
  right: var(--floating-actions-right, 24px);
  bottom: var(--floating-actions-bottom, 24px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--floating-actions-gap, 8px);
  z-index: 990;
}

.floating-action-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--floating-actions-size, 44px);
  height: var(--floating-actions-size, 44px);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  border-radius: 50%;
  background: var(--surface, #ffffff);
  color: var(--text-secondary, #666666);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.floating-action-btn i {
  font-size: 16px;
}

.floating-action-btn:hover {
  transform: translateY(-3px) scale(1.08);
  background: var(--brand-primary, #10b981);
  border-color: transparent;
  color: #ffffff;
  box-shadow: 0 10px 24px rgba(16, 185, 129, 0.35);
}

.floating-action-btn:active {
  transform: translateY(-1px) scale(1.02);
}

.floating-action-tooltip {
  position: absolute;
  right: 52px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #ffffff;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.floating-action-btn:hover .floating-action-tooltip {
  opacity: 1;
}

.floating-action-fade-enter-active,
.floating-action-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.floating-action-fade-enter-from,
.floating-action-fade-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.6);
}

/* 移动布局沿用官方 APK 的顶栏与底栏，由 AppShell 决定不渲染本组件，此处不需要移动端覆盖样式。 */
</style>
