import SwiftUI
import CadenceKit

/// Edit the basics of a planned workout (`Route.editWorkout`): title, day, start time, duration.
/// Sends only what changed (`WorkoutEditDraft.patch`).
@MainActor
struct EditWorkoutScreen: View {
    let id: String
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.dismiss) private var dismiss
    @State private var original: PlannedWorkout? = nil
    @State private var draft: WorkoutEditDraft? = nil
    @State private var busy = false
    @State private var loadError: APIError? = nil

    var body: some View {
        let c = Theme.colors(accent)
        Group {
            if let original, let draft {
                form(original, draft, c)
            } else if let loadError {
                ScrollView { FailedBlock(error: loadError) { Task { await load() } } }
            } else {
                ScrollView { LoadingBlock() }
            }
        }
        .screenBackground()
        .navigationTitle("Edit workout")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else {
                    Button("Save", action: save)
                        .disabled(!(draft?.isValid ?? false) || original.flatMap { draft?.patch(from: $0) } == nil)
                }
            }
        }
        .task { if original == nil { await load() } }
    }

    private func form(_ w: PlannedWorkout, _ d: WorkoutEditDraft, _ c: ThemeColors) -> some View {
        Form {
            Section("Title") {
                TextField("Title", text: binding(\.title, d), axis: .vertical)
                    .lineLimit(1...3)
            }
            .listRowBackground(c.surface1)
            Section("When") {
                DatePicker("Day", selection: Binding(get: { PickerDate.date(d.date) },
                                                     set: { v in update { $0.date = PickerDate.local(v) } }),
                           displayedComponents: .date)
                Toggle("Start time", isOn: Binding(get: { draft?.startTime != nil },
                                                   set: { on in withAnimation(Theme.Motion.snappy) { update { $0.startTime = on ? ($0.startTime ?? "07:00") : nil } } }))
                if let time = d.startTime {
                    DatePicker("Starts", selection: Binding(get: { ClockTime.date(time, on: d.date) },
                                                            set: { v in update { $0.startTime = ClockTime.string(from: v) } }),
                               displayedComponents: .hourAndMinute)
                }
            }
            .listRowBackground(c.surface1)
            Section("Duration") {
                Stepper(value: Binding(get: { draft?.durationMin ?? 45 }, set: { v in update { $0.durationMin = v } }),
                        in: DurationField.range, step: DurationField.step(below: d.durationMin ?? 45)) {
                    HStack {
                        Text("Planned")
                        Spacer()
                        Text(d.durationMin.map { DurationField.text(minutes: $0) } ?? "None")
                            .monospacedDigit()
                            .foregroundStyle(c.fg2)
                            .contentTransition(.numericText(value: Double(d.durationMin ?? 0)))
                            .animation(Theme.Motion.snappy, value: d.durationMin)
                    }
                }
                if w.structure != nil {
                    Text("This workout has steps; the server keeps its structure. Changing the duration here sets the planned total only.")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(c.fg3)
                }
            }
            .listRowBackground(c.surface1)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func binding(_ key: WritableKeyPath<WorkoutEditDraft, String>, _ d: WorkoutEditDraft) -> Binding<String> {
        Binding(get: { draft?[keyPath: key] ?? d[keyPath: key] }, set: { v in update { $0[keyPath: key] = v } })
    }

    private func update(_ change: (inout WorkoutEditDraft) -> Void) {
        guard var d = draft else { return }
        change(&d)
        draft = d
    }

    private func load() async {
        guard let client = model.client else { return }
        if original == nil, let cached = client.cached(Endpoints.workout(id: id)) {
            original = cached.value
            draft = WorkoutEditDraft(cached.value)
        }
        do {
            let w = try await client.workout(id: id)
            if draft == nil || draft?.patch(from: original ?? w) == nil {
                draft = WorkoutEditDraft(w)
            }
            original = w
            loadError = nil
        } catch let e as APIError {
            if original == nil { loadError = e }
        } catch {}
    }

    private func save() {
        guard let client = model.client, let original, let draft, let patch = draft.patch(from: original), !busy else { return }
        busy = true
        Task {
            do {
                let saved = try await client.patchWorkout(id: id, patch)
                self.original = saved
                model.showToast("Saved \(saved.title)")
                await model.didWrite()
                dismiss()
            } catch {
                model.showError(error, doing: "save the workout")
            }
            busy = false
        }
    }
}
