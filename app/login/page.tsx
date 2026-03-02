"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import type { User } from "@/lib/api-types"
import { createApiClient } from "@/lib/api-client"
import { signInWithSession, useAppStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"

const apiClient = createApiClient({
  timeoutMs: 3000,
  retries: 1,
})

const parseLoginPayload = (payload: unknown): { token: string; user: User } | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null

  const token = (data as { token?: unknown }).token
  const user = (data as { user?: unknown }).user
  if (typeof token !== "string" || typeof user !== "object" || user === null) return null

  const id = (user as { id?: unknown }).id
  const email = (user as { email?: unknown }).email
  const name = (user as { name?: unknown }).name
  const role = (user as { role?: unknown }).role
  const createdAt = (user as { createdAt?: unknown }).createdAt

  if (
    typeof id !== "string" ||
    typeof email !== "string" ||
    typeof name !== "string" ||
    typeof role !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null
  }

  return {
    token,
    user: {
      id,
      email,
      name,
      role: role as User["role"],
      createdAt,
    },
  }
}

interface PasswordRecoveryQuestion {
  questionId: number
  questionText: string
}

const parseRecoveryStartPayload = (
  payload: unknown,
): { recoveryToken: string; questions: PasswordRecoveryQuestion[] } | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  const recoveryToken = (data as { recoveryToken?: unknown }).recoveryToken
  const questions = (data as { questions?: unknown }).questions
  if (typeof recoveryToken !== "string" || !Array.isArray(questions)) return null

  const parsedQuestions = questions
    .map((item) => {
      if (typeof item !== "object" || item === null) return null
      const questionId = (item as { questionId?: unknown }).questionId
      const questionText = (item as { questionText?: unknown }).questionText
      if (typeof questionId !== "number" || typeof questionText !== "string") return null
      return { questionId, questionText }
    })
    .filter((item): item is PasswordRecoveryQuestion => item !== null)

  if (!parsedQuestions.length) return null
  return { recoveryToken, questions: parsedQuestions }
}

const parseRecoveryVerifyPayload = (payload: unknown): { resetToken: string } | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  const resetToken = (data as { resetToken?: unknown }).resetToken
  if (typeof resetToken !== "string" || !resetToken.trim()) return null
  return { resetToken }
}

