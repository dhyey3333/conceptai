/**
 * Which model teaches, and whether to research first.
 *
 * School and JEE/NEET-level lessons go to the fast (cheaper) model; college and
 * postgraduate lessons go to the best model. If the lesson plan says a topic is
 * graduate-level anyway, an automatic choice is escalated. College and advanced
 * lessons are researched on the web before teaching, so niche and recent
 * material is grounded in real sources.
 */
import type { Level } from "./types";

export type Tier = "fast" | "best";
export type TierPref = "auto" | Tier;
export type ResearchPref = "auto" | "on" | "off";

const ADVANCED_LEVELS: Level[] = ["college", "advanced"];

export function chooseTier(pref: TierPref | undefined, level: Level): Tier {
  if (pref === "fast" || pref === "best") return pref;
  return ADVANCED_LEVELS.includes(level) ? "best" : "fast";
}

export function escalateTier(pref: TierPref | undefined, tier: Tier, difficulty: string | undefined): Tier {
  return (pref ?? "auto") === "auto" && difficulty === "advanced" ? "best" : tier;
}

export function shouldResearch(pref: ResearchPref | undefined, level: Level): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return ADVANCED_LEVELS.includes(level);
}
