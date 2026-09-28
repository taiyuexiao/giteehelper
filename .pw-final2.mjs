import { chromium } from "/Users/shipeilin/projects/mine/giteehelper/node_modules/playwright/index.mjs";
const BASE = "http://127.0.0.1:8899";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push("[pageerror] " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("[console] " + m.text()); });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill('input[autocomplete="username"]', process.env.ADMIN_USERNAME);
await page.fill('input[autocomplete="current-password"]', process.env.ADMIN_PASSWORD);
await page.click(".login-form button");
await page.waitForSelector(".sidebar");
await page.goto(BASE + "/repo", { waitUntil: "networkidle" });
await page.waitForSelector(".repo-canvas canvas");
await page.waitForTimeout(5000);

// 1) 悬停 + 点击
const box = await page.locator(".repo-canvas").boundingBox();
let hit = false;
for (let dx = -260; dx <= 260 && !hit; dx += 26) {
  for (let dy = -180; dy <= 180 && !hit; dy += 26) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await page.waitForTimeout(60);
    if (await page.locator(".graph-hover-card").count()) {
      hit = true;
      console.log("悬停提示:", (await page.locator(".graph-hover-card").innerText()).replace(/\s+/g, " ").slice(0, 70));
      await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
      await page.waitForTimeout(700);
      console.log("点击抽屉:", (await page.locator(".repo-drawer").count()) ? "已打开" : "未打开");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }
}
if (!hit) console.log("未命中节点");

// 2) 交互
for (const label of ["仅新提交", "仅冲突", "未归属", "全部"]) { await page.click(`.view-switcher button:has-text("${label}")`); await page.waitForTimeout(500); }
console.log("筛选切换完成");
await page.locator(".owner-chip").first().click(); await page.waitForTimeout(600);
console.log("负责人筛选:", await page.locator(".owner-clear").count() ? "生效" : "未生效");
await page.click('button:has-text("清除负责人筛选")').catch(() => {});
await page.waitForTimeout(400);
await page.click('button:has-text("重置视角")'); await page.waitForTimeout(1200);
console.log("重置视角完成");

// 3) 页面滚动与画布尺寸
const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, view: window.innerHeight }));
console.log(`页面高度 ${m.scroll} / 视口 ${m.view} → ${m.scroll <= m.view + 8 ? "无整页滚动" : "仍有滚动"}`);
await page.screenshot({ path: "/tmp/repo-final.png" });
console.log("错误:", errors.length ? errors.slice(0, 4).join(" || ") : "无");
await browser.close();
