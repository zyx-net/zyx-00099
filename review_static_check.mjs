// Reviewer-owned verification: test core business logic from the prompt
// This is a minimal script to verify key behaviors without full test framework

// Test 1: Verify build outputs exist and are valid
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const dist = join(process.cwd(), "dist");
let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error("FAIL: " + msg); } }
function check(msg, cond) { if (cond) { passed++; console.log("PASS: " + msg); } else { failed++; console.error("FAIL: " + msg); } }

// Check dist exists
check("dist directory exists", existsSync(dist));

// Check key build files
const indexHtml = join(dist, "index.html");
check("dist/index.html exists", existsSync(indexHtml));

const htmlContent = readFileSync(indexHtml, "utf-8");
check("index.html references app JS bundle", htmlContent.includes("assets/index-") && htmlContent.includes(".js"));
check("index.html references app CSS bundle", htmlContent.includes("assets/index-") && htmlContent.includes(".css"));
check("index.html has PWA manifest link", htmlContent.includes("manifest.webmanifest") || htmlContent.includes("manifest"));

// Check service worker
const swFile = join(dist, "sw.js");
check("service worker exists", existsSync(swFile));
const swContent = readFileSync(swFile, "utf-8");
check("service worker has precache entries", swContent.includes("precacheAndRoute") || swContent.includes("workbox"));

// Check manifest
const manifestFile = join(dist, "manifest.webmanifest");
check("web manifest exists", existsSync(manifestFile));
const manifestContent = JSON.parse(readFileSync(manifestFile, "utf-8"));
check("manifest has name", !!manifestContent.name);
check("manifest has display:standalone", manifestContent.display === "standalone");

// Check assets directory exists and has JS and CSS
const assetsDir = join(dist, "assets");
check("dist/assets directory exists", existsSync(assetsDir));
const assets = readdirSync(assetsDir);
const hasJS = assets.some(f => f.endsWith(".js"));
const hasCSS = assets.some(f => f.endsWith(".css"));
check("dist/assets has JS bundle", hasJS);
check("dist/assets has CSS bundle", hasCSS);

// Test 2: Verify source code contains required features
const srcDir = join(process.cwd(), "src");

// Check types have PlanDelayRecord
const typesContent = readFileSync(join(srcDir, "types", "index.ts"), "utf-8");
check("types has PlanDueStatus", typesContent.includes("PlanDueStatus"));
check("types has PlanDelayRecord", typesContent.includes("PlanDelayRecord"));
check("types has PlanConflict with time conflict", typesContent.includes("hasTimeConflict") && typesContent.includes("timeConflictInfo"));
check("types has export/import warning types", typesContent.includes("missing_fields") && typesContent.includes("duplicate_plan"));

// Check helpers
const helpersContent = readFileSync(join(srcDir, "utils", "helpers.ts"), "utf-8");
check("helpers has computePlanDueStatus", helpersContent.includes("computePlanDueStatus"));
check("helpers has DUE_STATUS_LABELS", helpersContent.includes("DUE_STATUS_LABELS"));
check("helpers has buildDelayHistoryRemark", helpersContent.includes("buildDelayHistoryRemark"));
check("helpers has getPlanLastDelayReason", helpersContent.includes("getPlanLastDelayReason"));
check("helpers has getPlanLastApproverName", helpersContent.includes("getPlanLastApproverName"));

// Check permissions
const permContent = readFileSync(join(srcDir, "utils", "permissions.ts"), "utf-8");
check("permissions has canRequestDelay", permContent.includes("canRequestDelay"));
check("permissions has canApproveDelay", permContent.includes("canApproveDelay"));
check("permissions has canResolveTimeConflict", permContent.includes("canResolveTimeConflict"));
check("permissions has canDirectlyChangeReviewTime", permContent.includes("canDirectlyChangeReviewTime"));
check("inspector cannot approve delay (no delay_approve)", 
  permContent.includes("inspector") && 
  !JSON.parse(permContent.match(/inspector:\s*\[([^\]]+)\]/)?.[1]?.replace(/'/g, '"') || "[]").some(s => s.includes("delay_approve")));

// Check store has delay-related actions
const storeContent = readFileSync(join(srcDir, "store", "index.ts"), "utf-8");
check("store has requestPlanDelay", storeContent.includes("requestPlanDelay"));
check("store has approvePlanDelay", storeContent.includes("approvePlanDelay"));
check("store has rejectPlanDelay", storeContent.includes("rejectPlanDelay"));
check("store has resolvePlanTimeConflict", storeContent.includes("resolvePlanTimeConflict"));
check("store has computeAndSyncDueStatus", storeContent.includes("computeAndSyncDueStatus"));

// Check homepage has due status display
const homeContent = readFileSync(join(srcDir, "pages", "Home.tsx"), "utf-8");
check("Home.tsx imports DueStatusBadge", homeContent.includes("DueStatusBadge"));
check("Home.tsx uses dueStatus grouping", homeContent.includes("dueStatus"));
check("Home.tsx has overdue/scheduled/delay sections", 
  homeContent.includes("overdue") && homeContent.includes("due_soon") && homeContent.includes("delay_requested"));

// Check SyncQueue has due status filter
const syncContent = readFileSync(join(srcDir, "pages", "SyncQueue.tsx"), "utf-8");
check("SyncQueue.tsx imports DueStatusBadge", syncContent.includes("DueStatusBadge"));
check("SyncQueue.tsx has due filter options", syncContent.includes("DUE_FILTER_OPTIONS"));
check("SyncQueue.tsx shows lastApproverName", syncContent.includes("lastApproverName"));

// Check export includes delay fields
const templateVersionContent = readFileSync(join(srcDir, "services", "templateVersionService.ts"), "utf-8");
check("buildExportPayload includes delayRecords", templateVersionContent.includes("planDelayRecords"));
check("buildExportPayload schemaVersion 4.0", templateVersionContent.includes("4.0"));
check("generateCSVWithVersions has delay columns", 
  templateVersionContent.includes("到期状态") && 
  templateVersionContent.includes("延期次数") && 
  templateVersionContent.includes("最后延期原因") && 
  templateVersionContent.includes("审批人"));
check("parseExportPayload handles old schema", 
  templateVersionContent.includes("已自动为缺失字段补充默认值"));
check("parseExportPayload warns about v3 missing fields", 
  templateVersionContent.includes("旧版本未包含"));

// Check DB has delay record operations
const dbContent = readFileSync(join(srcDir, "lib", "db.ts"), "utf-8");
check("db.ts has getAllPlanDelayRecords", dbContent.includes("getAllPlanDelayRecords"));
check("db.ts has addPlanDelayRecord", dbContent.includes("addPlanDelayRecord"));
check("db.ts has updatePlanDelayRecord", dbContent.includes("updatePlanDelayRecord"));

console.log(`\n=== Reviewer Static Verification: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
