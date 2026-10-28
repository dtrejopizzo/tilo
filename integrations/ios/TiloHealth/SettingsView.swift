import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var sync: HealthSync
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var manualToken = ""
    @State private var showManual = false
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue

    var body: some View {
        settings.preferredColorScheme(Appearance(rawValue: appearance)?.scheme) // sheets don't inherit it
    }

    private var settings: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tilo").font(.largeTitle.bold())
                        Text("Manda Apple Health a tu tablero sola, cada vez que Salud recibe algo nuevo: pasos, entrenamientos (con kcal y frecuencia cardíaca), sueño y peso.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                if sync.token == nil {
                    Section("1 · Tu cuenta") {
                        Button {
                            Task { await login() }
                        } label: {
                            Label("Iniciar sesión con Tilo", systemImage: "person.crop.circle.badge.checkmark")
                        }
                        DisclosureGroup("Pegar un token", isExpanded: $showManual) {
                            SecureField("tilo_…", text: $manualToken).textInputAutocapitalization(.never).autocorrectionDisabled()
                            TextField("Servidor", text: $sync.baseURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                            Button("Guardar") { sync.setToken(manualToken.trimmingCharacters(in: .whitespacesAndNewlines)) }
                                .disabled(!manualToken.hasPrefix("tilo_"))
                        }
                    }
                } else {
                    Section("1 · Tu cuenta") {
                        Label("Conectado a \(URL(string: sync.baseURL)?.host ?? sync.baseURL)", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                }

                Section("Apariencia") {
                    Picker("Tema", selection: $appearance) {
                        ForEach(Appearance.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                }

                Section("2 · Apple Health") {
                    if sync.healthConnected {
                        Label("Salud conectada", systemImage: "heart.fill").foregroundStyle(.pink)
                    }
                    Button {
                        Task { await sync.connectHealth() }
                    } label: {
                        Label(sync.healthConnected ? "Revisar permisos de Salud" : "Conectar Apple Health", systemImage: "heart.text.square")
                    }
                    .disabled(sync.token == nil)
                }

                if sync.token != nil && sync.healthConnected {
                    Section("Sincronización") {
                        Button {
                            Task { await sync.sync(reason: "a mano", force: true) }
                        } label: {
                            HStack {
                                Label("Sincronizar ahora", systemImage: "arrow.triangle.2.circlepath")
                                if sync.busy { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(sync.busy)
                        if let last = sync.lastSync {
                            LabeledContent("Última", value: last.formatted(.relative(presentation: .named)))
                        }
                        if !sync.lastResult.isEmpty {
                            Text(sync.lastResult).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Section {
                        Text("Podés cerrar la app. iOS la despierta cuando Salud recibe datos nuevos y además cada hora más o menos.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Cerrar sesión", role: .destructive) { sync.signOut() }
                    }
                }
            }
        }
    }

    private func login() async {
        let state = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        sync.pendingState = state
        guard let url = URL(string: "\(sync.baseURL)/api/connect/ios?state=\(state)") else { return }
        do {
            let callback = try await webAuth.authenticate(using: url, callbackURLScheme: "tilohealth", preferredBrowserSession: .shared)
            sync.handleCallback(callback)
        } catch {
            sync.lastResult = "Inicio de sesión cancelado"
        }
    }
}
