import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const files = (dir) => {
  const result = [];
  for (const name of readdirSync(join(root, dir))) {
    const relative = join(dir, name);
    if (statSync(join(root, relative)).isDirectory()) result.push(...files(relative));
    else result.push(relative);
  }
  return result;
};

assert.equal(existsSync(join(root, "injected/chaoxing/focus.js")), false);
const injected = files("injected").filter((path) => path.endsWith(".js"));
assert.equal(
  injected.some((path) => read(path).includes("preserveFocusState")),
  false,
);

const exam = read("injected/chaoxing/exam.js");
assert.equal(exam.includes("answerPage"), false);
assert.equal(exam.includes("answerPaged"), false);
assert.equal(exam.includes("topreview"), false);
assert.equal(exam.includes("showManualReviewPanel"), true);

const quiz = read("injected/chaoxing/course/chapter/tasks/quiz.js");
assert.equal(quiz.includes("resolveQuizPolicy"), true);
assert.equal(quiz.includes("assertSubmitAllowed"), true);
assert.equal(quiz.includes("controller.checkpoint"), true);
assert.equal(quiz.includes("submitBtn.click()"), true);

const interactive = read(
  "injected/chaoxing/course/chapter/tasks/interactive.js",
);
assert.equal(interactive.includes("resolveQuizPolicy"), true);
assert.equal(interactive.includes("assertSubmitAllowed"), true);
assert.equal(interactive.includes("controller.checkpoint"), true);
assert.equal(interactive.includes("submitButton.click()"), true);

for (const name of ["chat.rs", "responses.rs", "gemini.rs"]) {
  const source = read(`src-tauri/src/core/quiz/llm/dispatcher/${name}`);
  assert.equal(source.includes("response.text()"), false, `${name} leaks body`);
  assert.equal(source.includes("原始响应"), false, `${name} leaks raw response`);
}
const dispatcher = read("src-tauri/src/core/quiz/llm/dispatcher.rs");
assert.equal(dispatcher.includes("timeout(REQUEST_TIMEOUT)"), true);
assert.equal(dispatcher.includes("succeeded_batches == 0"), true);

const commands = read("src-tauri/src/commands/config/llm.rs");
assert.equal(commands.includes("ProviderView"), true);
assert.equal(commands.includes("api_key.expose"), true);
assert.equal(commands.includes("clear_key"), true);
const providerView = read("src-tauri/src/config/llm.rs");
assert.equal(providerView.includes("pub has_key: bool"), true);
assert.equal(
  providerView.includes("pub api_key: Option<ApiKey>") &&
    providerView.includes("pub struct ProviderView"),
  true,
);

const lib = read("src-tauri/src/lib.rs");
assert.equal(lib.includes("--disable-background-timer-throttling"), false);
assert.equal(lib.includes("--disable-renderer-backgrounding"), false);

console.log("security static tests: PASS");
