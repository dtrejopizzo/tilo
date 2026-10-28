import PhotosUI
import SwiftUI

// Tilo on the iPhone: Inicio (greeting that follows the time of day, today at a glance) and four
// tabs for the rest. Same data as the web; settings (theme, account) from the header.
struct RootView: View {
    @EnvironmentObject var sync: HealthSync
    @StateObject private var store: DayStore
    @State private var tab = 0
    private let tick = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    init(sync: HealthSync) { _store = StateObject(wrappedValue: DayStore(sync: sync)) }

    var body: some View {
        TabView(selection: $tab) {
            HomeView(goTo: { tab = $0 }).tabItem { Label("Inicio", systemImage: "house.fill") }.tag(0)
            AgendaTab().tabItem { Label("Agenda", systemImage: "calendar") }.tag(1)
            TasksTab().tabItem { Label("Tareas", systemImage: "checklist") }.tag(2)
            BodyTab().tabItem { Label("Cuerpo", systemImage: "flame.fill") }.tag(3)
            HabitsTab().tabItem { Label("Hábitos", systemImage: "leaf.fill") }.tag(4)
        }
        .tint(Theme.leaf)
        .environmentObject(store)
        .overlay(alignment: .top) {
            if let toast = store.toast {
                Text(toast).font(.footnote.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 9)
                    .background(.thinMaterial, in: Capsule()).padding(.top, 4).transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .task { await store.load(pull: true) }
        .onReceive(tick) { store.now = $0 }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in Task { await store.load(pull: true) } }
    }
}

// MARK: - Time of day

struct DayMoment {
    let title: String
    let symbol: String
    let colors: [Color]

    static func at(_ date: Date) -> DayMoment {
        let h = Calendar.current.component(.hour, from: date)
        switch h {
        case 5..<7: return DayMoment(title: "Buen amanecer", symbol: "sunrise.fill", colors: [Color(red: 0.98, green: 0.62, blue: 0.47), Color(red: 0.55, green: 0.46, blue: 0.80)])
        case 7..<12: return DayMoment(title: "Buen día", symbol: "sun.max.fill", colors: [Color(red: 0.99, green: 0.80, blue: 0.36), Color(red: 0.36, green: 0.70, blue: 0.95)])
        case 12..<14: return DayMoment(title: "Buen mediodía", symbol: "sun.max.circle.fill", colors: [Color(red: 0.30, green: 0.76, blue: 0.95), Color(red: 0.18, green: 0.62, blue: 0.37)])
        case 14..<19: return DayMoment(title: "Buenas tardes", symbol: "sun.haze.fill", colors: [Color(red: 0.97, green: 0.56, blue: 0.24), Color(red: 0.84, green: 0.30, blue: 0.42)])
        case 19..<22: return DayMoment(title: "Buenas noches", symbol: "moon.stars.fill", colors: [Color(red: 0.24, green: 0.25, blue: 0.55), Color(red: 0.10, green: 0.12, blue: 0.28)])
        default: return DayMoment(title: "Hora de descansar", symbol: "bed.double.fill", colors: [Color(red: 0.10, green: 0.12, blue: 0.25), Color(red: 0.03, green: 0.04, blue: 0.10)])
        }
    }
}

// MARK: - Inicio

struct HomeView: View {
    @EnvironmentObject var store: DayStore
    @EnvironmentObject var sync: HealthSync
    let goTo: (Int) -> Void
    @State private var text = ""
    @State private var saving = false
    @State private var showSettings = false

    var body: some View {
        let moment = DayMoment.at(store.now)
        VStack(spacing: 10) {
                header(moment)
                if let day = store.day {
                    KpiGrid(day: day, addWater: { Task { await store.addWater() } }).padding(.horizontal, 14)
                    VStack(spacing: 10) {
                        BriefCard(brief: store.brief)
                        MeetingsCard(meetings: store.brief?.meetings ?? [], now: store.now, isToday: store.isToday) { goTo(1) }
                        TopTasksCard(tasks: store.brief?.tasks ?? [], date: store.dayKey, toggle: { t in Task { await store.toggle(t) } }) { goTo(2) }
                    }
                    .padding(.horizontal, 14)
                } else if let error = store.error {
                    Card("Sin conexión") { Text(error).font(.footnote).foregroundStyle(.secondary) }.padding(.horizontal, 14)
                } else {
                    ProgressView().padding(.top, 60)
                }
                Spacer(minLength: 0)
        }
        .ignoresSafeArea(edges: .top)
        .background(Theme.bg)
        .safeAreaInset(edge: .bottom) { QuickAddBar(text: $text, saving: $saving) }
        .sheet(isPresented: $showSettings) { SettingsView().environmentObject(sync) }
    }

