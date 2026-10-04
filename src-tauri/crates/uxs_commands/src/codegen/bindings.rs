use crate::command::CommandEntry;
use quote::{quote, ToTokens};

pub(super) fn function(commands: &[CommandEntry], bindings_path: &str) -> impl ToTokens {
    let commands: Vec<_> = commands
        .iter()
        .map(|command| {
            let path = command.path();
            let cfgs = command.cfg_attributes();
            quote! { #(#cfgs)* #path }
        })
        .collect();

    quote! {
        pub(super) fn sync_bindings() {
            tauri_specta::Builder::<tauri::Wry>::new()
                .error_handling(tauri_specta::ErrorHandlingMode::Throw)
                .commands(tauri_specta::collect_commands![
                    #(#commands),*
                ])
                .export(
                    specta_typescript::Typescript::default(),
                    #bindings_path,
                )
                .expect("sync_bindings: failed to export TypeScript bindings");
        }
    }
}
