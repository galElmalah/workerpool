import SwiftUI
import CadenceKit

/// Calendar — "what is my week / month?" A compact month grid (or a one-week strip), swipe between
/// months/weeks, the selected week's summary (links to the week review) and the selected day's
/// sessions below. Long-press a session for move / copy / skip / delete; drag it onto another day.
@MainActor
struct CalendarScreen: View {
    enum Mode: String, Hashable { case month, week }

    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var remote = Remote<CalendarResponse>()
    @State private var month = MonthID(Day(Date()))
    @State private var selected = Day(Date()).string
    @State private var mode: Mode = .month
    @State private var swipeEdge: Edge = .trailing
    @State private var drops = 0
    @State private var didApplyInitialFocus = false
    @Namespace private var selection

    /// The range loaded: the grid of the displayed month (week mode: of the selected day's month).
    private var loadedMonth: MonthID { mode == .month ? month : MonthID(Day(selected) ?? Day(Date())) }
    private var today: LocalDate { remote.value?.today ?? model.today }

    var body: some View {
        let c = Theme.colors(accent)
        let units = model.units
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                header(c)
                VStack(spacing: Theme.Space.xs) {
                    weekdayRow(c)
                    calendarBody(c, units: units)
                        .id(mode == .month ? month.string : (Day(selected)?.weekStart.string ?? selected))
                        .transition(.push(from: swipeEdge))
                }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .contentShape(Rectangle())
                .simultaneousGesture(swipe)

                if remote.isOffline {
                    OfflineNotice(storedAt: remote.storedAt)
                }

                if let cal = remote.value, let line = CalendarModels.weekSummary(containing: selected, calendar: cal, today: today) {
                    WeekSummaryCard(line: line)
                }

                selectedDay(c, units: units)
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.bottom, Theme.Space.xxl)
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .refreshable { await load() }
        .navigationTitle("Calendar")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.newWorkout(date: selected)) {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New workout on \(Format.dateMedium(selected))")
            }
        }
        .task(id: "\(loadedMonth.string)|\(model.dataVersion)") { await load() }
        .onAppear(perform: applyFocus)
        .onChange(of: model.calendarFocus) { _, _ in applyFocus() }
        .sensoryFeedback(.success, trigger: drops)
        .sensoryFeedback(.selection, trigger: selected)
    }

    // MARK: Header

    private func header(_ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                Text(mode == .month ? month.title : weekTitle)
                    .font(Theme.Typography.title2)
                    .foregroundStyle(c.fg1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .contentTransition(.opacity)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Theme.Space.xs)
                Button { step(-1) } label: {
                    Image(systemName: "chevron.left").frame(width: 36, height: 36)
                }
                .accessibilityLabel(mode == .month ? "Previous month" : "Previous week")
                Button("Today") { goToToday() }
                    .font(Theme.Typography.bodySmall.weight(.medium))
                    .buttonStyle(.bordered)
                    .tint(c.fg2)
                Button { step(1) } label: {
                    Image(systemName: "chevron.right").frame(width: 36, height: 36)
                }
                .accessibilityLabel(mode == .month ? "Next month" : "Next week")
            }
            .foregroundStyle(c.fg2)
            .tint(c.fg2)
            Picker("View", selection: $mode.animation(Theme.Motion.smooth)) {
                Text("Month").tag(Mode.month)
                Text("Week").tag(Mode.week)
            }
            .pickerStyle(.segmented)
        }
    }

    private var weekTitle: String {
        guard let d = Day(selected) else { return month.title }
        return Format.weekLabel(d.isoWeek) + Format.dot + Format.weekRange(d.isoWeek)
    }

    private func weekdayRow(_ c: ThemeColors) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(CalendarModels.weekdayInitials.enumerated()), id: \.offset) { _, d in
                Text(d)
                    .font(Theme.Typography.label)
                    .foregroundStyle(c.fg3)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    // MARK: Grid / strip

    @ViewBuilder
    private func calendarBody(_ c: ThemeColors, units: UnitSystem) -> some View {
        switch mode {
        case .month:
            let grid = CalendarModels.month(month, calendar: remote.value, today: today, units: units)
            VStack(spacing: 2) {
                ForEach(grid.weeks) { week in
                    HStack(spacing: 2) {
                        ForEach(week.cells) { cell in dayCell(cell, compact: true, c) }
                    }
                }
            }
        case .week:
            if let row = CalendarModels.week(containing: selected, calendar: remote.value, today: today, units: units) {
                HStack(spacing: 2) {
                    ForEach(row.cells) { cell in dayCell(cell, compact: false, c) }
                }
            }
        }
    }

    private func dayCell(_ cell: MonthCell, compact: Bool, _ c: ThemeColors) -> some View {
        let isSelected = cell.date == selected
        return DayCellView(cell: cell, isSelected: isSelected, compact: compact, selection: selection) {
            if isSelected {
                model.push(.day(cell.date))
            } else {
                withAnimation(Theme.Motion.snappy) { selected = cell.date }
            }
        } onDrop: { id in
            drop(workoutId: id, on: cell.date)
        }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { v in
                let dx = v.translation.width
                guard abs(dx) > 60, abs(dx) > abs(v.translation.height) * 1.5 else { return }
                step(dx < 0 ? 1 : -1)
            }
    }

    // MARK: Selected day

    @ViewBuilder
    private func selectedDay(_ c: ThemeColors, units: UnitSystem) -> some View {
        let cards = remote.value.map { DayCards.build($0, date: selected, units: units) } ?? []
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.dateLong(selected))
                        .font(Theme.Typography.title3)
                        .foregroundStyle(c.fg1)
                        .lineLimit(2)
                    Text(Format.relativeDay(selected, today: today))
                        .font(Theme.Typography.caption)
                        .foregroundStyle(selected == today ? c.accentInk : c.fg3)
                }
                Spacer()
                NavigationLink(value: Route.day(selected)) {
                    HStack(spacing: 2) {
                        Text("Day")
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                }
                .zoomSource(.day(selected))
                .accessibilityLabel("Open \(Format.dateLong(selected))")
            }
            if remote.value == nil && remote.isLoading {
                LoadingBlock()
            } else if cards.isEmpty {
                Text("Nothing planned.")
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg3)
                    .padding(.vertical, Theme.Space.xs)
            } else {
                VStack(spacing: Theme.Space.xxs) {
                    ForEach(cards) { card in
                        sessionRow(card)
                    }
                }
                .animation(Theme.Motion.smooth, value: cards)
            }
            QuickAddField(date: selected, local: { apply($0) })
                .padding(.top, Theme.Space.xs)
        }
    }

    @ViewBuilder
    private func sessionRow(_ card: SessionCardModel) -> some View {
        let route = Route(card.target)
        let link = NavigationLink(value: route) { SessionListRow(card: card) }
            .buttonStyle(.plain)
            .zoomSource(route)
            .contextMenu { SessionMenuItems(card: card, local: { apply($0) }) }
        if card.isEditableWorkout, let id = card.workoutId {
            link.draggable(id)
        } else {
            link
        }
    }

    // MARK: Actions

    private func load() async {
        guard let client = model.client else { return }
        let m = loadedMonth
        let from = m.gridStart.string
        let to = m.gridEnd.string
        if let v = remote.value, !(v.from <= from && to <= v.to) { remote.reset() }
        await remote.load(cached: { client.cached(Endpoints.calendar(from: from, to: to)) },
                          fetch: { try await client.calendar(from: from, to: to) })
    }

    private func apply(_ edit: LocalEdit) {
        withAnimation(Theme.Motion.smooth) { remote.update { edit.apply(to: $0) } }
    }

    private func step(_ n: Int) {
        swipeEdge = n > 0 ? .trailing : .leading
        withAnimation(Theme.Motion.smooth) {
            switch mode {
            case .month:
                month = month.adding(months: n)
                if let d = Day(selected), !month.contains(d) {
                    selected = (month.contains(Day(today) ?? month.firstDay) ? today : month.firstDay.string)
                }
            case .week:
                if let d = Day(selected) {
                    selected = d.adding(days: 7 * n).string
                    month = MonthID(Day(selected) ?? d)
                }
            }
        }
    }

    private func goToToday() {
        let t = today
        let target = MonthID(Day(t) ?? Day(Date()))
        swipeEdge = target < month ? .leading : .trailing
        withAnimation(Theme.Motion.smooth) {
            month = target
            selected = t
        }
    }

    private func applyFocus() {
        if !didApplyInitialFocus {
            didApplyInitialFocus = true
            selected = model.today
            month = MonthID(Day(model.today) ?? Day(Date()))
        }
        guard let focus = model.calendarFocus, let d = Day(focus) else { return }
        selected = d.string
        month = MonthID(d)
        model.calendarFocus = nil
    }

    private func drop(workoutId: String, on date: LocalDate) -> Bool {
        guard let w = remote.value?.workouts.first(where: { $0.id == workoutId }), w.date != date,
              w.pairedActivityId == nil else { return false }
        drops += 1
        withAnimation(Theme.Motion.snappy) { selected = date }
        Task { await model.moveWorkout(id: w.id, title: w.title, from: w.date, to: date, local: { apply($0) }) }
        return true
    }
}

