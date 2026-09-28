/**
 * 负责人配色：低饱和度浅色系，用于 3D 仓库全景图中按负责人填充模块背景。
 * 同一负责人名称始终得到同一颜色，前后端共用，避免图例与图形不一致。
 */
export interface OwnerPalette {
  hue: number;
  /** 浅色填充，用于 3D 簇底色与图例色块 */
  fill: string;
  /** 更浅的填充，用于大面积背景 */
  fillSoft: string;
  /** 描边与强调色 */
  stroke: string;
  /** 深色文字，保证浅底上的对比度 */
  text: string;
}

const OWNER_HUES = [188, 206, 224, 246, 268, 292, 330, 12, 32, 48, 96, 152];

export const UNASSIGNED_OWNER = "未分配";

function hashKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100000;
  }
  return hash;
}

export function ownerPalette(owner: string | null | undefined): OwnerPalette {
  const key = owner?.trim() || UNASSIGNED_OWNER;
  const hue = OWNER_HUES[hashKey(key) % OWNER_HUES.length];
  return {
    hue,
    fill: `hsl(${hue} 46% 78%)`,
    fillSoft: `hsl(${hue} 52% 92%)`,
    stroke: `hsl(${hue} 40% 42%)`,
    text: `hsl(${hue} 38% 30%)`
  };
}

/**
 * 3D 场景必须用数字色值。
 * three.js 的 Color 不解析 CSS 的空格分隔 hsl 语法（"hsl(188 46% 78%)"），
 * 解析失败会静默退化成纯白——这正是节点全都显示成白圆的原因。
 */
export function ownerFillHex(owner: string | null | undefined): number {
  return hslToHex(ownerPalette(owner).hue, 0.46, 0.78);
}

export function ownerStrokeHex(owner: string | null | undefined): number {
  return hslToHex(ownerPalette(owner).hue, 0.4, 0.42);
}

export function hslToHex(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 60 ? [chroma, secondary, 0]
      : hue < 120 ? [secondary, chroma, 0]
        : hue < 180 ? [0, chroma, secondary]
          : hue < 240 ? [0, secondary, chroma]
            : hue < 300 ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const channel = (value: number) => Math.round((value + match) * 255);
  return (channel(red) << 16) | (channel(green) << 8) | channel(blue);
}
