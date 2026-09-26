//! Native JavaScript dialogs for the macOS web view.
//!
//! wry's `WKUIDelegate` implements the file picker but not the JavaScript
//! panel methods, and WebKit answers an unimplemented panel immediately:
//! `confirm()` returns `false`, `prompt()` returns `null`, `alert()` shows
//! nothing. Every confirmation in AXOM (restore a backup, merge, delete, reset)
//! therefore cancelled itself silently in the desktop app. This module adds the
//! three panel methods to wry's delegate class at startup and shows real
//! `NSAlert`s, so the web code keeps using the standard browser APIs.

#[cfg(target_os = "macos")]
mod macos {
    use block2::Block;
    use objc2::ffi::class_addMethod;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    use std::ffi::CStr;

    /// `NSAlertFirstButtonReturn`.
    const FIRST_BUTTON: isize = 1000;
    const TITLE: &str = "AXOM";

    fn text(value: &str) -> Retained<NSString> {
        NSString::from_str(value)
    }

    /// A modal alert with the page's message; the first button is the default
    /// (Return) and a button titled "Cancel" answers Escape.
    unsafe fn run_alert(
        message: &NSString,
        buttons: &[&str],
        accessory: Option<&AnyObject>,
    ) -> bool {
        let alert: Retained<AnyObject> = msg_send![class!(NSAlert), new];
        let _: () = msg_send![&*alert, setMessageText: &*text(TITLE)];
        let _: () = msg_send![&*alert, setInformativeText: message];
        for title in buttons {
            let _: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*text(title)];
        }
        if let Some(view) = accessory {
            let _: () = msg_send![&*alert, setAccessoryView: view];
            let window: *mut AnyObject = msg_send![&*alert, window];
            if !window.is_null() {
                let _: Bool = msg_send![window, makeFirstResponder: view];
            }
        }
        let response: isize = msg_send![&*alert, runModal];
        response == FIRST_BUTTON
    }

    unsafe extern "C-unwind" fn run_alert_panel(
        _this: &AnyObject,
        _cmd: Sel,
        _webview: &AnyObject,
        message: &NSString,
        _frame: &AnyObject,
        handler: &Block<dyn Fn()>,
    ) {
        run_alert(message, &["OK"], None);
        handler.call(());
    }

    unsafe extern "C-unwind" fn run_confirm_panel(
        _this: &AnyObject,
        _cmd: Sel,
        _webview: &AnyObject,
        message: &NSString,
        _frame: &AnyObject,
        handler: &Block<dyn Fn(Bool)>,
    ) {
        let confirmed = run_alert(message, &["OK", "Cancel"], None);
        handler.call((Bool::new(confirmed),));
    }

    unsafe extern "C-unwind" fn run_prompt_panel(
        _this: &AnyObject,
        _cmd: Sel,
        _webview: &AnyObject,
        prompt: &NSString,
        default_text: *mut NSString,
        _frame: &AnyObject,
        handler: &Block<dyn Fn(*mut NSString)>,
    ) {
        let initial = if default_text.is_null() {
            text("")
        } else {
            Retained::retain(default_text).unwrap_or_else(|| text(""))
        };
        let field: Retained<AnyObject> =
            msg_send![class!(NSTextField), textFieldWithString: &*initial];
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(320.0, 24.0));
        let _: () = msg_send![&*field, setFrame: frame];
        if run_alert(prompt, &["OK", "Cancel"], Some(&field)) {
            let value: Retained<NSString> = msg_send![&*field, stringValue];
            // WebKit copies the string before the handler returns.
            handler.call((Retained::as_ptr(&value) as *mut NSString,));
        } else {
            handler.call((std::ptr::null_mut(),));
        }
    }

    type AlertPanel = unsafe extern "C-unwind" fn(
        &AnyObject,
        Sel,
        &AnyObject,
        &NSString,
        &AnyObject,
        &Block<dyn Fn()>,
    );
    type ConfirmPanel = unsafe extern "C-unwind" fn(
        &AnyObject,
        Sel,
        &AnyObject,
        &NSString,
        &AnyObject,
        &Block<dyn Fn(Bool)>,
    );
    type PromptPanel = unsafe extern "C-unwind" fn(
        &AnyObject,
        Sel,
        &AnyObject,
        &NSString,
        *mut NSString,
        &AnyObject,
        &Block<dyn Fn(*mut NSString)>,
    );

    /// Adds a method only when the class does not already answer it (a future
    /// wry release may implement these panels itself).
    unsafe fn add(class: &AnyClass, selector: Sel, imp: Imp, types: &CStr) -> bool {
        let responds: bool = msg_send![class, instancesRespondToSelector: selector];
        if responds {
            return false;
        }
        class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            selector,
            imp,
            types.as_ptr(),
        )
        .as_bool()
    }

    /// `webview` is the `WKWebView`. WebKit reads which panel methods a UI
    /// delegate implements when the delegate is assigned, so the delegate is
    /// reassigned after the methods are added.
    pub unsafe fn install(webview: *mut AnyObject) {
        if webview.is_null() {
            return;
        }
        let delegate: *mut AnyObject = msg_send![webview, UIDelegate];
        if delegate.is_null() {
            return;
        }
        let class = (*delegate).class();
        let mut added = false;
        added |= add(
            class,
            sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<AlertPanel, Imp>(run_alert_panel),
            c"v@:@@@@?",
        );
        added |= add(
            class,
            sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<ConfirmPanel, Imp>(run_confirm_panel),
            c"v@:@@@@?",
        );
        added |= add(
            class,
            sel!(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:),
            std::mem::transmute::<PromptPanel, Imp>(run_prompt_panel),
            c"v@:@@@@@?",
        );
        if added {
            let _: () = msg_send![webview, setUIDelegate: std::ptr::null::<AnyObject>()];
            let _: () = msg_send![webview, setUIDelegate: delegate];
        }
    }

    /// Whether the delegate now answers the confirm panel — used by the smoke check.
    pub unsafe fn installed(webview: *mut AnyObject) -> bool {
        if webview.is_null() {
            return false;
        }
        let delegate: *mut AnyObject = msg_send![webview, UIDelegate];
        if delegate.is_null() {
            return false;
        }
        let responds: bool = msg_send![delegate, respondsToSelector: sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:)];
        responds
    }
}

/// Install native `alert`/`confirm`/`prompt` panels on a webview window. No-op
/// on other platforms, where the system web views already provide them.
pub fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let result = window.with_webview(|webview| unsafe {
            let wk = webview.inner() as *mut objc2::runtime::AnyObject;
            macos::install(wk);
            if !macos::installed(wk) {
                eprintln!("AXOM: native JavaScript dialogs could not be installed; confirmations will be cancelled.");
            }
        });
        if let Err(error) = result {
            eprintln!("AXOM: could not reach the web view to install JavaScript dialogs: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}
