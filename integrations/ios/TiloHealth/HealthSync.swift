import Foundation
import HealthKit
import Security
import UIKit

// Reads Apple Health and posts it to Tilo's /api/v1/ingest (the same format the web server already
// deduplicates against Google Health and Strava). Sends today and yesterday every time, so a late
// sync or a workout saved after midnight still lands on the right day.
@MainActor
final class HealthSync: ObservableObject {
    static let shared = HealthSync()

    @Published var token: String? = Keychain.get("token")
    @Published var baseURL: String = UserDefaults.standard.string(forKey: "baseURL") ?? "https://tiloapp.vercel.app"
    @Published var lastSync: Date? = UserDefaults.standard.object(forKey: "lastSync") as? Date
    @Published var lastResult: String = UserDefaults.standard.string(forKey: "lastResult") ?? ""
    @Published var healthConnected: Bool = UserDefaults.standard.bool(forKey: "healthConnected")
    @Published var busy = false
    var pendingState: String?

    private let store = HKHealthStore()
    private var pendingUnlock = false

    // Last wake-ups (time, why, whether Health was readable), sent along so the server can tell how
    // quickly iOS really delivers new data
    private func logWake(_ reason: String) {
        var log = UserDefaults.standard.stringArray(forKey: "wakes") ?? []
        let state = UIApplication.shared.applicationState == .background ? "bg" : "fg"
        log.append("\(ISO8601DateFormatter().string(from: Date())) \(state) \(UIApplication.shared.isProtectedDataAvailable ? "unlocked" : "locked") \(reason)")
        UserDefaults.standard.set(Array(log.suffix(40)), forKey: "wakes")
    }
    private var observing = false
    private var rerun = false

    private let bpm = HKUnit.count().unitDivided(by: .minute())
    private var readTypes: Set<HKObjectType> {
        let quantities: [HKQuantityTypeIdentifier] = [.stepCount, .distanceWalkingRunning, .activeEnergyBurned, .restingHeartRate, .heartRateVariabilitySDNN, .heartRate, .bodyMass, .distanceSwimming, .distanceCycling, .swimmingStrokeCount]
        var set = Set<HKObjectType>(quantities.map { HKQuantityType($0) })
        set.insert(HKCategoryType(.sleepAnalysis))
        set.insert(HKCategoryType(.irregularHeartRhythmEvent))
        set.insert(HKWorkoutType.workoutType())
        return set
    }
    // What wakes the app up in the background
    private var observedTypes: [HKSampleType] {
        [HKWorkoutType.workoutType(), HKQuantityType(.stepCount), HKQuantityType(.activeEnergyBurned), HKCategoryType(.sleepAnalysis), HKQuantityType(.restingHeartRate), HKQuantityType(.bodyMass), HKQuantityType(.distanceSwimming), HKQuantityType(.heartRate)]
    }

    // MARK: - Sign in

    func handleCallback(_ url: URL) {
        guard url.scheme == "tilohealth", let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        let q = Dictionary(uniqueKeysWithValues: items.compactMap { i in i.value.map { (i.name, $0) } })
        guard let token = q["token"], token.hasPrefix("tilo_") else { return }
        if let expected = pendingState, q["state"] != expected { return }
        pendingState = nil
        setToken(token, url: q["url"])
    }

    func setToken(_ token: String, url: String? = nil) {
        Keychain.set("token", token)
        self.token = token
        if let url, url.hasPrefix("https://") {
            baseURL = url
            UserDefaults.standard.set(url, forKey: "baseURL")
        }
        if healthConnected { Task { await sync(reason: "inicio de sesión", force: true) } }
    }

    func signOut() {
        Keychain.delete("token")
        token = nil
    }

    // MARK: - Health access and background delivery