    private func header(_ m: DayMoment) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button { store.shift(-1) } label: { Image(systemName: "chevron.left") }
                Text(store.isToday ? "Hoy" : store.date.formatted(.dateTime.weekday(.wide).day().month())).font(.subheadline.weight(.semibold))
                Button { store.shift(1) } label: { Image(systemName: "chevron.right") }
                Spacer()
                Button { showSettings = true } label: { Image(systemName: "gearshape.fill").font(.title3) }
                    .accessibilityLabel("Ajustes y tema")
            }
            .foregroundStyle(.white)
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.firstName.isEmpty ? "¡Hola!" : "¡Hola, \(store.firstName)!").font(.title.bold())
                    Text("\(m.title) · \(store.now.formatted(date: .omitted, time: .shortened))").font(.subheadline.weight(.medium)).opacity(0.9)
                }
                Spacer()
                Image(systemName: m.symbol).font(.system(size: 34)).symbolRenderingMode(.hierarchical)
            }
            .foregroundStyle(.white)
        }
        .padding(.horizontal, 18)
        .padding(.top, 58)
        .padding(.bottom, 14)
        .background(LinearGradient(colors: m.colors, startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 28, bottomTrailingRadius: 28))
        .animation(.easeInOut(duration: 0.6), value: m.title)
    }
}

struct QuickAddBar: View {
    @EnvironmentObject var store: DayStore
    @Binding var text: String
    @Binding var saving: Bool
    @StateObject private var dictation = Dictation()
    @State private var camera = false
    @State private var picked: PhotosPickerItem?
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles").foregroundStyle(Theme.leaf)
            TextField(dictation.listening ? "Te escucho…" : "Registrá o dictá lo que sea…", text: $text).submitLabel(.send).onSubmit { send() }
            if saving { ProgressView() } else if !text.isEmpty && !dictation.listening {
                Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
            } else {
                MicButton(dictation: dictation) { text = $0 }
                Menu {
                    Button { camera = true } label: { Label("Sacar foto de la comida", systemImage: "camera") }
                    PhotosPicker(selection: $picked, matching: .images) { Label("Elegir de Fotos", systemImage: "photo.on.rectangle") }
                } label: { Image(systemName: "camera.fill").font(.title3).foregroundStyle(.secondary) }
                .accessibilityLabel("Comida con foto")
            }
        }
        .onChange(of: dictation.listening) { _, on in if !on, !text.isEmpty { send() } } // stop talking → it's saved
        .fullScreenCover(isPresented: $camera) { CameraPicker { img in Task { await store.addMealPhoto(img) } }.ignoresSafeArea() }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { await store.addMealPhoto(img) }
                picked = nil
            }
        }
        .alert("Dictado", isPresented: Binding(get: { dictation.error != nil }, set: { if !$0 { dictation.error = nil } })) { Button("OK") {} } message: { Text(dictation.error ?? "") }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
        .padding(.horizontal, 12).padding(.bottom, 6)
    }
    private func send() {
        guard !saving else { return }
        saving = true
        Task {
            if await store.quickAdd(text) { text = "" }
            saving = false
        }
    }
}

