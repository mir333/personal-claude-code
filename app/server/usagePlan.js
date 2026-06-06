import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILES_DIR = "/home/node/.claude/profiles";
const CONFIG_FILENAME = "usage-plan.json";

export const PLAN_LIMITS = { pro: 19000, max5: 88000, max20: 220000 };
export const PLANS = [
  { id: "pro", label: "Pro", limit: PLAN_LIMITS.pro },
  { id: "max5", label: "Max5", limit: PLAN_LIMITS.max5 },
  { id: "max20", label: "Max20", limit: PLAN_LIMITS.max20 },
];
const DEFAULT_PLAN = "max5";

export function normalizePlanId(planId) {
  return PLAN_LIMITS[planId] != null ? planId : DEFAULT_PLAN;
}

function configPath(profileId) {
  const dir = path.join(PROFILES_DIR, profileId || "_global");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, CONFIG_FILENAME);
}

export function loadUsagePlan(profileId) {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(profileId), "utf-8"));
    return { planId: normalizePlanId(data.planId) };
  } catch {
    return { planId: DEFAULT_PLAN };
  }
}

export function saveUsagePlan(profileId, { planId }) {
  const next = { planId: normalizePlanId(planId), updatedAt: Date.now() };
  const filePath = configPath(profileId);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  return next;
}