/// One day in the grid or strip: day number (today = accent numeral; selected = surface pill) and up
/// to three small session marks in sport colours (done = filled, planned = ring, missed = dim ring).
@MainActor
private struct DayCellView: View {
    let cell: MonthCell
    let isSelected: Bool
    let compact: Bool
    let selection: Namespace.ID
    let onTap: () -> Void
    let onDrop: (String) -> Bool
    @Environment(\.cadenceAccent) private var accent
    @State private var targeted = false

    var body: some View {
        let c = Theme.colors(accent)
        Button(action: onTap) {
            VStack(spacing: compact ? 4 : 6) {
                Text(cell.dayNumber)
                    .font(cell.isToday ? Font.callout.weight(.bold) : Font.callout)
                    .monospacedDigit()
                    .foregroundStyle(cell.isToday ? c.accentInk : (cell.isInMonth ? c.fg1 : c.fg4))
                HStack(spacing: 3) {
                    ForEach(cell.marks) { mark in
                        MarkDot(mark: mark, size: compact ? 6 : 8)
                    }
                    if cell.overflow > 0 {
                        Text("+\(cell.overflow)")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(c.fg3)
                    }
                }
                .frame(height: 8)
                if cell.hasEvent {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(c.fg3)
                } else if !compact {
                    Color.clear.frame(height: 8)
                }
            }
            .frame(maxWidth: .infinity, minHeight: compact ? 50 : 72)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(c.surface2)
                        .matchedGeometryEffect(id: "selected-day", in: selection)
                } else if targeted {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(c.surfaceActive)
                }
            }
            .opacity(cell.isInMonth ? 1 : 0.55)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.first else { return false }
            return onDrop(id)
        } isTargeted: { targeted = $0 }
        .accessibilityLabel(cell.accessibilityLabel)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(isSelected ? "Opens the day" : "Selects the day")
    }
}

