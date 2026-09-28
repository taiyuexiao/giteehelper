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
  const g = d.graph;
  const cam = g.camera();
  const nodes = d.nodes.filter(n => n.x !== undefined);
  const pts = nodes.map(n => g.graph2ScreenCoords(n.x, n.y, n.z));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const canvas = g.width ? { w: g.width(), h: g.height() } : null;
  return {
    渲染尺寸: canvas,
    相机距离: Math.round(Math.hypot(cam.position.x, cam.position.y, cam.position.z)),
    fov: cam.fov,
    节点屏幕包围盒: { x: [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))], y: [Math.round(Math.min(...ys)), Math.round(Math.max(...ys))] },
    占比: { 宽: Math.round((Math.max(...xs) - Math.min(...xs)) / g.width() * 100) + "%", 高: Math.round((Math.max(...ys) - Math.min(...ys)) / g.height() * 100) + "%" },
    节点半径范围: (() => { const r = nodes.map(n => Math.hypot(n.x, n.y, n.z)); return [Math.round(Math.min(...r)), Math.round(Math.max(...r))]; })()
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
