// The Pressroom's six stations: which stories each one offers this pupil, and what badge it shows.
// Pure and shared so the scene hotspots, the station list and the station pages can never disagree,
// and so they follow the pupil's EFFECTIVE rules (article ∧ class/assignment), not just the article's flags.
import type { HubArticle } from "../types";

export const HOME_STATIONS = ["newsstand", "investigation", "todaysStory", "opinion", "writing", "editor"] as const;
export type HomeStation = (typeof HOME_STATIONS)[number];

export type StationArticleView = Pick<HubArticle, "articleId" | "locked" | "tasks" | "writing" | "access">;
export interface StationEntry<A extends StationArticleView> { article: A; done: boolean }

export function stationArticles<A extends StationArticleView>(articles: readonly A[], station: HomeStation): StationEntry<A>[] {
  const out: StationEntry<A>[] = [];
  for (const a of articles) {
    const acc = a.access;
    if (a.locked || !acc) continue;
    const has = (s: string) => (acc.stations as readonly string[]).includes(s);
    const type = (t: string) => (acc.questionTypes as readonly string[]).includes(t);
    switch (station) {
      case "newsstand": out.push({ article: a, done: false }); break;
      case "investigation": {
        const c = has("investigation") && type("comprehension") ? a.tasks.comprehension : undefined;
        const v = has("investigation") && type("vocabulary") ? a.tasks.vocabulary : undefined;
        if (c || v) out.push({ article: a, done: (!c || c.passed) && (!v || v.passed) });
        break;
      }
      case "opinion": if (has("opinion") && type("reflect") && a.tasks.reflect) out.push({ article: a, done: a.tasks.reflect.passed }); break;
      case "writing": if (has("writing") && type("writing") && a.writing) out.push({ article: a, done: a.writing.passed }); break;
      // Editing is a polish pass on an existing draft: only stories with a first draft are offered, and it is never "finished".
      case "editor": if (has("editor") && acc.learningLoop.edit && a.writing && a.writing.attemptsCount >= 1) out.push({ article: a, done: false }); break;
      case "todaysStory": break;
    }
  }
  return out;
}

export function stationBadge(articles: readonly StationArticleView[], station: HomeStation): string {
  if (station === "todaysStory") return "🏆 GOAT";
  const entries = stationArticles(articles, station);
  if (entries.length === 0) return "Nothing yet";
  if (station === "newsstand") return "Ready ✓";
  if (station === "editor") return `${entries.length} ready to edit`;
  const remaining = entries.filter((e) => !e.done).length;
  return remaining === 0 ? "All done ✓" : `${remaining} waiting`;
}
