import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

/** 滚动超过该阈值后才展示「回到顶部」，避免短页面出现无意义按钮。 */
export const BACK_TO_TOP_THRESHOLD = 300;

/** 回到顶部时一并归零的滚动容器，覆盖信息流、话题、用户页等主要滚动宿主。 */
const SCROLL_HOST_SELECTORS = '.custom-scrollbar, .feed-scroll-container, .page-container, .user-page-wrapper, .discover-scroll-container, .feed-detail-page, .downloads-page, main.app-main-content';

/**
 * 「回到顶部」的滚动检测与回顶逻辑。
 * 聊天页（/messages）及其内部滚动区域不参与，避免与消息列表抢焦点。
 */
export function useBackToTop() {
  const route = useRoute();
  const showButton = ref(false);
  let activeScrollTarget: HTMLElement | Window | null = null;

  const isExcluded = computed(() => Boolean(route?.path?.startsWith('/messages')));

  function reset() {
    showButton.value = false;
    activeScrollTarget = null;
  }

  function checkScroll(event?: Event) {
    if (isExcluded.value) {
      reset();
      return;
    }

    const target = event?.target as HTMLElement | null | undefined;
    if (target && target.scrollTop !== undefined) {
      // 聊天区域内部的滚动不代表页面滚动位置。
      if (target.closest?.('.messages-page') || target.classList?.contains('chat-area') || target.classList?.contains('session-list')) {
        reset();
        return;
      }
      if (target.scrollTop > BACK_TO_TOP_THRESHOLD) activeScrollTarget = target;
      showButton.value = target.scrollTop > BACK_TO_TOP_THRESHOLD;
      return;
    }

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop > BACK_TO_TOP_THRESHOLD) activeScrollTarget = window;
    showButton.value = scrollTop > BACK_TO_TOP_THRESHOLD;
  }

  function scrollElementToTop(el: HTMLElement | Window) {
    try {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      (el as HTMLElement).scrollTop = 0;
    }
  }

  function scrollToTop() {
    scrollElementToTop(activeScrollTarget && 'scrollTo' in activeScrollTarget ? activeScrollTarget : window);

    const hosts = document.querySelectorAll<HTMLElement>(SCROLL_HOST_SELECTORS);
    let scrolledFound = false;
    hosts.forEach(el => {
      if (el.scrollTop <= 0) return;
      scrolledFound = true;
      scrollElementToTop(el);
    });

    // 兜底：页面结构变化导致选择器未命中时，找回真正滚动的元素。
    if (scrolledFound) return;
    Array.from(document.querySelectorAll<HTMLElement>('*'))
      .filter(el => el.scrollTop > 0 && el.scrollHeight > el.clientHeight)
      .forEach(scrollElementToTop);
  }

  onMounted(() => window.addEventListener('scroll', checkScroll, true));
  onUnmounted(() => window.removeEventListener('scroll', checkScroll, true));

  // 切换页面后滚动位置归零，按钮不应残留。
  watch(() => route?.fullPath, reset);

  return { showButton, isExcluded, scrollToTop, reset };
}
