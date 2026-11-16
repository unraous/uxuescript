fn main() {
    println!("cargo:rerun-if-changed=../dist/scripts");
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri 只给实际 bin 链入含 v6 清单的 resource.lib；库单元测试需由 rustc 自动嵌入。
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
        // 后发参数仅关闭 bin 的自动清单，保留 resource.lib 原清单并避免重复资源。
        println!("cargo:rustc-link-arg-bins=/MANIFEST:NO");
    }
}
