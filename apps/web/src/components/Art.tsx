// v3.0's artwork, retained. Files live in /public (served as-is by the Worker's static assets).
import { tierForLevel } from "@newsroom/shared";

/** Only the five sections the artwork covers get an icon. Section is free text a teacher types, so anything else renders nothing rather than a broken image. */
const SECTION_ICONS: Record<string, string> = {
  news: "/section-icons/news.svg", sport: "/section-icons/sport.svg", sports: "/section-icons/sport.svg",
  science: "/section-icons/science.svg", arts: "/section-icons/arts.svg", "arts & culture": "/section-icons/arts.svg", world: "/section-icons/world.svg",
};
export function SectionIcon({ section, size = 16 }: { section?: string | null; size?: number }) {
  const src = section ? SECTION_ICONS[section.trim().toLowerCase()] : undefined;
  return src ? <img src={src} alt="" width={size} height={size} style={{ verticalAlign: "middle", borderRadius: Math.round(size * 0.2) }} /> : null;
}

export function RankBadge({ level, size = 28 }: { level: number | null | undefined; size?: number }) {
  const tier = tierForLevel(level);
  return tier === null ? null : <img src={`/rank-badges/tier-${tier}.png`} alt={`Rank badge, tier ${tier}`} title={`Level ${level}`} width={size} height={size} loading="lazy" style={{ verticalAlign: "middle", objectFit: "contain" }} />;
}

export const ART = {
  scene: "/newsroom-scene.webp", corkboard: "/investigation-corkboard.png", podium: "/goat-podium.png", stamp: "/published-stamp.png",
} as const;
