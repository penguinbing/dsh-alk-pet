import AppKit
import Foundation

final class PetView: NSView {
    static let defaultCounts = ["idle": 121, "thinking": 121, "working": 121, "waiting": 121, "success": 121, "error": 59]
    var state = "idle" { didSet { if oldValue != state { animationState = state; frameNumber = 1; needsDisplay = true } } }
    var animationState = "idle"
    var frameNumber = 1
    var reducedMotion = false
    var counts = PetView.defaultCounts
    let images = NSCache<NSString, NSImage>()
    let assets = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        images.countLimit = 160
        images.totalCostLimit = 64 * 1024 * 1024
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        images.countLimit = 160
        images.totalCostLimit = 64 * 1024 * 1024
    }

    /// Host supplied clips override the legacy defaults per state.
    func applyClips(_ clips: [String: Int]) {
        var next = counts
        for (key, value) in clips where PetView.defaultCounts[key] != nil {
            if value > 0 { next[key] = min(value, 10_000) }
        }
        counts = next
    }

    func advance() {
        guard !reducedMotion else { return }
        let count = counts[animationState] ?? 1
        if frameNumber < count { frameNumber += 1 }
        else { frameNumber = 1; if animationState == "success" || animationState == "error" { animationState = "idle" } }
        needsDisplay = true
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let key = "\(animationState)/\(String(format: "%03d", reducedMotion ? 1 : frameNumber))" as NSString
        let image = images.object(forKey: key) ?? NSImage(contentsOfFile: "\(assets)/\(key).png")
        if let image {
            let representation = image.representations.first
            let pixelsWide = representation?.pixelsWide ?? Int(image.size.width * 2)
            let pixelsHigh = representation?.pixelsHigh ?? Int(image.size.height * 2)
            images.setObject(image, forKey: key, cost: max(1, pixelsWide * pixelsHigh * 4))
            image.draw(in: NSRect(x: 0, y: 0, width: bounds.width, height: bounds.width * 344 / 412))
            return
        }
        let colors: [String: NSColor] = [
            "idle": .systemBlue, "thinking": .systemPurple, "working": .systemTeal,
            "waiting": .systemOrange, "success": .systemGreen, "error": .systemRed
        ]
        let color = colors[state] ?? .systemBlue
        let body = NSBezierPath()
        body.move(to: NSPoint(x: 34, y: 59))
        body.curve(to: NSPoint(x: 58, y: 42), controlPoint1: NSPoint(x: 38, y: 28), controlPoint2: NSPoint(x: 52, y: 37))
        body.curve(to: NSPoint(x: 89, y: 58), controlPoint1: NSPoint(x: 79, y: 27), controlPoint2: NSPoint(x: 88, y: 34))
        body.curve(to: NSPoint(x: 99, y: 99), controlPoint1: NSPoint(x: 106, y: 73), controlPoint2: NSPoint(x: 103, y: 87))
        body.curve(to: NSPoint(x: 62, y: 129), controlPoint1: NSPoint(x: 94, y: 119), controlPoint2: NSPoint(x: 78, y: 129))
        body.curve(to: NSPoint(x: 22, y: 99), controlPoint1: NSPoint(x: 40, y: 129), controlPoint2: NSPoint(x: 27, y: 119))
        body.curve(to: NSPoint(x: 34, y: 59), controlPoint1: NSPoint(x: 17, y: 83), controlPoint2: NSPoint(x: 22, y: 67))
        body.close()
        color.blended(withFraction: 0.44, of: .white)?.setFill()
        body.fill()
        NSColor(calibratedRed: 0.19, green: 0.24, blue: 0.39, alpha: 1).setStroke()
        body.lineWidth = 3
        body.stroke()
        let eyeHeight: CGFloat = state == "success" ? 3 : 12
        NSColor(calibratedRed: 0.14, green: 0.20, blue: 0.31, alpha: 1).setFill()
        for x in [43.0, 77.0] {
            NSBezierPath(ovalIn: NSRect(x: x, y: 83, width: 8, height: eyeHeight)).fill()
        }
        NSColor(calibratedRed: 1, green: 0.53, blue: 0.65, alpha: 0.7).setFill()
        for x in [29.0, 84.0] {
            NSBezierPath(ovalIn: NSRect(x: x, y: 103, width: 12, height: 6)).fill()
        }
        let mouth = NSBezierPath()
        mouth.move(to: NSPoint(x: 54, y: state == "error" ? 114 : 109))
        mouth.curve(to: NSPoint(x: 69, y: state == "error" ? 114 : 109), controlPoint1: NSPoint(x: 60, y: state == "error" ? 106 : 118), controlPoint2: NSPoint(x: 65, y: state == "error" ? 106 : 118))
        mouth.lineWidth = 2.5
        mouth.lineCapStyle = .round
        NSColor(calibratedRed: 0.14, green: 0.20, blue: 0.31, alpha: 1).setStroke()
        mouth.stroke()
    }
}

