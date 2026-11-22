import Foundation
import WidgetKit
import CadenceKit

/// Cache first, network when the cache is older than `WidgetRefresh.maxCacheAge`, timeline from
/// `WidgetRefresh.plan`. Shared by every provider; all decisions live in CadenceKit.
struct SnapshotLoader {
    struct Options {
        var kind: CadenceWidgetKind
        /// fetch this week's calendar (large Week widget)
        var weekCalendar = false
        /// sync / read the morning check-in (check-in widget)
        var checkIn = false
        var metric: WeekWidgetMetric = .hours
    }

    let config = AppGroupConfig.fromInfoPlist()

    var accent: Accent { SharedPreferences(defaults: config.defaults).accent }

    /// Instant entry from the cache only (widget gallery snapshot, first paint).
    func cachedEntry(options: Options, now: Date = Date()) -> CadenceEntry {
        let cached = SnapshotCache(directory: config.containerURL).load()
        guard let cached else {
            return CadenceEntry.preview(accent: accent, metric: options.metric)
        }
        let record = options.checkIn ? CheckInStore(defaults: config.defaults).load() : nil
        return CadenceEntry(date: now, content: .data(cached.snapshot, fetchedAt: cached.fetchedAt), accent: accent,
                            checkIn: record, metric: options.metric)
    }

    /// The full timeline: refresh when stale, then one entry per `WidgetRefresh.plan` date.
    func timeline(options: Options) async -> Timeline<CadenceEntry> {
        let now = Date()
        let cache = SnapshotCache(directory: config.containerURL)
        let checkIns = CheckInStore(defaults: config.defaults)
        var cached = cache.load()
        var calendar: CalendarResponse?

        let tokenStore = KeychainTokenStore(accessGroup: config.keychainGroup)
        let responses = ResponseCache(directory: config.containerURL.appendingPathComponent("WidgetResponses", isDirectory: true),
                                      maxEntries: 12)
        let client = APIClient.restore(tokenStore: tokenStore,
                                       transport: URLSessionTransport(session: URLSessionTransport.defaultSession(timeout: 15)),
                                       responseCache: responses)
        var signedOut = false

        if let client {
            var fetched = false
            if WidgetRefresh.shouldFetch(fetchedAt: cached?.fetchedAt, now: now) {
                do {
                    let fresh = try await client.refreshSnapshot(into: cache, now: now)
                    cached = SnapshotCache.Entry(snapshot: fresh, fetchedAt: now)
                    fetched = true
                } catch APIError.unauthorized {
                    // revoked: the client already cleared the token; drop the data too
                    cache.clear()
                    checkIns.clear()
                    cached = nil
                    signedOut = true
                } catch {
                    // offline / server trouble: keep the cache, try again at the next reload
                }
            }
            if !signedOut && options.checkIn {
                await syncCheckIn(client: client, store: checkIns, now: now, readServer: fetched)
            }
            if !signedOut && options.weekCalendar, let s = cached?.snapshot,
               let from = s.week.days.first?.date, let to = s.week.days.last?.date {
                let endpoint = Endpoints.calendar(from: from, to: to)
                if fetched || client.cached(endpoint) == nil {
                    calendar = try? await client.calendar(from: from, to: to)
                }
                if calendar == nil { calendar = client.cached(endpoint)?.value }
            }
        } else if cached == nil {
            signedOut = true
        }
        // No token but a cache: most likely the keychain is locked (before first unlock after a
        // restart). Sign-out clears the cache, so showing it is safe; retry soon.

        let accent = self.accent
        let record = options.checkIn ? checkIns.load() : nil
        if signedOut {
            let entry = CadenceEntry(date: now, content: .signedOut, accent: accent, metric: options.metric)
            return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(WidgetRefresh.signedOutInterval)))
        }
        guard let cached else {
            let entry = CadenceEntry(date: now, content: .empty, accent: accent, metric: options.metric)
            return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(WidgetRefresh.retryInterval)))
        }

        let plan = WidgetRefresh.plan(for: cached.snapshot, fetchedAt: cached.fetchedAt, now: now)
        let reload = client == nil ? min(plan.reloadAfter, now.addingTimeInterval(WidgetRefresh.retryInterval)) : plan.reloadAfter
        let entries = plan.entryDates.map { date -> CadenceEntry in
            let logged = record.map { $0.date == Day(date).string } ?? false
            let hint = WidgetModels.relevance(options.kind, snapshot: cached.snapshot, checkInLogged: logged, now: date)
            return CadenceEntry(date: date, content: .data(cached.snapshot, fetchedAt: cached.fetchedAt), accent: accent,
                                calendar: calendar, checkIn: record, metric: options.metric,
                                relevance: TimelineEntryRelevance(score: Float(hint.score), duration: hint.duration))
        }
        return Timeline(entries: entries, policy: .after(reload))
    }

    /// Sends a check-in that failed earlier; on a fresh fetch also adopts one logged elsewhere (web).
    private func syncCheckIn(client: APIClient, store: CheckInStore, now: Date, readServer: Bool) async {
        if var pending = store.pending(now: now) {
            if (try? await client.checkIn(date: pending.date, WellnessCheckIn(feel: .value(pending.feel)))) != nil {
                pending.synced = true
                store.save(pending)
            }
            return
        }
        let today = Day(now).string
        guard readServer, store.record(for: today) == nil else { return }
        if let day = try? await client.wellness(date: today), let feel = day.feel, CheckInScale.range.contains(feel) {
            store.save(CheckInRecord(date: today, feel: feel, savedAt: now, synced: true))
        }
    }
}

// MARK: - Providers

/// Today, Form, Next race and Check-in (no configuration).
struct CadenceProvider: TimelineProvider {
    let options: SnapshotLoader.Options

    init(_ kind: CadenceWidgetKind, checkIn: Bool = false) {
        options = SnapshotLoader.Options(kind: kind, checkIn: checkIn)
    }

    func placeholder(in context: Context) -> CadenceEntry {
        CadenceEntry.preview()
    }

    func getSnapshot(in context: Context, completion: @escaping (CadenceEntry) -> Void) {
        if context.isPreview {
            completion(CadenceEntry.preview(accent: SnapshotLoader().accent))
        } else {
            completion(SnapshotLoader().cachedEntry(options: options))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CadenceEntry>) -> Void) {
        let options = self.options
        Task {
            completion(await SnapshotLoader().timeline(options: options))
        }
    }
}

/// Week (configurable: lead with hours or load). The large family also loads the week's sessions.
struct WeekProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> CadenceEntry {
        CadenceEntry.preview()
    }

    func snapshot(for configuration: WeekWidgetConfigurationIntent, in context: Context) async -> CadenceEntry {
        let options = makeOptions(configuration, context)
        if context.isPreview {
            return CadenceEntry.preview(accent: SnapshotLoader().accent, metric: options.metric)
        }
        return SnapshotLoader().cachedEntry(options: options)
    }

    func timeline(for configuration: WeekWidgetConfigurationIntent, in context: Context) async -> Timeline<CadenceEntry> {
        await SnapshotLoader().timeline(options: makeOptions(configuration, context))
    }

    private func makeOptions(_ configuration: WeekWidgetConfigurationIntent, _ context: Context) -> SnapshotLoader.Options {
        SnapshotLoader.Options(kind: .week, weekCalendar: context.family == .systemLarge, checkIn: false,
                               metric: configuration.metric.metric)
    }
}
