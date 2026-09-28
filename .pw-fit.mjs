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
await page.waitForTimeout(6000);

const measure = async (label) => {
  const r = await page.evaluate(() => {
    const d = window.__repoDebug; const g = d.graph;
    const nodes = d.nodes.filter(n => n.x !== undefined);
    const pts = nodes.map(n => g.graph2ScreenCoords(n.x, n.y, n.z));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { w: g.width(), h: g.height(), spanX: Math.round(Math.max(...xs) - Math.min(...xs)), spanY: Math.round(Math.max(...ys) - Math.min(...ys)) };
  });
  console.log(`${label}: 占宽 ${Math.round(r.spanX / r.w * 100)}% / 占高 ${Math.round(r.spanY / r.h * 100)}%  (${r.spanX}x${r.spanY} of ${r.w}x${r.h})`);
};

await measure("当前");
// 手工再取一次景，看是否只是"取景太早"
await page.evaluate(() => window.__repoDebug.graph.zoomToFit(0, 40, () => true));
await page.waitForTimeout(1200);
await measure("手动 zoomToFit 后");

// 场景里的装饰气泡有多大
const bubbles = await page.evaluate(() => {
  const d = window.__repoDebug; const scene = d.graph.scene();
  const out = [];
  scene.traverse((o) => {
    if (o.__graphObjType === "cluster" && o.geometry && o.geometry.type === "SphereGeometry") {
      out.push({ r: Math.round(o.scale.x), pos: [Math.round(o.position.x), Math.round(o.position.y), Math.round(o.position.z)] });
    }
  });
  return out;
});
console.log("分区气泡:", JSON.stringify(bubbles.slice(0, 15)));
await browser.close();
