/// 提供基于 URL 结构与域名分类判定及脚本匹配功能的核心模块。
/// 基于结构与域名特征进行归类的 URL 类型枚举。
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Type {
    Course,
    Work,
    Exam,
    CourseOverview,
    Login,
    MainSpace,
    Other,
    Unknown,
}

const EXAM_PATHS: &[&str] = &[
    "/exam-ans/exam/test/reVersionTestStartNew",
    "/mooc-ans/exam/test/reVersionTestStartNew",
    "/exam-ans/mooc2/exam/preview",
    "/mooc-ans/mooc2/exam/preview",
];

/// 判定传入 URL 是否属于超星及其资源域名并返回具体分类类型。
pub fn classify(url: &tauri::Url) -> Type {
    let host = url.host_str().unwrap_or_default();

    if host == "cldisk.com" || host.ends_with(".cldisk.com") {
        return Type::Other;
    }
    if host != "chaoxing.com" && !host.ends_with(".chaoxing.com") {
        return Type::Unknown;
    }

    let sub = host.split('.').next().unwrap_or_default();
    match (sub, url.path()) {
        (_, path) if EXAM_PATHS.contains(&path) => Type::Exam,
        (_, "/mooc-ans/mooc2/work/dowork") => Type::Work,
        ("i", _) => Type::MainSpace,
        ("mooc1", path) if path.starts_with("/mycourse/") => Type::Course,
        ("mooc2-ans", _) => Type::CourseOverview,
        ("passport2", path) if path.starts_with("/login") => Type::Login,
        _ => Type::Other,
    }
}

#[cfg(test)]
#[path = "../../tests/unit/core/url.rs"]
mod tests;
