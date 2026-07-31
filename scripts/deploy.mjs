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
/* 이미 커밋해 둔 것이 밀려 있으면 작업트리가 깨끗해도 **푸시는 해야 한다.**
   깨끗하면 무조건 생략하던 판은 커밋 3개를 쥔 채 「변경 없음」이라 말하고 끝냈다. */
const ahead = execSync("git rev-list --count @{u}..HEAD", { cwd: ROOT }).toString().trim();

if (changed) {
  run("git add -A", "스테이징");
  run(`git commit -q -m "${msg.replace(/"/g, '\\"')}"`, "커밋");
} else if (ahead === "0") {
  console.log("\n변경 없음 · 밀린 커밋 없음 — 배포 생략");
  process.exit(0);
} else {
  console.log(`\n작업트리는 깨끗하고 밀린 커밋 ${ahead}개를 배포합니다`);
}
run("git push -q origin main", "푸시");
console.log("\n배포 완료 → https://gudwls5337-dot.github.io/youth-policy-app/");
console.log("Pages 반영까지 보통 1~2분 걸립니다.");
