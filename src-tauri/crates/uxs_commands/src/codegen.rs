mod bindings;
mod handler;

use crate::permissions;
use crate::project::ProjectCommands;
use proc_macro::TokenStream;
use quote::quote;

pub(super) fn expand_registry() -> TokenStream {
    let project = ProjectCommands::collect();
    permissions::sync(&project)
        .unwrap_or_else(|error| panic!("uxs_commands: permission synchronization failed: {error}"));
    let handler = handler::function(&project.commands);
    let bindings = bindings::function(&project.commands, &project.bindings_path);
    let tracked_files = &project.tracked_files;

    quote! {
        #[doc(hidden)]
        mod __uxs_commands_generated {
            #(const _: &[u8] = include_bytes!(#tracked_files);)*
            #handler
            #bindings
        }
    }
    .into()
}
