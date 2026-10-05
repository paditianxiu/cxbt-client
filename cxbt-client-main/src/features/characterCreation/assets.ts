export type Appearance = { gender: number; hair: number; eyes: number; mouth: number; accessory: number };
export type ModelPart = { model: string; texture: string };
export type CreationAttachment = { id: string; model: string; texture: string | null; bone: string; animation?: string | null; characterAnimation?: string | null };
export type CreationWeapon = {
  id: string;
  label: string;
  icon: string;
  parts: { model: string; texture: string | null; bone: string }[];
  animation: string;
  actions?: { attack?: string; reload?: string };
};
export type CreationPreset = {
  id: string;
  body: string;
  hair: ModelPart[];
  ears: string[];
  eyes: string[];
  mouths: string[];
  accessories: ModelPart[];
  fixedParts: ModelPart[];
  accessorySets: number[][];
  defaultHair: number;
};
export type CreationAssets = {
  ui: Record<string, string>;
  models: Record<string, string>;
  jobs: Record<CreationJob, { background: string; icon: string; weapons: CreationWeapon[]; presets: CreationPreset[] }>;
  skinColor: string;
};
export const CREATION_BASE = `${import.meta.env.BASE_URL}assets/creation/`;
export const assetUrl = (path: string) => `${CREATION_BASE}${path}`;

export function initialAppearance(preset: CreationPreset, gender = 0): Appearance {
  return { gender, hair: preset.defaultHair, eyes: 0, mouth: 0, accessory: preset.accessorySets.length - 1 };
}

export async function loadCreationAssets(signal?: AbortSignal): Promise<CreationAssets> {
  const response = await fetch(assetUrl('config.json'), { signal });
  if (!response.ok) throw new Error('角色素材加载失败，请重试');
  return response.json();
}

// select_character.lua: jobPower, and game_text.lua: UI_profession_*_desc.
export const CREATION_JOBS = {
  guardian: { name: '护卫兵', stats: [5, 3, 2, 5], description: '●"护卫兵"视救助生命、捍卫和平为天职。\n●步枪、散弹枪、复合弓，轻量便捷，适合移动作战。\n●"群体治疗技能"和"辅助攻击技能"将提升团队的整体作战能力。' },
  gunner: { name: '重装兵', stats: [3, 2, 5, 3], description: '●"重装兵"是强壮、无畏的勇士，掩护同伴、冲锋在前是他们的使命。\n●机关枪、火箭筒，火力强悍极具侵略性。\n●盾牌配合防御性技能，造就了以守为攻的职业打法。' },
  assassin: { name: '突击兵', stats: [4, 5, 3, 2], description: '●"突击兵"总是如幽灵般潜伏或游走。寻找时机，迅速偷走敌人的生命。\n●近身短刀突袭，远程精准狙击。极端的作战距离让他成为战斗中的孤胆英雄。' },
  // The biochemical description is absent from this cache's game_text.lua.
  biochemist: { name: '生化专家', stats: [2, 4, 2, 4], description: '' },
};
export type CreationJob = keyof typeof CREATION_JOBS;