final class DragPanel: NSPanel {
    private var startMouse: NSPoint?
    private var startOrigin: NSPoint?
    override func mouseDown(with event: NSEvent) {
        startMouse = NSEvent.mouseLocation
        startOrigin = frame.origin
    }
    override func mouseDragged(with event: NSEvent) {
        guard let startMouse, let startOrigin else { return }
        let now = NSEvent.mouseLocation
        setFrameOrigin(NSPoint(x: startOrigin.x + now.x - startMouse.x, y: startOrigin.y + now.y - startMouse.y))
    }
    override func mouseUp(with event: NSEvent) {
        UserDefaults.standard.set(NSStringFromPoint(frame.origin), forKey: "dsh-alk-pet.origin")
        startMouse = nil
        startOrigin = nil
    }
}

final class HoverButton: NSButton {
    var onHover: (() -> Void)?
    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        guard NSEvent.pressedMouseButtons == 0 else { return }
        onHover?()
    }
}

final class HoverView: NSView {
    var onHover: ((Bool) -> Void)?
    private var area: NSTrackingArea?
    private var hovering = false

    override func updateTrackingAreas() {
        if let area { removeTrackingArea(area) }
        let next = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(next)
        area = next
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) { setHover(true) }
    override func mouseExited(with event: NSEvent) { setHover(false) }

    func setHover(_ value: Bool) {
        guard hovering != value else { return }
        hovering = value
        onHover?(value)
    }
}

final class PetController: NSObject, NSApplicationDelegate {
    let panel: DragPanel
    let pet = PetView(frame: NSRect(x: 4, y: 0, width: 152, height: 140))
    let bubble = NSVisualEffectView(frame: NSRect(x: 0, y: 148, width: 160, height: 40))
    let title = NSTextField(labelWithString: "")
    let detail = NSTextField(labelWithString: "")
    let statusDot = NSView(frame: .zero)
    let switcher = HoverView(frame: .zero)
    var taskButtons: [NSButton] = []
    var tasks: [[String: Any]] = []
    var selectedTaskId = ""
    var switcherHovering = false
    let base = NSView(frame: NSRect(x: 0, y: 0, width: 160, height: 140))
    var size: CGFloat = 120
    var showBubble = true
    var viewed = false
    var detailValue = ""
    var titleValue = "待机中"
    var statusValue = "待机中"
    var frameMs: Double = 83
    private var frameTimer: Timer?
    private var snapshotTint: NSView?
    private var snapshotScheduled = false
    private let snapshotPath: String? = {
        guard let raw = ProcessInfo.processInfo.environment["DSH_ALK_PET_SNAPSHOT"], !raw.isEmpty else { return nil }
        return raw
    }()

