import SwiftUI

// Everything the tabs show for the selected day, loaded once and shared, plus the actions that
// change it. Pulling to refresh or coming back to the app reloads (and syncs Health first).
@MainActor
final class DayStore: ObservableObject {
    @Published var date = Date()
    @Published var day: DayData?
    @Published var events: [CalEvent] = []
    @Published var insights: Insights?
    @Published var brief: Brief?
    @Published var error: String?
    @Published var toast: String?
    @Published var now = Date()
    private let sync: HealthSync

    init(sync: HealthSync) { self.sync = sync }

    var api: API? { sync.token.map { API(base: sync.baseURL, token: $0) } }
    var dayKey: String { HealthSync.day(date) }
    var isToday: Bool { Calendar.current.isDateInToday(date) }
    var firstName: String { (day?.profile?.name ?? "").split(separator: " ").first.map(String.init) ?? "" }

    var visibleEvents: [CalEvent] {
        let hidden = day?.hiddenEvents ?? []
        var seen = Set<String>()
        return events.filter { e in
            let key = "\(e.title.lowercased())|\(e.start)"
            guard !hidden.contains(e.title.lowercased()), seen.insert(key).inserted else { return false }
            return !isToday || e.allDay || (iso(e.end) ?? .distantFuture) > now
        }
    }

    func shift(_ days: Int) {
        date = Calendar.current.date(byAdding: .day, value: days, to: date)!
        Task { await load(pull: true) }
    }

    func load(pull: Bool = false) async {
        guard let api else { return }
        do {
            day = try await api.get("/day?date=\(dayKey)", as: DayData.self)
            error = nil
        } catch { self.error = error.localizedDescription }
        events = (try? await api.get("/calendar?date=\(dayKey)", as: API.Events.self).events) ?? events
        if pull {
            await sync.sync(reason: "al abrir")
            try? await api.send("POST", "/sync", ["date": dayKey])
            if let fresh = try? await api.get("/day?date=\(dayKey)", as: DayData.self) { day = fresh }
        }
        async let b = try? await api.get("/brief?date=\(dayKey)", as: Brief.self)
        async let i = try? await api.get("/insights?date=\(dayKey)", as: Insights.self)
        brief = await b ?? brief
        insights = await i ?? insights
    }

    func quickAdd(_ text: String) async -> Bool {
        guard let api, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        do {
            let r = try await api.send("POST", "/quick-add", ["text": text, "date": dayKey], as: API.Summary.self)
            show(r.summary ?? "Guardado")
            await load()
            return true
        } catch {
            show(error.localizedDescription)
            return false
        }
    }

    func addMealPhoto(_ image: UIImage) async {
        guard let api, let jpeg = image.mealJPEG() else { return }
        show("Analizando tu comida…")
        do {
            let m = try await api.send("POST", "/meals/photo", ["image": jpeg.base64EncodedString(), "mime": "image/jpeg", "date": dayKey], as: Meal.self)
            haptic()
            show("\(m.description) · \(fmt(m.kcal?.value ?? 0)) kcal")
            await load()
        } catch { show(error.localizedDescription) }
    }

    func addWater() async {
        guard let api else { return }
        try? await api.send("POST", "/water", ["ml": 250, "date": dayKey])
        haptic()
        show("+250 ml de agua")
        await load()
    }

    func addTask(title: String, due: String?, priority: String, project: String?) async -> Bool {
        guard let api, !title.isEmpty else { return false }
        var body: [String: Any] = ["title": title, "priority": priority]
        if let due { body["due_date"] = due }
        if let project { body["project"] = project }
        do {
            try await api.send("POST", "/tasks", body)
            haptic()
            show("Tarea agregada")
            await load()
            return true
        } catch {
            show(error.localizedDescription)
            return false
        }
    }

    func toggle(_ t: TaskItem) async {
        guard let api else { return }
        try? await api.send("PATCH", "/tasks/\(t.id)", ["status": t.status == "done" ? "todo" : "done", "date": dayKey])
        haptic()
        await load()
    }

    func check(_ kind: String, _ id: String, _ on: Bool) async {
        guard let api else { return }
        if kind == "habit" { try? await api.send("PUT", "/habits/\(id)/log", ["done": on, "date": dayKey]) }
        else { try? await api.send("PUT", "/supplements/\(id)/log", ["taken": on, "date": dayKey]) }
        haptic()
        await load()
    }

    private func haptic() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }

    func show(_ message: String) {
        withAnimation { toast = message }
        Task { try? await Task.sleep(for: .seconds(3)); withAnimation { if toast == message { toast = nil } } }
    }
}
