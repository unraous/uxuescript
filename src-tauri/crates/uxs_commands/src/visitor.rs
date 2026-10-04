use super::command::{parse_webview_args, CommandEntry};
use quote::ToTokens;
use syn::{visit::Visit, ItemFn};

pub(super) struct CommandVisitor {
    pub(super) module_name: String,
    pub(super) commands: Vec<CommandEntry>,
}

impl<'ast> Visit<'ast> for CommandVisitor {
    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        let has_native_tauri_command = node.attrs.iter().any(|attr| {
            let path = attr.path();
            path.segments.len() == 2
                && path.segments[0].ident == "tauri"
                && path.segments[1].ident == "command"
        });
        if has_native_tauri_command {
            panic!("uxs_commands: bare #[tauri::command] is forbidden; use #[uxs_commands::command(...)]");
        }

        let command_attr = node.attrs.iter().find(|attr| {
            let path = attr.path();
            path.segments.len() == 2
                && path.segments[0].ident == "uxs_commands"
                && path.segments[1].ident == "command"
        });

        if let Some(command_attr) = command_attr {
            let webviews = match &command_attr.meta {
                syn::Meta::Path(_) => Vec::new(),
                syn::Meta::List(list) => list
                    .parse_args_with(syn::punctuated::Punctuated::parse_terminated)
                    .and_then(|args| parse_webview_args(&args))
                    .unwrap_or_else(|error| {
                        panic!("uxs_commands: invalid command attribute: {error}")
                    }),
                syn::Meta::NameValue(_) => {
                    panic!("uxs_commands: command attribute must use a list or no arguments")
                }
            };
            let cfgs = node
                .attrs
                .iter()
                .filter(|attr| attr.path().is_ident("cfg"))
                .map(|attr| attr.to_token_stream().to_string())
                .collect();

            self.commands.push(CommandEntry {
                module_name: self.module_name.clone(),
                name: node.sig.ident.to_string(),
                cfgs,
                webviews,
            });
        }

        syn::visit::visit_item_fn(self, node);
    }
}

#[cfg(test)]
mod tests {
    use super::CommandVisitor;
    use crate::command::WebviewScope;
    use quote::ToTokens;
    use syn::visit::Visit;

    fn collect_commands(module_name: &str, source: &str) -> Vec<String> {
        let syntax_tree = syn::parse_file(source).expect("failed to parse test source");
        let mut visitor = CommandVisitor {
            module_name: module_name.to_string(),
            commands: Vec::new(),
        };
        visitor.visit_file(&syntax_tree);
        visitor
            .commands
            .iter()
            .map(|command| command.path().to_token_stream().to_string())
            .collect()
    }

    #[test]
    fn detects_tauri_command() {
        let source = r#"
            #[uxs_commands::command]
            pub fn hello() -> String { "hello".to_string() }
        "#;

        assert_eq!(
            collect_commands("greeter", source),
            vec!["crate :: commands :: greeter :: hello"]
        );
    }

    #[test]
    fn skips_plain_functions() {
        let source = r#"
            pub fn not_a_command() -> i32 { 42 }
            fn private_helper() {}
        "#;

        assert!(collect_commands("utils", source).is_empty());
    }

    #[test]
    fn collects_multiple_commands() {
        let source = r#"
            #[uxs_commands::command]
            pub fn foo() {}
            pub fn bar() {}
            #[uxs_commands::command]
            pub fn baz() -> bool { true }
        "#;
        let commands = collect_commands("multi", source);

        assert_eq!(commands.len(), 2);
        assert!(commands[0].contains("foo"));
        assert!(commands[1].contains("baz"));
    }

    #[test]
    fn ignores_other_attributes() {
        let source = r#"
            #[derive(Debug)]
            pub struct Foo;
            #[inline]
            pub fn inlined() {}
            #[allow(dead_code)]
            fn suppressed() {}
        "#;

        assert!(collect_commands("attrs", source).is_empty());
    }

    #[test]
    fn rejects_bare_command_attribute() {
        let source = r#"
            #[command]
            pub fn sneaky() {}
        "#;

        assert!(collect_commands("edge", source).is_empty());
    }

    #[test]
    fn supports_nested_module_paths() {
        let source = r#"
            #[uxs_commands::command]
            pub fn list_users() {}
        "#;

        assert_eq!(
            collect_commands("admin::users", source),
            vec!["crate :: commands :: admin :: users :: list_users"]
        );
    }

    #[test]
    fn module_name_appears_in_path() {
        let source = r#"
            #[uxs_commands::command]
            pub fn action() {}
        "#;
        let commands = collect_commands("my_module", source);

        assert_eq!(commands.len(), 1);
        assert!(commands[0].contains("my_module"));
    }

    #[test]
    fn collects_webview_permissions_and_multiple_cfg_attributes() {
        let source = r#"
            #[cfg(target_os = "windows")]
            #[cfg(feature = "desktop")]
            #[uxs_commands::command(webview = "chaoxing", webview = "mask")]
            pub fn platform_command() {}
        "#;
        let syntax_tree = syn::parse_file(source).expect("failed to parse test source");
        let mut visitor = CommandVisitor {
            module_name: "platform".to_string(),
            commands: Vec::new(),
        };
        visitor.visit_file(&syntax_tree);

        assert_eq!(visitor.commands.len(), 1);
        assert_eq!(
            visitor.commands[0].webviews,
            vec![WebviewScope::Chaoxing, WebviewScope::Mask]
        );
        assert_eq!(visitor.commands[0].cfgs.len(), 2);
    }

    #[test]
    #[should_panic(expected = "bare #[tauri::command] is forbidden")]
    fn rejects_native_tauri_command_attributes() {
        let source = r#"
            #[tauri::command]
            pub fn unregistered_command() {}
        "#;

        collect_commands("commands", source);
    }
}
