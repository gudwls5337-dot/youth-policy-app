/**
 * 갱신 → 검증 → 배포
 *   node scripts/deploy.mjs ["커밋 메시지"]
 *
 * 검증이 하나라도 깨지면 push 하지 않는다. 이게 이 스크립트의 존재 이유다.
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, label) => {
  console.log(`\n▸ ${label}`);
  try { execSync(cmd, { cwd: ROOT, stdio: "inherit" }); }
  catch { console.error(`\n중단 — ${label} 실패. 배포하지 않습니다.`); process.exit(1); }
};

run("node scripts/build.mjs", "빌드");
run("node scripts/validate.mjs", "데이터 검증");
run("node scripts/smoke.mjs", "화면 동작 검증");

const msg = process.argv[2] || `데이터 갱신 ${new Date().toISOString().slice(0, 10)}`;
const changed = execSync("git status --porcelain", { cwd: ROOT }).toString().trim();
if (!changed) { console.log("\n변경 없음 — 배포 생략"); process.exit(0); }

run("git add -A", "스테이징");
run(`git commit -q -m "${msg.replace(/"/g, '\\"')}"`, "커밋");
run("git push -q origin main", "푸시");
console.log("\n배포 완료 → https://gudwls5337-dot.github.io/youth-policy-app/");
console.log("Pages 반영까지 보통 1~2분 걸립니다.");
