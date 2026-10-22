import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import FloatingPageActions from '../FloatingPageActions.vue';
import { usePageTabsStore } from '../../../stores/pageTabs';

const routeState = vi.hoisted(() => ({ value: { path: '/', fullPath: '/', name: 'Home', params: {}, query: {} } }));

vi.mock('vue-router', () => ({
  useRoute: () => routeState.value,
}));

describe('FloatingPageActions', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    routeState.value = { path: '/', fullPath: '/', name: 'Home', params: {}, query: {} };
    scrollToSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollToSpy, writable: true, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('刷新按钮常驻，回到顶部按钮初始隐藏', () => {
    const wrapper = mount(FloatingPageActions);
    const buttons = wrapper.findAll('.floating-action-btn');

    expect(buttons).toHaveLength(1);
    expect(buttons[0].attributes('title')).toBe('刷新当前页面');
    expect(wrapper.find('[title="回到顶部"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('刷新按钮递增当前页面标签的代数，使页面重新挂载', async () => {
    const pageTabsStore = usePageTabsStore();
    const homeTab = pageTabsStore.tabs.find(tab => tab.id === 'home');
    expect(homeTab).toBeTruthy();
    const before = homeTab!.generation;

    const wrapper = mount(FloatingPageActions);
    await wrapper.find('[title="刷新当前页面"]').trigger('click');

    expect(homeTab!.generation).toBe(before + 1);

    wrapper.unmount();
  });

  it('页面滚动超过 300px 后显示回到顶部，点击后平滑回到顶部', async () => {
    const wrapper = mount(FloatingPageActions);
    const scrollHost = document.createElement('div');
    scrollHost.className = 'feed-scroll-container';
    document.body.appendChild(scrollHost);

    Object.defineProperty(window, 'scrollY', { value: 450, writable: true, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    await nextTick();

    const topButton = wrapper.find('[title="回到顶部"]');
    expect(topButton.exists()).toBe(true);

    await topButton.trigger('click');
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    scrollHost.remove();
    wrapper.unmount();
  });
});
