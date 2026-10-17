import SwiftUI

// Tilo's Today on the iPhone: the same day as the web, laid out for one hand.
// KPIs → what's happening now (calendar) → tasks → habits → meals → energy, and a quick-add bar
// pinned above the keyboard.
struct TodayView: View {
    @EnvironmentObject var sync: HealthSync
    @State private var date = Date()
    @State private var day: DayData?
    @State private var events: [CalEvent] = []
    @State private var error: String?
    @State private var text = ""
    @State private var saving = false
    @State private var toast: String?
    @State private var showSettings = false
    @State private var now = Date()
    private let tick = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private var api: API? { sync.token.map { API(base: sync.baseURL, token: $0) } }
    private var dayKey: String { HealthSync.day(date) }
    private var isToday: Bool { Calendar.current.isDateInToday(date) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if let day {
                        KpiGrid(day: day, addWater: { Task { await addWater() } })
                        AgendaCard(events: visibleEvents, now: now, isToday: isToday)
                        TasksCard(day: day, date: dayKey) { t in Task { await toggle(t) } }
                        ChecklistCard(day: day) { kind, id, on in Task { await check(kind, id, on) } }
                        MealsCard(day: day)
                        EnergyCard(day: day)
                    } else if let error {
                        Card("Sin conexión") { Text(error).font(.footnote).foregroundStyle(.secondary) }
                    } else {
                        ProgressView().padding(.top, 80)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
            }
            .refreshable { await load(sync: true) }
            .background(Theme.bg)
            .navigationTitle(isToday ? "Hoy" : date.formatted(.dateTime.weekday(.wide).day().month()))
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button { shift(-1) } label: { Image(systemName: "chevron.left") }
                    Button { shift(1) } label: { Image(systemName: "chevron.right") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .safeAreaInset(edge: .bottom) { quickAdd }
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast).font(.footnote.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.thinMaterial, in: Capsule()).padding(.top, 6).transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView().environmentObject(sync) }
        }
        .tint(Theme.leaf)
        .task(id: dayKey) { await load(sync: true) }
        .onReceive(tick) { now = $0 }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in Task { await load(sync: true) } }
    }

    private var visibleEvents: [CalEvent] {
        let hidden = day?.hiddenEvents ?? []
        return events.filter { !hidden.contains($0.title.lowercased()) && (!isToday || $0.allDay || (iso($0.end) ?? .distantFuture) > now) }
    }

    private var quickAdd: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles").foregroundStyle(Theme.leaf)
            TextField("Registrá lo que sea…", text: $text)
                .submitLabel(.send)
                .onSubmit { Task { await save() } }
            if saving { ProgressView() } else if !text.isEmpty {
                Button { Task { await save() } } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
        .padding(.horizontal, 12).padding(.bottom, 4)
    }

    // MARK: actions

    private func shift(_ days: Int) { date = Calendar.current.date(byAdding: .day, value: days, to: date)! }

    private func load(sync pull: Bool = false) async {
        guard let api else { return }
        do {
            day = try await api.get("/day?date=\(dayKey)", as: DayData.self)
            error = nil
        } catch { self.error = error.localizedDescription }
        events = (try? await api.get("/calendar?date=\(dayKey)", as: API.Events.self).events) ?? events
        if pull {
            // Health first (it's on the phone), then let the server pull mail and Google
            await sync.sync(reason: "al abrir")
            try? await api.send("POST", "/sync", ["date": dayKey])
            if let fresh = try? await api.get("/day?date=\(dayKey)", as: DayData.self) { day = fresh }
        }
    }

    private func save() async {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard let api, !t.isEmpty, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let r = try await api.send("POST", "/quick-add", ["text": t, "date": dayKey], as: API.Summary.self)
            text = ""
            show(r.summary ?? "Guardado")
            await load()
        } catch { show(error.localizedDescription) }
    }

    private func addWater() async {
        guard let api else { return }
        try? await api.send("POST", "/water", ["ml": 250, "date": dayKey])
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        await load()
    }

    private func toggle(_ t: TaskItem) async {
        guard let api else { return }
        try? await api.send("PATCH", "/tasks/\(t.id)", ["status": t.status == "done" ? "todo" : "done", "date": dayKey])
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        await load()
    }

    private func check(_ kind: String, _ id: String, _ on: Bool) async {
        guard let api else { return }
        if kind == "habit" { try? await api.send("PUT", "/habits/\(id)/log", ["done": on, "date": dayKey]) }
        else { try? await api.send("PUT", "/supplements/\(id)/log", ["taken": on, "date": dayKey]) }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        await load()
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task { try? await Task.sleep(for: .seconds(3)); withAnimation { toast = nil } }
    }
}

// MARK: - Look

enum Theme {
    static let bg = Color(red: 0.06, green: 0.07, blue: 0.07)
    static let surface = Color(red: 0.09, green: 0.11, blue: 0.09)
    static let surface2 = Color(red: 0.11, green: 0.14, blue: 0.13)
    static let line = Color(red: 0.16, green: 0.19, blue: 0.17)
    static let leaf = Color(red: 0.30, green: 0.76, blue: 0.49)
    static let protein = Color(red: 0.66, green: 0.52, blue: 0.92)
    static let carbs = Color(red: 0.35, green: 0.61, blue: 0.94)
    static let fat = Color(red: 0.89, green: 0.64, blue: 0.26)
    static let danger = Color(red: 0.94, green: 0.42, blue: 0.38)
    static let live = Color(red: 0.96, green: 0.77, blue: 0.09)
}

