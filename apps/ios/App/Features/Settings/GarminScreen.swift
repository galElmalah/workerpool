import SwiftUI
import CadenceKit

/// Garmin: connection status, last sync, "Sync now", and the recent sync log.
/// Connecting an account happens in the web app (credentials never touch the phone).
@MainActor
struct GarminScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var status = Remote<GarminStatus>()
    @State private var log = Remote<SyncLogPage>()
    @State private var isSyncing = false
    @State private var resultText: String? = nil
    @State private var syncCount = 0

    var body: some View {
        let c = Theme.colors(accent)
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.xl) {
                if status.isOffline {
                    OfflineNotice(storedAt: status.storedAt)
                }
                if let s = status.value {
                    let vm = GarminStatusModel(status: s, now: Date())
                    statusBlock(vm, c)
                    VStack(alignment: .leading, spacing: Theme.Space.s) {
                        Button {
                            sync()
                        } label: {
                            HStack(spacing: Theme.Space.xs) {
                                if isSyncing {
                                    ProgressView().tint(c.onAccent)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text(isSyncing ? "Syncing\u{2026}" : "Sync now")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isSyncing || !vm.canSync)
                        .sensoryFeedback(.success, trigger: syncCount)
                        if let resultText {
                            Text(resultText)
                                .font(Theme.Typography.bodySmall)
                                .foregroundStyle(c.fg2)
                                .transition(.opacity)
                        }
                        if !vm.canSync {
                            Text("Connect your Garmin account in Cadence on the web, then sync from here.")
                                .font(Theme.Typography.bodySmall)
                                .foregroundStyle(c.fg3)
                        }
                    }
                } else if status.failedEmpty {
                    FailedBlock(error: status.error) { Task { await load() } }
                } else {
                    LoadingBlock()
                }
                if let entries = log.value?.entries, !entries.isEmpty {
                    ScreenSection("Recent syncs") {
                        SyncLogList(rows: entries.map { SyncLogRowModel(entry: $0, now: Date()) })
                    }
                }
            }
            .padding(.horizontal, Theme.Space.gutter)
            .padding(.vertical, Theme.Space.m)
            .animation(Theme.Motion.smooth, value: resultText)
        }
        .screenBackground()
        .navigationTitle("Garmin")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: model.dataVersion) { await load() }
    }

    @ViewBuilder
    private func statusBlock(_ vm: GarminStatusModel, _ c: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.xs) {
                Image(systemName: vm.canSync ? AnalysisTone.good.symbol : "circle.dashed")
                    .foregroundStyle(vm.canSync ? DataColor.good : c.fg3)
                    .accessibilityHidden(true)
                Text(vm.stateText)
                    .font(Theme.Typography.title2)
                    .foregroundStyle(c.fg1)
                if let account = vm.accountText {
                    Text(account)
                        .font(Theme.Typography.body)
                        .foregroundStyle(c.fg2)
                        .lineLimit(1)
                }
            }
            Text(vm.lastSyncText)
                .font(Theme.Typography.body)
                .foregroundStyle(c.fg2)
            if let counts = vm.countsText {
                Text(counts)
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg3)
            }
            if let backfill = vm.backfillText {
                Text(backfill)
                    .font(Theme.Typography.bodySmall.monospacedDigit())
                    .foregroundStyle(c.fg3)
            }
            if let error = vm.errorText {
                Label {
                    Text(error).foregroundStyle(c.fg1)
                } icon: {
                    Image(systemName: AnalysisTone.critical.symbol).foregroundStyle(DataColor.critical)
                }
                .font(Theme.Typography.bodySmall)
            }
            if vm.isDemo {
                Text("Demo server: syncing replays sample data.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func sync() {
        guard let client = model.client, !isSyncing else { return }
        isSyncing = true
        resultText = nil
        Task {
            do {
                let report = try await client.syncNow()
                resultText = SyncResultText.text(report)
                syncCount += 1
                await model.didWrite()
            } catch let e as APIError {
                resultText = SyncResultText.error(e)
            } catch {
                resultText = nil
            }
            isSyncing = false
            await load()
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        await status.load(cached: { client.cached(Endpoints.garminStatus()) }, fetch: { try await client.garminStatus() })
        await log.load(cached: { nil }, fetch: { try await client.syncLog(limit: 20) })
    }
}

/// Sync log rows: status symbol, summary (wraps), kind · when. Long lists scroll inside a capped area.
@MainActor
struct SyncLogList: View {
    let rows: [SyncLogRowModel]
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                    Image(systemName: row.symbol)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(row.isError ? DataColor.critical : c.fg3)
                        .frame(width: 18)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.summary)
                            .font(Theme.Typography.bodySmall)
                            .foregroundStyle(c.fg1)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("\(row.kindText)\(Format.dot)\(row.whenText)")
                            .font(Theme.Typography.caption.monospacedDigit())
                            .foregroundStyle(c.fg3)
                        if let detail = row.detail {
                            ScrollView(.horizontal, showsIndicators: false) {
                                Text(detail)
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(c.fg3)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                .padding(.vertical, Theme.Space.s)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("\(row.isError ? "Error, " : "")\(row.summary), \(row.kindText), \(row.whenText)"))
                if row.id != rows.last?.id {
                    Rectangle().fill(c.line1).frame(height: 0.5)
                }
            }
        }
    }
}
