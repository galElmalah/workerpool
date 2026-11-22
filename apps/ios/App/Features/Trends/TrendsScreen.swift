import SwiftUI
import CadenceKit

/// Trends: "am I progressing?" Range picker → headline figures → Fitness/Fatigue/Form →
/// weekly volume → week-over-week progression → intensity distribution → consistency.
@MainActor
struct TrendsScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var store = TrendsStore()
    @State private var range: TrendRange = .twelveWeeks
    @State private var metric: VolumeMetric = .hours

    var body: some View {
        let c = Theme.colors(accent)
        let today = store.today ?? model.today
        let todayDay = Day(today) ?? Day(Date())
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    Text(range.subtitle(today: todayDay))
                        .font(Theme.Typography.bodySmall)
                        .foregroundStyle(c.fg3)
                        .contentTransition(.opacity)
                    Picker("Range", selection: $range) {
                        ForEach(TrendRange.allCases) { r in
                            Text(r.label).tag(r).accessibilityLabel(Text(r.accessibilityLabel))
                        }
                    }
                    .pickerStyle(.segmented)
                    if store.isOffline {
                        OfflineNotice(storedAt: store.weekly.storedAt)
                    }
                }

                if store.isEmptyAndLoading {
                    LoadingBlock()
                } else if store.failedEverything {
                    FailedBlock(error: store.weekly.error ?? store.fitness.error) { Task { await load() } }
                } else {
                    content(today: today)
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Theme.Space.m)
        }
        .screenBackground()
        .navigationTitle("Trends")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: model.dataVersion) { await load() }
        .task(id: range) { await loadIntensity() }
        .animation(Theme.Motion.resolved(Theme.Motion.smooth, reduceMotion: reduceMotion), value: range)
        .animation(Theme.Motion.resolved(Theme.Motion.smooth, reduceMotion: reduceMotion), value: metric)
    }

    @ViewBuilder
    private func content(today: LocalDate) -> some View {
        let weeks = store.weekly.value ?? []
        let days = store.fitness.value?.days ?? []
        let figures = TrendsHeadline.figures(weeks: weeks, fitness: days, today: today)
        if !figures.isEmpty {
            TrendsHeadlineRow(figures: figures)
        }
        if let trend = store.fitness.value {
            FitnessSection(chart: FitnessChartModel(trend: trend, range: range))
        }
        if !weeks.isEmpty {
            VolumeSection(volume: VolumeChartModel(weeks: weeks, range: range, metric: metric, units: model.units, today: today),
                          metric: $metric)
            ProgressionSection(model: ProgressionModel(weeks: weeks, range: range, metric: metric, units: model.units, today: today))
        }
        if let intensity = store.intensity.value {
            IntensitySection(chart: IntensityChartModel(trend: intensity))
        }
        if let consistency = store.consistency.value {
            ConsistencySection(model: ConsistencyModel(trend: consistency, weeks: max(range.weeks, 26)))
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        await store.load(client: client, today: model.today)
        await loadIntensity()
    }

    private func loadIntensity() async {
        guard let client = model.client else { return }
        await store.loadIntensity(client: client, weeks: range.weeks)
    }
}

/// Trends data. Fitness and weekly are fetched once for the longest range and sliced per range
/// (so the range picker morphs without a refetch); intensity is fetched per range.
@MainActor
@Observable
final class TrendsStore {
    let fitness = Remote<FitnessTrend>()
    let weekly = Remote<[WeekSummary]>()
    let intensity = Remote<IntensityTrend>()
    let consistency = Remote<ConsistencyTrend>()

    var today: LocalDate? { fitness.value?.today }
    var isOffline: Bool { weekly.isOffline || fitness.isOffline }
    var isEmptyAndLoading: Bool { weekly.value == nil && fitness.value == nil && (weekly.isFirstLoad || fitness.isFirstLoad) }
    var failedEverything: Bool { weekly.failedEmpty && fitness.failedEmpty }

    func load(client: APIClient, today: LocalDate) async {
        guard let t = Day(today) else { return }
        let from = t.adding(days: -(52 * 7 + 7)).string
        let to = t.adding(days: 56).string
        async let a: Void = fitness.load(cached: { client.cached(Endpoints.fitness(from: from, to: to)) },
                                         fetch: { try await client.fitness(from: from, to: to) })
        async let b: Void = weekly.load(cached: { client.cached(Endpoints.weekly(weeks: 53)) },
                                        fetch: { try await client.weekly(weeks: 53) })
        async let c: Void = consistency.load(cached: { client.cached(Endpoints.consistency(days: 365)) },
                                             fetch: { try await client.consistency(days: 365) })
        _ = await (a, b, c)
    }

    func loadIntensity(client: APIClient, weeks: Int) async {
        await intensity.load(cached: { client.cached(Endpoints.intensity(weeks: weeks)) },
                             fetch: { try await client.intensity(weeks: weeks) })
    }
}