    override init() {
        let saved = UserDefaults.standard.string(forKey: "dsh-alk-pet.origin")
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let origin = saved.map(NSPointFromString) ?? NSPoint(x: screen.maxX - 180, y: screen.minY + 22)
        panel = DragPanel(contentRect: NSRect(origin: origin, size: NSSize(width: 160, height: 140)), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        panel.isOpaque = false
        panel.acceptsMouseMovedEvents = true
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isMovableByWindowBackground = true
        panel.contentView = base
        bubble.material = .hudWindow
        bubble.blendingMode = .behindWindow
        bubble.state = .active
        bubble.appearance = NSAppearance(named: .darkAqua)
        bubble.wantsLayer = true
        bubble.layer?.cornerRadius = 23
        bubble.layer?.masksToBounds = true
        bubble.layer?.borderWidth = 1
        bubble.layer?.borderColor = NSColor.white.withAlphaComponent(0.22).cgColor
        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 3
        title.font = .systemFont(ofSize: 12.5, weight: .semibold)
        title.textColor = .white
        title.maximumNumberOfLines = 1
        title.lineBreakMode = .byTruncatingTail
        detail.font = .systemFont(ofSize: 11.5, weight: .regular)
        detail.textColor = NSColor.white.withAlphaComponent(0.72)
        detail.maximumNumberOfLines = 1
        detail.lineBreakMode = .byTruncatingTail
        bubble.addSubview(statusDot)
        bubble.addSubview(title)
        bubble.addSubview(detail)
        if snapshotPath != nil {
            // NSVisualEffectView blur is not captured by cacheDisplay; snapshot-only tint.
            let tint = NSView(frame: bubble.bounds)
            tint.wantsLayer = true
            tint.layer?.backgroundColor = NSColor(calibratedRed: 0.145, green: 0.173, blue: 0.224, alpha: 0.92).cgColor
            bubble.addSubview(tint, positioned: .below, relativeTo: statusDot)
            snapshotTint = tint
        }
        base.addSubview(bubble)
        base.addSubview(switcher)
        switcher.onHover = { [weak self] hovered in
            guard let self else { return }
            self.switcherHovering = hovered
            self.layoutBubble()
            self.sendAction(["type": "hover", "hovered": hovered])
        }
        base.addSubview(pet)
        layoutBubble()
        panel.orderFrontRegardless()
        startFrameTimer(frameMs)
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.panel.level = .floating
            self?.panel.orderFrontRegardless()
        }
    }

    func update(_ message: [String: Any]) {
        if let state = message["state"] as? String { pet.state = state }
        if let reducedMotion = message["reducedMotion"] as? Bool { pet.reducedMotion = reducedMotion; pet.needsDisplay = true }
        if let title = message["title"] as? String { titleValue = title }
        if let label = message["label"] as? String { statusValue = label }
        if let value = message["detail"] as? String { detailValue = value }
        if let show = message["showBubble"] as? Bool { showBubble = show }
        if let seen = message["viewed"] as? Bool { viewed = seen }
        if let items = message["tasks"] as? [[String: Any]] {
            tasks = items
            selectedTaskId = message["selectedTaskId"] as? String ?? ""
            updateSwitcher()
        }
        if let rawSize = message["size"] as? Double {
            size = CGFloat(max(72, min(200, rawSize)))
        }
        if let clips = message["clips"] as? [String: Any] {
            var parsed: [String: Int] = [:]
            for (key, value) in clips {
                if let number = value as? NSNumber { parsed[key] = number.intValue }
            }
            pet.applyClips(parsed)
        }
        if let rawFrame = message["frameMs"] as? NSNumber {
            let milliseconds = min(1000, max(16, rawFrame.doubleValue))
            if abs(milliseconds - frameMs) > 0.001 {
                frameMs = milliseconds
                startFrameTimer(milliseconds)
            }
        }
        layoutBubble()
        maybeScheduleSnapshot()
    }

