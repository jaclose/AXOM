import AppKit
import SwiftUI
import WebKit

@main
struct AXOMWebApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            AXOMWebView()
                .frame(minWidth: 1180, idealWidth: 1360, minHeight: 760, idealHeight: 900)
                .background(Color.black)
        }
        .windowStyle(.hiddenTitleBar)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct AXOMWebView: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.suppressesIncrementalRendering = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        webView.loadAXOM()
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            if url.isFileURL || url.scheme == "about" {
                decisionHandler(.allow)
                return
            }

            if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                NSWorkspace.shared.open(url)
            }
            return nil
        }
    }
}

private extension WKWebView {
    func loadAXOM() {
        guard let resourceURL = Bundle.main.resourceURL else {
            loadHTMLString(errorPage("AXOM resources were not bundled into this app."), baseURL: nil)
            return
        }

        let webRoot = resourceURL.appendingPathComponent("WebApp", isDirectory: true)
        let index = webRoot.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: index.path) {
            loadFileURL(index, allowingReadAccessTo: webRoot)
        } else {
            loadHTMLString(errorPage("Missing WebApp/index.html inside AXOM.app."), baseURL: nil)
        }
    }

    func errorPage(_ message: String) -> String {
        """
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                color: white;
                background: radial-gradient(circle at top left, #292317, transparent 42%), #070707;
                font: 15px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", system-ui, sans-serif;
              }
              main {
                width: min(560px, calc(100vw - 48px));
                padding: 28px;
                border: 1px solid rgba(200,169,106,.24);
                border-radius: 22px;
                background: rgba(255,255,255,.06);
                box-shadow: 0 24px 70px rgba(0,0,0,.5);
              }
              h1 { margin: 0 0 10px; font-size: 24px; }
              p { margin: 0; color: rgba(255,255,255,.65); line-height: 1.5; }
            </style>
          </head>
          <body>
            <main>
              <h1>AXOM could not start</h1>
              <p>\(message)</p>
            </main>
          </body>
        </html>
        """
    }
}