// Two or three plain lines: what to do now for your health, what to prepare for work
struct BriefCard: View {
    let brief: Brief?
    var body: some View {
        Card("Tu día") {
            if let b = brief, !b.bullets.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(b.bullets.prefix(2).enumerated()), id: \.offset) { i, line in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: i == b.bullets.count - 1 && b.bullets.count > 1 ? "briefcase.fill" : "heart.fill")
                                .font(.caption).foregroundStyle(i == b.bullets.count - 1 && b.bullets.count > 1 ? Theme.carbs : Theme.leaf)
                            Text(line).font(.subheadline).lineLimit(2)
                        }
                    }
                }
            } else {
                Text(brief?.aiError ?? "Armando tu día…").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

// Only real meetings (people invited or a video call), not the routine blocks
struct MeetingsCard: View {
    let meetings: [CalEvent]
    let now: Date
    let isToday: Bool
    let more: () -> Void
    var body: some View {
        let left = meetings.filter { !isToday || (iso($0.end) ?? .distantFuture) > now }
        let current = isToday ? left.first { (iso($0.start) ?? .distantFuture) <= now } : nil
        Card("Reuniones", meta: left.isEmpty ? "ninguna más hoy" : "\(left.count) hoy", action: more) {
            if let c = current, let end = iso(c.end), let start = iso(c.start) { LiveEvent(event: c, start: start, end: end, now: now) }
            ForEach(left.filter { $0.id != current?.id }.prefix(current == nil ? 2 : 1)) { e in EventRow(event: e) }
            if left.isEmpty { Text("Sin llamadas: buen momento para trabajo profundo.").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

// The 3-4 most important open tasks; as you complete one, the next takes its place
struct TopTasksCard: View {
    let tasks: [TaskItem]
    let date: String
    let toggle: (TaskItem) -> Void
    let more: () -> Void
    var body: some View {
        Card("Lo importante", action: more) {
            ForEach(tasks.prefix(3)) { t in TaskRow(task: t, date: date, compact: true) { toggle(t) } }
            if tasks.isEmpty { Text("Nada urgente pendiente.").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

struct PanoramaCard: View {
    let insights: Insights?
    var body: some View {
        Card("Panorama del día") {
            if let i = insights, !i.bullets.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(i.bullets.enumerated()), id: \.offset) { _, b in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Circle().fill(Theme.leaf).frame(width: 6, height: 6)
                            Text(b).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            } else {
                Text(insights?.aiError ?? "Armando tu panorama…").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

// The meeting in progress (or the next one) and what's left today, compact
struct NowCard: View {
    let events: [CalEvent]
    let now: Date
    let isToday: Bool
    let more: () -> Void
    var body: some View {
        let timed = events.filter { !$0.allDay }
        let current = isToday ? timed.first { (iso($0.start) ?? .distantFuture) <= now && (iso($0.end) ?? .distantPast) > now } : nil
        let upcoming = timed.filter { $0.id != current?.id }.prefix(3)
        Card("Agenda", meta: timed.isEmpty ? "libre" : "\(timed.count) por delante") {
            if let c = current, let end = iso(c.end), let start = iso(c.start) { LiveEvent(event: c, start: start, end: end, now: now) }
            ForEach(Array(upcoming)) { e in EventRow(event: e) }
            if timed.isEmpty { Text("Nada más por hoy.").font(.footnote).foregroundStyle(.secondary) }
            if timed.count > 3 { Button("Ver toda la agenda", action: more).font(.footnote.weight(.semibold)) }
        }
    }
}

struct NextTasksCard: View {
    let day: DayData
    let date: String
    let toggle: (TaskItem) -> Void
    let more: () -> Void
    var body: some View {
        let open = (day.tasks ?? []).filter { $0.status == "todo" && ($0.due_date ?? "9999") <= date }
        Card("Tareas de hoy", meta: "\(open.count) pendientes") {
            ForEach(open.prefix(4)) { t in TaskRow(task: t, date: date) { toggle(t) } }
            if open.isEmpty { Text("Nada pendiente para hoy.").font(.footnote).foregroundStyle(.secondary) }
            if open.count > 4 { Button("Ver las \(open.count) tareas", action: more).font(.footnote.weight(.semibold)) }
        }
    }
}

// MARK: - Tabs

struct TabPage<Content: View>: View {
    @EnvironmentObject var store: DayStore
    let title: String
    var add: (() -> Void)? = nil
    @ViewBuilder var content: Content
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if store.day != nil { content } else { ProgressView().padding(.top, 60) }
                }
                .padding(.horizontal, 14).padding(.bottom, 16)
            }
            .background(Theme.bg)
            .refreshable { await store.load(pull: true) }
            .navigationTitle(title)
            .toolbar {
                if let add {
                    ToolbarItem(placement: .topBarLeading) { Button(action: add) { Image(systemName: "plus.circle.fill").font(.title2) }.accessibilityLabel("Nueva tarea") }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { store.shift(-1) } label: { Image(systemName: "chevron.left") }
                    Text(store.isToday ? "Hoy" : store.date.formatted(.dateTime.day().month())).font(.subheadline.weight(.semibold))
                    Button { store.shift(1) } label: { Image(systemName: "chevron.right") }
                }
            }
        }
    }
}

struct AgendaTab: View {
    @EnvironmentObject var store: DayStore
    var body: some View {
        TabPage(title: "Agenda") {
            AgendaCard(events: store.visibleEvents, now: store.now, isToday: store.isToday)
        }
    }
}

struct TasksTab: View {
    @EnvironmentObject var store: DayStore
    @State private var adding = false
    var body: some View {
        TabPage(title: "Tareas", add: { adding = true }) {
            if let day = store.day {
                let date = store.dayKey
                let all = day.tasks ?? []
                let overdue = all.filter { $0.status == "todo" && ($0.due_date ?? "9999") < date }
                let today = all.filter { $0.status == "todo" && $0.due_date == date }
                let later = all.filter { $0.status == "todo" && ($0.due_date ?? "") > date }
                let someday = all.filter { $0.status == "todo" && $0.due_date == nil }
                let done = all.filter { $0.status == "done" }
                ForEach([("Vencidas", overdue), ("Hoy", today), ("Próximas", later), ("Sin fecha", someday), ("Hechas hoy", done)], id: \.0) { group in
                    if !group.1.isEmpty {
                        Card(group.0, meta: "\(group.1.count)") {
                            ForEach(group.1) { t in TaskRow(task: t, date: date) { Task { await store.toggle(t) } } }
                        }
                    }
                }
                if all.isEmpty { Card("Tareas") { Text("No hay tareas. Tocá + para agregar una.").font(.footnote).foregroundStyle(.secondary) } }
            }
        }
        .sheet(isPresented: $adding) { NewTaskSheet().environmentObject(store) }
    }
}

// New task: title, project (one of yours or a new one), deadline and priority
struct NewTaskSheet: View {
    @EnvironmentObject var store: DayStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var project = ""
    @State private var newProject = ""
    @State private var hasDue = true
    @State private var due = Date()
    @State private var priority = "medium"
    @State private var saving = false
    @StateObject private var dictation = Dictation()
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .top) {
                        TextField(dictation.listening ? "Te escucho…" : "¿Qué tenés que hacer? (escribí o dictá)", text: $title, axis: .vertical).focused($focused)
                        MicButton(dictation: dictation) { title = $0 }
                    }
                }
                Section("Proyecto") {
                    Picker("Proyecto", selection: $project) {
                        Text("Sin proyecto").tag("")
                        ForEach(store.day?.projects ?? []) { p in Text(p.name).tag(p.name) }
                        Text("Nuevo proyecto…").tag("__new__")
                    }
                    if project == "__new__" { TextField("Nombre del proyecto", text: $newProject) }
                }
                Section("Cuándo") {
                    Toggle("Fecha límite", isOn: $hasDue)
                    if hasDue { DatePicker("Fecha", selection: $due, displayedComponents: .date) }
                }
                Section("Prioridad") {
                    Picker("Prioridad", selection: $priority) {
                        Text("Alta").tag("high"); Text("Media").tag("medium"); Text("Baja").tag("low")
                    }.pickerStyle(.segmented)
                }
            }
            .navigationTitle("Nueva tarea")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Guardando…" : "Agregar") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
            .onAppear { focused = true }
        }
    }
    private func save() async {
        saving = true
        let name = project == "__new__" ? newProject.trimmingCharacters(in: .whitespaces) : project
        if await store.addTask(title: title.trimmingCharacters(in: .whitespacesAndNewlines), due: hasDue ? HealthSync.day(due) : nil, priority: priority, project: name.isEmpty ? nil : name) { dismiss() }
        saving = false
    }
}

struct BodyTab: View {
    @EnvironmentObject var store: DayStore
    var body: some View {
        TabPage(title: "Cuerpo") {
            if let day = store.day {
                PanoramaCard(insights: store.insights)
                EnergyCard(day: day)
                ActivitiesCard(day: day)
                MealsCard(day: day)
            }
        }
    }
}

struct HabitsTab: View {
    @EnvironmentObject var store: DayStore
    var body: some View {
        TabPage(title: "Hábitos") {
            if let day = store.day {
                ChecklistCard(day: day) { kind, id, on in Task { await store.check(kind, id, on) } }
            }
        }
    }
}

// MARK: - Pieces shared by Inicio and the tabs

struct LiveEvent: View {
    let event: CalEvent
    let start: Date
    let end: Date
    let now: Date
    @State private var pulse = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle().fill(Theme.live).frame(width: 8, height: 8).opacity(pulse ? 0.3 : 1)
                    .animation(.easeInOut(duration: 0.8).repeatForever(), value: pulse).onAppear { pulse = true }
                Text(event.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer()
                Text("quedan \(max(1, Int(end.timeIntervalSince(now) / 60))) min").font(.caption.monospaced()).foregroundStyle(.secondary)
            }
            GeometryReader { geo in
                Capsule().fill(Theme.live).frame(width: geo.size.width * max(0, end.timeIntervalSince(now) / end.timeIntervalSince(start)))
            }.frame(height: 3)
        }
        .padding(10).background(Theme.live.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct EventRow: View {
    let event: CalEvent
    var body: some View {
        HStack(spacing: 10) {
            Text(event.allDay ? "día" : (iso(event.start)?.formatted(date: .omitted, time: .shortened) ?? "")).font(.caption.monospaced()).foregroundStyle(.secondary).frame(width: 48, alignment: .leading)
            RoundedRectangle(cornerRadius: 1).fill(Theme.carbs).frame(width: 2, height: 16)
            Text(event.title).font(.subheadline).lineLimit(1)
            Spacer()
            if let a = event.account { Text(a.split(separator: "@").last?.split(separator: ".").first.map(String.init) ?? "").font(.caption2).foregroundStyle(Theme.carbs) }
        }
    }
}

struct TaskRow: View {
    let task: TaskItem
    let date: String
    var compact = false
    let toggle: () -> Void
    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 10) {
                Check(on: task.status == "done")
                Text(task.title).font(.subheadline).lineLimit(compact ? 1 : 2).multilineTextAlignment(.leading)
                    .strikethrough(task.status == "done").foregroundStyle(task.status == "done" ? .secondary : .primary)
                Spacer(minLength: 4)
                if let due = task.due_date, due < date, task.status != "done" { Pill("vencida", Theme.danger) }
                else if task.priority == "high", task.status != "done" { Pill("alta", Theme.danger) }
                if task.source == "email" { Pill("mail", Theme.carbs) }
            }
        }.buttonStyle(.plain)
    }
}

struct ActivitiesCard: View {
    let day: DayData
    static let labels = ["run": "Correr", "walk": "Caminar", "hike": "Trekking", "ride": "Bici", "swim": "Natación", "strength": "Fuerza", "hiit": "HIIT", "other": "Entrenamiento", "yoga": "Yoga", "tennis": "Tenis", "padel": "Pádel", "golf": "Golf", "football": "Fútbol"]
    var body: some View {
        let acts = day.activities ?? []
        Card("Ejercicios", meta: acts.isEmpty ? nil : "\(acts.count)") {
            ForEach(acts) { a in
                HStack(spacing: 10) {
                    Image(systemName: a.source == "strava" ? "figure.run.circle.fill" : "heart.circle.fill").foregroundStyle(a.source == "strava" ? Color.orange : Color.pink)
                    Text(a.name?.isEmpty == false ? a.name! : (Self.labels[a.type] ?? a.type)).font(.subheadline).lineLimit(1)
                    Spacer()
                    Text("\(Int((a.duration_s?.value ?? 0) / 60)) min").font(.caption.monospaced()).foregroundStyle(.secondary)
                    if let d = a.distance_m?.value, d > 0 { Text(String(format: "%.1f km", d / 1000)).font(.caption.monospaced()).foregroundStyle(.secondary) }
                    if let k = a.kcal?.value, k > 0 { Text("\(fmt(k)) kcal").font(.caption.monospaced().weight(.semibold)).foregroundStyle(Theme.leaf) }
                }
            }
            if acts.isEmpty { Text("Todavía no hay entrenamientos hoy.").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}
