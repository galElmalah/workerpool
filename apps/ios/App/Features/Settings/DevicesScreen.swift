import SwiftUI
import CadenceKit

/// Devices with access to this Cadence server: revoke the others, sign this iPhone out.
@MainActor
struct DevicesScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.cadenceAccent) private var accent
    @State private var devices: [Device]? = nil
    @State private var error: APIError? = nil
    @State private var revoking: Set<String> = []

    var body: some View {
        let c = Theme.colors(accent)
        let currentId = model.client?.tokenStore.load()?.deviceId
        List {
            if let devices {
                let rows = DeviceRowModel.rows(devices, currentDeviceId: currentId, now: Date())
                Section {
                    ForEach(rows) { row in
                        DeviceRow(row: row, isBusy: revoking.contains(row.id))
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if !row.isCurrent {
                                    Button(role: .destructive) { revoke(row) } label: {
                                        Label("Revoke", systemImage: "xmark.circle")
                                    }
                                }
                            }
                            .contextMenu {
                                if !row.isCurrent {
                                    Button(role: .destructive) { revoke(row) } label: {
                                        Label("Revoke access", systemImage: "xmark.circle")
                                    }
                                }
                            }
                    }
                } footer: {
                    Text("Revoking signs that device out at once. Swipe left on a device to revoke it.")
                }
                .listRowBackground(c.surface1)
            } else if let error {
                Section { FailedBlock(error: error) { Task { await load() } } }
                    .listRowBackground(Color.clear)
            } else {
                Section { LoadingBlock() }
                    .listRowBackground(Color.clear)
            }
            Section {
                Button(role: .destructive) {
                    Task { await model.signOut() }
                } label: {
                    Label("Sign out this iPhone", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } footer: {
                Text("You\u{2019}ll need the server address and passphrase to connect again.")
            }
            .listRowBackground(c.surface1)
        }
        .scrollContentBackground(.hidden)
        .background(c.canvas.ignoresSafeArea())
        .navigationTitle("Devices")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task { await load() }
        .animation(Theme.Motion.smooth, value: devices)
    }

    private func revoke(_ row: DeviceRowModel) {
        guard let client = model.client, !row.isCurrent else { return }
        revoking.insert(row.id)
        Task {
            do {
                try await client.revokeDevice(id: row.id)
                devices?.removeAll { $0.id == row.id }
                model.showToast("\(row.name) can no longer reach Cadence.")
            } catch {
                model.showError(error, doing: "revoke \(row.name)")
            }
            revoking.remove(row.id)
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            devices = try await client.devices()
            error = nil
        } catch let e as APIError {
            if devices == nil { error = e }
        } catch {}
    }
}

@MainActor
private struct DeviceRow: View {
    let row: DeviceRowModel
    let isBusy: Bool
    @Environment(\.cadenceAccent) private var accent

    var body: some View {
        let c = Theme.colors(accent)
        HStack(spacing: Theme.Space.s) {
            Image(systemName: row.symbol)
                .font(.title3)
                .foregroundStyle(row.isCurrent ? c.accentInk : c.fg2)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                    .font(Theme.Typography.body.weight(row.isCurrent ? .semibold : .regular))
                    .foregroundStyle(c.fg1)
                    .lineLimit(1)
                Text(row.detail)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(c.fg3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if isBusy { ProgressView() }
        }
        .padding(.vertical, Theme.Space.xxs)
        .accessibilityElement(children: .combine)
        .accessibilityHint(row.isCurrent ? "" : "Swipe or use the actions menu to revoke")
    }
}
