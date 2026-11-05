use super::*;
use serde_json::json;

#[test]
fn task_resume_is_one_use_and_clear_discards_all_state() {
    let session = TaskSession::default();
    {
        let mut state = session.0.lock();
        state.course_active = true;
        state.resume = true;
        state.return_trip = Some((
            "https://mooc1.chaoxing.com/mycourse/".parse().unwrap(),
            "https://k.chaoxing.com/sg6356".parse().unwrap(),
        ));
        state.completed_task = Some("https://k.chaoxing.com/sg6356".parse().unwrap());
        state.exam = Some(("exam".into(), exam_state()));
    }
    assert!(session.resume_course());
    assert!(!session.resume_course());
    session.0.lock().resume = true;
    session.clear();
    let state = session.0.lock();
    assert!(!state.resume);
    assert!(state.return_trip.is_none());
    assert!(state.completed_task.is_none());
    assert!(state.exam.is_none());
    assert!(!state.course_active);
}

fn exam_state() -> ExamRun {
    serde_json::from_value(json!({
            "phase": "collect", "index": 0, "config": {"switchingCd": null},
            "entries": [{"id": "q1", "start": 0}], "answers": [],
            "pages": [{"font": [0, 128, 255], "context": {}, "entries": [
                {"type": "question", "data": {
                    "id": "1", "kind": "单选题", "stem": "[图片1]", "options": [],
                    "images": [{"marker": "图片1", "url": "https://p.cldisk.com/1.png"}]
                }}
            ]}]
    }))
    .unwrap()
}

#[test]
fn exam_state_round_trip_preserves_question_images_and_font() {
    let value = serde_json::to_value(exam_state()).unwrap();
    assert_eq!(value["pages"][0]["font"], json!([0, 128, 255]));
    assert_eq!(
        value["pages"][0]["entries"][0]["data"]["images"][0]["url"],
        "https://p.cldisk.com/1.png"
    );
}
