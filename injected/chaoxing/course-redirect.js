/** @type {Record<string, string>} */
const redirects = {
  "/visit/courses/study": "mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction",
  "/mooc-ans/mycourse/studentcourse":
    "mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu",
  "/mooc-ans/mycourse/studentstudy": "mooc1.chaoxing.com/mycourse/studentstudy",
};

/** 将旧课程地址重定向到对应页面，保留原始查询字符串。 */
export function main() {
  const { location } = window;
  if (location.host !== "mooc1-2.chaoxing.com") return;
  const target = redirects[location.pathname];
  if (!target) return;

  const query = location.href.split("#", 1)[0].match(/\?.*$/)?.[0] ?? "";
  location.replace(`${location.protocol}//${target}${query}`);
}
