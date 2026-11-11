import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import script from "../../dist/scripts/embedded/course-redirect.js?raw";

/** @param {string} address */
function run(address) {
  const url = new URL(address);
  const replace = vi.fn();
  const top = { location: { replace: vi.fn() } };
  runInNewContext(script, {
    window: {
      location: {
        host: url.host,
        pathname: url.pathname,
        protocol: url.protocol,
        href: url.href,
        replace,
      },
      top,
    },
  });
  return { replace, top };
}

describe("course redirects", () => {
  it.each([
    [
      "/visit/courses/study",
      "mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction",
    ],
    [
      "/mooc-ans/mycourse/studentcourse",
      "mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu",
    ],
    [
      "/mooc-ans/mycourse/studentstudy",
      "mooc1.chaoxing.com/mycourse/studentstudy",
    ],
  ])(
    "redirects %s in its own frame, preserving the original query",
    (path, target) => {
      const query = "?a=%2f%2F&a=1+2&empty=&flag";
      const { replace, top } = run(
        `https://mooc1-2.chaoxing.com${path}${query}#fragment`,
      );
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        `https://${target}${query}`,
      );
      expect(top.location.replace).not.toHaveBeenCalled();
    },
  );

  it("preserves the protocol and an empty query", () => {
    const { replace } = run("http://mooc1-2.chaoxing.com/visit/courses/study?");
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "http://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction?",
    );
  });

  it.each([
    "https://mooc1.chaoxing.com/visit/courses/study?a=1",
    "https://mooc1-2.chaoxing.com:8443/visit/courses/study",
    "https://mooc1-2.chaoxing.com/visit/courses/study/",
    "https://mooc1-2.chaoxing.com/visit/courses/study-extra",
    "https://mooc1-2.chaoxing.com/other#?a=1",
  ])("does not redirect an unmatched URL: %s", (address) => {
    expect(run(address).replace).not.toHaveBeenCalled();
  });
});
