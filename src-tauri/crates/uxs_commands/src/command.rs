pub(super) struct CommandEntry {
    pub(super) module_name: String,
    pub(super) name: String,
    pub(super) cfgs: Vec<String>,
    pub(super) webviews: Vec<WebviewScope>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WebviewScope {
    Chaoxing,
    Mask,
}

impl WebviewScope {
    pub(super) const ALL: [Self; 2] = [Self::Chaoxing, Self::Mask];

    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Chaoxing => "chaoxing",
            Self::Mask => "mask",
        }
    }
}

pub(super) fn expand(
    args: proc_macro::TokenStream,
    input: proc_macro::TokenStream,
) -> proc_macro::TokenStream {
    let parser = syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated;
    let args = match syn::parse::Parser::parse(parser, args) {
        Ok(args) => args,
        Err(error) => return error.into_compile_error().into(),
    };
    if let Err(error) = parse_webview_args(&args) {
        return error.into_compile_error().into();
    }
    let mut function = syn::parse_macro_input!(input as syn::ItemFn);
    let attrs = std::mem::take(&mut function.attrs);

    quote::quote! {
        #(#attrs)*
        #[tauri::command]
        #[specta::specta]
        #function
    }
    .into()
}

pub(super) fn parse_webview_args(
    args: &syn::punctuated::Punctuated<syn::Meta, syn::Token![,]>,
) -> syn::Result<Vec<WebviewScope>> {
    let mut scopes = Vec::new();
    for arg in args {
        let syn::Meta::NameValue(name_value) = arg else {
            return Err(syn::Error::new_spanned(
                arg,
                "expected `webview = \"chaoxing\"` or `webview = \"mask\"`",
            ));
        };
        if !name_value.path.is_ident("webview") {
            return Err(syn::Error::new_spanned(
                &name_value.path,
                "unsupported command option; expected `webview`",
            ));
        }
        let syn::Expr::Lit(expression) = &name_value.value else {
            return Err(syn::Error::new_spanned(
                &name_value.value,
                "webview value must be a string",
            ));
        };
        let syn::Lit::Str(name) = &expression.lit else {
            return Err(syn::Error::new_spanned(
                &expression.lit,
                "webview value must be a string",
            ));
        };
        let scope = match name.value().as_str() {
            "chaoxing" => WebviewScope::Chaoxing,
            "mask" => WebviewScope::Mask,
            _ => {
                return Err(syn::Error::new_spanned(
                    name,
                    "unknown webview permission scope; expected `chaoxing` or `mask`",
                ));
            }
        };
        if !scopes.contains(&scope) {
            scopes.push(scope);
        }
    }
    Ok(scopes)
}

impl CommandEntry {
    pub(super) fn path(&self) -> syn::Path {
        let full_path = format!("crate::commands::{}::{}", self.module_name, self.name);
        syn::parse_str(&full_path).expect("uxs_commands: failed to build command path")
    }

    pub(super) fn cfg_attributes(&self) -> Vec<syn::Attribute> {
        self.cfgs
            .iter()
            .map(|cfg| {
                let source = format!("{cfg}\nfn __uxs_commands_cfg_probe() {{}}\n");
                let file = syn::parse_file(&source)
                    .expect("uxs_commands: failed to restore cfg attribute");
                match file.items.into_iter().next() {
                    Some(syn::Item::Fn(function)) => function
                        .attrs
                        .into_iter()
                        .next()
                        .expect("uxs_commands: missing restored cfg attribute"),
                    _ => panic!("uxs_commands: failed to restore cfg attribute"),
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_webview_args, CommandEntry, WebviewScope};
    use quote::ToTokens;

    fn parse_args(source: &str) -> syn::punctuated::Punctuated<syn::Meta, syn::Token![,]> {
        syn::parse::Parser::parse_str(
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
            source,
        )
        .unwrap()
    }

    #[test]
    fn builds_command_path_from_module_and_name() {
        let command = CommandEntry {
            module_name: "admin::users".to_string(),
            name: "list_users".to_string(),
            cfgs: Vec::new(),
            webviews: Vec::new(),
        };

        assert_eq!(
            command.path().to_token_stream().to_string(),
            "crate :: commands :: admin :: users :: list_users"
        );
    }

    #[test]
    fn restores_cfg_attributes() {
        let command = CommandEntry {
            module_name: "platform".to_string(),
            name: "platform_command".to_string(),
            cfgs: vec!["#[cfg(target_os = \"windows\")]".to_string()],
            webviews: Vec::new(),
        };

        let attributes = command.cfg_attributes();

        assert_eq!(attributes.len(), 1);
        assert!(attributes[0].path().is_ident("cfg"));
    }

    #[test]
    fn parses_and_deduplicates_extra_webview_permissions() {
        let args = parse_args(r#"webview = "chaoxing", webview = "mask", webview = "chaoxing""#);

        assert_eq!(
            parse_webview_args(&args).unwrap(),
            vec![WebviewScope::Chaoxing, WebviewScope::Mask]
        );
    }

    #[test]
    fn rejects_unknown_webview_permission_scopes() {
        let args = parse_args(r#"webview = "other""#);

        assert!(parse_webview_args(&args).is_err());
    }
}