/// A session mark: filled when done, a ring when planned, dim when missed or skipped.
private struct MarkDot: View {
    let mark: CalendarMark
    let size: CGFloat
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        let color = DataColor.sport(mark.sport)
        switch mark.state {
        case .done:
            Circle().fill(color).frame(width: size, height: size)
        case .missed:
            Circle().strokeBorder(c.fg4, lineWidth: 1.2).frame(width: size, height: size)
        case .skipped:
            Capsule().fill(c.fg4).frame(width: size, height: 1.5).frame(height: size)
        case .planned, .unknown:
            Circle().strokeBorder(color, lineWidth: 1.4).frame(width: size, height: size)
        }
    }
}

/// The selected week's summary: "W47 · Run base", hours done of plan + thin bar, "Load 464 · Form −6".
@MainActor
struct WeekSummaryCard: View {
    let line: WeekSummaryLine
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        NavigationLink(value: Route.week(line.isoWeek)) {
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack {
                    Text(line.title)
                        .font(Theme.Typography.label)
                        .foregroundStyle(c.fg2)
                        .lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(c.fg3)
                }
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                    Text(line.hoursText)
                        .font(Theme.Typography.statMedium)
                        .foregroundStyle(c.fg1)
                        .contentTransition(.numericText())
                    Text(line.ofText)
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg3)
                }
                if !line.isFuture {
                    ThinProgressBar(fraction: line.fraction)
                }
                Text(line.detailText)
                    .font(Theme.Typography.bodySmall)
                    .foregroundStyle(c.fg2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .cadenceCard(padding: Theme.Space.m)
        }
        .buttonStyle(.plain)
        .zoomSource(.week(line.isoWeek))
        .animation(Theme.Motion.smooth, value: line)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.accessibilityLabel)
    }
}
