import { rmSync } from "node:fs";
import path from "node:path";

/**
 * 测试必须使用独立的数据库文件。
 * 旧配置直接复用 data/giteehelper.db，会让 `npm test` 污染真实数据
 * （历史上一次修复测试就向真实库写入并“批准”了 21 个修复包）。
 */
const target = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/test/giteehelper-test.db");
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(`${target}${suffix}`, { force: true });
}
console.log(`[test] 已重置测试数据库 ${path.relative(process.cwd(), target)}`);