    func connectHealth() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            lastResult = "Este dispositivo no tiene Salud"
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            healthConnected = true
            UserDefaults.standard.set(true, forKey: "healthConnected")
            startObserving()
            await sync(reason: "conexión con Salud", force: true)
        } catch {
            lastResult = "No pude pedir acceso a Salud: \(error.localizedDescription)"
        }
    }

    // Registered on every launch: HealthKit relaunches the app in the background and calls these
    func startObserving() {
        guard HKHealthStore.isHealthDataAvailable(), !observing, UserDefaults.standard.bool(forKey: "healthConnected") else { return }
        observing = true
        // A sync skipped while locked runs as soon as the phone is unlocked
        NotificationCenter.default.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in
                let shared = HealthSync.shared
                if shared.pendingUnlock {
                    shared.pendingUnlock = false
                    await shared.sync(reason: "al desbloquear", force: true)
                }
            }
        }
        for type in observedTypes {
            let isWorkout = type == HKWorkoutType.workoutType()
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                Task { @MainActor in
                    // A new workout always goes out, even right after a steps update
                    if error == nil { await HealthSync.shared.sync(reason: isWorkout ? "entrenamiento nuevo" : "dato nuevo en Salud", force: isWorkout) }
                    completion()
                }
            }
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: .immediate) { _, _ in }
        }
    }

    // MARK: - Sync

    func sync(reason: String, force: Bool = false) async {
        guard let token, let url = URL(string: "\(baseURL)/api/v1/ingest") else { return }
        logWake(reason)
        // Health data is encrypted while the phone is locked: reading now returns nothing. Wait for
        // the unlock (the app keeps observing it) instead of sending an empty day.
        guard UIApplication.shared.isProtectedDataAvailable else {
            pendingUnlock = true
            return
        }
        if busy {
            rerun = true
            return
        }
        // Several observers fire together when the phone syncs: one request covers them all
        if !force, let last = lastSync, Date().timeIntervalSince(last) < 45 { return }
        busy = true
        let bg = UIApplication.shared.beginBackgroundTask(withName: "tilo-sync")
        do {
            let payload = await buildPayload(days: 2)
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.timeoutInterval = 25
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await URLSession.shared.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 {
                signOut()
                record("La sesión venció: volvé a iniciar sesión")
            } else if (200..<300).contains(code) {
                let workouts = (payload["activities"] as? [Any])?.count ?? 0
                let steps = ((payload["daily"] as? [[String: Any]])?.last?["steps"] as? Int).map { "\($0.formatted()) pasos" } ?? "sin pasos"
                lastSync = Date()
                UserDefaults.standard.set(lastSync, forKey: "lastSync")
                record("\(steps) · \(workouts) \(workouts == 1 ? "entrenamiento" : "entrenamientos") · \(reason)")
            } else {
                record("Error \(code): \(String(data: data, encoding: .utf8)?.prefix(120) ?? "")")
            }
        } catch {
            record("Sin conexión: \(error.localizedDescription)")
        }
        busy = false
        UIApplication.shared.endBackgroundTask(bg)
        if rerun {
            rerun = false
            await sync(reason: reason, force: true)
        }
    }

    private func record(_ text: String) {
        lastResult = text
        UserDefaults.standard.set(text, forKey: "lastResult")
    }

    private func buildPayload(days: Int) async -> [String: Any] {
        let cal = Calendar.current
        var daily: [[String: Any]] = []
        for offset in (0..<days).reversed() {
            let start = cal.startOfDay(for: cal.date(byAdding: .day, value: -offset, to: Date())!)
            let end = cal.date(byAdding: .day, value: 1, to: start)!
            var d: [String: Any] = ["date": Self.day(start)]
            if let v = await stat(.stepCount, .cumulativeSum, start, end)?.sumQuantity()?.doubleValue(for: .count()) { d["steps"] = Int(v) }
            if let v = await stat(.distanceWalkingRunning, .cumulativeSum, start, end)?.sumQuantity()?.doubleValue(for: .meter()) { d["distance_m"] = v }
            if let v = await stat(.activeEnergyBurned, .cumulativeSum, start, end)?.sumQuantity()?.doubleValue(for: .kilocalorie()) { d["active_kcal"] = v }
            if let v = await stat(.restingHeartRate, .discreteAverage, start, end)?.averageQuantity()?.doubleValue(for: bpm) { d["resting_hr"] = v }
            if let v = await stat(.heartRateVariabilitySDNN, .discreteAverage, start, end)?.averageQuantity()?.doubleValue(for: .secondUnit(with: .milli)) { d["hrv_ms"] = v }
            if let v = await sleepMinutes(wakingOn: start) { d["sleep_min"] = v }
            if let n = await irregularRhythm(start, end), n > 0 { d["irregular_rhythm_events"] = n }
            daily.append(d)
        }
        let from = cal.startOfDay(for: cal.date(byAdding: .day, value: -(days - 1), to: Date())!)
        let real = await workouts(from: from)
        let detected = await detectedSessions(from: from, excluding: real)
        var payload: [String: Any] = [
            "source": "apple",
            "device": "Apple Health",
            "timezone": TimeZone.current.identifier,
            "daily": daily,
            "activities": real + detected,
            // The server replaces the sessions it detected before on these days with this list
            "inferred_dates": daily.compactMap { $0["date"] },
        ]
        if let w = await latestWeight(from: from) { payload["weights"] = [w] }
        let found = (payload["activities"] as? [[String: Any]] ?? []).map { "\($0["type"] ?? "?") \($0["start_at"] ?? "?")" }
        payload["diagnostics"] = ["wakes": UserDefaults.standard.stringArray(forKey: "wakes") ?? [], "app": "ios 1.2", "workouts_found": found, "workouts_error": lastWorkoutError ?? "", "detect": detectLog, "last_result": lastResult]
        return payload
    }

    private func stat(_ id: HKQuantityTypeIdentifier, _ options: HKStatisticsOptions, _ start: Date, _ end: Date) async -> HKStatistics? {
        let predicate = HKSamplePredicate.quantitySample(type: HKQuantityType(id), predicate: HKQuery.predicateForSamples(withStart: start, end: end))
        return try? await HKStatisticsQueryDescriptor(predicate: predicate, options: options).result(for: store)
    }

    // Minutes asleep in the night that ended on `day` (18:00 the day before to 14:00), with
    // overlapping samples from the watch and the phone merged so nothing counts twice
    private func sleepMinutes(wakingOn day: Date) async -> Int? {
        let cal = Calendar.current
        let from = cal.date(byAdding: .hour, value: -6, to: day)!
        let to = cal.date(byAdding: .hour, value: 14, to: day)!
        let predicate = HKSamplePredicate.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: from, end: to))
        guard let samples = try? await HKSampleQueryDescriptor(predicates: [predicate], sortDescriptors: [SortDescriptor(\.startDate)]).result(for: store) else { return nil }
        let asleep: Set<Int> = [HKCategoryValueSleepAnalysis.asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM].map(\.rawValue).reduce(into: []) { $0.insert($1) }
        var total: TimeInterval = 0
        var current: (Date, Date)?
        for s in samples where asleep.contains(s.value) {
            if let c = current, s.startDate <= c.1 {
                current = (c.0, max(c.1, s.endDate))
            } else {
                if let c = current { total += c.1.timeIntervalSince(c.0) }
                current = (s.startDate, s.endDate)
            }
        }
        if let c = current { total += c.1.timeIntervalSince(c.0) }
        return total > 0 ? Int(total / 60) : nil
    }

    // Apple Watch irregular rhythm notifications (possible atrial fibrillation) that day
    private func irregularRhythm(_ start: Date, _ end: Date) async -> Int? {
        let predicate = HKSamplePredicate.categorySample(type: HKCategoryType(.irregularHeartRhythmEvent), predicate: HKQuery.predicateForSamples(withStart: start, end: end))
        return try? await HKSampleQueryDescriptor(predicates: [predicate], sortDescriptors: []).result(for: store).count
    }

    private var lastWorkoutError: String?
    private var detectLog: [String] = []

    private func workouts(from: Date) async -> [[String: Any]] {
        let predicate = HKSamplePredicate.workout(HKQuery.predicateForSamples(withStart: from, end: nil))
        let list: [HKWorkout]
        do {
            list = try await HKSampleQueryDescriptor(predicates: [predicate], sortDescriptors: [SortDescriptor(\.startDate)]).result(for: store)
            lastWorkoutError = nil
        } catch {
            lastWorkoutError = error.localizedDescription
            return []
        }
        let iso = ISO8601DateFormatter()
        return list.map { w in
            var a: [String: Any] = [
                "external_id": w.uuid.uuidString,
                "type": Self.typeName(w.workoutActivityType),
                "start_at": iso.string(from: w.startDate),
                "end_at": iso.string(from: w.endDate),
                "duration_s": Int(w.duration),
                "kcal_is_net": true, // Apple's workout energy is active energy
            ]
            if let k = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()) { a["kcal"] = k }
            let distance = [HKQuantityTypeIdentifier.distanceWalkingRunning, .distanceSwimming, .distanceCycling]
                .compactMap { w.statistics(for: HKQuantityType($0))?.sumQuantity()?.doubleValue(for: .meter()) }
                .max()
            if let d = distance, d > 0 { a["distance_m"] = d }
            if let hr = w.statistics(for: HKQuantityType(.heartRate)) {
                if let avg = hr.averageQuantity()?.doubleValue(for: bpm) { a["avg_hr"] = avg }
                if let max = hr.maximumQuantity()?.doubleValue(for: bpm) { a["max_hr"] = max }
            }
            let app = w.sourceRevision.source.name
            a["name"] = app.lowercased().contains("strava") || app.lowercased().contains("entreno") || app.lowercased().contains("workout") ? nil : app
            return a
        }
    }

    // MARK: - Sessions detected from raw samples

    // Strava's watch app writes the workout to Health only hours later, but the samples it records
    // (heart rate every few seconds, swim distance, energy) land at once. A stretch of dense, high
    // heart rate is a session; its distance says which: swim distance → swim, fast walking/running
    // distance → run, slow → walk, none → a gym session. Replaced on the server when the real
    // workout arrives.
    private func samples(_ id: HKQuantityTypeIdentifier, from: Date) async -> [HKQuantitySample] {
        let predicate = HKSamplePredicate.quantitySample(type: HKQuantityType(id), predicate: HKQuery.predicateForSamples(withStart: from, end: nil))
        return (try? await HKSampleQueryDescriptor(predicates: [predicate], sortDescriptors: [SortDescriptor(\.startDate)]).result(for: store)) ?? []
    }

    private func detectedSessions(from: Date, excluding real: [[String: Any]]) async -> [[String: Any]] {
        let iso = ISO8601DateFormatter()
        let realSpans: [(Date, Date)] = real.compactMap { a in
            guard let s = (a["start_at"] as? String).flatMap(iso.date), let e = (a["end_at"] as? String).flatMap(iso.date) else { return nil }
            return (s, e)
        }
        let overlapsReal = { (s: Date, e: Date) in realSpans.contains { $0.0 < e && s < $0.1 } }
        let hr = await samples(.heartRate, from: from)
        let swim = await samples(.distanceSwimming, from: from)
        let walkRun = await samples(.distanceWalkingRunning, from: from)
        let energy = await samples(.activeEnergyBurned, from: from)
        let resting = await stat(.restingHeartRate, .discreteAverage, from, Date())?.averageQuantity()?.doubleValue(for: bpm) ?? 60

        // Heart-rate windows: dense samples (≤ 90 s apart), joined across pauses of up to 5 min
        var hrWindows: [(Date, Date)] = []
        var cur: (Date, Date, Int)?
        let closeHr = { (c: (Date, Date, Int)) in if c.2 >= 20, c.1.timeIntervalSince(c.0) >= 8 * 60 { hrWindows.append((c.0, c.1)) } }
        for s in hr {
            if let c = cur, s.startDate.timeIntervalSince(c.1) <= 90 { cur = (c.0, max(c.1, s.endDate), c.2 + 1) }
            else { if let c = cur { closeHr(c) }; cur = (s.startDate, s.endDate, 1) }
        }
        if let c = cur { closeHr(c) }
        var joined: [(Date, Date)] = []
        for w in hrWindows {
            if let last = joined.last, w.0.timeIntervalSince(last.1) <= 5 * 60 { joined[joined.count - 1] = (last.0, max(last.1, w.1)) } else { joined.append(w) }
        }
        // Swim windows: clusters of swim distance (heart rate is patchy in water), always their own session
        var swims: [(Date, Date, Double)] = []
        var sc: (Date, Date, Double)?
        for s in swim {
            let m = s.quantity.doubleValue(for: .meter())
            if let c = sc, s.startDate.timeIntervalSince(c.1) <= 5 * 60 { sc = (c.0, max(c.1, s.endDate), c.2 + m) }
            else { if let c = sc, c.2 >= 50 { swims.append(c) }; sc = (s.startDate, s.endDate, m) }
        }
        if let c = sc, c.2 >= 50 { swims.append(c) }
        // A heart-rate window that contains a swim is split around it: gym, then pool, are two sessions
        var land: [(Date, Date)] = []
        for w in joined {
            var pieces = [w]
            for sw in swims {
                pieces = pieces.flatMap { p -> [(Date, Date)] in
                    guard sw.0 < p.1 && p.0 < sw.1 else { return [p] }
                    return [(p.0, min(p.1, sw.0)), (max(p.0, sw.1), p.1)].filter { $0.1.timeIntervalSince($0.0) > 0 }
                }
            }
            land += pieces
        }

        let sum = { (list: [HKQuantitySample], s: Date, e: Date, unit: HKUnit) -> Double in
            list.filter { $0.startDate >= s && $0.endDate <= e.addingTimeInterval(60) }.reduce(0) { $0 + $1.quantity.doubleValue(for: unit) }
        }
        let rates = { (s: Date, e: Date) in hr.filter { $0.startDate >= s && $0.endDate <= e }.map { $0.quantity.doubleValue(for: self.bpm) }.sorted() }
        var out: [[String: Any]] = []
        func add(_ type: String, _ s: Date, _ e: Date, distance: Double?, label: String) {
            let r = rates(s, e)
            var a: [String: Any] = [
                "external_id": "inferred-\(Int(s.timeIntervalSince1970))", "type": type, "name": label,
                "start_at": iso.string(from: s), "end_at": iso.string(from: e), "duration_s": Int(e.timeIntervalSince(s)),
                "kcal": sum(energy, s, e, .kilocalorie()), "kcal_is_net": true,
            ]
            if let distance, distance > 0 { a["distance_m"] = distance }
            if !r.isEmpty { a["avg_hr"] = r.reduce(0, +) / Double(r.count); a["max_hr"] = r.last! }
            out.append(a)
        }
        detectLog = land.map { w in
            let r = rates(w.0, w.1); let m = sum(walkRun, w.0, w.1, .meter())
            return "\(iso.string(from: w.0)) \(Int(w.1.timeIntervalSince(w.0) / 60))min median=\(r.isEmpty ? 0 : Int(r[r.count / 2])) foot=\(Int(m))m n=\(r.count) resting=\(Int(resting))"
        }
        for sw in swims where sw.1.timeIntervalSince(sw.0) >= 5 * 60 && !overlapsReal(sw.0, sw.1) {
            add("swimming", sw.0, sw.1, distance: sw.2, label: "Natación · detectada")
        }
        for (s, e) in land where e.timeIntervalSince(s) >= 8 * 60 && !overlapsReal(s, e) {
            let r = rates(s, e)
            let median = r.isEmpty ? 0 : r[r.count / 2]
            let footM = sum(walkRun, s, e, .meter())
            let kmh = footM / 1000 / (e.timeIntervalSince(s) / 3600)
            // Dense heart rate already means a workout app was recording; the pulse only decides the kind.
            // Running needs both pace and effort (a brisk walk can reach 7 km/h at 95 ppm).
            if kmh >= 7.5 && median >= max(110, resting + 40) { add("running", s, e, distance: footM, label: "Correr · detectada") }
            else if footM >= 800 && kmh >= 3 { if median >= resting + 15 { add("walking", s, e, distance: footM, label: "Caminar · detectada") } }
            else if median >= resting + 15 { add("workout", s, e, distance: nil, label: "Entrenamiento · detectado") } // gym: pulse up without going anywhere
        }
        return out
    }

    private func latestWeight(from: Date) async -> [String: Any]? {
        let predicate = HKSamplePredicate.quantitySample(type: HKQuantityType(.bodyMass), predicate: HKQuery.predicateForSamples(withStart: from, end: Date()))
        guard let s = try? await HKSampleQueryDescriptor(predicates: [predicate], sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)], limit: 1).result(for: store).first else { return nil }
        return ["date": Self.day(s.startDate), "kg": s.quantity.doubleValue(for: .gramUnit(with: .kilo))]
    }

    // Names the server already understands (packages/core/src/sources.ts)
    static func typeName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "running"
        case .walking: return "walking"
        case .hiking: return "hiking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .traditionalStrengthTraining: return "traditionalstrengthtraining"
        case .functionalStrengthTraining: return "functionalstrengthtraining"
        case .highIntensityIntervalTraining: return "hiit"
        case .crossTraining: return "crossfit"
        case .yoga: return "yoga"
        case .pilates: return "pilates"
        case .rowing: return "rowing"
        case .elliptical: return "elliptical"
        case .tennis: return "tennis"
        case .soccer: return "soccer"
        case .stairClimbing: return "stairstepper"
        default: return "workout"
        }
    }

    static func day(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

// The sync token lives in the Keychain, readable after the first unlock so background syncs work
enum Keychain {
    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "tilo", kSecAttrAccount as String: key]
    }

    static func set(_ key: String, _ value: String) {
        SecItemDelete(query(key) as CFDictionary)
        var add = query(key)
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
