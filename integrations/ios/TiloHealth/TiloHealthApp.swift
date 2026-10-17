import BackgroundTasks
import SwiftUI

// Tilo for iPhone: a small bridge that sends Apple Health to Tilo on its own.
// HealthKit wakes the app when new data arrives (background delivery); a background refresh
// every hour or so catches anything missed. The screen only exists to sign in and to show it works.
@main
struct TiloHealthApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var sync = HealthSync.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sync)
                .onOpenURL { url in sync.handleCallback(url) }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    static let refreshTask = "com.dtrejopizzo.tilohealth.refresh"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Observers must be registered on every launch, including background launches by HealthKit
        HealthSync.shared.startObserving()
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTask, using: nil) { task in
            Self.schedule()
            Task {
                await HealthSync.shared.sync(reason: "refresco en segundo plano")
                task.setTaskCompleted(success: true)
            }
        }
        Self.schedule()
        return true
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 45 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
