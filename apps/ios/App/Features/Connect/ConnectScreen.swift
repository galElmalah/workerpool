import SwiftUI
import UIKit
import CadenceKit

/// First run: server address + passphrase + device name → device token (docs/MOBILE_API.md §1).
/// Clear error states: wrong passphrase, throttled with a live countdown, unreachable, bad address.
@MainActor
struct ConnectScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var server = ""
    @State private var passphrase = ""
    @State private var deviceName = ""
    @State private var busy = false
    @State private var failure: ConnectFailure? = nil
    @State private var failedAt = Date()
    @State private var attempts = 0
    @FocusState private var focus: ConnectField?

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    Text("cadence")
                        .font(Theme.Typography.title1)
                        .foregroundStyle(c.fg1)
                        .accessibilityAddTraits(.isHeader)
                    Text("Connect this iPhone to your Cadence server.")
                        .font(Theme.Typography.body)
                        .foregroundStyle(c.fg2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, Theme.Space.xl)

                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    field("Server address", highlighted: failure?.field == .server) {
                        TextField("cadence.example.com", text: $server)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .focused($focus, equals: .server)
                            .onSubmit { focus = .passphrase }
                    }
                    field("Passphrase", highlighted: failure?.field == .passphrase) {
                        SecureField("Your Cadence passphrase", text: $passphrase)
                            .textContentType(.password)
                            .submitLabel(.next)
                            .focused($focus, equals: .passphrase)
                            .onSubmit { focus = .deviceName }
                    }
                    field("Device name", highlighted: false) {
                        TextField("iPhone", text: $deviceName)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .focused($focus, equals: .deviceName)
                            .onSubmit(connect)
                    }
                }

                if let failure {
                    // re-renders every second while throttled, so the countdown ticks
                    TimelineView(.periodic(from: failedAt, by: 1)) { context in
                        failureLine(failure, now: context.date)
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                TimelineView(.periodic(from: failedAt, by: 1)) { context in
                    let blocked = failure?.blocksRetry(now: context.date) ?? false
                    Button(action: connect) {
                        ZStack {
                            Text("Connect").opacity(busy ? 0 : 1)
                            if busy { ProgressView().tint(c.onAccent) }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || blocked || !ConnectForm.canSubmit(server: server, passphrase: passphrase))
                }

                Text("Use the passphrase from the web app. This iPhone gets its own token, which you can revoke in the web app\u{2019}s settings. The passphrase itself is not stored.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(c.canvas.ignoresSafeArea())
        .animation(Theme.Motion.snappy, value: failure)
        .sensoryFeedback(.error, trigger: attempts)
        .onAppear {
            if deviceName.isEmpty { deviceName = UIDevice.current.name }
            if server.isEmpty { focus = .server }
        }
    }

    private func failureLine(_ f: ConnectFailure, now: Date) -> some View {
        let c = Theme.colors(accent)
        let symbol: String
        switch f {
        case .throttled: symbol = "hourglass"
        case .unreachable(let offline): symbol = offline ? "wifi.slash" : "network.slash"
        case .wrongPassphrase: symbol = "key"
        default: symbol = "exclamationmark.circle"
        }
        return Label {
            Text(f.message(now: now))
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.numericText())
        } icon: {
            Image(systemName: symbol).foregroundStyle(f == .wrongPassphrase || f.field == .server ? DataColor.critical : DataColor.warn)
        }
        .font(Theme.Typography.bodySmall)
        .foregroundStyle(c.fg1)
        .accessibilityElement(children: .combine)
    }

    private func field<Content: View>(_ label: String, highlighted: Bool, @ViewBuilder content: () -> Content) -> some View {
        let c = Theme.colors(accent)
        return VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(label)
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            content()
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg1)
                .padding(.horizontal, Theme.Space.s)
                .frame(minHeight: 48)
                .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .strokeBorder(highlighted ? c.line3 : Color.clear, lineWidth: 1)
                )
        }
    }

    private func connect() {
        guard !busy, ConnectForm.canSubmit(server: server, passphrase: passphrase) else { return }
        if let failure, failure.blocksRetry(now: Date()) { return }
        busy = true
        focus = nil
        Task {
            do {
                try await model.connect(server: server, passphrase: passphrase, deviceName: deviceName)
                passphrase = ""
                failure = nil
            } catch let e as APIError {
                failedAt = Date()
                failure = ConnectFailure(e, now: failedAt)
                attempts += 1
                if failure?.field == .passphrase { focus = .passphrase }
            } catch {
                failedAt = Date()
                failure = .other(error.localizedDescription)
                attempts += 1
            }
            busy = false
        }
    }
}
