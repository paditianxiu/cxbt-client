import type { CreationAttachment, CreationJob, CreationWeapon } from '../characterCreation/assets';

export type InventoryCategory = 'equipment' | 'items' | 'gestures' | 'avatars';
export type InventoryItem = {
  id: string;
  name: string;
  category: InventoryCategory;
  icon: string;
  weapon?: string;
  attachment?: CreationAttachment;
  animation?: string | null;
  preset?: { jobId: CreationJob; gender: number };
};
export type LobbyAssets = {
  ui: Record<string, string>;
  maps: { id: string; name: string; cover: string | null; roomImage: string | null; coverCard?: boolean }[];
  items: InventoryItem[];
  weapons: Record<string, CreationWeapon>;
  counts: Record<InventoryCategory, number>;
};
export const lobbyUrl = (path: string) => `${import.meta.env.BASE_URL}assets/lobby/${path}`;

export async function loadLobbyAssets(signal?: AbortSignal): Promise<LobbyAssets> {
  const response = await fetch(lobbyUrl('catalog.json'), { signal });
  if (!response.ok) throw new Error('背包素材加载失败');
  return response.json();
}
