const BASE = `${import.meta.env.BASE_URL}assets/gameplay/audio/`;

export function createBattleAudio(ambienceName?: string | null) {
  const music = new Audio(`${BASE}battle.ogg`);
  const ambienceFile = ['ambience_day', 'alien_boss', 'castle'].includes(ambienceName ?? '')
    ? ambienceName : 'ambience_day';
  const ambience = new Audio(`${BASE}${ambienceFile}.ogg`);
  music.loop = true;
  ambience.loop = true;
  music.volume = 0.25;
  ambience.volume = 0.16;
  const effects = new Set<HTMLAudioElement>();

  const start = () => {
    if (music.paused) void music.play().catch(() => {});
    if (ambience.paused) void ambience.play().catch(() => {});
  };
  const pause = () => { music.pause(); ambience.pause(); };
  const play = (name: string, volume = 0.55) => {
    const effect = new Audio(`${BASE}${name}.wav`);
    effect.volume = volume;
    effects.add(effect);
    effect.addEventListener('ended', () => effects.delete(effect), { once: true });
    void effect.play().catch(() => effects.delete(effect));
  };
  const dispose = () => {
    pause();
    effects.forEach((effect) => effect.pause());
    effects.clear();
  };
  return { start, pause, play, dispose };
}
