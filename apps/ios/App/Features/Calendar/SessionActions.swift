import SwiftUI
import CadenceKit

/// A change a screen applies to its loaded data at once (optimistic), before the server answers.
enum LocalEdit {
    case moved(id: String, to: LocalDate)
    case removed(id: String)
    case restored([PlannedWorkout])
    case upserted(PlannedWorkout)
    case skipped(id: String, reason: SkipReason?)
    case key(id: String, isKey: Bool)

    /// Applies the edit to a calendar response.
    func apply(to cal: CalendarResponse) -> CalendarResponse {
        switch self {
        case .moved(let id, let date): return cal.movingWorkout(id: id, to: date)
        case .removed(let id): return cal.removingWorkouts(ids: [id])
        case .restored(let ws): return cal.upserting(ws)
        case .upserted(let w): return cal.upserting([w])
        case .skipped(let id, let reason): return cal.updatingWorkout(id: id) { $0.applySkip(reason) }
        case .key(let id, let isKey): return cal.updatingWorkout(id: id) { $0.isKey = isKey }
        }
    }

    /// Applies the edit to today's response.
    func apply(to t: TodayResponse) -> TodayResponse {
        switch self {
        case .moved(let id, _), .removed(let id):
            var copy = t
            copy.workouts.removeAll { $0.id == id }
            return copy
        case .restored(let ws):
            var copy = t
            for w in ws where w.date == t.date && !copy.workouts.contains(where: { $0.id == w.id }) { copy.workouts.append(w) }
            return copy
        case .upserted(let w):
            return t.updatingWorkout(id: w.id) { $0 = w }
        case .skipped(let id, let reason): return t.updatingWorkout(id: id) { $0.applySkip(reason) }
        case .key(let id, let isKey): return t.updatingWorkout(id: id) { $0.isKey = isKey }
        }
    }
}

/// Workout and activity actions shared by Today, Calendar, Day and Workout screens: request, toast,
/// undo (no confirm dialogs), then `didWrite()` (snapshot + widgets + screens reload).
extension AppModel {
    @discardableResult
    func moveWorkout(id: String, title: String, from: LocalDate, to date: LocalDate, local: ((LocalEdit) -> Void)? = nil) async -> Bool {
        guard let client, from != date else { return false }
        local?(.moved(id: id, to: date))
        do {
            _ = try await client.moveWorkout(id: id, to: date)
            showToast("Moved \(title) to \(Format.dateMedium(date))") { [weak self] in
                guard let self else { return }
                local?(.moved(id: id, to: from))
                await self.moveWorkout(id: id, title: title, from: date, to: from, local: nil)
            }
            await didWrite()
            return true
        } catch {
            local?(.moved(id: id, to: from))
            showError(error, doing: "move \(title)")
            return false
        }
    }

    @discardableResult
    func duplicateWorkout(id: String, title: String, to date: LocalDate, local: ((LocalEdit) -> Void)? = nil) async -> PlannedWorkout? {
        guard let client else { return nil }
        do {
            let copy = try await client.duplicateWorkout(id: id, to: date)
            local?(.upserted(copy))
            showToast("Copied \(title) to \(Format.dateMedium(date))") { [weak self] in
                guard let self, let client = self.client else { return }
                local?(.removed(id: copy.id))
                _ = try? await client.deleteWorkout(id: copy.id)
                await self.didWrite()
            }
            await didWrite()
            return copy
        } catch {
            showError(error, doing: "copy \(title)")
            return nil
        }
    }

    /// Deletes at once; the toast offers Undo (restores the deleted rows).
    @discardableResult
    func deleteWorkout(id: String, title: String, local: ((LocalEdit) -> Void)? = nil) async -> Bool {
        guard let client else { return false }
        local?(.removed(id: id))
        do {
            let deleted = try await client.deleteWorkout(id: id)
            showToast("Deleted \(title)") { [weak self] in
                guard let self, let client = self.client else { return }
                do {
                    let restored = try await client.restoreWorkouts(deleted)
                    local?(.restored(restored))
                    await self.didWrite()
                } catch {
                    self.showError(error, doing: "restore \(title)")
                }
            }
            await didWrite()
            return true
        } catch {
            showError(error, doing: "delete \(title)")
            await didWrite()
            return false
        }
    }

    func skipWorkout(id: String, title: String, reason: SkipReason?, local: ((LocalEdit) -> Void)? = nil) async {
        guard let client else { return }
        local?(.skipped(id: id, reason: reason))
        do {
            if let reason {
                let w = try await client.skipWorkout(id: id, reason: reason)
                local?(.upserted(w))
                showToast("Skipped \(title)\(Format.dot)\(reason.label.lowercased())") { [weak self] in
                    await self?.skipWorkout(id: id, title: title, reason: nil, local: local)
                }
            } else {
                let w = try await client.unskipWorkout(id: id)
                local?(.upserted(w))
            }
            await didWrite()
        } catch {
            showError(error, doing: reason == nil ? "unskip \(title)" : "skip \(title)")
            await didWrite()
        }
    }

