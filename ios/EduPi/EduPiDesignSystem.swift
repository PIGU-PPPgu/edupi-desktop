import SwiftUI

enum EduPiColor {
    static let canvas = adaptive(0xFCFCFD, 0x141821)
    static let surface = adaptive(0xFFFFFF, 0x202634)
    static let soft = adaptive(0xF5F6F8, 0x1B202C)
    static let ink = adaptive(0x242735, 0xF5F5F7)
    static let muted = adaptive(0x676E7E, 0xADB3BD)
    static let line = adaptive(0xE4E7ED, 0x363C46)
    static let accent = adaptive(0x4869B1, 0x82A8FF)
    static let accentSoft = adaptive(0xEDF3FB, 0x263754)
    static let action = adaptive(0x25283B, 0xE6EAF5)
    static let onAction = adaptive(0xFFFFFF, 0x202536)
    static let brand = adaptive(0x5E85BB, 0x45658D)

    private static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            rgb(traits.userInterfaceStyle == .dark ? dark : light)
        })
    }

    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255,
            alpha: 1
        )
    }
}

enum EduPiMetrics {
    static let controlRadius: CGFloat = 10
    static let cardRadius: CGFloat = 20
    static let targetSize: CGFloat = 44
    static let pageInset: CGFloat = 20
    static let sectionGap: CGFloat = 24
}

struct EduPiPage<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EduPiMetrics.sectionGap) {
                content
            }
            .padding(.horizontal, EduPiMetrics.pageInset)
            .padding(.top, 12)
            .padding(.bottom, 24)
            .frame(maxWidth: 660, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(EduPiColor.canvas.ignoresSafeArea())
    }
}

struct EduPiHeader<Actions: View>: View {
    let title: String
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(EduPiColor.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            actions
        }
        .frame(minHeight: EduPiMetrics.targetSize)
    }
}

extension EduPiHeader where Actions == EmptyView {
    init(title: String) {
        self.init(title: title) { EmptyView() }
    }
}

struct EduPiSectionHeading<Actions: View>: View {
    let title: String
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(EduPiColor.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            actions
        }
    }
}

extension EduPiSectionHeading where Actions == EmptyView {
    init(title: String) {
        self.init(title: title) { EmptyView() }
    }
}

struct EduPiSurface<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EduPiColor.surface, in: RoundedRectangle(cornerRadius: EduPiMetrics.cardRadius))
        .overlay {
            RoundedRectangle(cornerRadius: EduPiMetrics.cardRadius)
                .strokeBorder(EduPiColor.line, lineWidth: 1)
                .allowsHitTesting(false)
        }
    }
}

struct EduPiGlyph: View {
    let icon: String
    var emphasized = false

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(emphasized ? EduPiColor.accent : EduPiColor.muted)
            .frame(width: 34, height: 34)
            .background(
                emphasized ? EduPiColor.accentSoft : EduPiColor.soft,
                in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius)
            )
            .accessibilityHidden(true)
    }
}

struct EduPiIconButtonLabel: View {
    let icon: String

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(EduPiColor.ink)
            .frame(width: EduPiMetrics.targetSize, height: EduPiMetrics.targetSize)
            .background(EduPiColor.surface, in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius))
            .overlay {
                RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius)
                    .strokeBorder(EduPiColor.line)
                    .allowsHitTesting(false)
            }
    }
}

struct EduPiPrimaryLabel<Content: View>: View {
    var stretches = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(EduPiColor.onAction)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .frame(maxWidth: stretches ? .infinity : nil, minHeight: EduPiMetrics.targetSize)
            .background(EduPiColor.action, in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius))
    }
}

struct EduPiRow: View {
    let title: String
    var detail: String? = nil
    var icon: String? = nil
    var emphasized = false
    var navigates = false

    var body: some View {
        HStack(spacing: 12) {
            if let icon {
                EduPiGlyph(icon: icon, emphasized: emphasized)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(EduPiColor.ink)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(EduPiColor.muted)
                }
            }
            Spacer(minLength: 4)
            if navigates {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(EduPiColor.muted)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct EduPiStatus: View {
    let title: String
    var icon = "tray"

    var body: some View {
        Label(title, systemImage: icon)
            .font(.subheadline)
            .foregroundStyle(EduPiColor.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 14)
    }
}

struct EduPiWordmark: View {
    var body: some View {
        HStack(spacing: 10) {
            Text("π")
                .font(.system(size: 29, weight: .medium, design: .serif))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(EduPiColor.brand, in: RoundedRectangle(cornerRadius: EduPiMetrics.controlRadius))
                .accessibilityHidden(true)
            Text("EduPi")
                .font(.system(.title, design: .serif, weight: .semibold))
                .foregroundStyle(EduPiColor.ink)
        }
    }
}

struct EduPiPressStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(isEnabled ? (configuration.isPressed ? 0.84 : 1) : 0.5)
    }
}
