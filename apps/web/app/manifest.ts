import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tilo",
    short_name: "Tilo",
    description: "Hábitos, tareas, comidas, entrenamiento y salud.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f4",
    theme_color: "#1d2a24",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
