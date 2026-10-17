import Foundation

// Thin client for Tilo's REST API, authenticated with the same token the sync uses
struct API {
    let base: String
    let token: String

    func get<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
        try await send("GET", path, nil, as: T.self)
    }

    @discardableResult
    func send<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any]?, as: T.Type = Ignored.self) async throws -> T {
        var req = URLRequest(url: URL(string: base + "/api/v1" + path)!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 30
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw NSError(domain: "Tilo", code: code, userInfo: [NSLocalizedDescriptionKey: msg ?? "Error \(code)"])
        }
        if T.self == Ignored.self { return Ignored() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct Ignored: Decodable {}
    struct Summary: Decodable { var summary: String? }
    struct Events: Decodable { var events: [CalEvent] }
}
