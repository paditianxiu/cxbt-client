import { CREATION_JOBS, type Appearance, type CreationJob } from './assets';
import { apiFetch } from '../../api';

export type SavedCharacter = { 
  version: 1; 
  name: string; 
  jobId: CreationJob; 
  appearance: Appearance; 
  userId: number;
  level?: number; 
  exp?: number; 
  coins?: number; 
  rating?: number; 
};

export const CHARACTER_KEY = 'avatarstar.character';
let localCharacterCache: SavedCharacter | null = null;

// Initial fast read for App.tsx state fallback
export function readCharacter(): SavedCharacter | null {
  return localCharacterCache;
}

export async function fetchCharacterFromServer(): Promise<SavedCharacter | null> {
  try {
    const data = await apiFetch('/character');
    localCharacterCache = {
      version: 1,
      name: data.name,
      jobId: data.jobId,
      appearance: data.appearance,
      userId: data.userId,
      level: data.level,
      exp: data.exp,
      coins: data.coins,
      rating: data.rating,
    };
    return localCharacterCache;
  } catch (e) {
    return null;
  }
}

export async function saveCharacter(name: string, jobId: CreationJob, appearance: Appearance): Promise<SavedCharacter> {
  const data = await apiFetch('/character', {
    method: 'POST',
    body: JSON.stringify({ name, jobId, appearance }),
  });
  
  localCharacterCache = {
    version: 1,
    name: data.name,
    jobId: data.jobId as CreationJob,
    appearance: data.appearance,
    level: data.level,
    exp: data.exp,
    coins: data.coins,
    rating: data.rating,
  };
  return localCharacterCache;
}
