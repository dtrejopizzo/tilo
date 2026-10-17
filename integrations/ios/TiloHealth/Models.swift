import Foundation

// The slice of /api/v1/day the iPhone shows. Every field is optional and numbers are read leniently,
// so a server change never breaks the app; it just shows less.
struct Num: Decodable {
    let value: Double
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self), let d = Double(s) { value = d }
        else { value = 0 }
    }
}

struct DayData: Decodable {
    var date: String
    var goals: Goals?
    var settings: [String: AnyDecodable]?
    var projects: [Project]?
    var tasks: [TaskItem]?
    var habits: [Habit]?
    var supplements: [Supplement]?
    var meals: [Meal]?
    var water: [Water]?
    var metrics: [Metric]?
    var activities: [Activity]?
    var energy: Energy?
}

struct Goals: Decodable { var kcal: Num?; var protein_g: Num?; var water_ml: Num?; var steps: Num?; var sleep_min: Num? }
struct Project: Decodable, Identifiable { var id: String; var name: String }
struct TaskItem: Decodable, Identifiable {
    var id: String; var title: String; var priority: String?; var status: String; var due_date: String?
    var project_id: String?; var source: String?
}
struct Habit: Decodable, Identifiable { var id: String; var name: String; var done: Bool? }
struct Supplement: Decodable, Identifiable { var id: String; var name: String; var dose: Num?; var unit: String?; var slot: String?; var taken: Bool? }
struct Meal: Decodable, Identifiable {
    var id: String; var description: String; var meal_type: String?
    var kcal: Num?; var protein_g: Num?; var carbs_g: Num?; var fat_g: Num?; var fiber_g: Num?
}
struct Water: Decodable { var ml: Num }
struct Metric: Decodable { var source: String; var steps: Num?; var active_kcal: Num?; var sleep_min: Num?; var resting_hr: Num? }
struct Activity: Decodable, Identifiable { var id: String; var type: String; var name: String?; var duration_s: Num?; var kcal: Num?; var distance_m: Num? }
struct Energy: Decodable { var bmr: Num?; var neat: Num?; var exercise: Num?; var tef: Num?; var total: Num?; var intake: Num? }
struct CalEvent: Decodable, Identifiable { var id: String; var title: String; var start: String; var end: String; var allDay: Bool; var account: String? }

struct AnyDecodable: Decodable {
    let value: Any?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode([String].self) { value = v } else if let v = try? c.decode(Double.self) { value = v } else if let v = try? c.decode(String.self) { value = v } else { value = nil }
    }
}

extension DayData {
    // Same source priority as the web (apple first): the best value per metric
    private func metric(_ key: KeyPath<Metric, Num?>) -> Double? {
        let order = ["apple", "google_health", "health_connect", "garmin", "strava", "manual"]
        return (metrics ?? []).sorted { (order.firstIndex(of: $0.source) ?? 9) < (order.firstIndex(of: $1.source) ?? 9) }.compactMap { $0[keyPath: key]?.value }.first
    }
    var steps: Double? { metric(\.steps) }
    var sleepMin: Double? { metric(\.sleep_min) }
    var waterMl: Double { (water ?? []).reduce(0) { $0 + $1.ml.value } }
    var kcalIn: Double { (meals ?? []).reduce(0) { $0 + ($1.kcal?.value ?? 0) } }
    var protein: Double { (meals ?? []).reduce(0) { $0 + ($1.protein_g?.value ?? 0) } }
    var checklistDone: Int { (habits ?? []).filter { $0.done == true }.count + (supplements ?? []).filter { $0.taken == true }.count }
    var checklistTotal: Int { (habits ?? []).count + (supplements ?? []).count }
    var hiddenEvents: [String] { (settings?["hidden_events"]?.value as? [String] ?? []).map { $0.lowercased() } }
}
