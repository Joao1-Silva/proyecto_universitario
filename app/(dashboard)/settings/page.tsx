"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Plus, Pencil, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import type { CompanySettings, SecurityQuestion, User } from "@/lib/api-types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createApiClient } from "@/lib/api-client"
import { getPermissions, roleLabel } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"

const apiClient = createApiClient({ timeoutMs: 3000, retries: 1 })
const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  name: "",
  rif: "",
  address: "",
  phone: "",
  email: "",
}

const createSecurityQuestionForm = () => [
  { questionId: "", answer: "" },
  { questionId: "", answer: "" },
  { questionId: "", answer: "" },
]

const readData = <T,>(payload: unknown): T | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (data === undefined) return null
  return data as T
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab") ?? "company"
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const permissions = getPermissions(currentUser)
  const canManageUsers = permissions.canManageUsers
  const allowedTabs = canManageUsers ? ["company", "users"] : []
  const normalizedTab = allowedTabs.includes(tabParam) ? tabParam : "company"
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState(normalizedTab)
  const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)
  const [users, setUsers] = useState<User[]>([])
  const [securityQuestionsCatalog, setSecurityQuestionsCatalog] = useState<SecurityQuestion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false)
  const [isEditUserOpen, setIsEditUserOpen] = useState(false)
  const [isDeleteUserOpen, setIsDeleteUserOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [userError, setUserError] = useState("")
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    role: "procura" as User["role"],
    password: "",
    securityQuestions: createSecurityQuestionForm(),
  })

  const loadApiData = async () => {
    if (!canManageUsers) {
      setLoadError("Solo el superusuario puede acceder a este modulo.")
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError("")

    const [companyResponse, usersResponse, questionsResponse] = await Promise.all([
      apiClient.request<unknown>("GET", "/company-settings"),
      apiClient.request<unknown>("GET", "/users"),
      apiClient.request<unknown>("GET", "/security-questions"),
    ])

    if (!companyResponse.ok || !usersResponse.ok || !questionsResponse.ok) {
      setLoadError("No se pudo cargar la configuracion desde la base de datos.")
      setIsLoading(false)
      return
    }

    const companyData = readData<CompanySettings>(companyResponse.data)
    const usersData = readData<User[]>(usersResponse.data)
    const questionsData = readData<SecurityQuestion[]>(questionsResponse.data)

    setCompanySettings(companyData ?? DEFAULT_COMPANY_SETTINGS)
    setUsers(usersData ?? [])
    setSecurityQuestionsCatalog(questionsData ?? [])
    setIsLoading(false)
  }

  useEffect(() => {
    setActiveTab(normalizedTab)
  }, [normalizedTab])

  useEffect(() => {
    void loadApiData()
  }, [canManageUsers])

  const resetUserForm = () => {
    setUserForm({ name: "", email: "", role: "procura", password: "", securityQuestions: createSecurityQuestionForm() })
    setUserError("")
    setSelectedUser(null)
  }

  const validateUserForm = (requirePassword: boolean) => {
    if (!userForm.name.trim()) return "El nombre es requerido."
    if (!userForm.email.trim() || !emailRegex.test(userForm.email.trim())) return "Email invalido."
    if (requirePassword && userForm.password.trim().length < 6) {
      return "La contrasena debe tener al menos 6 caracteres."
    }
    return ""
  }

  const validateSecurityQuestions = (required: boolean) => {
    const normalized = userForm.securityQuestions.map((item) => ({
      questionId: item.questionId.trim(),
      answer: item.answer.trim(),
    }))
    const hasAnyValue = normalized.some((item) => item.questionId || item.answer)

    if (!required && !hasAnyValue) {
      return ""
    }

    if (normalized.some((item) => !item.questionId || !item.answer)) {
      return "Debes completar las 3 preguntas y respuestas de seguridad."
    }

    const uniqueQuestionIds = new Set(normalized.map((item) => item.questionId))
    if (uniqueQuestionIds.size !== normalized.length) {
      return "Las preguntas de seguridad deben ser distintas."
    }

    if (normalized.some((item) => item.answer.length < 2)) {
      return "Cada respuesta de seguridad debe tener al menos 2 caracteres."
    }

    return ""
  }

  const toSecurityQuestionPayload = () =>
    userForm.securityQuestions.map((item) => ({
      questionId: Number.parseInt(item.questionId, 10),
      answer: item.answer.trim(),
    }))

  const handleSaveCompany = async () => {
    setIsSubmitting(true)
    const response = await apiClient.request<unknown>("PUT", "/company-settings", companySettings)
    setIsSubmitting(false)

    if (!response.ok) {
      toast({
        title: "No se pudo guardar",
        description: response.error ?? "Error actualizando datos de empresa.",
        variant: "destructive",
      })
      return
    }

    const updated = readData<CompanySettings>(response.data)
    if (updated) {
      setCompanySettings(updated)
    }
    toast({ title: "Empresa actualizada", description: "Los datos de la empresa se guardaron en BD." })
  }

  const handleCreateUser = async () => {
    if (!canManageUsers) {
      setUserError("No tienes permisos para crear usuarios.")
      return
    }
    const error = validateUserForm(true)
    if (error) {
      setUserError(error)
      return
    }
    const securityError = validateSecurityQuestions(true)
    if (securityError) {
      setUserError(securityError)
      return
    }

    const emailExists = users.some((user) => user.email.toLowerCase() === userForm.email.trim().toLowerCase())
    if (emailExists) {
      setUserError("Ya existe un usuario con este correo.")
      return
    }

    setIsSubmitting(true)
    const response = await apiClient.request<unknown>("POST", "/users", {
      name: userForm.name.trim(),
      email: userForm.email.trim(),
      role: userForm.role,
      password: userForm.password.trim(),
      securityQuestions: toSecurityQuestionPayload(),
    })
    setIsSubmitting(false)

    if (!response.ok) {
      setUserError(response.error ?? "No se pudo crear el usuario.")
      return
    }

    const created = readData<User>(response.data)
    if (created) {
      setUsers((current) => [created, ...current])
    }

    toast({ title: "Usuario creado", description: `Se agrego a ${userForm.name}.` })
    setIsCreateUserOpen(false)
    resetUserForm()
  }

  const handleEditUser = async () => {
    if (!selectedUser) return
    if (!canManageUsers) {
      setUserError("No tienes permisos para editar usuarios.")
      return
    }

    const error = validateUserForm(false)
    if (error) {
      setUserError(error)
      return
    }
    const securityError = validateSecurityQuestions(false)
    if (securityError) {
      setUserError(securityError)
      return
    }

    const emailExists = users.some(
      (user) => user.email.toLowerCase() === userForm.email.trim().toLowerCase() && user.id !== selectedUser.id,
    )
    if (emailExists) {
      setUserError("Ya existe un usuario con este correo.")
      return
    }

    setIsSubmitting(true)
    const response = await apiClient.request<unknown>("PUT", `/users/${selectedUser.id}`, {
      name: userForm.name.trim(),
      email: userForm.email.trim(),
      role: userForm.role,
      ...(userForm.password.trim() ? { password: userForm.password.trim() } : {}),
      ...(userForm.securityQuestions.some((item) => item.questionId.trim() || item.answer.trim())
        ? { securityQuestions: toSecurityQuestionPayload() }
        : {}),
    })
    setIsSubmitting(false)

    if (!response.ok) {
      setUserError(response.error ?? "No se pudo actualizar el usuario.")
      return
    }

    const updated = readData<User>(response.data)
    if (updated) {
      setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)))
    }

    toast({ title: "Usuario actualizado", description: "Los datos del usuario fueron actualizados en BD." })
    setIsEditUserOpen(false)
    resetUserForm()
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return
    if (!canManageUsers) {
      toast({
        title: "Accion no permitida",
        description: "No tienes permisos para eliminar usuarios.",
        variant: "destructive",
      })
      setIsDeleteUserOpen(false)
      return
    }

    if (currentUser?.id === selectedUser.id) {
      toast({
        title: "Accion no permitida",
        description: "No puedes eliminar tu propio usuario.",
        variant: "destructive",
      })
      setIsDeleteUserOpen(false)
      return
    }

    setIsSubmitting(true)
    const response = await apiClient.request<unknown>("DELETE", `/users/${selectedUser.id}`)
    setIsSubmitting(false)

    if (!response.ok) {
      toast({
        title: "No se pudo eliminar",
        description: response.error ?? "Error eliminando usuario.",
        variant: "destructive",
      })
      return
    }

    setUsers((current) => current.filter((user) => user.id !== selectedUser.id))
    toast({ title: "Usuario eliminado", description: "El usuario fue eliminado de la BD." })
    setIsDeleteUserOpen(false)
    resetUserForm()
  }

  const openEditUser = async (user: User) => {
    const securityResponse = await apiClient.request<unknown>("GET", `/users/${user.id}/security-questions`)
    const securityData = readData<Array<{ questionId: number }>>(securityResponse.data) ?? []
    const nextSecurityQuestions = createSecurityQuestionForm().map((item, index) => ({
      ...item,
      questionId: securityData[index] ? String(securityData[index].questionId) : "",
      answer: "",
    }))

    setSelectedUser(user)
    setUserForm({
      name: user.name,
      email: user.email,
      role: user.role,
      password: "",
      securityQuestions: nextSecurityQuestions,
    })
    setUserError("")
    setIsEditUserOpen(true)
  }

  const openDeleteUser = (user: User) => {
    setSelectedUser(user)
    setIsDeleteUserOpen(true)
  }

  const userColumns: ColumnDef<User>[] = useMemo(() => {
    const columns: ColumnDef<User>[] = [
      {
        accessorKey: "name",
        header: "Nombre",
      },
      {
        accessorKey: "email",
        header: "Email",
      },
      {
        accessorKey: "role",
        header: "Rol",
        cell: ({ row }) => <Badge>{roleLabel(row.getValue("role") as string)}</Badge>,
      },
    ]

    if (canManageUsers) {
      columns.push({
        id: "actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={() => void openEditUser(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => openDeleteUser(row.original)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      })
    }

    return columns
  }, [canManageUsers])

  if (!canManageUsers) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Ajustes</h1>
          <p className="mt-1 text-muted-foreground">Configura los parametros del sistema</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>Solo el superusuario puede acceder a este modulo.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Ajustes</h1>
        <p className="mt-1 text-muted-foreground">Configura los parametros del sistema</p>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="users" disabled={!canManageUsers}>
            Usuarios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Informacion de la Empresa</CardTitle>
              <CardDescription>Datos generales de tu empresa</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Razon Social</Label>
                  <Input
                    id="company-name"
                    value={companySettings.name}
                    onChange={(e) => setCompanySettings({ ...companySettings, name: e.target.value })}
                    disabled={isLoading || isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-rif">RIF</Label>
                  <Input
                    id="company-rif"
                    value={companySettings.rif}
                    onChange={(e) => setCompanySettings({ ...companySettings, rif: e.target.value })}
                    disabled={isLoading || isSubmitting}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-address">Direccion</Label>
                <Input
                  id="company-address"
                  value={companySettings.address}
                  onChange={(e) => setCompanySettings({ ...companySettings, address: e.target.value })}
                  disabled={isLoading || isSubmitting}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company-phone">Telefono</Label>
                  <Input
                    id="company-phone"
                    value={companySettings.phone}
                    onChange={(e) => setCompanySettings({ ...companySettings, phone: e.target.value })}
                    disabled={isLoading || isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-email">Email</Label>
                  <Input
                    id="company-email"
                    type="email"
                    value={companySettings.email}
                    onChange={(e) => setCompanySettings({ ...companySettings, email: e.target.value })}
                    disabled={isLoading || isSubmitting}
                  />
                </div>
              </div>
              <Button onClick={handleSaveCompany} disabled={isLoading || isSubmitting}>
                Guardar Cambios
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          {!canManageUsers && (
            <Alert variant="destructive">
              <AlertDescription>Solo usuarios superadmin pueden gestionar usuarios.</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                resetUserForm()
                setIsCreateUserOpen(true)
              }}
              disabled={!canManageUsers || isLoading || isSubmitting}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Usuario
            </Button>
          </div>
          <DataTable columns={userColumns} data={users} />
        </TabsContent>
      </Tabs>

      <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Usuario</DialogTitle>
            <DialogDescription>Ingresa la informacion del usuario.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {userError && (
              <Alert variant="destructive">
                <AlertDescription>{userError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="user-name">Nombre</Label>
              <Input
                id="user-name"
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">Rol</Label>
              <Select value={userForm.role} onValueChange={(value: User["role"]) => setUserForm({ ...userForm, role: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="superadmin">Superadmin</SelectItem>
                  <SelectItem value="finanzas">Finanzas</SelectItem>
                  <SelectItem value="procura">Procura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-password">Contrasena</Label>
              <Input
                id="user-password"
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Preguntas de Seguridad (3)</Label>
              <div className="space-y-3 rounded-md border p-3">
                {userForm.securityQuestions.map((item, index) => (
                  <div key={`create-security-${index}`} className="grid grid-cols-2 gap-2">
                    <Select
                      value={item.questionId || undefined}
                      onValueChange={(value) =>
                        setUserForm({
                          ...userForm,
                          securityQuestions: userForm.securityQuestions.map((question, position) =>
                            position === index ? { ...question, questionId: value } : question,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={`Pregunta ${index + 1}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {securityQuestionsCatalog.map((question) => (
                          <SelectItem key={question.id} value={String(question.id)}>
                            {question.questionText}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="password"
                      placeholder={`Respuesta ${index + 1}`}
                      value={item.answer}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          securityQuestions: userForm.securityQuestions.map((question, position) =>
                            position === index ? { ...question, answer: event.target.value } : question,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateUserOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateUser} disabled={isSubmitting}>
              Crear Usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
            <DialogDescription>Actualiza la informacion del usuario.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {userError && (
              <Alert variant="destructive">
                <AlertDescription>{userError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-user-name">Nombre</Label>
              <Input
                id="edit-user-name"
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user-email">Email</Label>
              <Input
                id="edit-user-email"
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user-role">Rol</Label>
              <Select value={userForm.role} onValueChange={(value: User["role"]) => setUserForm({ ...userForm, role: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="superadmin">Superadmin</SelectItem>
                  <SelectItem value="finanzas">Finanzas</SelectItem>
                  <SelectItem value="procura">Procura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-user-password">Nueva Contrasena (opcional)</Label>
              <Input
                id="edit-user-password"
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Resetear Preguntas de Seguridad (opcional)</Label>
              <div className="space-y-3 rounded-md border p-3">
                {userForm.securityQuestions.map((item, index) => (
                  <div key={`edit-security-${index}`} className="grid grid-cols-2 gap-2">
                    <Select
                      value={item.questionId || undefined}
                      onValueChange={(value) =>
                        setUserForm({
                          ...userForm,
                          securityQuestions: userForm.securityQuestions.map((question, position) =>
                            position === index ? { ...question, questionId: value } : question,
                          ),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={`Pregunta ${index + 1}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {securityQuestionsCatalog.map((question) => (
                          <SelectItem key={question.id} value={String(question.id)}>
                            {question.questionText}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="password"
                      placeholder={`Nueva respuesta ${index + 1}`}
                      value={item.answer}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          securityQuestions: userForm.securityQuestions.map((question, position) =>
                            position === index ? { ...question, answer: event.target.value } : question,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditUserOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEditUser} disabled={isSubmitting}>
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteUserOpen} onOpenChange={setIsDeleteUserOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El usuario "{selectedUser?.name}" sera eliminado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSubmitting}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
