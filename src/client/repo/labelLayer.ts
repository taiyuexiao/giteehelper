/**
 * 极简 CSS2D 标签层。
 *
 * 3D 场景里的文字精灵受纹理分辨率限制、缩放后模糊，而且无法点击与参与布局；
 * 分区标题、模块名这类"必须一直看得清"的文字改用真实 DOM，覆盖在画布上，
 * 每帧把世界坐标投影成屏幕坐标。同时做防重叠：优先级高的先占位，
 * 放不下的直接隐藏——这正是地图类产品处理密集标签的标准做法。
 */
export interface LabelItem {
  id: string;
  /** 每帧读取世界坐标（节点位置会被力学引擎持续改动） */
  world: () => { x: number; y: number; z: number } | null;
  /** 越大越优先保留 */
  priority: number;
  element: HTMLElement;
  /** 返回 false 时整条标签不参与布局 */
  enabled: () => boolean;
  /** 纵向像素偏移，让文字浮在节点上方而不是压在球体上 */
  offsetY?: number;
}

type Placed = { x: number; y: number; w: number; h: number };

function overlaps(a: Placed, b: Placed, gap: number) {
  return !(
    a.x + a.w + gap < b.x ||
    b.x + b.w + gap < a.x ||
    a.y + a.h + gap < b.y ||
    b.y + b.h + gap < a.y
  );
}

export class LabelLayer {
  private container: HTMLDivElement;
  private items: LabelItem[] = [];
  private sizes = new Map<string, { w: number; h: number }>();
  private frame = 0;
  private lastAt = 0;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "repo-labels";
    parent.appendChild(this.container);
  }

  set(items: LabelItem[]) {
    const keep = new Set(items.map((item) => item.id));
    for (const item of this.items) {
      if (!keep.has(item.id)) {
        item.element.remove();
        this.sizes.delete(item.id);
      }
    }
    for (const item of items) {
      if (!item.element.isConnected) this.container.appendChild(item.element);
    }
    this.items = items;
  }

  /** 屏幕投影由调用方提供；返回 null 表示该点不可见（在相机背后等） */
  render(project: (x: number, y: number, z: number) => { x: number; y: number } | null, width: number, height: number) {
    const placed: Placed[] = [];
    const ordered = [...this.items].sort((a, b) => b.priority - a.priority);
    for (const item of ordered) {
      const element = item.element;
      if (!item.enabled()) {
        element.style.visibility = "hidden";
        continue;
      }
      const world = item.world();
      if (!world) {
        element.style.visibility = "hidden";
        continue;
      }
      const screen = project(world.x, world.y, world.z);
      if (!screen) {
        element.style.visibility = "hidden";
        continue;
      }

      let size = this.sizes.get(item.id);
      if (!size) {
        // 只在内容变化后量一次，避免每帧触发布局计算
        element.style.visibility = "visible";
        size = { w: element.offsetWidth || 130, h: element.offsetHeight || 26 };
        this.sizes.set(item.id, size);
      }

      const rect: Placed = { x: screen.x - size.w / 2, y: screen.y - size.h / 2, w: size.w, h: size.h };
      const outside =
        screen.x < -size.w || screen.x > width + size.w || screen.y < -size.h || screen.y > height + size.h;
      if (outside || placed.some((other) => overlaps(other, rect, 6))) {
        element.style.visibility = "hidden";
        continue;
      }

      placed.push(rect);
      element.style.visibility = "visible";
      const offsetY = item.offsetY ?? 0;
      element.style.transform = `translate(-50%, -50%) translate(${Math.round(screen.x)}px, ${Math.round(screen.y + offsetY)}px)`;
    }
  }

  /** 内容变化后需要重新测量尺寸 */
  invalidate(id?: string) {
    if (id) this.sizes.delete(id);
    else this.sizes.clear();
  }

  /** 节流渲染：标签不需要跟满帧率，20fps 足够顺滑且省 CPU */
  renderThrottled(project: (x: number, y: number, z: number) => { x: number; y: number } | null, width: number, height: number, intervalMs = 45) {
    const now = performance.now();
    if (now - this.lastAt < intervalMs) return;
    this.lastAt = now;
    this.frame += 1;
    this.render(project, width, height);
    return this.frame;
  }

  destroy() {
    this.container.remove();
    this.items = [];
    this.sizes.clear();
  }
}
