use crate::command::CommandEntry;
use quote::{quote, ToTokens};

pub(super) fn function(commands: &[CommandEntry]) -> impl ToTokens {
    let commands: Vec<_> = commands
        .iter()
        .map(|command| {
            let path = command.path();
            let cfgs = command.cfg_attributes();
            quote! { #(#cfgs)* #path }
        })
        .collect();

    quote! {
        pub(super) fn handler(
        ) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![
                #(#commands),*
            ]
        }
    }
}
