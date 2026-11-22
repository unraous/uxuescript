use super::*;

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
