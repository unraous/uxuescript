import assert from "node:assert/strict";
import {
  AutomationStopped,
  ManualReviewRequired,
  TaskState,
  TaskStopped,
  assertSubmitAllowed,
  classifyTaskPolicy,
  controller,
  resolveQuizPolicy,
} from "../../injected/chaoxing/safety.js";

const doc = (text) => ({ body: { innerText: text } });

assert.equal(classifyTaskPolicy("Video"), "LEARNING");
assert.equal(classifyTaskPolicy("Audio"), "LEARNING");
assert.equal(classifyTaskPolicy("PDF"), "LEARNING");
assert.equal(classifyTaskPolicy("Quiz"), "NEEDS_CONFIRMATION");
assert.equal(classifyTaskPolicy("Other"), "RESTRICTED");
assert.equal(classifyTaskPolicy("Exam"), "RESTRICTED");

const graded = await resolveQuizPolicy(
  doc("期末考试 计分 90%"),
  "章节测验",
  () => {
    throw new Error("graded page must not prompt for fill");
  },
);
assert.equal(graded.kind, "GRADED");
assert.equal(graded.allowFill, false);
assert.equal(graded.allowSubmit, false);

const restricted = await resolveQuizPolicy(
  doc("禁止自动化 restricted"),
  "章节测验",
  () => false,
);
assert.equal(restricted.kind, "RESTRICTED");
assert.equal(restricted.allowFill, false);

const contradictory = await resolveQuizPolicy(
  doc("非计分考试"),
  "章节测验",
  () => {
    throw new Error("contradictory exam page must not prompt");
  },
);
assert.equal(contradictory.kind, "GRADED");
assert.equal(contradictory.allowFill, false);

let prompts = 0;
const onlyFill = await resolveQuizPolicy(doc("普通练习"), "章节测验", () => {
  prompts += 1;
  return prompts === 1;
});
assert.equal(onlyFill.kind, "UNGRADED");
assert.equal(onlyFill.allowFill, true);
assert.equal(onlyFill.allowSubmit, false);

prompts = 0;
const practice = await resolveQuizPolicy(doc("非计分练习"), "视频互动题", () => {
  prompts += 1;
  return true;
});
assert.equal(practice.kind, "PRACTICE");
assert.equal(practice.allowFill, true);
assert.equal(practice.allowSubmit, true);

const noFill = await resolveQuizPolicy(doc("普通练习"), "章节测验", () => false);
assert.equal(noFill.kind, "NEEDS_CONFIRMATION");
assert.equal(noFill.allowFill, false);

assert.throws(() => assertSubmitAllowed(onlyFill), ManualReviewRequired);
assert.throws(() => assertSubmitAllowed(onlyFill), AutomationStopped);
assert.doesNotThrow(() => assertSubmitAllowed(practice));

controller.state = TaskState.IDLE;
controller.start();
assert.equal(controller.state, TaskState.RUNNING);
controller.pause();
assert.equal(controller.state, TaskState.PAUSED);
let resumed = false;
const checkpoint = controller.checkpoint().then(() => {
  resumed = true;
});
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(resumed, false);
controller.resume();
await checkpoint;
assert.equal(resumed, true);
controller.stop();
assert.equal(controller.state, TaskState.STOPPED);
await assert.rejects(() => controller.checkpoint(), TaskStopped);

console.log("safety tests: PASS");
