"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Upload } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Invoice } from "@/lib/api-types"
import { getPermissions } from "@/lib/permissions"
import { createApiClient } from "@/lib/api-client"
import { getCurrentUser, useAppStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { format } from "date-fns"

const MAX_PROOF_SIZE = 1024 * 1024 * 2

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultInvoiceId?: string
  invoices?: Invoice[]
  onSuccess?: () => void | Promise<void>
}

const apiClient = createApiClient({ timeoutMs: 3500, retries: 1 })

const parsePaymentPayload = (payload: unknown): { paymentNumber?: string } | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  return data as { paymentNumber?: string }
}

export function PaymentDialog({ open, onOpenChange, defaultInvoiceId, invoices, onSuccess }: PaymentDialogProps) {
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const permissions = getPermissions(currentUser)
  const canCreatePayments = permissions.canCreatePayments
  const { toast } = useToast()
  const candidateInvoices = invoices ?? store.invoices
  const availableInvoices = useMemo(
    () => candidateInvoices.filter((invoice) => invoice.balance > 0),
    [candidateInvoices],
  )

  const [formError, setFormError] = useState("")
  const [proofName, setProofName] = useState("")
  const [proofUrl, setProofUrl] = useState<string | undefined>(undefined)
  const [formData, setFormData] = useState({
    invoiceId: defaultInvoiceId ?? "",
    date: format(new Date(), "yyyy-MM-dd"),
    amount: 0,
    method: "transfer" as "transfer" | "check" | "cash",
    reference: "",
    reason: "",
  })

  const selectedInvoice = useMemo(
    () => availableInvoices.find((invoice) => invoice.id === formData.invoiceId),
    [availableInvoices, formData.invoiceId],
  )

  useEffect(() => {
    if (!open) return
    const preferredInvoiceId = defaultInvoiceId ?? formData.invoiceId
    const invoice = availableInvoices.find((item) => item.id === preferredInvoiceId) ?? availableInvoices[0]
    setFormData((prev) => ({
      ...prev,
      invoiceId: invoice?.id ?? "",
      amount: invoice?.balance ?? 0,
    }))
  }, [availableInvoices, defaultInvoiceId, open])

  useEffect(() => {
    if (!open) {
      setFormError("")
      setProofName("")
      setProofUrl(undefined)
      setFormData({
        invoiceId: defaultInvoiceId ?? "",
        date: format(new Date(), "yyyy-MM-dd"),
        amount: 0,
        method: "transfer",
        reference: "",
        reason: "",
      })
    }
  }, [defaultInvoiceId, open])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_PROOF_SIZE) {
      toast({
        title: "Archivo demasiado grande",
        description: "El comprobante debe ser menor a 2 MB.",
        variant: "destructive",
      })
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setProofUrl(reader.result?.toString())
      setProofName(file.name)
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = async () => {
    if (!canCreatePayments) {
      setFormError("No tienes permisos para registrar pagos.")
      return
    }
    setFormError("")
    if (!selectedInvoice) {
      setFormError("No hay facturas pendientes disponibles para registrar pago.")
      return
    }
    const response = await apiClient.request<unknown>("POST", "/payments", {
      invoiceId: selectedInvoice.id,
      date: formData.date,
      amount: formData.amount,
      method: formData.method,
      reference: formData.reference,
      reason: formData.reason,
      proofUrl,
    })
    const parsed = response.ok ? parsePaymentPayload(response.data) : null
    if (!response.ok || !parsed) {
      setFormError(response.error ?? "No se pudo registrar el pago.")
      return
    }

    if (onSuccess) {
      await onSuccess()
    }
    toast({ title: "Pago registrado", description: `Pago ${parsed.paymentNumber ?? "creado"} creado.` })
    onOpenChange(false)
  }

  const invoiceSelectionLocked = Boolean(defaultInvoiceId && availableInvoices.some((invoice) => invoice.id === defaultInvoiceId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar Pago</DialogTitle>
          <DialogDescription>Ingresa los datos del pago a proveedor</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {!canCreatePayments && (
            <Alert variant="destructive">
              <AlertDescription>No tienes permisos para registrar pagos.</AlertDescription>
            </Alert>
          )}
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="invoice">Factura *</Label>
            <Select
              value={formData.invoiceId || undefined}
              onValueChange={(value) => {
                const invoice = availableInvoices.find((item) => item.id === value)
                setFormData({
                  ...formData,
                  invoiceId: value,
                  amount: invoice?.balance ?? 0,
                })
              }}
              disabled={invoiceSelectionLocked}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona factura" />
              </SelectTrigger>
              <SelectContent>
                {availableInvoices.map((invoice) => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    {invoice.invoiceNumber} - {invoice.supplierName} -{" "}
                    {new Intl.NumberFormat("es-MX", {
                      style: "currency",
                      currency: "MXN",
                    }).format(invoice.balance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableInvoices.length === 0 && (
              <div className="text-xs text-destructive">
                No hay facturas con saldo pendiente para registrar pagos.
              </div>
            )}
            {selectedInvoice && (
              <div className="text-xs text-muted-foreground">
                Saldo pendiente:{" "}
                {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(selectedInvoice.balance)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Fecha de Pago *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Monto *</Label>
              <Input
                id="amount"
                type="number"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: Number.parseFloat(e.target.value) || 0 })}
                step="0.01"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="method">Método de Pago *</Label>
              <Select
                value={formData.method}
                onValueChange={(value: "transfer" | "check" | "cash") => setFormData({ ...formData, method: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                  <SelectItem value="check">Cheque</SelectItem>
                  <SelectItem value="cash">Efectivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Referencia *</Label>
              <Input
                id="reference"
                value={formData.reference}
                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                placeholder="SPEI-1234567890"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Motivo</Label>
            <Textarea
              id="reason"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              placeholder="Motivo del abono"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proof">Comprobante de Pago</Label>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="w-full bg-transparent" asChild>
                <label htmlFor="proof" className="cursor-pointer">
                  <Upload className="mr-2 h-4 w-4" />
                  {proofName ? proofName : "Subir archivo (PDF, JPG, PNG)"}
                  <input
                    id="proof"
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileChange}
                  />
                </label>
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!selectedInvoice || !canCreatePayments}>
            Registrar Pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
