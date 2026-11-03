import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import TheCourseCover from "@/components/TheCourseCover.vue";

const loadCourseCover = vi.hoisted(() => vi.fn());
vi.mock("@/services/cmds", () => ({ commands: { loadCourseCover } }));

it("loads the cover through the backend and displays the returned image", async () => {
  loadCourseCover.mockResolvedValue("data:image/png;base64,aW1hZ2U=");
  const wrapper = mount(TheCourseCover, {
    props: { coverSrc: "http://p.ananas.chaoxing.com/star3/origin/cover.png" },
  });
  await flushPromises();
  expect(loadCourseCover).toHaveBeenCalledWith(
    "http://p.ananas.chaoxing.com/star3/origin/cover.png",
  );
  expect(wrapper.get(".cover-main").attributes("src")).toBe(
    "data:image/png;base64,aW1hZ2U=",
  );
});
