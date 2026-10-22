/**
 * 右下角页面操作浮层（刷新 / 回到顶部）的几何常量。
 * 组件样式与其它右下角浮层的避让计算共用同一组数值，避免改一处漏一处。
 */
export const FLOATING_ACTIONS_LAYOUT = {
  /** 距窗口右边缘 */
  rightPx: 24,
  /** 距窗口下边缘 */
  bottomPx: 24,
  /** 圆形按钮直径 */
  sizePx: 44,
  /** 两个按钮之间的间距 */
  gapPx: 8,
  /** 两个按钮都显示时浮层的总高度 */
  get stackHeightPx() {
    return this.sizePx * 2 + this.gapPx;
  },
  /** 浮层顶部相对窗口底部的距离，供其它右下角浮层避让使用 */
  get avoidBottomPx() {
    return this.bottomPx + this.stackHeightPx + 8;
  },
  /** 横向进入浮层区域的距离阈值，供其它右下角浮层判断是否需要上移 */
  get overlapThresholdPx() {
    return this.rightPx + this.sizePx + 28;
  },
} as const;
