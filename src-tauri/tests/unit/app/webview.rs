use super::*;

#[test]
fn course_views_share_creation_and_resize_geometry() {
    for size in [
        LogicalSize::new(1920.0, 1080.0),
        LogicalSize::new(800.0, 600.0),
    ] {
        let expected = (
            LogicalPosition::new(size.width * 0.51, size.height * 0.46),
            LogicalSize::new(size.width * 0.48, size.height * 0.48),
        );
        for label in ["chaoxing", "chaoxing-mask", "deepseek"] {
            assert_eq!(placement(label, size), expected);
        }
    }
}

#[test]
fn selects_home_url_by_version() {
    assert_eq!(select_home_url(false).as_str(), "https://i.chaoxing.com/");
    assert_eq!(
        select_home_url(true).as_str(),
        "https://i.mooc.chaoxing.com/"
    );
}

fn url(value: &str) -> Url {
    value.parse().expect("test URL should be valid")
}

#[test]
fn allows_only_the_deepseek_chat_host() {
    assert!(is_deepseek_url(&url("https://chat.deepseek.com/")));
    assert!(is_deepseek_url(&url(
        "https://chat.deepseek.com/a/chat/session?from=home#messages"
    )));
    assert!(!is_deepseek_url(&url("https://auth.chat.deepseek.com/")));
    assert!(!is_deepseek_url(&url(
        "https://chat.deepseek.com.example.org/"
    )));
    assert!(!is_deepseek_url(&url("https://example.org/")));
    assert!(!is_deepseek_url(&url("about:blank")));
}

#[test]
fn ignores_blank_and_duplicate_current_urls() {
    let stack = UrlStack::default();

    stack.push(url("about:blank"));
    assert_eq!(stack.current(), None);

    let home = url("https://example.com/home");
    stack.push(home.clone());
    stack.push(home.clone());

    assert_eq!(stack.current(), Some(home));
    assert!(!stack.can_back());
    assert!(!stack.can_forward());
}

#[test]
fn navigates_back_and_forward_without_leaving_history_bounds() {
    let stack = UrlStack::default();
    let home = url("https://example.com/home");
    let course = url("https://example.com/course");
    let task = url("https://example.com/task");

    stack.push(home.clone());
    stack.push(course.clone());
    stack.push(task.clone());

    assert!(stack.can_back());
    assert_eq!(stack.back(), Some(course.clone()));
    assert_eq!(stack.back(), Some(home.clone()));
    assert_eq!(stack.back(), None);
    assert_eq!(stack.current(), Some(home));

    assert_eq!(stack.forward(), Some(course));
    assert_eq!(stack.forward(), Some(task));
    assert_eq!(stack.forward(), None);
}

#[test]
fn pushing_after_back_discards_forward_history() {
    let stack = UrlStack::default();
    let home = url("https://example.com/home");
    let course = url("https://example.com/course");
    let task = url("https://example.com/task");

    stack.push(home.clone());
    stack.push(course.clone());
    stack.push(url("https://example.com/old-task"));
    assert_eq!(stack.back(), Some(course.clone()));

    stack.push(task.clone());

    assert_eq!(stack.current(), Some(task));
    assert!(!stack.can_forward());
    assert_eq!(stack.back(), Some(course));
    assert_eq!(stack.back(), Some(home));
}
