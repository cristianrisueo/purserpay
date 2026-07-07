import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"

export function Dashboard() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-4xl font-medium text-foreground">Dashboard</h1>
      <p className="max-w-md text-muted-foreground">
        Aquí vivirá la mesa de pagos.
      </p>
      <Button asChild>
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  )
}

export default Dashboard
