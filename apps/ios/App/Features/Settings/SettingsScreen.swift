import SwiftUI
import CadenceKit

/// Settings: athlete basics and units, appearance (theme + accent, synced with the web app via
/// `Settings`), Garmin and devices, server info, about. Changes apply at once and save to the server.
@MainActor
struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var name: String = ""
    @State private var loadError: APIError? = nil
    @State private var garmin: GarminStatus? = nil
    @FocusState private var nameFocused: Bool

    var body: some View {
        let c = Theme.colors(accent)
        Form {
            if let s = model.settings {
                athleteSection(s, c)
                appearanceSection(s, c)
            } else if let loadError {
                Section {
                    FailedBlock(error: loadError) { Task { await load() } }
                }
            } else {
                Section { LoadingBlock() }
            }
            connectionsSection(c)
            serverSection(c)
            Section {
                Button(role: .destructive) {
                    Task { await model.signOut() }
                } label: {
                    Text("Sign out of this iPhone")
                }
            } footer: {
                Text("Revokes this iPhone\u{2019}s access. Your data stays on your server.")
            }
            .listRowBackground(c.surface1)
        }
        .scrollContentBackground(.hidden)
        .background(c.canvas.ignoresSafeArea())
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .scrollDismissesKeyboard(.interactively)
        .task(id: model.dataVersion) { await load() }
        .refreshable { await load() }
    }

    // MARK: Sections

    @ViewBuilder
    private func athleteSection(_ s: AthleteSettings, _ c: ThemeColors) -> some View {
        Section("Athlete") {
            LabeledContent("Name") {
                TextField("Your name", text: $name)
                    .multilineTextAlignment(.trailing)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .onSubmit { saveName() }
            }
            if let born = SettingsText.birthYear(s.birthYear) {
                LabeledContent("Birth year", value: born)
            }
            LabeledContent("Sex", value: s.sex.settingsLabel)
            Picker("Units", selection: binding(\.units, s) { SettingsPatch(units: $0) }) {
                ForEach(UnitSystem.knownCases, id: \.self) { u in Text(u.settingsLabel).tag(u) }
            }
            Picker("Week starts on", selection: binding(\.weekStart, s) { SettingsPatch(weekStart: $0) }) {
                ForEach(WeekStart.knownCases, id: \.self) { w in Text(w.settingsLabel).tag(w) }
            }
            LabeledContent("Time zone", value: s.timezone)
            Picker("Send workouts to Garmin", selection: binding(\.garminAutoPushDays, s) { SettingsPatch(garminAutoPushDays: $0) }) {
                ForEach(autoPushOptions(s), id: \.self) { d in Text(SettingsText.autoPush(d)).tag(d) }
            }
        }
        .listRowBackground(c.surface1)
        .onAppear { if !nameFocused { name = s.name } }
        .onChange(of: nameFocused) { _, focused in
            if !focused { saveName() }
        }
    }

    @ViewBuilder
    private func appearanceSection(_ s: AthleteSettings, _ c: ThemeColors) -> some View {
        Section {
            Picker("Theme", selection: binding(\.theme, s) { SettingsPatch(theme: $0) }) {
                ForEach(ThemePreference.pickerCases, id: \.self) { t in Text(t.settingsLabel).tag(t) }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)
            VStack(alignment: .leading, spacing: Theme.Space.s) {
                Text("Accent")
                    .font(Theme.Typography.label)
                    .foregroundStyle(c.fg3)
                HStack(spacing: Theme.Space.l) {
                    ForEach(Accent.knownCases, id: \.self) { a in
                        AccentSwatch(accent: a, isSelected: (model.settings?.accent ?? s.accent) == a) {
                            update(\.accent, a, SettingsPatch(accent: a))
                        }
                    }
                }
            }
            .padding(.vertical, Theme.Space.xxs)
            Toggle("Reduce motion", isOn: binding(\.reducedMotion, s) { SettingsPatch(reducedMotion: $0) })
        } header: {
            Text("Appearance")
        } footer: {
            Text("Theme and accent are shared with the web app.")
        }
        .listRowBackground(c.surface1)
    }

    @ViewBuilder
    private func connectionsSection(_ c: ThemeColors) -> some View {
        Section("Connections") {
            NavigationLink(value: Route.garmin) {
                LabeledContent {
                    Text(garmin.map { GarminStatusModel(status: $0, now: Date()).stateText } ?? "")
                } label: {
                    Label("Garmin", systemImage: "applewatch")
                }
            }
            NavigationLink(value: Route.devices) {
                Label("Devices", systemImage: "iphone")
            }
            NavigationLink(value: Route.journal) {
                Label("Journal", systemImage: "book")
            }
        }
        .listRowBackground(c.surface1)
    }

    @ViewBuilder
    private func serverSection(_ c: ThemeColors) -> some View {
        Section {
            if let client = model.client {
                LabeledContent("Server", value: SettingsText.serverHost(client.baseURL))
                if let name = client.tokenStore.load()?.deviceName {
                    LabeledContent("This device", value: name)
                }
                Link(destination: client.baseURL) {
                    Label("Open Cadence on the web", systemImage: "safari")
                }
            }
            LabeledContent("App version", value: model.appVersion)
            LabeledContent("CadenceKit", value: CadenceKitInfo.version)
        } header: {
            Text("Server and about")
        } footer: {
            Text("Cadence keeps your training on your own server. This iPhone has its own revocable token.")
        }
        .listRowBackground(c.surface1)
    }

    // MARK: Saving

    private func autoPushOptions(_ s: AthleteSettings) -> [Int] {
        let base = SettingsText.autoPushOptions
        return base.contains(s.garminAutoPushDays) ? base : (base + [s.garminAutoPushDays]).sorted()
    }

    /// A binding that applies the change locally at once (live retint), then PATCHes it.
    private func binding<T: Equatable>(_ key: WritableKeyPath<AthleteSettings, T>, _ s: AthleteSettings,
                                       patch: @escaping (T) -> SettingsPatch) -> Binding<T> {
        Binding(
            get: { (model.settings ?? s)[keyPath: key] },
            set: { value in update(key, value, patch(value)) }
        )
    }

    private func update<T: Equatable>(_ key: WritableKeyPath<AthleteSettings, T>, _ value: T, _ patch: SettingsPatch) {
        guard var local = model.settings, local[keyPath: key] != value else { return }
        let before = local
        local[keyPath: key] = value
        withAnimation(Theme.Motion.smooth) { model.apply(local) }
        guard let client = model.client else { return }
        Task {
            do {
                let saved = try await client.patchSettings(patch)
                model.apply(saved)
                await model.didWrite()
            } catch {
                withAnimation(Theme.Motion.smooth) { model.apply(before) }
                model.showError(error, doing: "save settings")
            }
        }
    }

    private func saveName() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != model.settings?.name else { return }
        update(\.name, trimmed, SettingsPatch(name: trimmed))
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            let s = try await client.settings()
            model.apply(s)
            if !nameFocused { name = s.name }
            loadError = nil
        } catch let e as APIError {
            if model.settings == nil { loadError = e }
        } catch {}
        garmin = try? await client.garminStatus()
    }
}

/// One accent option: a filled circle in that accent; the selected one carries a ring and a check.
@MainActor
private struct AccentSwatch: View {
    let accent: Accent
    let isSelected: Bool
    let action: @MainActor () -> Void
    @Environment(\.cadenceAccent) private var current

    var body: some View {
        let c = Theme.colors(current)
        Button {
            action()
        } label: {
            VStack(spacing: Theme.Space.xxs) {
                ZStack {
                    Circle()
                        .fill(Theme.colors(accent).accentColor)
                        .frame(width: 32, height: 32)
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(Theme.colors(accent).onAccent)
                    }
                }
                .padding(3)
                .overlay(Circle().stroke(isSelected ? c.fg2 : Color.clear, lineWidth: 1.5))
                Text(accent.settingsLabel)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(isSelected ? c.fg1 : c.fg3)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("\(accent.settingsLabel) accent"))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: isSelected)
        .animation(Theme.Motion.snappy, value: isSelected)
    }
}