    private func startFrameTimer(_ milliseconds: Double) {
        frameTimer?.invalidate()
        frameTimer = Timer.scheduledTimer(withTimeInterval: milliseconds / 1000, repeats: true) { [weak self] _ in
            self?.pet.advance()
        }
    }

    func updateSwitcher() {
        taskButtons.forEach { $0.removeFromSuperview() }
        taskButtons.removeAll()
        guard tasks.count > 1 else { switcherHovering = false; switcher.setHover(false); switcher.isHidden = true; return }
        switcher.isHidden = false
        let colors: [String: NSColor] = [
            "idle": NSColor(calibratedRed: 93/255, green: 102/255, blue: 117/255, alpha: 1),
            "running": NSColor(calibratedRed: 47/255, green: 158/255, blue: 143/255, alpha: 1),
            "waiting": NSColor(calibratedRed: 184/255, green: 132/255, blue: 47/255, alpha: 1),
            "success": NSColor(calibratedRed: 47/255, green: 156/255, blue: 108/255, alpha: 1),
            "error": NSColor(calibratedRed: 198/255, green: 91/255, blue: 104/255, alpha: 1),
        ]
        for task in tasks {
            guard let id = task["sessionId"] as? String else { continue }
            let button = HoverButton(frame: NSRect(x: 0, y: 0, width: 20, height: 20))
            button.isBordered = false
            let status = task["status"] as? String ?? "idle"
            button.image = taskSymbolImage(status)
            button.imagePosition = .imageOnly
            button.onHover = { [weak self] in
                guard let self, id != self.selectedTaskId else { return }
                self.sendAction(["type": "select", "sessionId": id])
            }
            let label: String
            switch status {
            case "running": label = "运行中"
            case "waiting": label = "等待确认"
            case "success": label = "已完成"
            case "error": label = "失败"
            default: label = "待机"
            }
            button.identifier = NSUserInterfaceItemIdentifier(id)
            button.toolTip = "\(task["title"] as? String ?? "当前任务") · \(label)"
            button.wantsLayer = true
            button.layer?.cornerRadius = 10
            button.layer?.backgroundColor = (colors[status] ?? .systemGray).cgColor
            button.layer?.borderWidth = 2
            button.layer?.borderColor = (id == selectedTaskId ? NSColor.white : colors[status] ?? .systemGray).cgColor
            switcher.addSubview(button)
            taskButtons.append(button)
        }
    }

