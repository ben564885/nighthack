// smart breadboard notch: a transparent, click-through window pinned to the top
// center of the screen. it loads the notch page, sized to the real hardware notch,
// so it looks like part of the machine and grows downward like the dynamic island.
import Cocoa
import WebKit

final class Overlay: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var window: NSPanel!
    var web: WKWebView!
    let base: String
    var inside = false
    var pageOpen = false                         // the page reports it, see userContentController
    var notch = NSSize(width: 200, height: 34)   // hardware notch size, set in layout()
    var tracker: Timer?

    init(base: String) { self.base = base }

    func applicationDidFinishLaunching(_ n: Notification) {
        window = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .screenSaver              // above the menu bar
        window.ignoresMouseEvents = true         // never steals a click
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "notch")
        web = WKWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        window.contentView = web

        NotificationCenter.default.addObserver(self, selector: #selector(layout),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
        layout()
        window.orderFrontRegardless()

        // the window is click-through, so it gets no mouse events. poll the pointer
        // (no permission needed) and tell the page when it enters or leaves the notch area.
        tracker = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in self?.trackMouse() }
    }

    /// the page posts {open: bool} whenever it opens or closes
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any], let open = body["open"] as? Bool { pageOpen = open }
    }

    func trackMouse() {
        let f = window.frame
        // closed: only the notch itself wakes it (hover to peek). open: the whole panel.
        let area = pageOpen
            ? NSRect(x: f.midX - 230, y: f.maxY - 330, width: 460, height: 330)
            : NSRect(x: f.midX - notch.width / 2 - 10, y: f.maxY - notch.height - 4, width: notch.width + 20, height: notch.height + 4)
        let now = area.contains(NSEvent.mouseLocation)
        if now != inside {
            inside = now
            web.evaluateJavaScript("window.notchHover && window.notchHover(\(now))", completionHandler: nil)
        }
    }

    /// the built-in screen is the one with a camera housing. fall back to the main screen.
    func targetScreen() -> NSScreen {
        NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main ?? NSScreen.screens[0]
    }

    @objc func layout() {
        let screen = targetScreen()
        let f = screen.frame
        let nh = screen.safeAreaInsets.top
        var nw: CGFloat = 0
        if nh > 0, let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea {
            nw = f.width - l.width - r.width
        }
        if nh == 0 { nw = 0 }                    // no notch: the page draws its own small pill
        notch = nw > 0 ? NSSize(width: nw, height: nh) : NSSize(width: 188, height: 34)

        let width: CGFloat = 520, height: CGFloat = 360
        window.setFrame(NSRect(x: f.midX - width / 2, y: f.maxY - height, width: width, height: height), display: true)

        var q = "native=1&overlay=1"
        if nw > 0 { q += "&nw=\(Int(nw.rounded()))&nh=\(Int(nh.rounded()))" }
        let key = ProcessInfo.processInfo.environment["HUB_TOKEN"] ?? Bundle.main.object(forInfoDictionaryKey: "HubToken") as? String
        if let key, !key.isEmpty { q += "&key=\(key)" }
        if let url = URL(string: "\(base)/notch?\(q)") { web.load(URLRequest(url: url)) }
    }
}

let arg = CommandLine.arguments.dropFirst().first
let plist = Bundle.main.object(forInfoDictionaryKey: "NotchURL") as? String
var base = arg ?? ProcessInfo.processInfo.environment["NOTCH_URL"] ?? plist ?? "http://localhost:3000"
if base.hasSuffix("/") { base.removeLast() }

let app = NSApplication.shared
app.setActivationPolicy(.accessory)              // no dock icon, no menu
let delegate = Overlay(base: base)
app.delegate = delegate
app.run()
