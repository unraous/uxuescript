use super::*;

#[tokio::test]
async fn foreground_switches_preserve_masks_and_retain_order_on_native_failure() {
    use crate::app::webview::solvers::BACKGROUND_ORDER;
    let mut order: Vec<_> = ["mask", "chaoxing-mask", "chaoxing", "main"]
        .into_iter()
        .map(|label| Entry {
            label: label.into(),
            layer: 0,
        })
        .collect();
    add_order(&mut order, "deepseek", |_| async { Ok(()) })
        .await
        .unwrap();
    for (label, layer) in BACKGROUND_ORDER {
        update_order(&mut order, label, layer, |_| async { Ok(()) })
            .await
            .unwrap();
    }
    let background = order.clone();
    for _ in 0..2 {
        update_order(
            &mut order,
            "deepseek",
            crate::app::webview::solvers::FOREGROUND_LAYER,
            |anchor| async move {
                assert_eq!(anchor.as_deref(), Some("mask"));
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(
            order
                .iter()
                .map(|entry| entry.label.as_str())
                .collect::<Vec<_>>(),
            ["mask", "deepseek", "chaoxing-mask", "chaoxing", "main"]
        );
    }
    let foreground = order.clone();
    assert!(
        update_order(
            &mut order,
            "deepseek",
            crate::app::webview::solvers::BACKGROUND_LAYER,
            |_| async { anyhow::bail!("native failure") }
        )
        .await
        .is_err()
    );
    assert_eq!(order, foreground);
    for _ in 0..2 {
        update_order(
            &mut order,
            "deepseek",
            crate::app::webview::solvers::BACKGROUND_LAYER,
            |_| async { Ok(()) },
        )
        .await
        .unwrap();
        assert_eq!(order, background);
    }
}

#[tokio::test]
async fn solver_priorities_preserve_static_order_and_retry_failed_native_move() {
    let mut order: Vec<_> = ["mask", "chaoxing-mask", "chaoxing", "main"]
        .into_iter()
        .map(|label| Entry {
            label: label.into(),
            layer: 0,
        })
        .collect();
    add_order(&mut order, "deepseek", |_| async { Ok(()) })
        .await
        .unwrap();
    let mut moved = Vec::new();
    for (label, priority) in crate::app::webview::solvers::BACKGROUND_ORDER {
        let result = update_order(&mut order, label, priority, |anchor| {
            moved.push((label, anchor));
            async { anyhow::bail!("native move failed") }
        })
        .await;
        assert_eq!(result.is_err(), label == "deepseek");
    }
    assert_eq!(moved, [("deepseek", Some("chaoxing".into()))]);
    assert_eq!(order.last().unwrap().label, "deepseek");
    for (label, priority) in crate::app::webview::solvers::BACKGROUND_ORDER {
        update_order(&mut order, label, priority, |_| async { Ok(()) })
            .await
            .unwrap();
    }
    assert_eq!(
        order
            .iter()
            .map(|entry| entry.label.as_str())
            .collect::<Vec<_>>(),
        ["mask", "chaoxing-mask", "chaoxing", "deepseek", "main"]
    );
}

#[tokio::test]
async fn dynamic_entries_move_before_registering_and_keep_static_order() {
    let mut order: Vec<_> = ["mask", "chaoxing-mask", "chaoxing", "main"]
        .into_iter()
        .map(|label| Entry {
            label: label.into(),
            layer: 0,
        })
        .collect();
    let original = order.clone();
    assert!(
        add_order(&mut order, "dynamic", |_| async {
            Err(anyhow::anyhow!("native failure"))
        })
        .await
        .is_err()
    );
    assert_eq!(order, original);
    add_order(&mut order, "dynamic", |anchor| async move {
        assert_eq!(anchor.as_deref(), Some("main"));
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(&order[..4], &original);
    add_order(&mut order, "dynamic", |_| async {
        panic!("duplicate must not move")
    })
    .await
    .unwrap();
    assert_eq!(order.len(), 5);
    update_order(&mut order, "dynamic", 2, |anchor| async move {
        assert_eq!(anchor, None);
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(order[0].label, "dynamic");
    assert_eq!(&order[1..], &original);
    remove_order(&mut order, "dynamic");
    remove_order(&mut order, "dynamic");
    assert_eq!(order, original);
}
