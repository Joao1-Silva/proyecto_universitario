"use client"

import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pencil, Plus } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { localDataSource, resolveDataSource, type DataSource } from "@/lib/data-source"
import type { Supplier } from "@/lib/api-types"
import { getPermissions } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const RIF_REGEX = /^J-\d{8}-\d$/
const E164_REGEX = /^\+[1-9]\d{7,14}$/
const COUNTRY_CODES = ["+58", "+51", "+57", "+1", "+34"]

const buildRifAuto = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 9)
  if (!digits) return "J-"
  if (digits.length <= 8) return `J-${digits}`
  return `J-${digits.slice(0, 8)}-${digits[8]}`
}

const normalizePhoneNumber = (value: string) => value.replace(/\D/g, "")

interface SupplierFormState {
  id?: string
  name: string
  rif: string
  email: string
  phoneCountryCode: string
  phoneNumber: string
  responsible: string
  categoryIds: string[]
  creditDays: number
  isActive: boolean
}

interface SupplierFormErrors {
  name?: string
  rif?: string
  email?: string
  phone?: string
  contact?: string
  responsible?: string
  categoryIds?: string
  creditDays?: string
}

const emptyForm: SupplierFormState = {
  name: "",
  rif: "J-",
  email: "",
  phoneCountryCode: "+58",
  phoneNumber: "",
  responsible: "",
  categoryIds: [],
  creditDays: 0,
  isActive: true,
}

const validateSupplier = (form: SupplierFormState): SupplierFormErrors => {
  const errors: SupplierFormErrors = {}
  const normalizedName = form.name.trim()
  const normalizedEmail = form.email.trim().toLowerCase()
  const normalizedPhoneNumber = normalizePhoneNumber(form.phoneNumber)
  const countryCode = form.phoneCountryCode.trim()
  const normalizedPhone = `${countryCode}${normalizedPhoneNumber}`
  const countryDigits = countryCode.replace(/\D/g, "")
  const e164Digits = `${countryDigits}${normalizedPhoneNumber}`
  const hasEmail = normalizedEmail.length > 0
  const hasPhone = normalizedPhoneNumber.length > 0

  if (normalizedName.length < 3) errors.name = "El nombre o razón social debe tener al menos 3 caracteres."
  if (!RIF_REGEX.test(form.rif.trim())) errors.rif = "RIF inválido. Debe ser J-########-#."
  if (hasEmail && !EMAIL_REGEX.test(normalizedEmail)) errors.email = "Email inválido."

  if (!hasEmail && !hasPhone) {
    errors.contact = "Debes registrar al menos un medio de contacto: teléfono o email."
  }

  if (hasPhone) {
    if (e164Digits.length > 15) {
      errors.phone = "El teléfono no puede superar 15 dígitos (E.164)."
    } else if (!E164_REGEX.test(normalizedPhone)) {
      errors.phone = "Teléfono inválido. Debe cumplir formato E.164."
    }
  }

  if (!form.responsible.trim()) errors.responsible = "El responsable es obligatorio."
  if (form.categoryIds.length === 0) errors.categoryIds = "Debes seleccionar al menos una categoría."
  if (form.creditDays < 0 || form.creditDays > 365) errors.creditDays = "Días de crédito entre 0 y 365."

  return errors
}

const supplierToForm = (supplier: Supplier): SupplierFormState => ({
  id: supplier.id,
  name: supplier.name,
  rif: supplier.rif || "J-",
  email: supplier.email || "",
  phoneCountryCode: supplier.phoneCountryCode || "+58",
  phoneNumber: supplier.phoneNumber || "",
  responsible: supplier.responsible,
  categoryIds: supplier.categoryIds || [],
  creditDays: supplier.creditDays,
  isActive: supplier.isActive ?? supplier.status !== "inactive",
})

