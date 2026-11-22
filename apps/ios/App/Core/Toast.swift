import SwiftUI
import CadenceKit

/// Toast-style banner at the bottom of a tab (above the tab bar): one line + optional Undo.
/// No confirm dialogs: destructive actions happen at once and offer Undo here for a few seconds.
@MainActor
struct ToastHost: ViewModifier {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if let toast = model.toast {
                ToastBanner(toast: toast)
                    .padding(.horizontal, Theme.Space.gutter)
                    .padding(.bottom, Theme.Space.xs)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: toast.id) {
                        try? await Task.sleep(for: .seconds(toast.undo == nil ? 3 : 6))
                        guard !Task.isCancelled, model.toast?.id == toast.id else { return }
                        withAnimation(Theme.Motion.snappy) { model.toast = nil }
                    }
            }
        }
        .animation(Theme.Motion.snappy, value: model.toast?.id)
    }
}

@MainActor
private struct ToastBanner: View {
    let toast: ToastItem
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(spacing: Theme.Space.s) {
            Text(toast.message)
                .font(Theme.Typography.bodySmall)
                .foregroundStyle(c.fg1)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let undo = toast.undo {
                Button(toast.undoTitle) {
                    withAnimation(Theme.Motion.snappy) { model.toast = nil }
                    Task { await undo() }
                }
                .font(Theme.Typography.bodySmall.weight(.semibold))
                .foregroundStyle(c.fg1)
                .buttonStyle(.borderless)
            }
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.vertical, Theme.Space.s)
        .background(c.surface3, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isStaticText)
    }
}

extension View {
    func toastHost() -> some View { modifier(ToastHost()) }
}
