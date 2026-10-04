extern crate proc_macro;

mod codegen;
mod command;
mod permissions;
mod project;
mod source;
mod visitor;

use proc_macro::TokenStream;

#[proc_macro_attribute]
/// Marks a function as both a Tauri command and a Specta binding.
///
/// Commands are available to the main WebView by default. Add
/// `webview = "chaoxing"` or `webview = "mask"` to include the command in that
/// WebView's generated permission allowlist. Repeat `webview` to add more than
/// one extra WebView.
pub fn command(args: TokenStream, input: TokenStream) -> TokenStream {
    command::expand(args, input)
}

#[proc_macro]
pub fn collect_commands(_: TokenStream) -> TokenStream {
    codegen::expand_registry()
}
