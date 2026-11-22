import SwiftUI
import CadenceKit

/// One completed activity: hero → plan vs actual → map → charts → all metrics → laps → zones →
/// peaks → strength → your log (RPE, feel, note, key, intensity). Offline: cached detail first.
@MainActor
struct ActivityScreen: View {
    let id: String
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var store: ActivityStore

    init(id: String) {
        self.id = id
        _store = State(initialValue: ActivityStore(id: id))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                if store.detail.isOffline {
                    OfflineNotice(storedAt: store.detail.storedAt)
                }
                if let vm = store.vm {
                    ActivityHero(vm: vm)
                    if let plan = vm.plan {
                        PlanVersusActual(plan: plan)
                    }
                    if let chart = store.chart, let route = chart.route {
                        ActivityRouteSection(store: store, route: route, sport: vm.sport, title: vm.title)
                    }
                    if let chart = store.chart, !chart.tracks.isEmpty {
                        ActivityChartsSection(store: store, chart: chart)
                    } else if store.isLoadingStreams {
                        ChartPlaceholder()
                    }
                    ActivityMetricsSection(groups: vm.metricGroups)
                    if let laps = vm.laps {
                        ScreenSection("Laps") { LapsTableView(table: laps) }
                    }
                    if !vm.zones.isEmpty {
                        ActivityZonesSection(zones: vm.zones)
                    }
                    if !vm.peaks.isEmpty || !vm.efforts.isEmpty {
                        ActivityPeaksSection(peaks: vm.peaks, efforts: vm.efforts)
                    }
                    if !vm.strength.isEmpty {
                        StrengthSection(rows: vm.strength)
                    }
                    ActivityLogSection(store: store)
                } else if store.detail.failedEmpty {
                    FailedBlock(error: store.detail.error) { Task { await load() } }
                } else {
                    LoadingBlock()
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Theme.Space.l)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle(store.vm?.title ?? "Activity")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: model.dataVersion) { await load() }
        .onDisappear {
            guard let client = model.client else { return }
            Task { await store.flushNote(client: client, model: model) }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        await store.load(client: client, units: model.units)
    }
}

/// Space reserved for the charts while streams load (no layout jump).
@MainActor
private struct ChartPlaceholder: View {
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
            .fill(Theme.colors(accent).surface1)
            .frame(height: 220)
            .overlay(ProgressView())
            .accessibilityLabel("Loading charts")
    }
}

/// Detail + streams + the editable log for one activity.
@MainActor
@Observable
final class ActivityStore {
    let id: String
    let detail = Remote<ActivityDetail>()
    private(set) var vm: ActivityDetailModel? = nil
    private(set) var chart: StreamChartModel? = nil
    private(set) var streams: ActivityStreams? = nil
    private(set) var isLoadingStreams = false
    /// shared scrubbing position (seconds) — read only by the chart and map sections
    var selection: Double? = nil

    // the log, edited locally then saved
    var rpe: Int? = nil
    var feel: Int? = nil
    var note: String = ""
    private(set) var savedNote: String = ""
    private(set) var noteState: NoteSaveState = .idle
    private var seededLog = false
    private var units: UnitSystem = .metric

    init(id: String) { self.id = id }

    var readout: StreamReadout? {
        guard let x = selection else { return nil }
        return chart?.readout(at: x)
    }

    func load(client: APIClient, units: UnitSystem) async {
        self.units = units
        await detail.load(cached: { client.cached(Endpoints.activity(id: id)) },
                          fetch: { try await client.activity(id: id) })
        rebuild()
        guard let d = detail.value, d.hasStreams else { return }
        if streams == nil {
            if let hit = client.cached(Endpoints.streams(activityId: id, maxPoints: 1200)) {
                await setStreams(hit.value, sport: d.sport)
            }
            isLoadingStreams = streams == nil
            do {
                let s = try await client.streams(activityId: id, maxPoints: 1200)
                await setStreams(s, sport: d.sport)
            } catch {
                // charts stay hidden; the rest of the page works
            }
            isLoadingStreams = false
        }
    }

    private func setStreams(_ s: ActivityStreams, sport: Sport) async {
        let units = self.units
        let model = await Task.detached(priority: .userInitiated) {
            StreamChartModel(streams: s, sport: sport, units: units)
        }.value
        streams = s
        chart = model
        rebuild()
    }

    private func rebuild() {
        guard let d = detail.value else { return }
        vm = ActivityDetailModel(detail: d, units: units, streams: streams)
        if !seededLog {
            seededLog = true
            rpe = d.rpe
            feel = d.feel
            note = d.postNote ?? ""
            savedNote = note
        }
    }

    private func applyUpdated(_ a: Activity) {
        detail.update { d in
            var copy = d
            copy.activity = a
            return copy
        }
        rebuild()
    }

    // MARK: Writes (optimistic; errors go to the toast)

    func setRPE(_ value: Int?, client: APIClient, model: AppModel) async {
        let old = rpe
        rpe = value
        do {
            applyUpdated(try await client.setRPE(activityId: id, value))
            await model.didWrite()
        } catch {
            rpe = old
            model.showError(error, doing: "save RPE")
        }
    }

    func setFeel(_ value: Int?, client: APIClient, model: AppModel) async {
        let old = feel
        feel = value
        do {
            applyUpdated(try await client.setFeel(activityId: id, value))
            await model.didWrite()
        } catch {
            feel = old
            model.showError(error, doing: "save how it felt")
        }
    }

    func setKey(_ isKey: Bool, client: APIClient, model: AppModel) async {
        do {
            applyUpdated(try await client.setActivityKey(activityId: id, isKey))
            await model.didWrite()
        } catch {
            model.showError(error, doing: "mark as key")
        }
    }

    func setIntensity(_ value: IntensityClass?, client: APIClient, model: AppModel) async {
        do {
            applyUpdated(try await client.setActivityIntensity(activityId: id, value))
            await model.didWrite()
        } catch {
            model.showError(error, doing: "change intensity")
        }
    }

    /// Autosave target: saves when the text differs from the last saved value.
    func saveNote(client: APIClient, model: AppModel) async {
        let text = note
        guard text != savedNote else { return }
        noteState = .saving
        do {
            let a = try await client.setActivityNote(activityId: id, text.trimmingCharacters(in: .whitespacesAndNewlines))
            savedNote = text
            noteState = .saved
            applyUpdated(a)
            await model.didWrite()
        } catch let e as APIError {
            noteState = .failed(e.isOffline ? "You\u{2019}re offline." : e.message)
        } catch {
            noteState = .idle
        }
    }

    /// Leaving the screen: save a pending edit right away.
    func flushNote(client: APIClient, model: AppModel) async {
        if note != savedNote { await saveNote(client: client, model: model) }
    }
}
