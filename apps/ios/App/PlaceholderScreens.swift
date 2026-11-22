import SwiftUI
import CadenceKit

/// Connect to a Cadence server: address + passphrase → device token (docs/MOBILE_API.md §1).
struct ConnectView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.cadenceAccent) private var accent
    @State private var server = ""
    @State private var passphrase = ""
    @State private var busy = false
    @FocusState private var focus: Field?

    private enum Field { case server, passphrase }

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    Text("cadence")
                        .font(Theme.Typography.title1)
                        .foregroundStyle(c.fg1)
                    Text("Connect this iPhone to your Cadence server.")
                        .font(Theme.Typography.body)
                        .foregroundStyle(c.fg2)
                }
                .padding(.top, Theme.Space.xxl)

                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    field(label: "Server address") {
                        TextField("cadence.example.com", text: $server)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .focused($focus, equals: .server)
                            .onSubmit { focus = .passphrase }
                    }
                    field(label: "Passphrase") {
                        SecureField("Your Cadence passphrase", text: $passphrase)
                            .textContentType(.password)
                            .submitLabel(.go)
                            .focused($focus, equals: .passphrase)
                            .onSubmit(connect)
                    }
                }

                if let error = model.lastError {
                    Label(error.message, systemImage: "exclamationmark.circle")
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg1)
                }

                Button(action: connect) {
                    if busy { ProgressView().tint(c.onAccent) } else { Text("Connect") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || server.trimmingCharacters(in: .whitespaces).isEmpty || passphrase.isEmpty)

                Text("The passphrase is the one you use on the web app. This phone gets its own token, which you can revoke from the web app's settings.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
            }
            .padding(.horizontal, Theme.Space.gutter)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func field<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        let c = Theme.colors(accent)
        return VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(label)
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            content()
                .font(Theme.Typography.body)
                .padding(.horizontal, Theme.Space.s)
                .frame(minHeight: 48)
                .background(c.surface1, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
    }

    private func connect() {
        guard !busy else { return }
        busy = true
        Task {
            await model.connect(server: server, passphrase: passphrase)
            busy = false
            if model.phase == .signedIn { passphrase = "" }
        }
    }
}

/// First paint from the cached snapshot, refreshed on appear and on pull. Placeholder until the
/// real Today screen exists — it only shows what the widgets show.
struct HomePlaceholderView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    if let s = model.snapshot {
                        content(s, c)
                    } else if model.isRefreshing {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, Theme.Space.xxl)
                    } else {
                        EmptyState(symbol: "arrow.clockwise", title: "Nothing loaded yet",
                                   message: model.lastError?.message ?? "Pull to refresh.",
                                   actionTitle: "Try again") { Task { await model.refresh() } }
                    }
                }
                .padding(.horizontal, Theme.Space.gutter)
                .padding(.bottom, Theme.Space.xxl)
            }
            .background(c.canvas.ignoresSafeArea())
            .refreshable { await model.refresh() }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Accent", selection: Binding(get: { model.accent }, set: { a in Task { await model.setAccent(a) } })) {
                            ForEach(Accent.knownCases, id: \.self) { a in Text(a.rawValue.capitalized).tag(a) }
                        }
                        Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                    } label: {
                        Image(systemName: "ellipsis.circle").accessibilityLabel("More")
                    }
                }
            }
        }
        .task { await model.refresh() }
    }

    @ViewBuilder
    private func content(_ s: MobileSnapshot, _ c: ThemeColors) -> some View {
        let today = WidgetModels.today(s, fetchedAt: model.snapshotFetchedAt, now: Date())
        let week = WidgetModels.week(s, now: Date())
        let form = WidgetModels.form(s)

        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            Text(today.dateText)
                .font(Theme.Typography.label)
                .foregroundStyle(c.fg3)
            if let headline = today.headline {
                Text(headline)
                    .font(Theme.Typography.title2)
                    .foregroundStyle(c.fg1)
            }
            if let stale = today.staleText {
                Text(stale).font(Theme.Typography.caption).foregroundStyle(c.fg3)
            }
        }

        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            if today.lines.isEmpty {
                EmptyState(symbol: "moon.zzz", title: today.emptyText)
            } else {
                ForEach(today.lines) { SessionRow(line: $0) }
            }
            if let label = today.upNextLabel {
                SectionHeader(title: label).padding(.top, Theme.Space.m)
                ForEach(today.upNext) { SessionRow(line: $0) }
            }
        }

        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: week.title)
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                Text(week.doneText).font(Theme.Typography.statLarge).foregroundStyle(c.fg1)
                Text(week.plannedText).font(Theme.Typography.bodySmall).foregroundStyle(c.fg3)
            }
            ThinProgressBar(fraction: week.fraction)
            Text([week.loadText, week.keyText].compactMap { $0 }.joined(separator: Format.dot))
                .font(Theme.Typography.bodySmall)
                .foregroundStyle(c.fg2)
        }
        .cadenceCard()

        HStack(alignment: .top, spacing: Theme.Space.l) {
            LabelledStat(label: "Form", value: form.formText, context: form.zoneText)
            LabelledStat(label: "Fitness", value: form.fitnessText)
            LabelledStat(label: "Fatigue", value: form.fatigueText)
        }
    }
}

#Preview("Connect") {
    ConnectView().environmentObject(AppModel())
}