    /// Vector glyphs inside the circular task dots (18x18 grid, shared with web/windows).
    func taskSymbolImage(_ status: String) -> NSImage {
        NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x, y: y) }
            switch status {
            case "running":
                let square = NSBezierPath(roundedRect: NSRect(x: 5.75, y: 5.75, width: 6.5, height: 6.5), xRadius: 1.1, yRadius: 1.1)
                NSColor.white.setFill()
                square.fill()
            case "waiting":
                let mark = NSBezierPath()
                mark.move(to: point(6.4, 6.5))
                mark.curve(to: point(12.0, 7.7), controlPoint1: point(6.9, 3.9), controlPoint2: point(10.6, 3.7))
                mark.curve(to: point(10.0, 10.6), controlPoint1: point(12.0, 9.2), controlPoint2: point(11.0, 9.7))
                mark.curve(to: point(9.1, 12.5), controlPoint1: point(9.4, 11.2), controlPoint2: point(9.1, 11.7))
                mark.lineWidth = 1.9
                mark.lineCapStyle = .round
                mark.lineJoinStyle = .round
                NSColor.white.setStroke()
                mark.stroke()
                let dot = NSBezierPath(ovalIn: NSRect(x: 9.1 - 1.05, y: 14.4 - 1.05, width: 2.1, height: 2.1))
                NSColor.white.setFill()
                dot.fill()
            case "success":
                let check = NSBezierPath()
                check.move(to: point(4.6, 9.2))
                check.line(to: point(7.7, 12.2))
                check.line(to: point(13.4, 5.9))
                check.lineWidth = 2.1
                check.lineCapStyle = .round
                check.lineJoinStyle = .round
                NSColor.white.setStroke()
                check.stroke()
            case "error":
                let cross = NSBezierPath()
                cross.move(to: point(5.2, 5.2))
                cross.line(to: point(12.8, 12.8))
                cross.move(to: point(12.8, 5.2))
                cross.line(to: point(5.2, 12.8))
                cross.lineWidth = 2.1
                cross.lineCapStyle = .round
                NSColor.white.setStroke()
                cross.stroke()
            default:
                let ring = NSBezierPath(ovalIn: NSRect(x: 9 - 3.25, y: 9 - 3.25, width: 6.5, height: 6.5))
                ring.lineWidth = 1.5
                NSColor.white.withAlphaComponent(0.72).setStroke()
                ring.stroke()
            }
            return true
        }
    }

    func sendAction(_ action: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: action) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }

    func layoutBubble() {
        let scale = size / 120
        let petWidth = 160 * scale
        let petHeight = 140 * scale
        let visible = showBubble && pet.state != "idle" && !viewed
        bubble.isHidden = !visible
        title.stringValue = titleValue
        let dots: [String: NSColor] = ["thinking": .systemPurple, "working": .systemTeal, "waiting": .systemOrange, "success": .systemGreen, "error": .systemRed]
        statusDot.layer?.backgroundColor = (dots[pet.state] ?? .systemBlue).cgColor
        let hasDetail = visible
        detail.stringValue = detailValue.isEmpty || detailValue == titleValue ? statusValue : detailValue
        let font = detail.font ?? .systemFont(ofSize: 11.5)
        let titleFont = title.font ?? .systemFont(ofSize: 12.5, weight: .semibold)
        let titleWidth = (title.stringValue as NSString).size(withAttributes: [.font: titleFont]).width
        let detailWidth = (detail.stringValue as NSString).size(withAttributes: [.font: font]).width
        let maxBubbleWidth = min(300 * scale, (NSScreen.main?.visibleFrame.width ?? 800) - 24)
        func taskBubbleWidth(_ task: [String: Any]) -> CGFloat {
            let taskTitle = task["title"] as? String ?? "当前任务"
            let taskDetail = task["detail"] as? String ?? ""
            let taskLabel = task["label"] as? String ?? ""
            let step = taskDetail.isEmpty || taskDetail == taskTitle ? taskLabel : taskDetail
            return max(
                (taskTitle as NSString).size(withAttributes: [.font: titleFont]).width + 45 * scale,
                (step as NSString).size(withAttributes: [.font: font]).width + 34 * scale
            )
        }
        var widestTaskWidth = 164 * scale
        if tasks.count > 1 {
            for task in tasks {
                widestTaskWidth = max(widestTaskWidth, taskBubbleWidth(task))
            }
        }
        widestTaskWidth = min(maxBubbleWidth, widestTaskWidth)
        let selectedTask = tasks.first { ($0["sessionId"] as? String) == selectedTaskId }
        let bubbleWidth: CGFloat
        if visible {
            if tasks.count > 1 {
                if switcherHovering, let selectedTask = selectedTask {
                    bubbleWidth = min(maxBubbleWidth, max(164 * scale, taskBubbleWidth(selectedTask)))
                } else {
                    bubbleWidth = widestTaskWidth
                }
            } else {
                bubbleWidth = min(maxBubbleWidth, max(164 * scale, max(titleWidth + 45 * scale, detailWidth + 34 * scale)))
            }
        } else {
            bubbleWidth = 0
        }
        let contentWidth = max(1, bubbleWidth - 32 * scale)
        let bubbleHeight: CGFloat = visible ? 49 : 0
        let gap = visible ? 5 * scale : 0
        let dotCount = taskButtons.count
        let columns = min(12, dotCount)
        let rows = dotCount > 0 ? (dotCount + 11) / 12 : 0
        let switcherWidth = dotCount > 0 ? CGFloat(columns * 24 + 12) : 0
        let switcherHeight = dotCount > 0 ? CGFloat(rows * 24 + 10) : 0
        let switcherGap: CGFloat = dotCount > 0 ? 6 : 0
        let width = max(petWidth, bubbleWidth, switcherWidth, dotCount > 0 ? widestTaskWidth : 0)
        let height = petHeight + gap + bubbleHeight + switcherGap + switcherHeight
        let oldCenter = panel.frame.midX
        let oldBottom = panel.frame.minY
        panel.setContentSize(NSSize(width: width, height: height))
        let screen = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        panel.setFrameOrigin(NSPoint(
            x: max(screen.minX, min(oldCenter - width / 2, screen.maxX - width)),
            y: max(screen.minY, min(oldBottom, screen.maxY - height))
        ))
        base.frame = NSRect(x: 0, y: 0, width: width, height: height)
        pet.frame = NSRect(x: (width - 152 * scale) / 2, y: 0, width: 152 * scale, height: 140 * scale)
        bubble.frame = NSRect(x: (width - bubbleWidth) / 2, y: petHeight + gap, width: bubbleWidth, height: bubbleHeight)
        switcher.frame = NSRect(x: (width - switcherWidth) / 2, y: petHeight + gap + bubbleHeight + switcherGap, width: switcherWidth, height: switcherHeight)
        for (index, button) in taskButtons.enumerated() {
            let row = index / 12
            let countInRow = min(12, dotCount - row * 12)
            let start = (switcherWidth - CGFloat(countInRow * 24 - 4)) / 2
            button.frame = NSRect(x: start + CGFloat(index % 12) * 24, y: switcherHeight - CGFloat(row + 1) * 24 - 2, width: 20, height: 20)
        }
        if visible {
            let mask = NSImage(size: bubble.frame.size, flipped: false) { rect in
                NSColor.white.setFill()
                NSBezierPath(roundedRect: rect, xRadius: 23, yRadius: 23).fill()
                return true
            }
            bubble.maskImage = mask
        }
        statusDot.frame = NSRect(x: 16 * scale, y: 31, width: 6, height: 6)
        title.frame = NSRect(x: 29 * scale, y: 26, width: max(1, bubbleWidth - 45 * scale), height: 17)
        detail.frame = NSRect(x: 16 * scale, y: 6, width: contentWidth, height: 20)
        detail.isHidden = !hasDetail
        snapshotTint?.frame = bubble.bounds
    }

    // Offscreen preview mode (verification only; dormant unless DSH_ALK_PET_SNAPSHOT is set).
    private func maybeScheduleSnapshot() {
        guard let path = snapshotPath, !snapshotScheduled else { return }
        snapshotScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self else { return }
            self.writeSnapshot(to: path)
            NSApp.terminate(nil)
        }
    }

    private func writeSnapshot(to path: String) {
        let view = base
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0 else { return }
        let scale = panel.backingScaleFactor > 0 ? panel.backingScaleFactor : 2
        let pixelsWide = Int((bounds.width * scale).rounded())
        let pixelsHigh = Int((bounds.height * scale).rounded())
        guard let representation = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: pixelsWide, pixelsHigh: pixelsHigh,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { return }
        representation.size = bounds.size
        view.cacheDisplay(in: bounds, to: representation)
        guard let data = representation.representation(using: .png, properties: [:]) else { return }
        do {
            try FileManager.default.createDirectory(at: URL(fileURLWithPath: path).deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: URL(fileURLWithPath: path))
        } catch {
            FileHandle.standardError.write(Data("snapshot write failed: \(error)\n".utf8))
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = PetController()
app.delegate = controller
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        DispatchQueue.main.async { controller.update(value) }
    }
    DispatchQueue.main.async { app.terminate(nil) }
}
app.run()
