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
const shot = await page.locator(".repo-canvas canvas").screenshot();
const fs = await import("node:fs");
fs.writeFileSync("/tmp/canvas.png", shot);
// 直接读 WebGL 像素太麻烦，这里用 Playwright 的截图 + 采样
const stats = await page.evaluate(() => {
  const d = window.__repoDebug;
  const scene = d.graph.scene();
  const bubbles = [];
  scene.traverse((o) => {
    if (o.__graphObjType === "cluster" && o.geometry && o.geometry.type === "SphereGeometry") {
      bubbles.push({ r: Math.round(o.scale.x), colorHex: o.material.color.getHexString(), opacity: o.material.opacity, wireframe: !!o.material.wireframe });
    }
  });
  return bubbles.slice(0, 8);
});
console.log("场景中的气泡材质:", JSON.stringify(stats, null, 1));
await browser.close();
