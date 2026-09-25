import fs from "node:fs";
import path from "node:path";
import { audit, execute, parseJson, queryOne } from "./db.js";
import type { Impact } from "../shared/types.js";

export function createRepairBundle(impactId: number, actor = "system") {
  const impact = queryOne<Impact & { reason: string; evidence_json: string; next_action: string; event_id: number }>(
    `SELECT i.*, i.reason, i.evidence_json, i.next_action, i.event_id FROM impacts i WHERE i.id = ?`,
    [impactId]
  );
  if (!impact) throw new Error("impact not found");
  const event = queryOne<{ id: number; title: string; source_id: string; url: string | null; payload_json: string }>(
    `SELECT id, title, source_id, url, payload_json FROM change_events WHERE id = ?`,
    [impact.event_id]
  );
  const bundleDir = path.resolve(process.cwd(), "data/repair-bundles", String(impactId));
  fs.mkdirSync(bundleDir, { recursive: true });
  const diff = [
    `# GiteeHelper generated repair suggestion`,
    `# Source: ${event?.source_id ?? impact.event_id}`,
    `# This patch is a review artifact. Apply only after local verification.`,
    `--- a/docs/module-review.md`,
    `+++ b/docs/module-review.md`,
    `@@`,
    `- // previous assumption`,
    `+ // TODO: ${impact.next_action}`
  ].join("\n");
  const testsPatch = [
    `# tests.patch`,
    `# Add or update tests for: ${impact.next_action}`
  ].join("\n");
  const provenance = {
    impactId,
    eventId: impact.event_id,
    source: event?.source_id,
    sourceUrl: event?.url,
    generatedAt: new Date().toISOString(),
    generatedBy: actor,
    evidence: parseJson(impact.evidence_json, []),
    approval: "required",
    directWriteAllowed: false
  };
  const files: Record<string, string> = {
    "repair.diff": diff,
    "tests.patch": testsPatch,
    "test-report.json": JSON.stringify({ status: "not-run", note: "Run tests locally before approval" }, null, 2),
    "provenance.json": JSON.stringify(provenance, null, 2),
    "commands.md": "# Commands\n\n1. `giteehelper repair apply`\n2. `giteehelper repair test`\n3. `giteehelper repair review`\n4. `giteehelper repair approve`\n",
    "README.md": `# Repair Bundle ${impactId}\n\n${impact.reason}\n\n下一步：${impact.next_action}\n`
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(bundleDir, name), content, "utf8");
  const inserted = execute(
    `INSERT INTO repair_bundles (event_id, impact_id, status, diff, tests_patch, test_report_json, provenance_json) VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
    [impact.event_id, impactId, diff, testsPatch, files["test-report.json"], JSON.stringify(provenance)]
  );
  const id = Number(inserted.lastInsertRowid);
  audit(null, actor, "repair_bundle_create", "repair_bundle", id, { impactId, bundleDir });
  return { id, bundleDir, files: Object.keys(files), provenance };
}
