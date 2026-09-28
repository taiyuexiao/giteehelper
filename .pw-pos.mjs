import { chromium } from "/Users/shipeilin/projects/mine/giteehelper/node_modules/playwright/index.mjs";
const BASE = "http://127.0.0.1:8899";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill('input[autocomplete="username"]', process.env.ADMIN_USERNAME);
await page.fill('input[autocomplete="current-password"]', process.env.ADMIN_PASSWORD);
await page.click(".login-form button");
await page.waitForSelector(".sidebar");
await page.goto(BASE + "/repo", { waitUntil: "networkidle" });
await page.waitForSelector(".repo-canvas canvas");
await page.waitForTimeout(7000);
const info = await page.evaluate(() => {
  const d = window.__repoDebug;
  if (!d) return { error: "没有调试对象" };
  const pos = d.nodes.filter(n => n.x !== undefined).map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, z: n.z }));
  const extent = (k) => { const v = pos.map(p => p[k]); return [Math.min(...v).toFixed(0), Math.max(...v).toFixed(0)]; };
  const anchorExtent = (k) => { const v = [...d.anchors.values()].map(a => a[k]); return [Math.min(...v).toFixed(0), Math.max(...v).toFixed(0)]; };
  const hasAnchorForce = typeof d.graph.d3Force("anchor") === "function";
  const cam = d.graph.cameraPosition();
  return {
    节点数: pos.length,
    有锚点力: hasAnchorForce,
    实际位置范围: { x: extent("x"), y: extent("y"), z: extent("z") },
    锚点范围: { x: anchorExtent("x"), y: anchorExtent("y"), z: anchorExtent("z") },
    相机: { x: Math.round(cam.x), y: Math.round(cam.y), z: Math.round(cam.z) },
    样例: pos.slice(0, 3).map(p => `${p.type} ${p.id} -> (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)})`)
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
