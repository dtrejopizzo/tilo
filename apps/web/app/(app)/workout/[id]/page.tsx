import { Suspense } from "react"
import { WorkoutScreen } from "@/components/WorkoutScreen"

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <Suspense><WorkoutScreen id={id} /></Suspense>
}