export default function LoginPage() {
  const router = useRouter()
  const store = useAppStore()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [resetStep, setResetStep] = useState<"identify" | "questions" | "password">("identify")
  const [resetIdentifier, setResetIdentifier] = useState("")
  const [recoveryToken, setRecoveryToken] = useState("")
  const [resetToken, setResetToken] = useState("")
  const [resetQuestions, setResetQuestions] = useState<PasswordRecoveryQuestion[]>([])
  const [resetAnswers, setResetAnswers] = useState<string[]>([])
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [resetError, setResetError] = useState("")
  const [isResetLoading, setIsResetLoading] = useState(false)

  useEffect(() => {
    if (store.session) {
      router.replace("/monitoring")
    }
  }, [router, store.session])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPassword = password.trim()

    if (!normalizedEmail || !normalizedPassword) {
      setError("Ingresa email y contrasena validos.")
      setIsLoading(false)
      return
    }

    const response = await apiClient.request<unknown>("POST", "/auth/login", {
      email: normalizedEmail,
      password: normalizedPassword,
    })
    const parsed = response.ok ? parseLoginPayload(response.data) : null

    if (response.ok && parsed) {
      signInWithSession(parsed.user, parsed.token)
      toast({
        title: "Bienvenido",
        description: `Hola, ${parsed.user.name}.`,
      })
      router.replace("/monitoring")
    } else {
      setError(response.error ?? "Credenciales invalidas")
    }

    setIsLoading(false)
  }

  const resetRecoveryState = () => {
    setResetStep("identify")
    setResetIdentifier("")
    setRecoveryToken("")
    setResetToken("")
    setResetQuestions([])
    setResetAnswers([])
    setNewPassword("")
    setConfirmPassword("")
    setResetError("")
    setIsResetLoading(false)
  }

  const handleRecoveryStart = async () => {
    setResetError("")
    const identifier = resetIdentifier.trim()

    if (!identifier) {
      setResetError("Ingresa tu usuario o email para continuar.")
      return
    }

    setIsResetLoading(true)
    const response = await apiClient.request<unknown>("POST", "/auth/password-recovery/start", {
      identifier,
    })
    const parsed = response.ok ? parseRecoveryStartPayload(response.data) : null
    if (!response.ok || !parsed) {
      setResetError(response.error ?? "No se pudo iniciar la recuperacion.")
      setIsResetLoading(false)
      return
    }

    setRecoveryToken(parsed.recoveryToken)
    setResetQuestions(parsed.questions)
    setResetAnswers(parsed.questions.map(() => ""))
    setResetStep("questions")
    setIsResetLoading(false)
  }

  const handleRecoveryVerify = async () => {
    setResetError("")
    if (!recoveryToken) {
      setResetError("La sesion de recuperacion no es valida.")
      return
    }

    const answersPayload = resetQuestions.map((question, index) => ({
      questionId: question.questionId,
      answer: resetAnswers[index]?.trim() ?? "",
    }))
    if (answersPayload.some((item) => !item.answer)) {
      setResetError("Responde todas las preguntas de seguridad.")
      return
    }

    setIsResetLoading(true)
    const response = await apiClient.request<unknown>("POST", "/auth/password-recovery/verify", {
      recoveryToken,
      answers: answersPayload,
    })
    const parsed = response.ok ? parseRecoveryVerifyPayload(response.data) : null
    if (!response.ok || !parsed) {
      setResetError(response.error ?? "Las respuestas no coinciden.")
      setIsResetLoading(false)
      return
    }

    setResetToken(parsed.resetToken)
    setResetStep("password")
    setIsResetLoading(false)
  }

  const handleRecoveryResetPassword = async () => {
    setResetError("")
    if (!resetToken) {
      setResetError("El token de restablecimiento no es valido.")
      return
    }
    if (newPassword.trim().length < 8) {
      setResetError("La nueva contrasena debe tener al menos 8 caracteres.")
      return
    }
    if (newPassword !== confirmPassword) {
      setResetError("La confirmacion de contrasena no coincide.")
      return
    }

    setIsResetLoading(true)
    const response = await apiClient.request<unknown>("POST", "/auth/password-recovery/reset", {
      resetToken,
      newPassword,
    })
    if (!response.ok) {
      setResetError(response.error ?? "No se pudo restablecer la contrasena.")
      setIsResetLoading(false)
      return
    }

    toast({
      title: "Contrasena actualizada",
      description: "Ya puedes iniciar sesion con tu nueva contrasena.",
    })
    setIsResetOpen(false)
    resetRecoveryState()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-primary">Sistema AGUILERA21</h1>
            <p className="mt-1 text-sm text-muted-foreground">Gestion Administrativa de activos industriales</p>
          </div>
          <CardTitle className="text-2xl font-bold">Iniciar Sesion</CardTitle>
          <CardDescription>Ingresa tus credenciales para acceder al sistema</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="usuario@empresa.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value.toLowerCase())
                  if (error) setError("")
                }}
                required
                disabled={isLoading}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contrasena</Label>
                <Button type="button" variant="link" className="px-0 text-xs" onClick={() => setIsResetOpen(true)}>
                  Olvidaste tu contrasena?
                </Button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="********"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (error) setError("")
                }}
                required
                disabled={isLoading}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </CardContent>

          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Iniciando sesion...
                </>
              ) : (
                "Iniciar Sesion"
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Dialog
        open={isResetOpen}
        onOpenChange={(open) => {
          setIsResetOpen(open)
          if (!open) {
            resetRecoveryState()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recuperar contrasena</DialogTitle>
            <DialogDescription>
              {resetStep === "identify" && "Ingresa tu usuario o email para mostrar tus preguntas de seguridad."}
              {resetStep === "questions" && "Responde correctamente tus preguntas de seguridad."}
              {resetStep === "password" && "Define una nueva contrasena para tu cuenta."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {resetError && (
              <Alert variant="destructive">
                <AlertDescription>{resetError}</AlertDescription>
              </Alert>
            )}

            {resetStep === "identify" && (
              <div className="space-y-2">
                <Label htmlFor="reset-identifier">Usuario o Email</Label>
                <Input
                  id="reset-identifier"
                  value={resetIdentifier}
                  onChange={(event) => setResetIdentifier(event.target.value)}
                  placeholder="usuario@empresa.com"
                  disabled={isResetLoading}
                />
              </div>
            )}

            {resetStep === "questions" && (
              <div className="space-y-3">
                {resetQuestions.map((question, index) => (
                  <div key={question.questionId} className="space-y-2">
                    <Label>{question.questionText}</Label>
                    <Input
                      type="password"
                      value={resetAnswers[index] ?? ""}
                      onChange={(event) =>
                        setResetAnswers((current) =>
                          current.map((item, position) => (position === index ? event.target.value : item)),
                        )
                      }
                      placeholder={`Respuesta ${index + 1}`}
                      disabled={isResetLoading}
                    />
                  </div>
                ))}
              </div>
            )}

            {resetStep === "password" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="reset-new-password">Nueva contrasena</Label>
                  <Input
                    id="reset-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="********"
                    disabled={isResetLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm-password">Confirmar contrasena</Label>
                  <Input
                    id="reset-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="********"
                    disabled={isResetLoading}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetOpen(false)}>
              Cancelar
            </Button>
            {resetStep === "identify" && (
              <Button onClick={handleRecoveryStart} disabled={isResetLoading}>
                Continuar
              </Button>
            )}
            {resetStep === "questions" && (
              <Button onClick={handleRecoveryVerify} disabled={isResetLoading}>
                Validar respuestas
              </Button>
            )}
            {resetStep === "password" && (
              <Button onClick={handleRecoveryResetPassword} disabled={isResetLoading}>
                Restablecer contrasena
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
