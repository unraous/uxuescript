use crate::command::CommandEntry;
use crate::permissions;
use crate::project::ProjectCommands;
use proc_macro::TokenStream;
use quote::{quote, ToTokens};

fn command_tokens(commands: &[CommandEntry], root: &syn::Path) -> Vec<impl ToTokens> {
    commands
        .iter()
        .map(|command| {
            let path = command.path_from(root);
            let cfgs = command.cfg_attributes();
            quote! { #(#cfgs)* #path }
        })
        .collect()
}

fn collect_project() -> ProjectCommands {
    let project = ProjectCommands::collect();
    permissions::sync(&project)
        .unwrap_or_else(|error| panic!("uxs_commands: permission synchronization failed: {error}"));
    project
}

pub(super) fn expand_register() -> TokenStream {
    let project = collect_project();
    let tracked_files = &project.tracked_files;
    let commands = command_tokens(&project.commands, &syn::parse_quote!(crate));

    quote! {
        {
            #(const _: &[u8] = include_bytes!(#tracked_files);)*
            tauri::generate_handler![#(#commands),*]
        }
    }
    .into()
}

pub(super) fn expand_sync_bindings(input: TokenStream) -> TokenStream {
    let root = if input.is_empty() {
        syn::parse_quote!(crate)
    } else {
        match syn::parse::<syn::Path>(input) {
            Ok(root) => root,
            Err(error) => return error.into_compile_error().into(),
        }
    };
    let project = collect_project();
    let tracked_files = &project.tracked_files;
    let commands = command_tokens(&project.commands, &root);
    let bindings_path = &project.bindings_path;

    quote! {
        {
            #(const _: &[u8] = include_bytes!(#tracked_files);)*
            tauri_specta::Builder::<tauri::Wry>::new()
                .error_handling(tauri_specta::ErrorHandlingMode::Throw)
                .commands(tauri_specta::collect_commands![#(#commands),*])
                .export(
                    specta_typescript::Typescript::default(),
                    #bindings_path,
                )
                .expect("sync_bindings: failed to export TypeScript bindings");
        }
    }
    .into()
}