func iso(_ s: String) -> Date? { ISO8601DateFormatter().date(from: s) ?? ISO8601DateFormatter.withFraction.date(from: s) }
extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}
func fmt(_ v: Double) -> String { Int(v.rounded()).formatted(.number.locale(Locale(identifier: "es_AR"))) }

struct Card<Content: View>: View {
    let title: String
    var meta: String? = nil
    @ViewBuilder var content: Content
    init(_ title: String, meta: String? = nil, @ViewBuilder content: () -> Content) { self.title = title; self.meta = meta; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline.weight(.semibold))
                if let meta { Text(meta).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                Spacer()
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
    }
}

struct Check: View {
    let on: Bool
    var body: some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(on ? Theme.leaf : .secondary)
    }
}

// MARK: - Cards

struct KpiGrid: View {
    let day: DayData
    let addWater: () -> Void
    var body: some View {
        let g = day.goals
        let total = day.energy?.total?.value ?? 0
        let balance = day.kcalIn - total
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible())], spacing: 8) {
            Kpi(label: "Balance", value: "\(balance > 0 ? "+" : "−")\(fmt(abs(balance)))", unit: "kcal", tint: balance < 0 ? Theme.leaf : nil)
            Kpi(label: "Pasos", value: day.steps.map(fmt) ?? "—", progress: ratio(day.steps, g?.steps?.value), color: Theme.carbs)
            Button(action: addWater) {
                Kpi(label: "Agua  +", value: String(format: "%.2g", day.waterMl / 1000), unit: "/\(String(format: "%.1f", (g?.water_ml?.value ?? 2800) / 1000)) L", progress: ratio(day.waterMl, g?.water_ml?.value), color: Theme.carbs)
            }.buttonStyle(.plain)
            Kpi(label: "Proteína", value: fmt(day.protein), unit: "/\(fmt(g?.protein_g?.value ?? 0)) g", progress: ratio(day.protein, g?.protein_g?.value), color: Theme.protein)
            Kpi(label: "Checklist", value: "\(day.checklistDone)", unit: "/\(day.checklistTotal)", progress: day.checklistTotal > 0 ? Double(day.checklistDone) / Double(day.checklistTotal) : nil, color: Theme.leaf)
            Kpi(label: "Sueño", value: day.sleepMin.map { "\(Int($0) / 60)h\(String(format: "%02d", Int($0) % 60))" } ?? "—", progress: ratio(day.sleepMin, g?.sleep_min?.value), color: Theme.protein)
        }
    }
    private func ratio(_ v: Double?, _ t: Double?) -> Double? { guard let v, let t, t > 0 else { return nil }; return min(1, v / t) }
}

struct Kpi: View {
    let label: String
    let value: String
    var unit: String? = nil
    var progress: Double? = nil
    var color: Color = Theme.leaf
    var tint: Color? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(.system(size: 10, weight: .medium)).tracking(0.6).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(value).font(.system(.title3, design: .monospaced).weight(.semibold)).foregroundStyle(tint ?? .primary).minimumScaleFactor(0.6).lineLimit(1)
                if let unit { Text(unit).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary) }
            }
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                if let progress { Capsule().fill(color).frame(width: max(4, 80 * progress)) }
            }.frame(width: 80, height: 3)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
    }
}

