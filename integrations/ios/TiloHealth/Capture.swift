import AVFoundation
import PhotosUI
import Speech
import SwiftUI

// Dictation in Spanish: tap to start, the text fills in as you speak, tap again (or pause) to stop
@MainActor
final class Dictation: ObservableObject {
    @Published var listening = false
    @Published var text = ""
    @Published var error: String?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "es-AR")) ?? SFSpeechRecognizer(locale: Locale(identifier: "es-ES"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func toggle(onText: @escaping (String) -> Void) {
        if listening { stop() } else { Task { await start(onText: onText) } }
    }

    private func start(onText: @escaping (String) -> Void) async {
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        let mic = await AVAudioApplication.requestRecordPermission()
        guard speech == .authorized, mic else {
            error = "Permití el micrófono y el reconocimiento de voz en Ajustes → Tilo"
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
            engine.prepare()
            try engine.start()
            listening = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            task = recognizer?.recognitionTask(with: req) { [weak self] result, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let result {
                        self.text = result.bestTranscription.formattedString
                        onText(self.text)
                        if result.isFinal { self.stop() }
                    }
                    if err != nil { self.stop() }
                }
            }
        } catch {
            self.error = error.localizedDescription
            stop()
        }
    }

    func stop() {
        guard listening || engine.isRunning else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

struct MicButton: View {
    @ObservedObject var dictation: Dictation
    let onText: (String) -> Void
    var body: some View {
        Button { dictation.toggle(onText: onText) } label: {
            Image(systemName: dictation.listening ? "mic.fill" : "mic")
                .font(.title3)
                .foregroundStyle(dictation.listening ? Theme.danger : .secondary)
                .symbolEffect(.pulse, isActive: dictation.listening)
        }
        .accessibilityLabel(dictation.listening ? "Dejar de dictar" : "Dictar")
    }
}

// Camera, wrapped for SwiftUI
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let img = info[.originalImage] as? UIImage { parent.onImage(img) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

extension UIImage {
    // Small enough to upload fast, big enough for the model to see the food
    func mealJPEG(maxSide: CGFloat = 1280) -> Data? {
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let img = UIGraphicsImageRenderer(size: target).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return img.jpegData(compressionQuality: 0.6)
    }
}
