import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"

export function Landing() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-4xl font-medium text-foreground">Purser Pay</h1>
      <p className="max-w-md text-muted-foreground">
        Paga a tu equipo en USDT sin que el dinero pase por nosotros.
      </p>
      <Button asChild>
        <Link to="/dashboard">Entrar al dashboard</Link>
      </Button>
    </div>
  )
}

export default Landing
