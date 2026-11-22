import Foundation

// Optimistic edits applied to loaded responses while the request is in flight (the screen then
// reloads from the server). Pure, so the calendar and day screens can show the result instantly.

extension CalendarResponse {
    /// The workout moved to `date` (its pairing is left to the server).
    public func movingWorkout(id: String, to date: LocalDate) -> CalendarResponse {
        updatingWorkout(id: id) { $0.date = date }
    }

    public func removingWorkouts(ids: Set<String>) -> CalendarResponse {
        var c = self
        c.workouts.removeAll { ids.contains($0.id) }
        return c
    }

    /// Replaces workouts with the same id, appends the others.
    public func upserting(_ workouts: [PlannedWorkout]) -> CalendarResponse {
        var c = self
        for w in workouts {
            if let i = c.workouts.firstIndex(where: { $0.id == w.id }) { c.workouts[i] = w }
            else { c.workouts.append(w) }
        }
        return c
    }

    public func updatingWorkout(id: String, _ change: (inout PlannedWorkout) -> Void) -> CalendarResponse {
        var c = self
        if let i = c.workouts.firstIndex(where: { $0.id == id }) { change(&c.workouts[i]) }
        return c
    }

    public func updatingActivity(id: String, _ change: (inout Activity) -> Void) -> CalendarResponse {
        var c = self
        if let i = c.activities.firstIndex(where: { $0.id == id }) { change(&c.activities[i]) }
        return c
    }

    public func settingDayNote(date: LocalDate, body: String, now: Date = Date()) -> CalendarResponse {
        var c = self
        c.dayNotes.removeAll { $0.date == date }
        if !body.isEmpty { c.dayNotes.append(DayNote(date: date, body: body, updatedAt: Instant.string(now))) }
        return c
    }
}

extension TodayResponse {
    public func updatingActivity(id: String, _ change: (inout Activity) -> Void) -> TodayResponse {
        var t = self
        if let i = t.activities.firstIndex(where: { $0.id == id }) { change(&t.activities[i]) }
        if let i = t.pendingLogs.firstIndex(where: { $0.id == id }) { change(&t.pendingLogs[i]) }
        return t
    }

    public func updatingWorkout(id: String, _ change: (inout PlannedWorkout) -> Void) -> TodayResponse {
        var t = self
        if let i = t.workouts.firstIndex(where: { $0.id == id }) { change(&t.workouts[i]) }
        return t
    }

    /// Morning check-in applied locally (feel / soreness).
    public func checkingIn(feel: Int?? = nil, soreness: Int?? = nil) -> TodayResponse {
        var t = self
        var day = t.wellness.today ?? WellnessDay(date: t.date)
        if let feel { day.feel = feel }
        if let soreness { day.soreness = soreness }
        t.wellness.today = day
        return t
    }
}

extension PlannedWorkout {
    /// Local skip / unskip (compliance becomes "excused" while skipped).
    public mutating func applySkip(_ reason: SkipReason?) {
        if let reason {
            status = .skipped
            skipReason = reason
            compliance = Compliance(metric: .duration, ratio: 0, state: .excused)
        } else {
            status = .planned
            skipReason = nil
            if compliance?.state == .excused { compliance = nil }
        }
    }
}

extension WellnessDay {
    /// An empty day (no device data, no check-in).
    public init(date: LocalDate) {
        self.init(date: date, hrvMs: nil, hrvStatus: nil, restingHr: nil, sleepSec: nil, sleepScore: nil, weightKg: nil,
                  bodyBattery: nil, stress: nil, readiness: nil, vo2max: nil, feel: nil, soreness: nil, note: nil)
    }
}