export default function SuppliersPage() {
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const permissions = getPermissions(currentUser)
  const { toast } = useToast()

  const [dataSource, setDataSource] = useState<DataSource | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [backendError, setBackendError] = useState("")

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [form, setForm] = useState<SupplierFormState>(emptyForm)
  const [formErrors, setFormErrors] = useState<SupplierFormErrors>({})

  const categoryLookup = useMemo(() => new Map(store.categories.map((cat) => [cat.id, cat.name])), [store.categories])

  const refreshSuppliers = async (source: DataSource) => {
    const records = await source.listSuppliers()
    setSuppliers(records)
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setIsLoading(true)
      setBackendError("")
      try {
        const resolved = await resolveDataSource(true)
        if (cancelled) return

        setDataSource(resolved.dataSource)
        if (resolved.mode !== "API") {
          setBackendError("Modo beta/local activo: Proveedores opera sobre datos JSON locales.")
        }
        try {
          await refreshSuppliers(resolved.dataSource)
        } catch (error) {
          if (resolved.mode === "API") {
            setDataSource(localDataSource)
            setBackendError(
              "Backend API con errores: Proveedores cambia automáticamente a modo beta/local para continuar.",
            )
            await refreshSuppliers(localDataSource)
          } else {
            throw error
          }
        }
        setIsLoading(false)
      } catch (error) {
        if (cancelled) return
        setBackendError(error instanceof Error ? error.message : "No se pudo cargar proveedores.")
        setIsLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setFormErrors({})
    setIsDialogOpen(true)
  }

  const openEdit = (supplier: Supplier) => {
    setForm(supplierToForm(supplier))
    setFormErrors({})
    setIsDialogOpen(true)
  }

  const onFormChange = (next: Partial<SupplierFormState>) => {
    const updated = { ...form, ...next }
    setForm(updated)
    setFormErrors(validateSupplier(updated))
  }

  const saveSupplier = async () => {
    if (!dataSource) return

    const errors = validateSupplier(form)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    const payload = {
      name: form.name.trim(),
      rif: buildRifAuto(form.rif),
      email: form.email.trim().toLowerCase(),
      phoneCountryCode: form.phoneCountryCode,
      phoneNumber: normalizePhoneNumber(form.phoneNumber),
      phoneE164: normalizePhoneNumber(form.phoneNumber)
        ? `${form.phoneCountryCode}${normalizePhoneNumber(form.phoneNumber)}`
        : undefined,
      categoryIds: form.categoryIds,
      responsible: form.responsible.trim(),
      creditDays: Number(form.creditDays),
      isActive: form.isActive,
    }

    try {
      if (form.id) {
        await dataSource.updateSupplier(form.id, payload)
        toast({ title: "Proveedor actualizado", description: "Se guardaron los cambios." })
      } else {
        await dataSource.createSupplier(payload)
        toast({ title: "Proveedor creado", description: "Proveedor registrado correctamente." })
      }

      await refreshSuppliers(dataSource)
      setIsDialogOpen(false)
      setForm(emptyForm)
    } catch (error) {
      toast({
        title: "No se pudo guardar",
        description: error instanceof Error ? error.message : "Intenta nuevamente.",
        variant: "destructive",
      })
    }
  }

  const toggleActive = async (supplier: Supplier, nextActive: boolean) => {
    if (!dataSource) return
    try {
      await dataSource.updateSupplier(supplier.id, { isActive: nextActive })
      await refreshSuppliers(dataSource)
      toast({
        title: nextActive ? "Proveedor activado" : "Proveedor desactivado",
        description: supplier.name,
      })
    } catch (error) {
      toast({
        title: "No se pudo actualizar estado",
        description: error instanceof Error ? error.message : "Intenta nuevamente.",
        variant: "destructive",
      })
    }
  }

  const canView = permissions.canViewSuppliers
  const canManage = permissions.canManageSuppliers
  const canActivate = permissions.canActivateSuppliers

  if (!canView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Proveedores</h1>
          <p className="mt-1 text-muted-foreground">Gestión de proveedores del sistema</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>No tienes permisos para ver proveedores.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Proveedores</h1>
          <p className="mt-1 text-muted-foreground">RIF, teléfono con código internacional y validaciones en tiempo real</p>
        </div>
        <Button onClick={openCreate} disabled={!canManage || isLoading || !dataSource}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo proveedor
        </Button>
      </div>

      {backendError && (
        <Alert variant="destructive">
          <AlertDescription>{backendError}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Categorías</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Cargando proveedores...
                </TableCell>
              </TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No hay proveedores registrados.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => {
                const isActive = supplier.isActive ?? supplier.status !== "inactive"
                return (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <div className="font-medium">{supplier.name}</div>
                      <div className="text-xs text-muted-foreground">{supplier.rif}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{supplier.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {supplier.phoneCountryCode || "+58"} {supplier.phoneNumber || ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {supplier.categoryIds.map((categoryId) => (
                          <Badge key={categoryId} variant="outline">
                            {categoryLookup.get(categoryId) ?? categoryId}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Activo" : "Inactivo"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {canManage && (
                          <Button variant="outline" size="sm" onClick={() => openEdit(supplier)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </Button>
                        )}
                        {canActivate && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void toggleActive(supplier, !isActive)}
                          >
                            {isActive ? "Desactivar" : "Activar"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
            <DialogDescription>
              El RIF se normaliza automáticamente al formato J-########-#. No se permite guardar con errores.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="supplier-name">Nombre</Label>
              <Input
                id="supplier-name"
                value={form.name}
                onChange={(event) => onFormChange({ name: event.target.value })}
                onBlur={() => setFormErrors(validateSupplier(form))}
              />
              {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-rif">RIF</Label>
              <Input
                id="supplier-rif"
                value={form.rif}
                onChange={(event) => onFormChange({ rif: buildRifAuto(event.target.value) })}
                onBlur={() => onFormChange({ rif: buildRifAuto(form.rif) })}
              />
              {formErrors.rif && <p className="text-xs text-destructive">{formErrors.rif}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-email">Email</Label>
              <Input
                id="supplier-email"
                type="email"
                value={form.email}
                onChange={(event) => onFormChange({ email: event.target.value })}
                onBlur={() => setFormErrors(validateSupplier(form))}
              />
              <p className="text-xs text-muted-foreground">Opcional (si no registras teléfono).</p>
              {formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}
            </div>

            <div className="space-y-2">
              <Label>Código país</Label>
              <Select value={form.phoneCountryCode} onValueChange={(value) => onFormChange({ phoneCountryCode: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-phone">Teléfono</Label>
              <Input
                id="supplier-phone"
                value={form.phoneNumber}
                onChange={(event) => onFormChange({ phoneNumber: normalizePhoneNumber(event.target.value) })}
                onBlur={() => setFormErrors(validateSupplier(form))}
                inputMode="numeric"
                maxLength={15}
                placeholder="4121234567"
              />
              {formErrors.phone && <p className="text-xs text-destructive">{formErrors.phone}</p>}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="supplier-resp">Responsable</Label>
              <Input
                id="supplier-resp"
                value={form.responsible}
                onChange={(event) => onFormChange({ responsible: event.target.value })}
                onBlur={() => setFormErrors(validateSupplier(form))}
              />
              {formErrors.responsible && <p className="text-xs text-destructive">{formErrors.responsible}</p>}
              {formErrors.contact && <p className="text-xs text-destructive">{formErrors.contact}</p>}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Categorías</Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-3 md:grid-cols-3">
                {store.categories.map((category) => {
                  const checked = form.categoryIds.includes(category.id)
                  return (
                    <label key={category.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          if (event.target.checked) {
                            onFormChange({ categoryIds: [...form.categoryIds, category.id] })
                          } else {
                            onFormChange({ categoryIds: form.categoryIds.filter((id) => id !== category.id) })
                          }
                        }}
                      />
                      <span>{category.name}</span>
                    </label>
                  )
                })}
              </div>
              {formErrors.categoryIds && <p className="text-xs text-destructive">{formErrors.categoryIds}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-credit">Días de crédito</Label>
              <Input
                id="supplier-credit"
                type="number"
                min={0}
                max={365}
                value={form.creditDays}
                onChange={(event) => onFormChange({ creditDays: Number(event.target.value) })}
                onBlur={() => setFormErrors(validateSupplier(form))}
              />
              {formErrors.creditDays && <p className="text-xs text-destructive">{formErrors.creditDays}</p>}
            </div>

            <div className="space-y-2">
              <Label>Estado</Label>
              <Select
                value={form.isActive ? "active" : "inactive"}
                onValueChange={(value) => onFormChange({ isActive: value === "active" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="inactive">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveSupplier()} disabled={Object.keys(formErrors).length > 0}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