    func setWorkoutKey(id: String, _ isKey: Bool, local: ((LocalEdit) -> Void)? = nil) async {
        guard let client else { return }
        local?(.key(id: id, isKey: isKey))
        do {
            let w = try await client.setWorkoutKey(id: id, isKey)
            local?(.upserted(w))
            await didWrite()
        } catch {
            local?(.key(id: id, isKey: !isKey))
            showError(error, doing: "update the key session")
        }
    }

    /// Pushes the workout to Garmin Connect (the watch picks it up on its next sync).
    @discardableResult
    func sendToWatch(id: String, title: String) async -> GarminLink? {
        guard let client else { return nil }
        do {
            let link = try await client.pushWorkout(id: id)
            if link.syncState == .error {
                showToast(link.error.map { "Couldn\u{2019}t send \(title): \($0)" } ?? "Couldn\u{2019}t send \(title)")
            } else {
                showToast("Sent \(title) to your watch")
            }
            await didWrite()
            return link
        } catch let e as APIError where e.code == "garmin_not_connected" {
            showToast("Connect Garmin in More \u{2192} Garmin to send workouts to your watch.")
            return nil
        } catch {
            showError(error, doing: "send \(title)")
            return nil
        }
    }

    /// Quick add with the server grammar ("run 45m easy"). Returns the response (issues included).
    func quickAdd(date: LocalDate, text: String, local: ((LocalEdit) -> Void)? = nil) async -> QuickAddResponse? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let client, !t.isEmpty else { return nil }
        do {
            let res = try await client.quickAdd(date: date, text: t)
            local?(.upserted(res.workout))
            let id = res.workout.id
            showToast("Added \(res.workout.title) on \(Format.dateMedium(res.workout.date))") { [weak self] in
                guard let self, let client = self.client else { return }
                local?(.removed(id: id))
                _ = try? await client.deleteWorkout(id: id)
                await self.didWrite()
            }
            await didWrite()
            return res
        } catch {
            showError(error, doing: "add \u{201C}\(t)\u{201D}")
            return nil
        }
    }

    // Activities (quick log on Today / Day)

    @discardableResult
    func logActivity(id: String, rpe: Int?? = nil, feel: Int?? = nil, note: String?? = nil) async -> Activity? {
        guard let client else { return nil }
        do {
            var result: Activity?
            if let rpe { result = try await client.setRPE(activityId: id, rpe) }
            if let feel { result = try await client.setFeel(activityId: id, feel) }
            if let note { result = try await client.setActivityNote(activityId: id, note) }
            return result
        } catch {
            showError(error, doing: "save the log")
            return nil
        }
    }
}

/// Context menu for a session in Calendar / Day / Today: open, key, move, copy, skip, watch, delete.
@MainActor
struct SessionMenuItems: View {
    let card: SessionCardModel
    let local: (LocalEdit) -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            model.push(Route(card.target))
        } label: {
            Label("Open", systemImage: "arrow.up.right")
        }
        if let id = card.workoutId, card.activityId == nil {
            Button {
                Task { await model.setWorkoutKey(id: id, !card.isKey, local: local) }
            } label: {
                Label(card.isKey ? "Not a key session" : "Mark as key session", systemImage: card.isKey ? "star.slash" : "star")
            }
            Menu {
                ForEach(CalendarModels.quickMoveTargets(from: card.date)) { t in
                    Button(t.label) {
                        Task { await model.moveWorkout(id: id, title: card.title, from: card.date, to: t.date, local: local) }
                    }
                }
                Button("Pick a day\u{2026}") { model.push(.moveWorkout(id: id, from: card.date, copy: false)) }
            } label: {
                Label("Move to", systemImage: "calendar")
            }
            Menu {
                ForEach(CalendarModels.quickMoveTargets(from: card.date)) { t in
                    Button(t.label) {
                        Task { await model.duplicateWorkout(id: id, title: card.title, to: t.date, local: local) }
                    }
                }
                Button("Pick a day\u{2026}") { model.push(.moveWorkout(id: id, from: card.date, copy: true)) }
            } label: {
                Label("Duplicate to", systemImage: "plus.square.on.square")
            }
            if card.isSkipped {
                Button {
                    Task { await model.skipWorkout(id: id, title: card.title, reason: nil, local: local) }
                } label: {
                    Label("Unskip", systemImage: "arrow.uturn.backward")
                }
            } else {
                Menu {
                    ForEach(SkipReason.knownCases, id: \.self) { reason in
                        Button(reason.label) {
                            Task { await model.skipWorkout(id: id, title: card.title, reason: reason, local: local) }
                        }
                    }
                } label: {
                    Label("Skip", systemImage: "minus.circle")
                }
            }
            if card.canSendToWatch {
                Button {
                    Task { await model.sendToWatch(id: id, title: card.title) }
                } label: {
                    Label(card.garmin?.sendButtonTitle ?? "Send to watch", systemImage: "applewatch.radiowaves.left.and.right")
                }
            }
            Divider()
            Button(role: .destructive) {
                Task { await model.deleteWorkout(id: id, title: card.title, local: local) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}