struct AgendaCard: View {
    let events: [CalEvent]
    let now: Date
    let isToday: Bool
    @State private var pulse = false
    var body: some View {
        let current = isToday ? events.first { !$0.allDay && (iso($0.start) ?? .distantFuture) <= now && (iso($0.end) ?? .distantPast) > now } : nil
        Card("Agenda", meta: current == nil ? "\(events.count) \(events.count == 1 ? "evento" : "eventos")" : nil) {
            if let c = current, let end = iso(c.end), let start = iso(c.start) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Circle().fill(Theme.live).frame(width: 8, height: 8).opacity(pulse ? 0.3 : 1)
                            .animation(.easeInOut(duration: 0.8).repeatForever(), value: pulse).onAppear { pulse = true }
                        Text(c.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Spacer()
                        Text("quedan \(Int(end.timeIntervalSince(now) / 60)) min").font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        Capsule().fill(Theme.live).frame(width: geo.size.width * max(0, end.timeIntervalSince(now) / end.timeIntervalSince(start)))
                    }.frame(height: 3)
                }
                .padding(10).background(Theme.live.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
            ForEach(events.filter { $0.id != current?.id }) { e in
                HStack(spacing: 10) {
                    Text(e.allDay ? "día" : (iso(e.start)?.formatted(date: .omitted, time: .shortened) ?? "")).font(.caption.monospaced()).foregroundStyle(.secondary).frame(width: 44, alignment: .leading)
                    RoundedRectangle(cornerRadius: 1).fill(Theme.carbs).frame(width: 2, height: 16)
                    Text(e.title).font(.subheadline).lineLimit(1)
                    Spacer()
                    if let a = e.account { Text(a.split(separator: "@").last?.split(separator: ".").first.map(String.init) ?? "").font(.caption2).foregroundStyle(Theme.carbs) }
                }
            }
            if events.isEmpty { Text(isToday ? "Nada más por hoy." : "Sin eventos.").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

struct TasksCard: View {
    let day: DayData
    let date: String
    let toggle: (TaskItem) -> Void
    var body: some View {
        let open = (day.tasks ?? []).filter { $0.status == "todo" && ($0.due_date ?? "9999") <= date }
        let done = (day.tasks ?? []).filter { $0.status == "done" }
        let later = (day.tasks ?? []).filter { $0.status == "todo" && ($0.due_date ?? "9999") > date }.count
        Card("Tareas", meta: "\(open.count) para hoy · \(done.count) hechas\(later > 0 ? " · \(later) próximas" : "")") {
            ForEach(open + done) { t in
                Button { toggle(t) } label: {
                    HStack(spacing: 10) {
                        Check(on: t.status == "done")
                        Text(t.title).font(.subheadline).lineLimit(2).strikethrough(t.status == "done").foregroundStyle(t.status == "done" ? .secondary : .primary)
                        Spacer(minLength: 4)
                        if let due = t.due_date, due < date, t.status != "done" { Pill("vencida", Theme.danger) }
                        else if t.priority == "high", t.status != "done" { Pill("alta", Theme.danger) }
                        if t.source == "email" { Pill("mail", Theme.carbs) }
                    }
                }.buttonStyle(.plain)
            }
            if open.isEmpty && done.isEmpty { Text("Nada pendiente para hoy.").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

struct Pill: View {
    let text: String
    let color: Color
    init(_ text: String, _ color: Color) { self.text = text; self.color = color }
    var body: some View {
        Text(text).font(.system(size: 10, weight: .semibold)).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}

struct ChecklistCard: View {
    let day: DayData
    let check: (String, String, Bool) -> Void
    var body: some View {
        Card("Hábitos y suplementos", meta: "\(day.checklistDone)/\(day.checklistTotal)") {
            ForEach(day.habits ?? []) { h in
                row(h.name, detail: "hábito", on: h.done == true) { check("habit", h.id, !(h.done == true)) }
            }
            ForEach(day.supplements ?? []) { s in
                row(s.name, detail: s.dose.map { "\(fmt($0.value)) \(s.unit ?? "")" } ?? "supl.", on: s.taken == true) { check("supplement", s.id, !(s.taken == true)) }
            }
        }
    }
    private func row(_ name: String, detail: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Check(on: on)
                Text(name).font(.subheadline).strikethrough(on).foregroundStyle(on ? .secondary : .primary)
                Spacer()
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }.buttonStyle(.plain)
    }
}

struct MealsCard: View {
    let day: DayData
    static let labels = ["breakfast": "Desayuno", "morning_snack": "Colación", "lunch": "Almuerzo", "merienda": "Merienda", "afternoon_snack": "Colación", "dinner": "Cena", "snack": "Extra"]
    var body: some View {
        let meals = day.meals ?? []
        Card("Comidas", meta: "\(fmt(day.kcalIn))/\(fmt(day.goals?.kcal?.value ?? 0)) kcal") {
            ForEach(meals) { m in
                HStack(spacing: 8) {
                    Text(Self.labels[m.meal_type ?? ""] ?? "Comida").font(.caption.weight(.semibold)).frame(width: 66, alignment: .leading)
                    Text(m.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(fmt(m.kcal?.value ?? 0)).font(.caption.monospaced())
                    Text("P\(fmt(m.protein_g?.value ?? 0))").font(.caption2.monospaced()).foregroundStyle(Theme.protein)
                }
            }
            if meals.isEmpty { Text("Escribí abajo: “almuerzo: 2 empanadas”.").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

struct EnergyCard: View {
    let day: DayData
    var body: some View {
        let e = day.energy
        let parts: [(String, Double, Color)] = [("Basal", e?.bmr?.value ?? 0, .gray), ("Movimiento", e?.neat?.value ?? 0, Theme.carbs), ("Ejercicio", e?.exercise?.value ?? 0, Theme.leaf), ("Digestión", e?.tef?.value ?? 0, Theme.fat)]
        let total = max(1, parts.reduce(0) { $0 + $1.1 })
        Card("Energía", meta: "\(fmt(e?.total?.value ?? 0)) kcal gastadas") {
            GeometryReader { geo in
                HStack(spacing: 0) { ForEach(parts, id: \.0) { p in p.2.frame(width: geo.size.width * p.1 / total) } }
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }.frame(height: 14)
            HStack(spacing: 10) {
                ForEach(parts, id: \.0) { p in
                    HStack(spacing: 4) { Circle().fill(p.2).frame(width: 6, height: 6); Text("\(p.0) \(fmt(p.1))").font(.caption2) }
                }
            }.foregroundStyle(.secondary)
        }
    }
}
