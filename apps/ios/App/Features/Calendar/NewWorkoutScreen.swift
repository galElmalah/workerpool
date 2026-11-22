import SwiftUI
import CadenceKit

/// New workout (`Route.newWorkout`): quick add with the server grammar ("run 45m easy") or a simple
/// form — sport, title, duration, intensity, key, day and optional time. A page, not a sheet.
@MainActor
struct NewWorkoutScreen: View {
    let date: LocalDate
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dismiss) private var dismiss
    @State private var draft: NewWorkoutDraft
    @State private var quickText = ""
    @State private var issues: [String] = []
    @State private var busy = false
    @State private var timed = false
    @FocusState private var quickFocused: Bool

    init(date: LocalDate) {
        self.date = date
        _draft = State(initialValue: NewWorkoutDraft(date: date))
    }

    var body: some View {
        let c = Theme.colors(accent)
        Form {
            Section {
                HStack(spacing: Theme.Space.s) {
                    TextField("run 45m easy", text: $quickText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($quickFocused)
                        .onSubmit(quickAdd)
                    if busy && !quickText.isEmpty {
                        ProgressView()
                    } else {
                        Button("Add", action: quickAdd)
                            .font(Theme.Typography.body.weight(.semibold))
                            .disabled(quickText.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    }
                }
                .listRowBackground(c.surface1)
                ForEach(issues, id: \.self) { issue in
                    Label(issue, systemImage: "info.circle")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(c.fg2)
                        .listRowBackground(c.surface1)
                }
            } header: {
                Text("Quick add")
            } footer: {
                Text("Type it the way you would say it: \u{201C}bike 1h30 z2\u{201D}, \u{201C}swim 2500m css\u{201D}, \u{201C}run 10k tempo key\u{201D}.")
            }

            Section("Or fill it in") {
                Picker("Sport", selection: $draft.sport) {
                    ForEach(Sport.knownCases, id: \.self) { s in
                        Label(s.label, systemImage: s.symbolName).tag(s)
                    }
                }
                TextField(draft.suggestedTitle, text: $draft.title)
                Stepper(value: $draft.durationMin, in: DurationField.range, step: DurationField.step(below: draft.durationMin)) {
                    HStack {
                        Text("Duration")
                        Spacer()
                        Text(draft.durationText)
                            .monospacedDigit()
                            .foregroundStyle(c.fg2)
                            .contentTransition(.numericText(value: Double(draft.durationMin)))
                            .animation(Theme.Motion.snappy, value: draft.durationMin)
                    }
                }
                Picker("Intensity", selection: $draft.intensity) {
                    ForEach(IntensityClass.knownCases, id: \.self) { i in
                        Text(i.label).tag(i)
                    }
                }
                Toggle("Key session", isOn: $draft.isKey)
            }
            .listRowBackground(c.surface1)

            Section("When") {
                DatePicker("Day", selection: dayBinding, displayedComponents: .date)
                Toggle("Set a start time", isOn: $timed.animation(Theme.Motion.snappy))
                if timed {
                    DatePicker("Start", selection: timeBinding, displayedComponents: .hourAndMinute)
                }
            }
            .listRowBackground(c.surface1)

            Section {
                Button(action: create) {
                    if busy && quickText.isEmpty { ProgressView().tint(c.onAccent) } else { Text("Add workout") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!draft.isValid || busy)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("New workout")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: timed) { _, on in
            draft.startTime = on ? (draft.startTime ?? "07:00") : nil
        }
    }

    private var dayBinding: Binding<Date> {
        Binding(get: { PickerDate.date(draft.date) }, set: { draft.date = PickerDate.local($0) })
    }

    private var timeBinding: Binding<Date> {
        Binding(get: { ClockTime.date(draft.startTime, on: draft.date) }, set: { draft.startTime = ClockTime.string(from: $0) })
    }

    private func quickAdd() {
        let text = quickText
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty, !busy else { return }
        busy = true
        Task {
            if let res = await model.quickAdd(date: draft.date, text: text) {
                let warnings = res.issues.filter { $0.severity != "info" }.map(\.message)
                if warnings.isEmpty {
                    dismiss()
                } else {
                    issues = warnings
                    quickText = ""
                }
            }
            busy = false
        }
    }

    private func create() {
        guard let client = model.client, draft.isValid, !busy else { return }
        busy = true
        let input = draft.input()
        Task {
            do {
                let w = try await client.createWorkout(input)
                let id = w.id
                let app = model
                app.showToast("Added \(w.title) on \(Format.dateMedium(w.date))") {
                    guard let client = app.client else { return }
                    _ = try? await client.deleteWorkout(id: id)
                    await app.didWrite()
                }
                await model.didWrite()
                dismiss()
            } catch {
                model.showError(error, doing: "add the workout")
            }
            busy = false
        }
    }
}
