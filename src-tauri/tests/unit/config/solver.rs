use crate::config::solver::SolverKind;

fn assert_solver_traits<T: Copy + Clone + Eq + specta::Type>() {}

#[test]
fn solver_kind_defaults_to_native_llm() {
    assert_solver_traits::<SolverKind>();
    assert_eq!(SolverKind::default(), SolverKind::NativeLlm);
}

#[test]
fn solver_kind_uses_stable_snake_case_values() {
    for (kind, value) in [
        (SolverKind::NativeLlm, "native_llm"),
        (SolverKind::DeepSeekWeb, "deep_seek_web"),
    ] {
        let serialized = serde_json::to_string(&kind).unwrap();
        assert_eq!(serialized, format!("\"{value}\""));
        assert_eq!(
            serde_json::from_str::<SolverKind>(&serialized).unwrap(),
            kind
        );
    }
}
